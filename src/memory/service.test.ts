// vim:set expandtab shiftwidth=4 filetype=typescript:
// SPDX-License-Identifier: GPL-3.0-only

//
//
// ~chewygumxx/dorothy.git
// ::: :/src/memory/service.test.ts
//
//

import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { appendFile, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Options, SDKMessage } from "@anthropic-ai/claude-agent-sdk";
import { DEFAULT_CONFIG } from "../config.js";
import { systemPrompt } from "../persona.js";
import { newPhrase } from "../session-id.js";
import type { Entry } from "./catalogue.js";
import { REVIEW_INSTRUCTIONS, type ReviewQueryFn } from "./review.js";
import type { Timers } from "./scheduler.js";
import {
    MemoryService,
    type MemoryServiceOptions,
    type Notice,
} from "./service.js";
import {
    EMPTY_SIDECAR,
    mergeEdit,
    type Notes,
    readSidecar,
    type Sidecar,
    sidecarPath,
    updateSidecar,
} from "./sidecar.js";

const NOW = new Date("2026-10-05T00:00:00.000Z");
const DAY = 86_400_000;
const phrase = (seed: number) =>
    newPhrase(() => Uint8Array.from([seed, 1, 2, 3, 4, 5, 6, 7]));
const LIVE = phrase(9);
const NOTES: Notes = {
    title: "Remembering",
    description: "How Dorothy remembers.",
    abstract: "Notes, tiers and budgets.",
};

const line = (kind: string, fields: object) =>
    JSON.stringify({ v: 1, kind, at: NOW.toISOString(), ...fields });
const user = (text: string) => line("user", { text });
const reply = (text: string) => line("assistant", { text, interrupted: false });

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

// Answers each review in turn: notes, an error, or "hang" (never answers).
function reviews(...answers: (Notes | Error | "hang")[]) {
    const calls: { prompt: string; options: Options }[] = [];
    let closed = 0;
    const fn: ReviewQueryFn = ({ prompt, options }) => {
        calls.push({ prompt, options });
        const answer = answers.shift() ?? new Error("no more answers");
        async function* run(): AsyncGenerator<SDKMessage> {
            if (answer === "hang") {
                await new Promise(() => {});
                return;
            }
            if (answer instanceof Error) {
                throw answer;
            }
            yield {
                type: "system",
                subtype: "init",
                model: "claude-test",
                session_id: "s",
            } as unknown as SDKMessage;
            yield {
                type: "result",
                subtype: "success",
                is_error: false,
                result: "",
                structured_output: answer,
                total_cost_usd: 0.25,
            } as unknown as SDKMessage;
        }
        return Object.assign(run(), {
            close: () => {
                closed++;
            },
        });
    };
    return { fn, calls, closed: () => closed };
}

function entry(
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
        turns,
        lastActive,
    };
}

let dir = "";
beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "dorothy-service-"));
});
afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
});

const transcript = (of: string, lines: string[]) =>
    writeFile(join(dir, `${of}.jsonl`), `${lines.join("\n")}\n`);
const sidecarOf = async (of: string) => {
    const read = await readSidecar(dir, of);
    return read.kind === "ok" ? read.sidecar : null;
};
const settle = () => new Promise((resolve) => setTimeout(resolve, 20));
async function until(check: () => boolean | Promise<boolean>): Promise<void> {
    for (let i = 0; i < 200 && !(await check()); i++) {
        await new Promise((resolve) => setTimeout(resolve, 5));
    }
}

function setup(
    options: Partial<MemoryServiceOptions> & { queryFn: ReviewQueryFn },
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
        now: () => NOW,
        timers,
        ...options,
    });
    memory.subscribe((notice) => notices.push(notice));
    return { memory, notices, timers };
}

describe("MemoryService", () => {
    it("builds the block from the other conversations", () => {
        const { memory } = setup({
            queryFn: reviews().fn,
            entries: [
                entry(phrase(1), { title: "Earlier chat" }),
                entry(LIVE, { title: "This chat" }),
            ],
        });
        expect(memory.block()).toContain("<title>Earlier chat</title>");
        expect(memory.block()).not.toContain("This chat");
    });

    it("writes a provisional title on the first send only", async () => {
        const { memory } = setup({ queryFn: reviews().fn });
        memory.sent("Hey there o/\nsecond line");
        await until(async () => (await sidecarOf(LIVE)) !== null);
        expect(await sidecarOf(LIVE)).toEqual({
            ...EMPTY_SIDECAR,
            rev: 1,
            title: "Hey there o/",
            fields: { title: { by: "prompt", at: NOW.toISOString() } },
        });
        await rm(sidecarPath(dir, LIVE));
        memory.sent("Another message");
        await settle();
        expect(await readSidecar(dir, LIVE)).toEqual({ kind: "none" });
    });

    it("titles a resumed conversation from its first message", async () => {
        const { memory } = setup({
            queryFn: reviews().fn,
            history: [
                { role: "user", text: "Original question" },
                { role: "assistant", text: "An answer" },
            ],
        });
        memory.sent("Follow-up");
        await until(async () => (await sidecarOf(LIVE)) !== null);
        expect((await sidecarOf(LIVE))?.title).toBe("Original question");
    });

    it("reviews after the first reply at once, then after idling", async () => {
        await transcript(LIVE, [user("Hi"), reply("Hello")]);
        const query = reviews(NOTES, { ...NOTES, title: "Second" });
        const { memory, notices, timers } = setup({ queryFn: query.fn });
        memory.turnEnded();
        await until(async () => (await sidecarOf(LIVE)) !== null);
        expect(await sidecarOf(LIVE)).toMatchObject({
            ...NOTES,
            reviewedThrough: 2,
            reviewCostUsd: 0.25,
            fields: {
                title: {
                    by: "dorothy",
                    model: "claude-test",
                    at: NOW.toISOString(),
                    throughTurn: 2,
                },
            },
        });
        expect(notices).toEqual([{ type: "memory-cost", usd: 0.25 }]);

        await appendFile(
            join(dir, `${LIVE}.jsonl`),
            `${user("More")}\n${reply("Sure")}\n`,
        );
        memory.turnEnded();
        await settle();
        expect(query.calls).toHaveLength(1);
        timers.advance(60_000);
        await until(async () => (await sidecarOf(LIVE))?.title === "Second");
        expect((await sidecarOf(LIVE))?.reviewedThrough).toBe(4);
    });

    it("waits for the transcript to flush before a live review", async () => {
        await transcript(LIVE, [user("Hi")]);
        const { memory } = setup({
            queryFn: reviews(NOTES).fn,
            flushed: () => transcript(LIVE, [user("Hi"), reply("Hello")]),
        });
        memory.turnEnded();
        await until(async () => (await sidecarOf(LIVE)) !== null);
        expect((await sidecarOf(LIVE))?.reviewedThrough).toBe(2);
    });

    it("warns of a failed review and writes nothing", async () => {
        await transcript(LIVE, [user("Hi"), reply("Hello")]);
        const { memory, notices } = setup({
            queryFn: reviews(new Error("overloaded")).fn,
        });
        memory.turnEnded();
        await until(() => notices.length > 0);
        expect(notices).toEqual([
            {
                type: "warning",
                message: `memory: couldn't review "${LIVE}": overloaded`,
            },
        ]);
        expect(await readSidecar(dir, LIVE)).toEqual({ kind: "none" });
    });

    it("leaves the user's notes alone", async () => {
        await transcript(LIVE, [user("Hi"), reply("Hello")]);
        await updateSidecar(dir, LIVE, (current) =>
            mergeEdit(current, { title: "Mine" }, NOW.toISOString()),
        );
        const { memory } = setup({ queryFn: reviews(NOTES).fn });
        memory.turnEnded();
        await until(async () => (await sidecarOf(LIVE))?.description != null);
        expect(await sidecarOf(LIVE)).toMatchObject({
            title: "Mine",
            description: NOTES.description,
        });
    });

    it("never writes over a sidecar broken by hand", async () => {
        await transcript(LIVE, [user("Hi"), reply("Hello")]);
        await writeFile(sidecarPath(dir, LIVE), "{ broken");
        const query = reviews(NOTES);
        const { memory } = setup({ queryFn: query.fn });
        memory.sent("Hi");
        memory.turnEnded();
        await settle();
        expect(query.calls).toHaveLength(0);
        expect(await readFile(sidecarPath(dir, LIVE), "utf8")).toBe("{ broken");
    });

    it("catches up stale conversations once, most recent first, up to the cap", async () => {
        const [older, newer, fresh, hidden, broken, oldest] = [
            phrase(1),
            phrase(2),
            phrase(3),
            phrase(4),
            phrase(5),
            phrase(6),
        ];
        for (const of of [older, newer, oldest]) {
            await transcript(of, [user(`from ${of}`), reply("ok")]);
        }
        const query = reviews(NOTES, NOTES, NOTES);
        const { memory } = setup({
            queryFn: query.fn,
            config: { ...DEFAULT_CONFIG.memory, catchUp: 2 },
            entries: [
                entry(older, null, { lastActive: NOW.getTime() - DAY }),
                entry(newer, null),
                entry(fresh, { title: "Fresh", reviewedThrough: 2 }),
                entry(hidden, { title: "Hidden", hidden: true }),
                {
                    ...entry(broken, null),
                    sidecar: { kind: "unparseable", reason: "bad" },
                },
                entry(oldest, null, { lastActive: NOW.getTime() - 2 * DAY }),
            ],
        });
        memory.ready();
        await until(async () => (await sidecarOf(older)) !== null);
        await settle();
        // Again, once that is done: nothing more is caught up.
        memory.ready();
        await settle();
        expect(query.calls).toHaveLength(2);
        expect(query.calls[0]?.prompt).toContain(`from ${newer}`);
        expect(query.calls[1]?.prompt).toContain(`from ${older}`);
    });

    it("rebuilds the block after a catch-up review", async () => {
        const other = phrase(1);
        await transcript(other, [user("Hi"), reply("Hello")]);
        const { memory } = setup({
            queryFn: reviews(NOTES).fn,
            entries: [entry(other, { title: "Old title" })],
        });
        expect(memory.block()).toContain("Old title");
        memory.ready();
        await until(() => memory.block().includes("Remembering"));
        expect(memory.block()).not.toContain("Old title");
    });

    it("reviews with the persona, the other notes and the instructions", async () => {
        const [stale, other] = [phrase(1), phrase(2)];
        await transcript(stale, [user("Hi"), reply("Hello")]);
        const query = reviews(NOTES);
        const { memory } = setup({
            queryFn: query.fn,
            entries: [
                entry(stale, { title: "Stale one" }),
                entry(other, { title: "Other", reviewedThrough: 2 }),
            ],
        });
        memory.ready();
        await until(() => query.calls.length > 0);
        const system = String(query.calls[0]?.options.systemPrompt);
        expect(system.startsWith(systemPrompt)).toBe(true);
        expect(system).toContain("<title>Other</title>");
        expect(system).not.toContain("Stale one");
        expect(system.endsWith(REVIEW_INSTRUCTIONS)).toBe(true);
    });

    it("leaves the live conversation alone when its transcript is not saved", async () => {
        await transcript(LIVE, [user("Hi"), reply("Hello")]);
        const query = reviews(NOTES);
        const { memory } = setup({ queryFn: query.fn, flushed: null });
        memory.sent("Hi");
        memory.turnEnded();
        await settle();
        expect(query.calls).toHaveLength(0);
        expect(await readSidecar(dir, LIVE)).toEqual({ kind: "none" });
    });

    it("warns of pins over the budget once, not after every review", async () => {
        const [pinned, stale] = [phrase(1), phrase(2)];
        await transcript(stale, [user("Hi"), reply("Hello")]);
        const { memory, notices } = setup({
            queryFn: reviews(NOTES).fn,
            config: { ...DEFAULT_CONFIG.memory, budget: 200 },
            entries: [
                entry(pinned, {
                    title: "Pinned",
                    description: "A pin.",
                    abstract: "x".repeat(1000),
                    pinned: true,
                    reviewedThrough: 2,
                }),
                entry(stale, { title: "Stale" }),
            ],
        });
        expect(memory.warnings()).toHaveLength(1);
        memory.ready();
        await until(
            async () => (await sidecarOf(stale))?.title === "Remembering",
        );
        await settle();
        expect(notices).toEqual([{ type: "memory-cost", usd: 0.25 }]);
    });

    it("warns of pins over the budget once, even when a review resizes them", async () => {
        const pinned = phrase(1);
        const fields = {
            title: "Pinned",
            description: "A pin.",
            abstract: "x".repeat(1000),
            pinned: true,
        };
        await transcript(pinned, [user("Hi"), reply("Hello")]);
        await updateSidecar(dir, pinned, () => ({
            ...EMPTY_SIDECAR,
            ...fields,
        }));
        const { memory, notices } = setup({
            queryFn: reviews({ ...NOTES, abstract: "y".repeat(900) }).fn,
            config: { ...DEFAULT_CONFIG.memory, budget: 200 },
            entries: [entry(pinned, fields)],
        });
        expect(memory.warnings()).toHaveLength(1);
        memory.ready();
        await until(
            async () => (await sidecarOf(pinned))?.title === "Remembering",
        );
        await settle();
        expect(memory.block()).toContain("yyyy");
        expect(notices.filter((notice) => notice.type === "warning")).toEqual(
            [],
        );
    });

    it("on stop, cancels the review without a word", async () => {
        await transcript(LIVE, [user("Hi"), reply("Hello")]);
        const query = reviews("hang");
        const { memory, notices } = setup({ queryFn: query.fn });
        memory.turnEnded();
        await until(() => query.calls.length > 0);
        memory.stop();
        await settle();
        expect(query.closed()).toBe(1);
        expect(notices).toEqual([]);
        expect(await readSidecar(dir, LIVE)).toEqual({ kind: "none" });
    });
});
