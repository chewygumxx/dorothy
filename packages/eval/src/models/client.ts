// vim:set expandtab shiftwidth=4 filetype=typescript:
// SPDX-License-Identifier: GPL-3.0-only

//
//
// ~chewygumxx/dorothy.git
// ::: :/packages/eval/src/models/client.ts
//
//

// The models of eval.toml over API or subscription CLI routes, with
// retries of our own and a cap on calls. The API client's retries are
// off: it does not retry a 429 without headers.

import type { AIMessage } from "@langchain/core/messages";
import type { ChatGeneration } from "@langchain/core/outputs";
import { ChatOpenAI } from "@langchain/openai";
import { z } from "zod";
import { RunStop, UsageError } from "../errors.js";
import { CliFailure, type CliOptions, cliAttempt } from "./cli.js";
import {
    type ApiConfig,
    type EvalConfig,
    type Role,
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

export type TokenCounts = { input: number; output: number };
export type RoleTokens = Partial<Record<Role, TokenCounts>>;

// --max-calls spent: what is done is kept, and a run resumes.
export class CallCap extends RunStop {}

export type ModelsOptions = CliOptions & {
    findCli?: (command: string, path: string | undefined) => string | null;
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
    if (error instanceof CliFailure) return true;
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
    readonly #tokens: RoleTokens = {};
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

    get tokens(): RoleTokens {
        return structuredClone(this.#tokens);
    }

    #count(role: Role, input: number, output: number): void {
        this.#tokens[role] ??= { input: 0, output: 0 };
        const total = this.#tokens[role];
        total.input += input;
        total.output += output;
    }

    #keyOf(found: ApiConfig): string {
        if (found.key === null) {
            // A local server takes any key.
            return "none";
        }
        const key = this.options.env[found.key];
        if (key === undefined || key === "") {
            throw new UsageError(
                `${found.key} is not set: add it with \`sops edit secrets.json\``,
            );
        }
        this.#keys.add(key);
        return key;
    }

    // Validate credentials before a command opens its corpus or pays for
    // any call. CLI roles never construct an API client.
    prepare(role: Role): void {
        const found = requireRole(this.config, role);
        if (found.via === "claude" || found.via === "codex") {
            const find =
                this.options.findCli ??
                ((command: string, path: string | undefined) =>
                    path ? Bun.which(command, { PATH: path }) : null);
            if (find(found.via, this.options.env.PATH) === null) {
                throw new UsageError(
                    `eval.toml: [models.${role}]: ${found.via} is not on PATH; install it or update PATH`,
                );
            }
        }
        if (found.via === "claude") {
            const token = this.options.env.CLAUDE_CODE_OAUTH_TOKEN;
            if (token === undefined || token === "") {
                throw new UsageError(
                    "CLAUDE_CODE_OAUTH_TOKEN is not set: add it with `sops edit secrets.json`",
                );
            }
            this.#keys.add(token);
        } else if (found.via !== "codex") {
            this.chat(role);
        }
    }

    chat(role: Role): ChatOpenAI {
        let chat = this.#chats.get(role);
        if (chat === undefined) {
            const found = requireRole(this.config, role);
            if (found.via === "claude" || found.via === "codex") {
                throw new UsageError(
                    `the ${role} role uses ${found.via}, not an API client`,
                );
            }
            chat = new ChatOpenAI({
                model: found.model,
                apiKey: this.#keyOf(found),
                // Raw API responses include usage even when downstream
                // schema parsing fails. This also sees openevals' judges.
                callbacks: [
                    {
                        handleLLMEnd: (result) => {
                            const message = (
                                result.generations[0]?.[0] as
                                    | ChatGeneration
                                    | undefined
                            )?.message as AIMessage | undefined;
                            this.#count(
                                role,
                                message?.usage_metadata?.input_tokens ?? 0,
                                message?.usage_metadata?.output_tokens ?? 0,
                            );
                        },
                    },
                ],
                maxRetries: 0,
                timeout:
                    this.options.timeoutMs ??
                    (found.timeoutSeconds ?? 120) * 1000,
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
    // not after a wait, and again after it: callers retrying together
    // each look at the cap just before they spend, with nothing awaited
    // between the look and the spend.
    async call<T>(work: () => Promise<T>, role?: Role): Promise<T> {
        let failure: unknown = null;
        for (let attempt = 0; ; attempt++) {
            this.#spend(failure);
            if (role !== undefined) this.#count(role, 0, 0);
            try {
                return await work();
            } catch (error) {
                if (attempt >= 2 || !retryable(error)) {
                    throw this.#redacted(error);
                }
                failure = this.#redacted(error);
                this.#room(failure);
                await Bun.sleep((this.options.retryMs ?? 2000) * (attempt + 1));
            }
        }
    }

    // Throws the cap if it is spent; the message alone carries the failure
    // being retried, as its other properties may hold what no redaction
    // reads.
    #room(failure: unknown): void {
        const cap = this.options.maxCalls ?? null;
        if (cap !== null && this.#calls >= cap) {
            throw new CallCap(
                failure === null
                    ? `reached --max-calls (${cap})`
                    : `reached --max-calls (${cap}) while retrying: ${failureOf(failure)}`,
            );
        }
    }

    #spend(failure: unknown): void {
        this.#room(failure);
        this.#calls++;
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
        this.prepare(role);
        const found = requireRole(this.config, role);
        const started = performance.now();
        if (found.via === "claude" || found.via === "codex") {
            const reply = await this.call(async () => {
                const done = await cliAttempt(
                    found,
                    messages,
                    undefined,
                    this.options,
                );
                this.#count(role, done.input, done.output);
                return done;
            }, role);
            return {
                text: reply.text,
                input: reply.input,
                output: reply.output,
                ms: Math.round(performance.now() - started),
            };
        }
        const chat = this.chat(role);
        const reply = await this.call(() => chat.invoke(messages), role);
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
        this.prepare(role);
        const found = requireRole(this.config, role);
        if (found.via === "claude" || found.via === "codex") {
            // claude refuses a schema naming its draft; neither CLI needs it.
            const { $schema: _draft, ...jsonSchema } = z.toJSONSchema(schema);
            return this.call(async () => {
                const reply = await cliAttempt(
                    found,
                    messages,
                    jsonSchema,
                    this.options,
                );
                this.#count(role, reply.input, reply.output);
                const parsed = schema.safeParse(reply.value);
                if (!parsed.success) {
                    throw new UsageError(
                        "the model's reply did not match its schema",
                    );
                }
                return {
                    value: parsed.data,
                    input: reply.input,
                    output: reply.output,
                };
            }, role);
        }
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
        }, role)) as unknown as {
            raw: { usage_metadata?: Usage };
            parsed: T | null;
        };
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
