// vim:set expandtab shiftwidth=4 filetype=typescript:
// SPDX-License-Identifier: GPL-3.0-only

//
//
// ~chewygumxx/dorothy.git
// ::: :/src/conversation.ts
//
//

import {
    type Options,
    query,
    type SDKMessage,
    type SDKUserMessage,
} from "@anthropic-ai/claude-agent-sdk";
import {
    ALLOWED_TOOLS,
    describeLookup,
    RECOLLECT_TOOL,
    SERVER_NAME,
    type Tool,
    toolOf,
} from "./contracts/recall.js";
import {
    type ChatSession,
    CLOSE_GRACE_MS,
    type ConversationEvent,
    type TurnStats,
} from "./contracts/session.js";
import { type SessionStart, withSection } from "./contracts/start.js";
import {
    baseOptions,
    cliOptions,
    type PersonaMode,
    personaPrompt,
    withHistory,
} from "./persona.js";

export type QueryHandle = AsyncIterable<SDKMessage> & {
    interrupt(): Promise<unknown>;
    close(): void;
};
export type QueryFn = (params: {
    prompt: AsyncIterable<SDKUserMessage>;
    options: Options;
}) => QueryHandle;

type ResultMessage = Extract<SDKMessage, { type: "result" }>;

type PendingCall = { tool: Tool; input: unknown; offset: number };

// DISABLE_COMPACT keeps the CLI from compacting. If it ever does, the
// conversation it summarised is no longer the one Dorothy's compaction
// planned, so the event is reported as a warning: an error would end the
// turn on screen and lose its reply, while the turn continues as usual.
export const COMPACTED_BY_CLI =
    "the CLI compacted this session itself, despite DISABLE_COMPACT";

// Characters as the note limits count them, four to a token.
const estimate = (text: string) => Math.ceil([...text].length / 4);

// The prompt stream for streaming input mode: one consumer (the SDK), fed by
// send(), finished by end().
class MessageQueue implements AsyncIterable<SDKUserMessage> {
    #items: SDKUserMessage[] = [];
    #wake: (() => void) | null = null;
    #ended = false;

    push(message: SDKUserMessage): void {
        if (this.#ended) {
            return;
        }
        this.#items.push(message);
        this.#wake?.();
    }

    end(): void {
        this.#ended = true;
        this.#wake?.();
    }

    async *[Symbol.asyncIterator](): AsyncGenerator<SDKUserMessage> {
        for (;;) {
            const next = this.#items.shift();
            if (next) {
                yield next;
                continue;
            }
            if (this.#ended) {
                return;
            }
            await new Promise<void>((resolve) => {
                this.#wake = resolve;
            });
            this.#wake = null;
        }
    }
}

// A tool result's text: a string, or text blocks.
function textOf(content: unknown): string {
    if (typeof content === "string") {
        return content;
    }
    return Array.isArray(content)
        ? content
              .map((block) =>
                  typeof block?.text === "string" ? block.text : "",
              )
              .join("")
        : "";
}

async function settleWithin(work: Promise<void>, ms: number): Promise<void> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    await Promise.race([
        work,
        new Promise<void>((resolve) => {
            timer = setTimeout(resolve, ms);
        }),
    ]);
    clearTimeout(timer);
}

// A session's start and the persona it speaks with. Every field may be
// left out, for tests and the dump.
export type SessionSetup = Partial<SessionStart> & { persona?: PersonaMode };

// What a session starts with, shared with --dump-context so that the dump
// shows exactly what a chat would send.
export function conversationOptions({
    history = [],
    memory = "",
    earlier = "",
    recall = null,
    recollect = false,
    persona = "chat",
}: SessionSetup = {}): Options {
    const offered = recall !== null && recollect;
    return {
        ...baseOptions,
        ...cliOptions(),
        systemPrompt: withHistory(
            withSection(
                withSection(
                    personaPrompt({ recall: recall !== null, mode: persona }),
                    memory,
                ),
                earlier,
            ),
            history,
        ),
        ...(recall === null
            ? {}
            : {
                  mcpServers: {
                      [SERVER_NAME]: {
                          type: "stdio",
                          command: recall.command,
                          args: offered
                              ? [...recall.args, "--recollect"]
                              : recall.args,
                      },
                  },
                  allowedTools: offered
                      ? [...ALLOWED_TOOLS, RECOLLECT_TOOL]
                      : ALLOWED_TOOLS,
              }),
    };
}

export class Conversation implements ChatSession {
    readonly #queue = new MessageQueue();
    readonly #listeners = new Set<(event: ConversationEvent) => void>();
    readonly #queryFn: QueryFn;
    readonly #options: Options;
    readonly #recall: boolean;
    #recallWarned = false;
    // Tool calls awaiting their results, by id.
    readonly #calls = new Map<string, PendingCall>();
    // The next text starts a new step of the reply.
    #afterLookup = false;
    #handle: QueryHandle | null = null;
    #done: Promise<void> = Promise.resolve();
    #closed: Promise<void> | null = null;
    #reply = "";
    #streaming = false;
    #interrupted = false;
    #sessionCost = 0;
    #ready = false;
    // What the latest request of this turn read, from its usage.
    #lastInput: number | null = null;

    constructor({
        queryFn = query,
        ...setup
    }: SessionSetup & { queryFn?: QueryFn } = {}) {
        this.#queryFn = queryFn;
        this.#recall = (setup.recall ?? null) !== null;
        this.#options = conversationOptions(setup);
    }

    start(): void {
        const handle = this.#queryFn({
            prompt: this.#queue,
            options: this.#options,
        });
        this.#handle = handle;
        this.#done = this.#pump(handle);
    }

    subscribe(listener: (event: ConversationEvent) => void): () => void {
        this.#listeners.add(listener);
        return () => {
            this.#listeners.delete(listener);
        };
    }

    send(text: string): void {
        this.#streaming = true;
        this.#queue.push({
            type: "user",
            message: { role: "user", content: text },
            parent_tool_use_id: null,
        });
    }

    async interrupt(): Promise<void> {
        if (!this.#streaming || this.#handle === null) {
            return;
        }
        this.#interrupted = true;
        await this.#handle.interrupt();
    }

    // Ending the prompt stream ends the session; the subprocess is terminated
    // only if it has not exited within the grace period. Safe to call twice.
    close(): Promise<void> {
        this.#closed ??= (async () => {
            this.#queue.end();
            await settleWithin(this.#done, CLOSE_GRACE_MS);
            this.#handle?.close();
        })();
        return this.#closed;
    }

    #emit(event: ConversationEvent): void {
        for (const listener of this.#listeners) {
            listener(event);
        }
    }

    async #pump(handle: QueryHandle): Promise<void> {
        try {
            for await (const message of handle) {
                this.#handleMessage(message);
            }
            if (this.#closed === null) {
                this.#fail("Dorothy's session ended unexpectedly.");
            }
        } catch (error) {
            if (this.#closed === null) {
                this.#fail(
                    error instanceof Error ? error.message : String(error),
                );
            }
        } finally {
            this.#streaming = false;
        }
    }

    #handleMessage(message: SDKMessage): void {
        this.#emit({ type: "sdk", message });
        if (
            message.type === "system" &&
            message.subtype === "compact_boundary"
        ) {
            // Its context is replaced, so what the last request read no
            // longer measures it.
            this.#lastInput = null;
            this.#emit({ type: "warning", message: COMPACTED_BY_CLI });
            return;
        }
        if (message.type === "system" && message.subtype === "init") {
            this.#checkRecall(message);
        }
        // The CLI sends init at the start of every turn; only the first one
        // means the session is ready.
        if (
            message.type === "system" &&
            message.subtype === "init" &&
            !this.#ready
        ) {
            this.#ready = true;
            this.#emit({
                type: "ready",
                model: message.model,
                sdkSessionId: message.session_id,
            });
        } else if (
            message.type === "stream_event" &&
            message.event.type === "content_block_delta" &&
            message.event.delta.type === "text_delta"
        ) {
            const text =
                this.#afterLookup && this.#reply !== ""
                    ? `\n\n${message.event.delta.text}`
                    : message.event.delta.text;
            this.#afterLookup = false;
            this.#reply += text;
            this.#emit({ type: "delta", text });
        } else if (message.type === "assistant") {
            // A subagent's request reads its own context, not this one.
            const usage = message.message.usage;
            if (
                message.parent_tool_use_id === null &&
                usage !== undefined &&
                usage !== null
            ) {
                this.#lastInput =
                    usage.input_tokens +
                    (usage.cache_read_input_tokens ?? 0) +
                    (usage.cache_creation_input_tokens ?? 0);
            }
            for (const block of message.message.content) {
                const tool =
                    block.type === "tool_use" ? toolOf(block.name) : null;
                if (
                    block.type === "tool_use" &&
                    tool !== null &&
                    !this.#calls.has(block.id)
                ) {
                    this.#calls.set(block.id, {
                        tool,
                        input: block.input,
                        offset: this.#reply.length,
                    });
                }
            }
        } else if (message.type === "user") {
            const { content } = message.message;
            for (const block of Array.isArray(content) ? content : []) {
                if (block.type !== "tool_result") {
                    continue;
                }
                const call = this.#calls.get(block.tool_use_id);
                if (call === undefined) {
                    continue;
                }
                this.#calls.delete(block.tool_use_id);
                const ok = block.is_error !== true;
                this.#lookup(
                    block.tool_use_id,
                    call,
                    ok,
                    ok ? textOf(block.content) : null,
                );
            }
        } else if (
            message.type === "result" &&
            message.is_error &&
            !this.#interrupted
        ) {
            // API failures (auth, rate limit, overload) do not throw: the turn
            // ends with an error result carrying the text instead of a reply.
            this.#settleCalls();
            const text =
                message.subtype === "success"
                    ? message.result
                    : message.errors.join("; ");
            this.#fail(text || message.subtype);
            this.#streaming = false;
            this.#lastInput = null;
        } else if (message.type === "result") {
            this.#settleCalls();
            const stats = this.#stats(message);
            const read =
                this.#lastInput ??
                stats.inputTokens +
                    stats.cacheReadTokens +
                    stats.cacheWriteTokens;
            this.#emit({
                type: "turn-end",
                reply: this.#reply,
                interrupted: this.#interrupted,
                stats,
                contextTokens: read + estimate(this.#reply),
            });
            this.#reply = "";
            this.#interrupted = false;
            this.#streaming = false;
            this.#lastInput = null;
        }
    }

    #lookup(
        id: string,
        call: PendingCall,
        ok: boolean,
        result: string | null,
    ): void {
        this.#afterLookup = true;
        this.#emit({
            type: "lookup",
            id,
            ok,
            offset: call.offset,
            lookup: describeLookup(call.tool, call.input, result),
        });
    }

    // Calls the turn ended without answering, as when it was interrupted.
    #settleCalls(): void {
        for (const [id, call] of this.#calls) {
            this.#lookup(id, call, false, null);
        }
        this.#calls.clear();
        this.#afterLookup = false;
    }

    // The init message lists the MCP servers; a server still starting is
    // not a failure, and init repeats every turn, so this warns once.
    #checkRecall(message: {
        mcp_servers?: { name: string; status: string }[];
    }): void {
        const servers = message.mcp_servers;
        if (!this.#recall || this.#recallWarned || !Array.isArray(servers)) {
            return;
        }
        const server = servers.find((entry) => entry.name === SERVER_NAME);
        if (server === undefined || server.status === "failed") {
            this.#recallWarned = true;
            this.#emit({
                type: "warning",
                message: `memory: recall is unavailable (${server?.status ?? "not started"})`,
            });
        }
    }

    #fail(message: string): void {
        this.#settleCalls();
        const partial = this.#reply;
        this.#reply = "";
        this.#interrupted = false;
        this.#emit(
            partial
                ? { type: "error", message, partial }
                : { type: "error", message },
        );
    }

    #stats(result: ResultMessage): TurnStats {
        // total_cost_usd is the session's running total, so a turn costs the
        // difference from the previous result. A total that went down is not
        // trusted as a new baseline.
        const costUsd = Math.max(0, result.total_cost_usd - this.#sessionCost);
        this.#sessionCost = Math.max(this.#sessionCost, result.total_cost_usd);
        return {
            inputTokens: result.usage.input_tokens,
            cacheReadTokens: result.usage.cache_read_input_tokens ?? 0,
            cacheWriteTokens: result.usage.cache_creation_input_tokens ?? 0,
            outputTokens: result.usage.output_tokens,
            ttftMs:
                result.subtype === "success" ? (result.ttft_ms ?? null) : null,
            durationMs: result.duration_ms,
            costUsd,
            sessionCostUsd: result.total_cost_usd,
        };
    }
}
