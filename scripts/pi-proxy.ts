// vim:set expandtab shiftwidth=4 filetype=typescript:
// SPDX-License-Identifier: GPL-3.0-only

//
//
// ~chewygumxx/dorothy.git
// ::: :/scripts/pi-proxy.ts
//
//

// The Pi probes' forwarding proxy, shared by the delivery probe and the
// stewardship trial: on loopback, it forwards only Chat Completions for
// one model to one upstream, holds the upstream key and gives Pi a
// synthetic one, counts each request (compaction and retries alike),
// reserves a call's worst cost before forwarding it and settles it from
// the reply's streamed usage. A reply without usage, or a stream cut
// before its end, keeps its reservation and stops every later call, as
// does the turn limit, the wall time or the budget. The clock is
// injectable, so its limits are tested without waiting. Also the
// Featherless catalogue check and the live key's loading, both used live
// alone. This is a probe's, not a gateway: never run by `mise run test`
// against a real upstream.

import { createHash } from "node:crypto";
import { loadCheckoutSecrets } from "../packages/cli/src/claude-hook.js";
import {
    type PiModelSpec,
    readPiCatalog,
} from "../packages/cli/src/hosts/pi/models.js";
import { SYNTHETIC_KEY } from "../packages/cli/src/hosts/pi/testing.js";

export const FEATHERLESS = "https://api.featherless.ai/v1";
export const CATALOGUE = `${FEATHERLESS}/models`;
// The variable config.toml names for Featherless's key.
const LIVE_KEY = "FEATHERLESS_API_KEY";
// USD per million tokens.
export type Price = { input: number; output: number; cacheRead: number };
export type Usage = { prompt: number; completion: number; cached: number };

// One call as the proxy saw it: the request's shape and the reply's,
// never their words. Hashes let a replay be matched to its origin.
export type Call = {
    n: number;
    status: number;
    refused: string | null;
    keys: string[];
    roles: string[];
    tools: string[];
    store: boolean;
    maxCompletionTokens: number | null;
    maxTokens: boolean;
    thinking: unknown;
    syntheticKey: boolean;
    replayedReasoning: string[];
    toolResults: string[];
    reply: {
        reasoning: string | null;
        // The field it streamed reasoning in, which Pi replays it in.
        reasoningField: string | null;
        toolCalls: string[];
        finish: string | null;
        usage: Usage | null;
    };
    reservedUsd: number;
    costUsd: number | null;
};

export type ProxyOptions = {
    upstream: string;
    model: string;
    key: string;
    maxUsd: number;
    maxTurns: number;
    timeoutMs: number;
    contextWindow: number;
    maxTokens: number;
    price: Price;
    // The wall time it forwards for, from its start: by default the turn
    // limit times each call's timeout.
    wallMs?: number;
    // The clock its limits are read on; Date.now by default.
    now?: () => number;
    // An absolute deadline, shared with the trial's startup and cleanup.
    deadlineAt?: number;
};

export type ForwardingProxy = {
    baseUrl: string;
    calls: Call[];
    spentUsd(): number;
    // Why it forwards nothing more, once it stops.
    stopped(): string | null;
    // Forwards nothing more, for this reason (the first one given stays).
    stop(reason: string): void;
    close(): Promise<void>;
};

const digest = (text: string) =>
    createHash("sha256").update(text).digest("hex").slice(0, 16);
const usd = (tokens: number, perMillion: number) =>
    (tokens * perMillion) / 1_000_000;

export const costOf = (used: Usage, price: Price) =>
    usd(used.prompt - used.cached, price.input) +
    usd(used.cached, price.cacheRead) +
    usd(used.completion, price.output);

export type Message = {
    role?: string;
    content?: unknown;
    tool_call_id?: unknown;
} & Partial<Record<(typeof REASONING)[number], unknown>>;

// The fields an OpenAI-compatible reply may stream reasoning in; Pi
// replays it in the one it came in (pi-ai 1.5.0 openai-completions.js).
const REASONING = ["reasoning_content", "reasoning", "reasoning_text"] as const;
const reasoningOf = (value: Partial<Record<string, unknown>>) =>
    REASONING.map((field) => value[field]).find(
        (part): part is string => typeof part === "string" && part !== "",
    );

// The request's shape.
function shapeOf(body: Record<string, unknown>) {
    const messages = (
        Array.isArray(body.messages) ? body.messages : []
    ) as Message[];
    const tools = (Array.isArray(body.tools) ? body.tools : []) as {
        function?: { name?: string };
    }[];
    const kwargs = body.chat_template_kwargs as
        | Record<string, unknown>
        | undefined;
    return {
        keys: Object.keys(body).sort(),
        roles: messages.map((message) => String(message.role)),
        tools: tools.map((tool) => String(tool.function?.name)).sort(),
        store: Object.hasOwn(body, "store"),
        maxCompletionTokens:
            typeof body.max_completion_tokens === "number"
                ? body.max_completion_tokens
                : null,
        maxTokens: Object.hasOwn(body, "max_tokens"),
        thinking: kwargs?.thinking,
        replayedReasoning: messages
            .filter((message) => message.role === "assistant")
            .flatMap((message) => {
                const thought = reasoningOf(message);
                return thought === undefined ? [] : [digest(thought)];
            }),
        toolResults: messages
            .filter((message) => message.role === "tool")
            .map((message) => String(message.tool_call_id)),
    };
}

// What a streamed reply said of itself, read as it passes: `onEnd` once,
// with `cut` where it never ended (Pi cancelled it, the upstream failed
// or the call's time ran out), when its usage cannot be trusted.
function tap(
    body: ReadableStream<Uint8Array>,
    onEnd: (reply: Call["reply"], cut: string | null) => void,
): ReadableStream<Uint8Array> {
    const decoder = new TextDecoder();
    let pending = "";
    let thought = "";
    let field: string | null = null;
    const calls = new Map<number, string>();
    let finishReason: string | null = null;
    let used: Usage | null = null;
    let usageInvalid = false;
    const line = (text: string) => {
        if (!text.startsWith("data:")) return;
        const data = text.slice(5).trim();
        if (data === "") return;
        // The explicit end of the stream: Pi returns on it and may cancel
        // before the HTTP body ends, so settle here, not only at EOF.
        if (data === "[DONE]") {
            end(null);
            return;
        }
        let chunk: {
            choices?: {
                delta?: {
                    tool_calls?: { index?: number; id?: string }[];
                } & Partial<Record<string, unknown>>;
                finish_reason?: string | null;
            }[];
            usage?: {
                prompt_tokens?: number;
                completion_tokens?: number;
                prompt_tokens_details?: { cached_tokens?: number };
            } | null;
        };
        try {
            chunk = JSON.parse(data);
        } catch {
            return;
        }
        for (const choice of chunk.choices ?? []) {
            const delta = choice.delta ?? {};
            const part = reasoningOf(delta);
            if (part !== undefined) {
                thought += part;
                field ??=
                    REASONING.find((name) => delta[name] === part) ?? null;
            }
            for (const call of delta.tool_calls ?? []) {
                const index = call.index ?? 0;
                if (call.id) calls.set(index, call.id);
                else if (!calls.has(index)) calls.set(index, "");
            }
            if (choice.finish_reason) finishReason = choice.finish_reason;
        }
        if (chunk.usage) {
            const prompt = chunk.usage.prompt_tokens;
            const completion = chunk.usage.completion_tokens;
            const cached =
                chunk.usage.prompt_tokens_details?.cached_tokens ?? 0;
            const valid = [prompt, completion, cached].every(
                (value) =>
                    typeof value === "number" &&
                    Number.isSafeInteger(value) &&
                    value >= 0,
            );
            if (!valid || (cached as number) > (prompt as number)) {
                usageInvalid = true;
                used = null;
            } else if (!usageInvalid) {
                used = {
                    prompt: prompt as number,
                    completion: completion as number,
                    cached: cached as number,
                };
            }
        }
    };
    let ended = false;
    const end = (cut: string | null) => {
        if (ended) return;
        ended = true;
        line(pending.trim());
        onEnd(
            {
                reasoning: thought === "" ? null : digest(thought),
                reasoningField: field,
                toolCalls: [...calls.values()],
                finish: finishReason,
                usage: used,
            },
            // DONE settles a complete reply; without a finish marker it is
            // incomplete, however much usage came before it.
            cut ??
                (usageInvalid
                    ? "usage invalid"
                    : finishReason === null
                      ? "stream cut: no finish"
                      : null),
        );
    };
    const reader = body.getReader();
    // Pumped by hand, so a cancel and an error reach `end` as well as the
    // close a TransformStream's flush alone would see.
    return new ReadableStream<Uint8Array>({
        async pull(controller) {
            let read: Awaited<ReturnType<typeof reader.read>>;
            try {
                read = await reader.read();
            } catch (error) {
                // Ended short, as a broken stream reaches Pi: no finish,
                // no [DONE].
                end(`stream cut: ${(error as Error).name}`);
                controller.close();
                return;
            }
            if (read.done) {
                end(null);
                controller.close();
                return;
            }
            controller.enqueue(read.value);
            pending += decoder.decode(read.value, { stream: true });
            const lines = pending.split("\n");
            pending = lines.pop() ?? "";
            for (const text of lines) line(text.trim());
        },
        async cancel(reason) {
            end("stream cut: cancelled");
            await reader.cancel(reason).catch(() => {});
        },
    });
}

// The probe's proxy: Chat Completions for one model, to one upstream,
// within its turns, time and money; anything else refused, and counted.
export function startForwardingProxy(options: ProxyOptions): ForwardingProxy {
    const calls: Call[] = [];
    let spent = 0;
    let held = 0;
    let stop: string | null = null;
    const now = options.now ?? Date.now;
    const deadline =
        options.deadlineAt ??
        now() + (options.wallMs ?? options.maxTurns * options.timeoutMs);
    const active = new Set<AbortController>();
    const activeSettles = new Set<(reason: string) => void>();
    const refuse = (call: Call, reason: string, status = 400) => {
        call.status = status;
        call.refused = reason;
        return new Response(
            JSON.stringify({ error: { message: `probe: ${reason}` } }),
            { status, headers: { "content-type": "application/json" } },
        );
    };
    const server = Bun.serve({
        hostname: "127.0.0.1",
        port: 0,
        idleTimeout: 0,
        async fetch(request) {
            const path = new URL(request.url).pathname;
            const text = await request.text();
            let body: Record<string, unknown> = {};
            try {
                body = JSON.parse(text);
            } catch {}
            const call: Call = {
                n: calls.length + 1,
                status: 0,
                refused: null,
                ...shapeOf(body),
                syntheticKey:
                    request.headers.get("authorization") ===
                    `Bearer ${SYNTHETIC_KEY}`,
                reply: {
                    reasoning: null,
                    reasoningField: null,
                    toolCalls: [],
                    finish: null,
                    usage: null,
                },
                reservedUsd: 0,
                costUsd: null,
            };
            calls.push(call);
            if (request.method !== "POST" || path !== "/v1/chat/completions")
                return refuse(call, `path ${path}`, 404);
            if (body.model !== options.model) return refuse(call, "model");
            if (stop !== null) return refuse(call, stop);
            const outputFields = ["max_completion_tokens", "max_tokens"].filter(
                (field) => Object.hasOwn(body, field),
            );
            if (
                outputFields.some((field) => {
                    const value = body[field];
                    return (
                        typeof value !== "number" ||
                        !Number.isSafeInteger(value) ||
                        value <= 0
                    );
                })
            ) {
                return refuse(call, "invalid output limit");
            }
            const requestedOutput = outputFields.map(
                (field) => body[field] as number,
            );
            const normalized = { ...body };
            const output = Math.min(options.maxTokens, ...requestedOutput);
            normalized.max_completion_tokens = output;
            if (Object.hasOwn(body, "max_tokens"))
                normalized.max_tokens = output;
            const outbound = JSON.stringify(normalized);
            Object.assign(call, shapeOf(normalized));
            const forwarded = calls.filter((c) => c.refused === null).length;
            if (forwarded > options.maxTurns) {
                stop = `turn limit ${options.maxTurns}`;
                return refuse(call, stop);
            }
            if (now() >= deadline) {
                stop = "time limit";
                return refuse(call, stop);
            }
            // The worst this call could cost: a full context in, its
            // largest reply out.
            const out = call.maxCompletionTokens ?? options.maxTokens;
            const reserve =
                usd(options.contextWindow, options.price.input) +
                usd(out, options.price.output);
            if (spent + held + reserve > options.maxUsd) {
                stop = `budget US$${options.maxUsd}`;
                return refuse(call, stop);
            }
            held += reserve;
            call.reservedUsd = reserve;
            // Settled from measured usage, or kept and stopping: a reply
            // without usage, or cut before its end, keeps its reservation.
            let settled = false;
            const settle = (
                reply: Call["reply"],
                cut: string | null = null,
            ) => {
                if (settled) return;
                settled = true;
                held -= reserve;
                activeSettles.delete(settleActive);
                call.reply = reply;
                if (cut !== null) call.refused = cut;
                if (reply.usage === null || cut !== null) {
                    spent += reserve;
                    stop ??= cut ?? "usage unavailable";
                } else {
                    call.costUsd = costOf(reply.usage, options.price);
                    spent += call.costUsd;
                }
            };
            const settleActive = (reason: string) => settle(call.reply, reason);
            activeSettles.add(settleActive);
            const control = new AbortController();
            active.add(control);
            const remaining = Math.max(1, deadline - now());
            const timer = setTimeout(
                () => {
                    stop ??= "time limit";
                    control.abort();
                    settleActive("stream cut: time limit");
                },
                Math.min(options.timeoutMs, remaining),
            );
            let upstream: Response;
            try {
                upstream = await fetch(`${options.upstream}/chat/completions`, {
                    method: "POST",
                    headers: {
                        "content-type": "application/json",
                        accept: "text/event-stream",
                        authorization: `Bearer ${options.key}`,
                    },
                    body: outbound,
                    signal: control.signal,
                });
            } catch (error) {
                clearTimeout(timer);
                active.delete(control);
                settle(
                    call.reply,
                    control.signal.aborted ? "stream cut: time limit" : null,
                );
                call.status = 502;
                call.refused = `upstream ${(error as Error).name}`;
                return new Response("probe: upstream unreachable", {
                    status: 502,
                });
            }
            call.status = upstream.status;
            if (!upstream.ok || upstream.body === null) {
                clearTimeout(timer);
                active.delete(control);
                settle(call.reply);
                return new Response(await upstream.text().catch(() => ""), {
                    status: upstream.status,
                    headers: {
                        "content-type":
                            upstream.headers.get("content-type") ??
                            "application/json",
                    },
                });
            }
            const reply = tap(upstream.body, (seen, cut) => {
                clearTimeout(timer);
                active.delete(control);
                settle(seen, cut);
            });
            // Pi gone mid-reply: its stream may never be read again.
            request.signal.addEventListener("abort", () => {
                control.abort();
                settle(call.reply, "stream cut: client gone");
            });
            return new Response(reply, {
                status: upstream.status,
                headers: { "content-type": "text/event-stream" },
            });
        },
    });
    return {
        baseUrl: `http://127.0.0.1:${server.port}/v1`,
        calls,
        spentUsd: () => spent + held,
        stopped: () => stop,
        stop: (reason) => {
            stop ??= reason;
            for (const finish of [...activeSettles]) finish(reason);
            for (const control of active) control.abort();
        },
        close: async () => {
            stop ??= "proxy closed";
            for (const finish of [...activeSettles]) finish("proxy closed");
            for (const control of active) control.abort();
            await server.stop(true);
        },
    };
}

export type Metadata = {
    checkedAt: string;
    source: string;
    found: boolean;
    contextWindow: number | null;
    maxTokens: number | null;
    price: { input: number | null; output: number | null };
    drift: string[];
};

// The exact current metadata must match the reviewed manifest before a
// key is loaded or a paid resource starts. Unknown is never a zero price.
export function metadataProblem(
    meta: Metadata | null,
    declared: PiModelSpec,
): string | null {
    if (!meta) return "catalogue unavailable";
    if (!meta.found) return "model absent from catalogue";
    if (meta.drift.length > 0)
        return `catalogue drift: ${meta.drift.join("; ")}`;
    const limits = [meta.contextWindow, meta.maxTokens];
    if (
        limits.some(
            (value) =>
                typeof value !== "number" ||
                !Number.isSafeInteger(value) ||
                value <= 0,
        )
    ) {
        return "catalogue limits invalid";
    }
    const prices = [
        meta.price.input,
        meta.price.output,
        declared.price.input,
        declared.price.output,
        declared.price.cacheRead ?? declared.price.input,
    ];
    if (
        prices.some(
            (value) =>
                typeof value !== "number" ||
                !Number.isFinite(value) ||
                value < 0,
        )
    ) {
        return "catalogue prices invalid";
    }
    if (
        !Number.isSafeInteger(declared.contextWindow) ||
        declared.contextWindow <= 0 ||
        !Number.isSafeInteger(declared.maxTokens) ||
        declared.maxTokens <= 0
    ) {
        return "manifest limits invalid";
    }
    return null;
}

// Featherless's public catalogue entry for the model, against the
// committed manifest; drift is said, never written back.
export async function refreshMetadata(
    model: string,
    timeoutMs = 30_000,
): Promise<Metadata> {
    const [declared] = (await readPiCatalog()).filter((m) => m.id === model);
    const response = await fetch(CATALOGUE, {
        signal: AbortSignal.timeout(Math.max(1, timeoutMs)),
    });
    const listed = ((await response.json()) as { data?: unknown[] }).data ?? [];
    const entry = listed.find(
        (item) => (item as { id?: unknown })?.id === model,
    ) as
        | {
              context_length?: number;
              max_completion_tokens?: number;
              pricing?: { input?: number; output?: number };
          }
        | undefined;
    const meta: Metadata = {
        checkedAt: new Date().toISOString(),
        source: CATALOGUE,
        found: entry !== undefined,
        contextWindow: entry?.context_length ?? null,
        maxTokens: entry?.max_completion_tokens ?? null,
        price: {
            input: entry?.pricing?.input ?? null,
            output: entry?.pricing?.output ?? null,
        },
        drift: [],
    };
    const differs = (what: string, seen: unknown, kept: unknown) => {
        if (seen !== kept)
            meta.drift.push(`${what}: ${seen} (manifest ${kept})`);
    };
    if (!meta.found) meta.drift.push(`${model} is not listed`);
    else {
        differs("context_length", meta.contextWindow, declared?.contextWindow);
        differs("max_completion_tokens", meta.maxTokens, declared?.maxTokens);
        differs("pricing.input", meta.price.input, declared?.price.input);
        differs("pricing.output", meta.price.output, declared?.price.output);
    }
    return meta;
}

// The key, from secrets.json through the checkout's loader, into an
// object of its own: never process.env, argv, a file or a log.
export async function liveKey(): Promise<string> {
    const target: Record<string, string | undefined> = {};
    const failure = await loadCheckoutSecrets(target);
    if (failure !== null) throw new Error(`secrets.json: ${failure}`);
    const key = target[LIVE_KEY];
    if (!key) throw new Error(`secrets.json: no ${LIVE_KEY}`);
    return key;
}
