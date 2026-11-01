// vim:set expandtab shiftwidth=4 filetype=typescript:
// SPDX-License-Identifier: GPL-3.0-only

//
//
// ~chewygumxx/dorothy.git
// ::: :/packages/agent/src/conversation.ts
//
//

// Dorothy's chat session on her own runtime: the session's messages,
// held here, and a turn per message on the chat route through
// runRoute, streamed as core's ConversationEvents.

import {
    type AttemptResult,
    type ChatSession,
    CLOSE_GRACE_MS,
    type ConversationEvent,
    Cooldowns,
    defaultRoutes,
    type Env,
    type Failure,
    label,
    type RawMessage,
    REAL_TIMERS,
    type RecallLaunch,
    type Route,
    type RouteEntry,
    runRoute,
    type SessionStart,
    stepCost,
    type Timers,
    withSection,
} from "@dorothy/core";
import { type ModelMessage, stepCountIs, streamText } from "ai";
import { STALL_MS, secretFailure, Watchdog } from "./attempt.js";
import { stepUsage, unpricedNotice } from "./cost.js";
import { failureOf } from "./failures.js";
import {
    type PersonaMode,
    personaPrompt,
    routeLine,
    withHistory,
} from "./persona.js";
import {
    keyOf,
    languageModel,
    type ModelFactory,
    providerOptions,
} from "./providers.js";
import {
    type ConnectRecall,
    connectRecall,
    type RecallTools,
    recallEnv,
} from "./recall-tools.js";
import { TurnState } from "./turn.js";

export const MAX_STEPS = 10;
export const STEP_LIMIT_WARNING = "the reply stopped after ten tool steps";

// Anthropic's prompt cache: the system prompt, and the latest message.
const BREAKPOINT = {
    anthropic: { cacheControl: { type: "ephemeral" as const } },
};

// A session's start and the persona it speaks with. Every field may be
// left out, for tests and the dump.
export type SessionSetup = Partial<SessionStart> & { persona?: PersonaMode };

export type ConversationSetup = {
    system: string;
    recall: RecallLaunch | null;
    recollect: boolean;
};

// What a session starts with, shared with memory's estimate of a
// compacted session and with --dump-context.
export function conversationSetup(
    {
        history = [],
        memory = "",
        earlier = "",
        recall = null,
        recollect = false,
        persona = "chat",
    }: SessionSetup = {},
    route: Route = defaultRoutes().chat,
): ConversationSetup {
    const prompt = withHistory(
        withSection(
            withSection(
                personaPrompt({ recall: recall !== null, mode: persona }),
                memory,
            ),
            earlier,
        ),
        history,
    );
    return {
        system:
            persona === "chat" ? prompt : `${prompt}\n\n${routeLine(route)}`,
        recall,
        recollect: recall !== null && recollect,
    };
}

export type ConversationDeps = {
    route?: Route;
    cooldowns?: Cooldowns;
    env?: Env;
    model?: ModelFactory;
    connect?: ConnectRecall;
    timers?: Timers;
    stallMs?: number;
    now?: () => number;
};

// A message, and the model that made it, null for the user's and for
// text kept from an interrupted turn.
type Stored = { message: ModelMessage; by: string | null };
type Answer = { messages: ModelMessage[]; limited: boolean };

const describeError = (error: unknown) =>
    error instanceof Error ? error.message : String(error);

async function settleWithin(work: Promise<unknown>, ms: number): Promise<void> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    await Promise.race([
        work,
        new Promise<void>((resolve) => {
            timer = setTimeout(resolve, ms);
        }),
    ]);
    clearTimeout(timer);
}

// A stream part as the raw pane shows it: its type, and a text part's
// text; never a prompt, a header or a key.
function rawOf(part: { type: string; text?: unknown }): RawMessage {
    return part.type === "text-delta"
        ? { type: part.type, event: { delta: part.text } }
        : { type: part.type };
}

// Reasoning belongs to the model that made it; another is sent none.
function withoutReasoning(message: ModelMessage): ModelMessage {
    if (message.role !== "assistant" || typeof message.content === "string") {
        return message;
    }
    return {
        ...message,
        content: message.content.filter((part) => part.type !== "reasoning"),
    };
}

// The user's message as sent: on Anthropic it carries the second cache
// breakpoint, in this copy only, never in the stored session.
const outgoingUser = (text: string, entry: RouteEntry): ModelMessage => ({
    role: "user",
    content: [
        {
            type: "text",
            text,
            ...(entry.kind === "anthropic"
                ? { providerOptions: BREAKPOINT }
                : {}),
        },
    ],
});

export class Conversation implements ChatSession {
    readonly #listeners = new Set<(event: ConversationEvent) => void>();
    readonly #setup: ConversationSetup;
    readonly #route: Route;
    readonly #cooldowns: Cooldowns;
    readonly #env: Env;
    readonly #model: ModelFactory;
    readonly #connect: ConnectRecall;
    readonly #timers: Timers;
    readonly #stallMs: number;
    readonly #now: () => number;
    readonly #id = crypto.randomUUID();
    readonly #messages: Stored[] = [];
    #recall: RecallTools | null = null;
    #started: Promise<void> | null = null;
    #work: Promise<void> = Promise.resolve();
    #turn: AbortController | null = null;
    #interrupted = false;
    #queued = 0;
    #stopQueued = false;
    #closed: Promise<void> | null = null;
    #sessionCost = 0;

    constructor({
        route = defaultRoutes().chat,
        cooldowns = new Cooldowns(),
        env = process.env,
        model = languageModel,
        connect = connectRecall,
        timers = REAL_TIMERS,
        stallMs = STALL_MS,
        now = () => performance.now(),
        ...setup
    }: SessionSetup & ConversationDeps = {}) {
        this.#route = route;
        this.#cooldowns = cooldowns;
        this.#env = env;
        this.#model = model;
        this.#connect = connect;
        this.#timers = timers;
        this.#stallMs = stallMs;
        this.#now = now;
        this.#setup = conversationSetup(setup, route);
    }

    start(): void {
        this.#started ??= this.#begin();
    }

    subscribe(listener: (event: ConversationEvent) => void): () => void {
        this.#listeners.add(listener);
        return () => {
            this.#listeners.delete(listener);
        };
    }

    send(text: string): void {
        this.start();
        this.#queued += 1;
        this.#work = this.#work.then(() => this.#runTurn(text)).catch(() => {});
    }

    async interrupt(): Promise<void> {
        if (this.#turn === null) {
            // A turn still waiting on recall's start ends as interrupted.
            this.#stopQueued = this.#queued > 0;
            return;
        }
        this.#interrupted = true;
        this.#turn.abort();
    }

    // A turn under way may finish within the grace period; then it is
    // stopped, and the recall server closed. Safe to call twice.
    close(): Promise<void> {
        this.#closed ??= (async () => {
            await settleWithin(this.#work, CLOSE_GRACE_MS);
            this.#turn?.abort();
            await settleWithin(this.#work, CLOSE_GRACE_MS);
            // A recall server still starting is closed by #begin.
            await settleWithin(
                this.#started ?? Promise.resolve(),
                CLOSE_GRACE_MS,
            );
            const recall = this.#recall;
            this.#recall = null;
            await recall?.close().catch(() => {});
        })();
        return this.#closed;
    }

    #emit(event: ConversationEvent): void {
        for (const listener of this.#listeners) {
            listener(event);
        }
    }

    // A listener that throws is told of as an error event, once; it never
    // stops the code that was emitting.
    #notify(event: ConversationEvent): void {
        try {
            this.#emit(event);
        } catch (error) {
            this.#fail(error);
        }
    }

    #fail(error: unknown): void {
        if (this.#closed !== null) {
            return;
        }
        try {
            this.#emit({ type: "error", message: describeError(error) });
        } catch {
            // A listener that throws on error is not told twice.
        }
    }

    // Never rejects: a listener throwing at start must not wedge the turns.
    async #begin(): Promise<void> {
        // ready is never emitted inside start(): callers subscribe after.
        await Promise.resolve();
        const { recall, recollect } = this.#setup;
        if (recall !== null) {
            try {
                this.#recall = await this.#connect(
                    recall,
                    recollect,
                    recallEnv(this.#env, this.#route),
                );
            } catch (error) {
                this.#notify({
                    type: "warning",
                    message: `memory: recall is unavailable (${describeError(error)})`,
                });
            }
        }
        if (this.#closed !== null) {
            const late = this.#recall;
            this.#recall = null;
            await late?.close().catch(() => {});
            return;
        }
        const first = this.#route[0];
        this.#notify({
            type: "ready",
            model: first === undefined ? "none" : label(first),
            sessionId: this.#id,
        });
    }

    // A listener may throw: the turn then ends in an error event, and
    // later messages still run.
    async #runTurn(text: string): Promise<void> {
        try {
            await this.#started;
            this.#queued -= 1;
            if (this.#closed !== null) {
                return;
            }
            await this.#turnOf(text);
        } catch (error) {
            this.#turn = null;
            this.#fail(error);
        }
    }

    async #turnOf(text: string): Promise<void> {
        const turn = new TurnState((event) => this.#emit(event), this.#now());
        if (this.#stopQueued) {
            this.#stopQueued = false;
            this.#messages.push({
                message: { role: "user", content: text },
                by: null,
            });
            this.#emit({
                type: "turn-end",
                reply: "",
                interrupted: true,
                stats: turn.stats(0, this.#sessionCost, this.#now()),
                contextTokens: turn.contextTokens(),
            });
            return;
        }
        const controller = new AbortController();
        this.#turn = controller;
        this.#interrupted = false;
        const tried: RouteEntry[] = [];
        const outcome = await runRoute(
            this.#route,
            (entry, signal) => {
                tried.push(entry);
                return this.#attempt(entry, signal, text, turn);
            },
            {
                cooldowns: this.#cooldowns,
                signal: controller.signal,
                deadlineMs: null,
                timers: this.#timers,
            },
        );
        this.#turn = null;
        turn.settleCalls();
        for (const note of outcome.notes) {
            this.#emit({ type: "warning", message: note });
        }
        this.#sessionCost += outcome.costUsd;
        const stats = turn.stats(
            outcome.costUsd,
            this.#sessionCost,
            this.#now(),
        );
        const user: Stored = {
            message: { role: "user", content: text },
            by: null,
        };
        if (outcome.ok) {
            const by = label(outcome.entry);
            this.#messages.push(
                user,
                ...outcome.value.messages.map((message) => ({ message, by })),
            );
            if (outcome.value.limited) {
                this.#emit({ type: "warning", message: STEP_LIMIT_WARNING });
            }
            this.#emit({
                type: "turn-end",
                reply: turn.reply,
                interrupted: false,
                stats,
                contextTokens: turn.contextTokens(),
                model: by,
            });
            return;
        }
        if (outcome.failure.class === "cancelled" && this.#interrupted) {
            this.#messages.push(user);
            if (turn.reply !== "") {
                this.#messages.push({
                    message: { role: "assistant", content: turn.reply },
                    by: null,
                });
            }
            const last = tried.at(-1);
            this.#emit({
                type: "turn-end",
                reply: turn.reply,
                interrupted: true,
                stats,
                contextTokens: turn.contextTokens(),
                ...(last === undefined ? {} : { model: label(last) }),
            });
            return;
        }
        if (this.#closed !== null) {
            return;
        }
        this.#emit({
            type: "error",
            message: outcome.reason,
            ...(turn.reply === "" ? {} : { partial: turn.reply }),
            ...(turn.steps === 0 ? {} : { stats }),
        });
    }

    #outgoing(entry: RouteEntry, text: string): ModelMessage[] {
        const by = label(entry);
        return [
            ...this.#messages.map(({ message, by: from }) =>
                from === null || from === by
                    ? message
                    : withoutReasoning(message),
            ),
            outgoingUser(text, entry),
        ];
    }

    async #attempt(
        entry: RouteEntry,
        signal: AbortSignal,
        text: string,
        turn: TurnState,
    ): Promise<AttemptResult<Answer>> {
        const key = keyOf(entry, this.#env);
        if (key === null) {
            return {
                ok: false,
                failure: secretFailure(entry),
                started: false,
                costUsd: 0,
            };
        }
        const watchdog = new Watchdog(signal, this.#stallMs, this.#timers);
        let costUsd = 0;
        let failure: Failure | null = null;
        let aborted = false;
        let limited = false;
        try {
            const result = streamText({
                model: this.#model(entry, key),
                instructions:
                    entry.kind === "anthropic"
                        ? {
                              role: "system",
                              content: this.#setup.system,
                              providerOptions: BREAKPOINT,
                          }
                        : this.#setup.system,
                messages: this.#outgoing(entry, text),
                ...(this.#recall === null ? {} : { tools: this.#recall.tools }),
                stopWhen: stepCountIs(MAX_STEPS),
                maxRetries: 0,
                abortSignal: watchdog.signal,
                providerOptions: providerOptions(entry),
                onError: () => {},
            });
            for await (const part of result.fullStream) {
                watchdog.touch();
                this.#emit({ type: "sdk", message: rawOf(part) });
                switch (part.type) {
                    case "text-delta":
                        turn.text(part.text, this.#now());
                        break;
                    case "tool-call":
                        turn.call(part.toolCallId, part.toolName, part.input);
                        break;
                    case "tool-result":
                        turn.result(part.toolCallId, part.output);
                        break;
                    case "tool-error":
                        turn.error(part.toolCallId);
                        break;
                    case "finish-step": {
                        const usage = stepUsage(part.usage);
                        turn.step(usage);
                        const cost = stepCost(entry, usage);
                        if (cost === null) {
                            const notice = unpricedNotice(entry);
                            if (notice !== null) {
                                this.#emit({
                                    type: "warning",
                                    message: notice,
                                });
                            }
                        }
                        costUsd += cost ?? 0;
                        limited = part.finishReason === "tool-calls";
                        break;
                    }
                    case "error":
                        failure ??= failureOf(part.error);
                        break;
                    case "abort":
                        aborted = true;
                        break;
                }
            }
            if (aborted) {
                return {
                    ok: false,
                    failure: watchdog.failure(),
                    started: turn.started,
                    costUsd,
                };
            }
            if (failure !== null) {
                return { ok: false, failure, started: turn.started, costUsd };
            }
            const steps = await result.steps;
            return {
                ok: true,
                value: {
                    messages: steps.flatMap((step) => step.response.messages),
                    limited,
                },
                costUsd,
            };
        } catch (error) {
            return {
                ok: false,
                failure: watchdog.signal.aborted
                    ? watchdog.failure()
                    : failureOf(error),
                started: turn.started,
                costUsd,
            };
        } finally {
            watchdog.dispose();
            // An Attempt never throws: a listener may, on a lookup.
            try {
                turn.settleCalls();
            } catch {}
        }
    }
}
