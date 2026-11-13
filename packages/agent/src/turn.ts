// vim:set expandtab shiftwidth=4 filetype=typescript:
// SPDX-License-Identifier: GPL-3.0-only

//
//
// ~xxdorothy/dorothy.git
// ::: :/packages/agent/src/turn.ts
//
//

// One chat turn's progress across its attempts: the reply, the calls
// awaiting results, the usage, and whether anything has happened that
// another model may not repeat.

import {
    type ConversationEvent,
    describeLookup,
    REMEMBER_TOOL,
    type StepUsage,
    type Tool,
    type TurnStats,
    toolOf,
} from "@dorothy/core";

type PendingCall = { tool: Tool; input: unknown; offset: number };
type PendingRemember = { input: unknown; offset: number };

// Characters as the note limits count them, four to a token.
export const estimate = (text: string) => Math.ceil([...text].length / 4);

// A tool result's text: text blocks, or a string.
export function textOf(content: unknown): string {
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

export class TurnState {
    reply = "";
    // Text has streamed or remember has run: no other model may take the
    // turn over.
    started = false;
    ttftMs: number | null = null;
    steps = 0;
    readonly #emit: (event: ConversationEvent) => void;
    readonly #began: number;
    readonly #usage: StepUsage = {
        noCache: 0,
        cacheRead: 0,
        cacheWrite: 0,
        output: 0,
    };
    #lastInput = 0;
    // The next text starts a new step of the reply.
    #afterLookup = false;
    readonly #calls = new Map<string, PendingCall>();
    readonly #remembers = new Map<string, PendingRemember>();

    constructor(emit: (event: ConversationEvent) => void, began: number) {
        this.#emit = emit;
        this.#began = began;
    }

    text(delta: string, at: number): void {
        if (delta === "") {
            return;
        }
        // Text after a lookup starts a new step of the reply.
        const text =
            this.#afterLookup && this.reply !== "" ? `\n\n${delta}` : delta;
        this.#afterLookup = false;
        this.reply += text;
        this.started = true;
        this.ttftMs ??= Math.round(at - this.#began);
        this.#emit({ type: "delta", text });
    }

    // A call of recall's or of remember, kept until its result comes.
    call(id: string, name: string, input: unknown): void {
        const pending = { input, offset: this.reply.length };
        const tool = toolOf(name);
        if (tool !== null && !this.#calls.has(id)) {
            this.#calls.set(id, { tool, ...pending });
        }
        if (name === REMEMBER_TOOL && !this.#remembers.has(id)) {
            this.#remembers.set(id, pending);
            this.started = true;
        }
    }

    // An MCP result: failed when it says isError.
    result(id: string, output: unknown): void {
        const result = output as
            | { content?: unknown; isError?: unknown }
            | undefined;
        this.#settle(id, result?.isError !== true, result?.content);
    }

    // A tool that threw, as when the recall server has gone.
    error(id: string): void {
        this.#settle(id, false, "");
    }

    #settle(id: string, ok: boolean, content: unknown): void {
        const kept = this.#remembers.get(id);
        if (kept !== undefined) {
            this.#remembers.delete(id);
            this.#afterLookup = true;
            this.#emit({
                type: "remember",
                id,
                ok,
                offset: kept.offset,
                input: kept.input,
                output: textOf(content),
            });
            return;
        }
        const call = this.#calls.get(id);
        if (call !== undefined) {
            this.#calls.delete(id);
            this.#afterLookup = true;
            this.#emit({
                type: "lookup",
                id,
                ok,
                offset: call.offset,
                lookup: describeLookup(
                    call.tool,
                    call.input,
                    ok ? textOf(content) : null,
                ),
            });
        }
    }

    // Calls the turn ended without answering, as when it was interrupted.
    settleCalls(): void {
        for (const id of [...this.#calls.keys(), ...this.#remembers.keys()]) {
            this.#settle(id, false, "");
        }
        this.#afterLookup = false;
    }

    step(usage: StepUsage): void {
        this.#usage.noCache += usage.noCache;
        this.#usage.cacheRead += usage.cacheRead;
        this.#usage.cacheWrite += usage.cacheWrite;
        this.#usage.output += usage.output;
        this.#lastInput = usage.noCache + usage.cacheRead + usage.cacheWrite;
        this.steps += 1;
    }

    stats(costUsd: number, sessionCostUsd: number, now: number): TurnStats {
        return {
            inputTokens: this.#usage.noCache,
            cacheReadTokens: this.#usage.cacheRead,
            cacheWriteTokens: this.#usage.cacheWrite,
            outputTokens: this.#usage.output,
            ttftMs: this.ttftMs,
            durationMs: Math.round(now - this.#began),
            costUsd,
            sessionCostUsd,
        };
    }

    // What the next request starts from: what the last one read, plus
    // the reply it added.
    contextTokens(): number {
        return this.#lastInput + estimate(this.reply);
    }
}
