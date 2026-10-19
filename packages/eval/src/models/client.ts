// vim:set expandtab shiftwidth=4 filetype=typescript:
// SPDX-License-Identifier: GPL-3.0-only

//
//
// ~chewygumxx/dorothy.git
// ::: :/packages/eval/src/models/client.ts
//
//

// The models of eval.toml over OpenAI-compatible Chat Completions, with
// one client per role, retries of its own and a cap on calls. The
// client's own retries are off: it does not retry a 429 without headers.

import type { Env } from "@dorothy/core";
import { ChatOpenAI } from "@langchain/openai";
import type { z } from "zod";
import { UsageError } from "../errors.js";
import {
    type EvalConfig,
    type Role,
    type RoleConfig,
    requireRole,
} from "./config.js";

// openevals wraps its judges in LangSmith's tracing, which reads these
// from the environment, as does @langchain/core, under either prefix;
// her data never goes there.
for (const name of [
    "LANGSMITH_TRACING",
    "LANGSMITH_TRACING_V2",
    "LANGCHAIN_TRACING",
    "LANGCHAIN_TRACING_V2",
]) {
    process.env[name] = "false";
}

// fetch without the Authorization header the client adds for its key.
const withoutKey = (input: RequestInfo | URL, init?: RequestInit) => {
    const headers = new Headers(init?.headers);
    headers.delete("authorization");
    return fetch(input, { ...init, headers });
};

export type Message = { role: "system" | "user"; content: string };
export type Completion = {
    text: string;
    input: number;
    output: number;
    ms: number;
};

// --max-calls spent: what is done is kept, and a run resumes.
export class CallCap extends UsageError {}

export type ModelsOptions = {
    env: Env;
    maxCalls?: number | null;
    timeoutMs?: number;
    // The first retry's wait; the second waits twice as long.
    retryMs?: number;
};

const statusOf = (error: unknown) => {
    const status = (error as { status?: unknown } | null)?.status;
    return typeof status === "number" ? status : null;
};

// What a failure with no status says when it is the network's.
const TRANSIENT =
    /timeout|timed out|connection|econn|socket|fetch failed|network/i;

// A value as text, even one with no string form.
const UNPRINTABLE = "a value that cannot be printed";
function printed(value: unknown): string {
    try {
        return String(value);
    } catch {
        return UNPRINTABLE;
    }
}

// A rate limit, a timeout, a server's fault or a lost connection may come
// right; a refusal, or a fault of ours, will not. A failure with a status
// is judged by it alone, whatever its message says.
function retryable(error: unknown): boolean {
    if (error instanceof UsageError) {
        return false;
    }
    const status = statusOf(error);
    if (status === null) {
        const { name, message } =
            error instanceof Error
                ? error
                : { name: "", message: printed(error) };
        return TRANSIENT.test(`${name} ${message}`);
    }
    return status === 408 || status === 429 || status >= 500;
}

// One line for a record: the status and the message's first line, which
// carry no key.
export function failureOf(error: unknown): string {
    const status = statusOf(error);
    const message = (error instanceof Error ? error.message : printed(error))
        .split("\n")[0]
        ?.slice(0, 200);
    return status === null || message?.startsWith(String(status))
        ? (message ?? "failed")
        : `${status} ${message}`;
}

const textOf = (content: unknown): string =>
    typeof content === "string"
        ? content
        : Array.isArray(content)
          ? content
                .map((part) =>
                    typeof part === "object" && part !== null && "text" in part
                        ? String((part as { text: unknown }).text)
                        : "",
                )
                .join("")
          : "";

type Usage = { input_tokens?: number; output_tokens?: number } | undefined;

export class Models {
    #calls = 0;
    readonly #chats = new Map<Role, ChatOpenAI>();
    // Every key read, so no failure carries one into a record.
    readonly #keys = new Set<string>();

    constructor(
        readonly config: EvalConfig,
        readonly options: ModelsOptions,
    ) {}

    get calls(): number {
        return this.#calls;
    }

    #keyOf(found: RoleConfig): string {
        if (found.key === null) {
            // A local server takes any key.
            return "none";
        }
        const key = this.options.env[found.key];
        if (key === undefined || key === "") {
            throw new UsageError(
                `${found.key} is not set: set it with \`bunx dotenvx set ${found.key}\`, then run under \`bunx dotenvx run --\``,
            );
        }
        this.#keys.add(key);
        return key;
    }

    chat(role: Role): ChatOpenAI {
        let chat = this.#chats.get(role);
        if (chat === undefined) {
            const found = requireRole(this.config, role);
            chat = new ChatOpenAI({
                model: found.model,
                apiKey: this.#keyOf(found),
                maxRetries: 0,
                timeout: this.options.timeoutMs ?? 120_000,
                configuration: {
                    baseURL: found.baseUrl,
                    // The client wants a key; a server without one is sent
                    // no Authorization header, not a placeholder Bearer.
                    ...(found.key === null ? { fetch: withoutKey } : {}),
                },
            });
            this.#chats.set(role, chat);
        }
        return chat;
    }

    // Each attempt spends one of --max-calls; a retryable failure is tried
    // twice more, waiting retryMs, then twice that. A cap reached between
    // the tries is said at once, with the failure that was being retried,
    // not after a wait.
    async call<T>(work: () => Promise<T>): Promise<T> {
        const capped = (failure: unknown) => {
            const cap = this.options.maxCalls ?? null;
            if (cap === null || this.#calls < cap) {
                return null;
            }
            // The message alone: a failure's other properties may hold
            // what no redaction reads.
            return new CallCap(
                failure === null
                    ? `reached --max-calls (${cap})`
                    : `reached --max-calls (${cap}) while retrying: ${failureOf(failure)}`,
            );
        };
        const first = capped(null);
        if (first !== null) {
            throw first;
        }
        for (let attempt = 0; ; attempt++) {
            this.#calls++;
            try {
                return await work();
            } catch (error) {
                if (attempt >= 2 || !retryable(error)) {
                    throw this.#redacted(error);
                }
                const failure = this.#redacted(error);
                const stopped = capped(failure);
                if (stopped !== null) {
                    throw stopped;
                }
                await Bun.sleep((this.options.retryMs ?? 2000) * (attempt + 1));
            }
        }
    }

    // A provider may echo a key in its refusal: the error, or the string
    // form of a value that is none, is copied with every key read put out,
    // its status kept.
    #redacted(error: unknown): unknown {
        if (error instanceof UsageError) {
            return error;
        }
        const original =
            error instanceof Error ? error.message : printed(error);
        if (original === UNPRINTABLE) {
            return error;
        }
        let message = original;
        for (const key of this.#keys) {
            message = message.replaceAll(key, "[key]");
        }
        if (message === original) {
            return error;
        }
        const copy = new Error(message);
        (copy as { status?: unknown }).status = statusOf(error) ?? undefined;
        return copy;
    }

    async complete(role: Role, messages: Message[]): Promise<Completion> {
        const chat = this.chat(role);
        const started = performance.now();
        const reply = await this.call(() => chat.invoke(messages));
        const usage = reply.usage_metadata as Usage;
        return {
            text: textOf(reply.content),
            input: usage?.input_tokens ?? 0,
            output: usage?.output_tokens ?? 0,
            ms: Math.round(performance.now() - started),
        };
    }

    async structured<T>(
        role: Role,
        schema: z.ZodType<T>,
        name: string,
        messages: Message[],
    ): Promise<{ value: T; input: number; output: number }> {
        const chat = this.chat(role).withStructuredOutput(schema, {
            name,
            includeRaw: true,
        });
        const reply = (await this.call(async () => {
            try {
                return await chat.invoke(messages);
            } catch (error) {
                // A reply that breaks the schema: no retry mends it.
                if (Array.isArray((error as { issues?: unknown }).issues)) {
                    throw new UsageError(
                        "the model's reply did not match its schema",
                    );
                }
                throw error;
            }
        })) as unknown as { raw: { usage_metadata?: Usage }; parsed: T | null };
        if (reply.parsed === null) {
            throw new UsageError("the model's reply did not match its schema");
        }
        return {
            value: reply.parsed,
            input: reply.raw.usage_metadata?.input_tokens ?? 0,
            output: reply.raw.usage_metadata?.output_tokens ?? 0,
        };
    }
}
