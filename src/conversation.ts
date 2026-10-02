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
import { baseOptions, type Turn, withHistory } from "./persona.js";

export type TurnStats = {
    inputTokens: number;
    outputTokens: number;
    ttftMs: number | null;
    durationMs: number;
    costUsd: number;
    sessionCostUsd: number;
};

export type ConversationEvent =
    | { type: "ready"; model: string; sdkSessionId: string }
    | { type: "delta"; text: string }
    | {
          type: "turn-end";
          reply: string;
          interrupted: boolean;
          stats: TurnStats;
      }
    | { type: "sdk"; message: SDKMessage }
    | { type: "error"; message: string };

export type QueryHandle = AsyncIterable<SDKMessage> & {
    interrupt(): Promise<unknown>;
    close(): void;
};
export type QueryFn = (params: {
    prompt: AsyncIterable<SDKUserMessage>;
    options: Options;
}) => QueryHandle;

export interface ChatSession {
    subscribe(listener: (event: ConversationEvent) => void): () => void;
    send(text: string): void;
    interrupt(): Promise<void>;
    close(): Promise<void>;
}

type ResultMessage = Extract<SDKMessage, { type: "result" }>;

// How long close() waits for the subprocess to exit on its own before
// terminating it.
const CLOSE_GRACE_MS = 2000;

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

export class Conversation implements ChatSession {
    readonly #queue = new MessageQueue();
    readonly #listeners = new Set<(event: ConversationEvent) => void>();
    readonly #queryFn: QueryFn;
    readonly #options: Options;
    #handle: QueryHandle | null = null;
    #done: Promise<void> = Promise.resolve();
    #closed: Promise<void> | null = null;
    #reply = "";
    #streaming = false;
    #interrupted = false;
    #sessionCost = 0;

    constructor({
        history = [],
        queryFn = query,
    }: { history?: readonly Turn[]; queryFn?: QueryFn } = {}) {
        this.#queryFn = queryFn;
        this.#options = {
            ...baseOptions,
            systemPrompt: withHistory(baseOptions.systemPrompt, history),
        };
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
                this.#emit({
                    type: "error",
                    message: "Dorothy's session ended unexpectedly.",
                });
            }
        } catch (error) {
            if (this.#closed === null) {
                this.#emit({
                    type: "error",
                    message:
                        error instanceof Error ? error.message : String(error),
                });
            }
        } finally {
            this.#streaming = false;
        }
    }

    #handleMessage(message: SDKMessage): void {
        this.#emit({ type: "sdk", message });
        if (message.type === "system" && message.subtype === "init") {
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
            this.#reply += message.event.delta.text;
            this.#emit({ type: "delta", text: message.event.delta.text });
        } else if (message.type === "result") {
            this.#emit({
                type: "turn-end",
                reply: this.#reply,
                interrupted: this.#interrupted,
                stats: this.#stats(message),
            });
            this.#reply = "";
            this.#interrupted = false;
            this.#streaming = false;
        }
    }

    #stats(result: ResultMessage): TurnStats {
        // total_cost_usd is the session's running total, so a turn costs the
        // difference from the previous result.
        const costUsd = result.total_cost_usd - this.#sessionCost;
        this.#sessionCost = result.total_cost_usd;
        return {
            inputTokens: result.usage.input_tokens,
            outputTokens: result.usage.output_tokens,
            ttftMs:
                result.subtype === "success" ? (result.ttft_ms ?? null) : null,
            durationMs: result.duration_ms,
            costUsd,
            sessionCostUsd: result.total_cost_usd,
        };
    }
}
