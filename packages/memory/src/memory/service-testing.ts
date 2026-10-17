// vim:set expandtab shiftwidth=4 filetype=typescript:
// SPDX-License-Identifier: GPL-3.0-only

//
//
// ~chewygumxx/dorothy.git
// ::: :/packages/memory/src/memory/service-testing.ts
//
//

// The fixtures MemoryService's tests share, and each test's directory.

import { afterEach, beforeEach } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
    DEFAULT_CONFIG,
    type Notice,
    newPhrase,
    type StructuredCall,
    type Timers,
} from "@dorothy/core";
import type { Entry } from "./catalogue.js";
import { MemoryService, type MemoryServiceOptions } from "./service.js";
import {
    EMPTY_SIDECAR,
    type Notes,
    readSidecar,
    type Sidecar,
} from "./sidecar.js";

export const NOW = new Date("2026-10-05T00:00:00.000Z");
export const PERSONA = "You are Dorothy, under test.";
export const DAY = 86_400_000;
export const phrase = (seed: number) =>
    newPhrase(() => Uint8Array.from([seed, 1, 2, 3, 4, 5, 6, 7]));
export const LIVE = phrase(9);
export const NOTES: Notes = {
    title: "Remembering",
    description: "How Dorothy remembers.",
    abstract: "Notes, tiers and budgets.",
};

export const line = (kind: string, fields: object) =>
    JSON.stringify({ v: 1, kind, at: NOW.toISOString(), ...fields });
export const user = (text: string) => line("user", { text });
export const reply = (text: string) =>
    line("assistant", { text, interrupted: false });

class FakeTimers implements Timers {
    #next = 1;
    #now = 0;
    readonly pending = new Map<number, { fn: () => void; at: number }>();
    set(fn: () => void, ms: number): number {
        const id = this.#next++;
        this.pending.set(id, { fn, at: this.#now + ms });
        return id;
    }
    clear(handle: unknown): void {
        this.pending.delete(handle as number);
    }
    advance(ms: number): void {
        this.#now += ms;
        for (const [id, timer] of [...this.pending]) {
            if (timer.at <= this.#now) {
                this.pending.delete(id);
                timer.fn();
            }
        }
    }
}

// Answers each review in turn: notes, an error, "timeout" (fails as a
// call that timed out does) or "hang" (answers only once cancelled).
// Calls are kept in the shape the assertions read, the system prompt and
// schema under options.
export function reviews(...answers: (object | Error | "hang" | "timeout")[]) {
    const calls: {
        prompt: string;
        options: {
            systemPrompt: string;
            outputFormat: {
                type: "json_schema";
                schema: Record<string, unknown>;
            };
        };
    }[] = [];
    let closed = 0;
    const fn: StructuredCall = async ({ system, prompt, schema, signal }) => {
        calls.push({
            prompt,
            options: {
                systemPrompt: system,
                outputFormat: { type: "json_schema", schema },
            },
        });
        const answer = answers.shift() ?? new Error("no more answers");
        if (answer === "hang") {
            await new Promise<void>((resolve) => {
                if (signal?.aborted) {
                    resolve();
                    return;
                }
                signal?.addEventListener("abort", () => resolve(), {
                    once: true,
                });
            });
            closed++;
            return { ok: false, reason: "cancelled", costUsd: 0 };
        }
        if (answer === "timeout") {
            return { ok: false, reason: "timed out after 120s", costUsd: 0 };
        }
        if (answer instanceof Error) {
            return { ok: false, reason: answer.message, costUsd: 0 };
        }
        return {
            ok: true,
            output: answer,
            model: "claude-test",
            costUsd: 0.25,
        };
    };
    return { fn, calls, closed: () => closed };
}

export function entry(
    of: string,
    fields: Partial<Sidecar> | null,
    { turns = 2, lastActive = NOW.getTime() } = {},
): Entry {
    return {
        phrase: of,
        sidecar:
            fields === null
                ? { kind: "none" }
                : { kind: "ok", sidecar: { ...EMPTY_SIDECAR, ...fields } },
        visits: [{ userTurns: 1, lastAt: lastActive }],
        reads: [],
        turns,
        lastActive,
    };
}

// Each test's own directory, made before it and removed after.
export let dir = "";
export function useTempDir(): void {
    beforeEach(async () => {
        dir = await mkdtemp(join(tmpdir(), "dorothy-service-"));
    });
    afterEach(async () => {
        await rm(dir, { recursive: true, force: true });
    });
}

export const transcript = (of: string, lines: string[]) =>
    writeFile(join(dir, `${of}.jsonl`), `${lines.join("\n")}\n`);
export const sidecarOf = async (of: string) => {
    const read = await readSidecar(dir, of);
    return read.kind === "ok" ? read.sidecar : null;
};
export const settle = () => new Promise((resolve) => setTimeout(resolve, 20));
export async function until(
    check: () => boolean | Promise<boolean>,
): Promise<void> {
    for (let i = 0; i < 200 && !(await check()); i++) {
        await new Promise((resolve) => setTimeout(resolve, 5));
    }
}

export function setup(
    options: Partial<MemoryServiceOptions> & { call: StructuredCall },
) {
    const timers = new FakeTimers();
    const notices: Notice[] = [];
    const memory = new MemoryService({
        dir,
        phrase: LIVE,
        history: [],
        config: DEFAULT_CONFIG.memory,
        entries: [],
        flushed: async () => {},
        persona: PERSONA,
        now: () => NOW,
        timers,
        ...options,
    });
    memory.subscribe((notice) => notices.push(notice));
    return { memory, notices, timers };
}
