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
import { RecallIndex } from "../recall/store.js";
import { newPhrase } from "../session-id.js";
import type { Timers } from "../timers.js";
import type { Entry } from "./catalogue.js";
import {
    CLUSTERS_INSTRUCTION,
    READS_INSTRUCTION,
    REVIEW_INSTRUCTIONS,
    REVIEW_TIMEOUT_MS,
    type ReviewQueryFn,
} from "./review.js";
import {
    MemoryService,
    type MemoryServiceOptions,
    type Notice,
    REVIEW_CLAIM_RETRY_MS,
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
function reviews(...answers: (object | Error | "hang")[]) {
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
        reads: [],
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
        await until(async () => (await sidecarOf(LIVE)) !== null);
        expect(await sidecarOf(LIVE)).toEqual({
            ...EMPTY_SIDECAR,
            rev: 1,
            failures: { count: 1, at: NOW.toISOString() },
        });
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

describe("MemoryService with the index", () => {
    let index: RecallIndex;
    beforeEach(() => {
        index = RecallIndex.open(join(dir, "index", "recall.sqlite"));
    });
    afterEach(() => {
        index.close();
    });

    const OTHER = phrase(1);
    const ago = (ms: number) => new Date(NOW.getTime() - ms).toISOString();
    const HOUR = 3_600_000;
    const saved = (of: string, fields: Partial<Sidecar>) =>
        writeFile(
            sidecarPath(dir, of),
            JSON.stringify({ ...EMPTY_SIDECAR, ...fields }),
        );

    it("waits out the back-off before reviewing again", async () => {
        await transcript(OTHER, [user("a"), reply("b")]);
        const failures = { count: 1, at: ago(HOUR / 2) };
        await saved(OTHER, { failures });
        const fake = reviews(NOTES);
        const { memory } = setup({
            queryFn: fake.fn,
            index,
            entries: [entry(OTHER, { failures })],
        });
        memory.ready();
        await settle();
        expect(fake.calls).toHaveLength(0);
    });

    it("counts a failed review on top of earlier ones", async () => {
        await transcript(OTHER, [user("a"), reply("b")]);
        await saved(OTHER, { failures: { count: 2, at: ago(3 * HOUR) } });
        const fake = reviews(new Error("boom"), NOTES);
        const { memory } = setup({
            queryFn: fake.fn,
            index,
            entries: [entry(OTHER, {})],
        });
        memory.ready();
        await until(
            async () => (await sidecarOf(OTHER))?.failures?.count === 3,
        );
        expect((await sidecarOf(OTHER))?.failures?.at).toBe(NOW.toISOString());
    });

    it("counts a timeout, not a review cancelled by quitting", async () => {
        await transcript(OTHER, [user("a"), reply("b")]);
        const timed = setup({
            queryFn: reviews("hang").fn,
            index,
            entries: [entry(OTHER, null)],
        });
        timed.memory.ready();
        await settle();
        timed.timers.advance(REVIEW_TIMEOUT_MS);
        await until(
            async () => (await sidecarOf(OTHER))?.failures?.count === 1,
        );
        timed.memory.stop();

        const LATER = phrase(2);
        await transcript(LATER, [user("a"), reply("b")]);
        const quit = setup({
            queryFn: reviews("hang").fn,
            index,
            entries: [entry(LATER, null)],
        });
        quit.memory.ready();
        await settle();
        quit.memory.stop();
        await settle();
        expect(await sidecarOf(LATER)).toBeNull();
    });

    it("skips a review the user has made pointless", async () => {
        await transcript(OTHER, [user("a"), reply("b")]);
        const owned = mergeEdit(
            null,
            { title: "T", description: "D", abstract: "A" },
            NOW.toISOString(),
        );
        await saved(OTHER, owned);
        const fake = reviews(NOTES);
        const { memory } = setup({
            queryFn: fake.fn,
            index,
            entries: [entry(OTHER, owned)],
        });
        memory.ready();
        await until(
            async () => (await sidecarOf(OTHER))?.reviewedThrough === 2,
        );
        expect(fake.calls).toHaveLength(0);
    });

    it("appraises the reads the conversation made", async () => {
        await transcript(LIVE, [
            user("what did we say?"),
            line("recall", {
                id: "toolu_1",
                ok: true,
                offset: 13,
                tool: "open",
                conversation: OTHER,
                name: OTHER,
                purpose: "the render bug",
                turns: [1, 2],
            }),
            reply("Let me check.\n\nWe said a lot."),
        ]);
        const fake = reviews({
            ...NOTES,
            appraisals: [{ id: "toolu_1", served: "useful" }],
        });
        const { memory } = setup({
            queryFn: fake.fn,
            index,
            entries: [entry(OTHER, { title: "Rendering" })],
        });
        memory.turnEnded();
        await until(
            async () =>
                (await sidecarOf(LIVE))?.appraisals.toolu_1?.served ===
                "useful",
        );
        const call = fake.calls[0];
        expect(call?.prompt).toContain("Let me check.[read toolu_1]");
        expect(call?.prompt).toContain('conversation="Rendering"');
        expect(call?.options.systemPrompt).toEndWith(READS_INSTRUCTION);
        const format = call?.options.outputFormat as
            | { schema: { required: string[] } }
            | undefined;
        expect(format?.schema.required).toContain("appraisals");
    });

    // Another process, opening the index once this one has closed.
    async function claimable(): Promise<boolean> {
        const other = RecallIndex.open(join(dir, "index", "recall.sqlite"));
        try {
            return await other.claim(LIVE, "them", NOW.getTime(), 60_000);
        } finally {
            other.close();
        }
    }

    it("lets go of the claim of a review cut short by quitting", async () => {
        await transcript(LIVE, [user("a"), reply("b")]);
        const own = RecallIndex.open(join(dir, "index", "recall.sqlite"));
        const fake = reviews("hang");
        const { memory } = setup({ queryFn: fake.fn, index: own });
        try {
            memory.turnEnded();
            await until(() => fake.calls.length > 0);
            await memory.stop();
        } finally {
            own.close();
        }
        expect(await claimable()).toBe(true);
    });

    it("lets go of the claim of a review that finishes", async () => {
        await transcript(LIVE, [user("a"), reply("b")]);
        const own = RecallIndex.open(join(dir, "index", "recall.sqlite"));
        const { memory } = setup({ queryFn: reviews(NOTES).fn, index: own });
        try {
            memory.turnEnded();
            await until(async () => (await sidecarOf(LIVE)) !== null);
            await memory.stop();
        } finally {
            own.close();
        }
        expect(await claimable()).toBe(true);
    });

    // A compaction, or another process, holding the conversation's claim.
    async function claimed(of: string): Promise<RecallIndex> {
        const other = RecallIndex.open(join(dir, "index", "recall.sqlite"));
        expect(await other.claim(of, "them", NOW.getTime(), 60_000)).toBe(true);
        return other;
    }

    it("waits for the live conversation's claim, and reviews once it is let go", async () => {
        await transcript(LIVE, [user("a"), reply("b")]);
        const other = await claimed(LIVE);
        const fake = reviews(NOTES);
        const { memory, timers } = setup({ queryFn: fake.fn, index });
        try {
            memory.turnEnded();
            await settle();
            expect(fake.calls).toHaveLength(0);
            timers.advance(REVIEW_CLAIM_RETRY_MS);
            await settle();
            expect(fake.calls).toHaveLength(0);
            await other.release(LIVE, "them");
            timers.advance(REVIEW_CLAIM_RETRY_MS);
            await until(() => fake.calls.length === 1);
            expect(fake.calls).toHaveLength(1);
            await until(async () => (await sidecarOf(LIVE)) !== null);
        } finally {
            other.close();
        }
    });

    it("stops waiting for the claim, unreviewed, when a message is sent or the run stops", async () => {
        await transcript(LIVE, [user("a"), reply("b")]);
        for (const end of ["sent", "stop"] as const) {
            const other = await claimed(LIVE);
            const fake = reviews(NOTES);
            const { memory, timers } = setup({ queryFn: fake.fn, index });
            try {
                memory.turnEnded();
                await settle();
                expect(timers.pending.size).toBe(1);
                if (end === "sent") {
                    memory.sent("next");
                    // Its provisional title holds the index's write lock,
                    // which the other connection's release would wait on.
                    await until(async () => (await sidecarOf(LIVE)) !== null);
                } else {
                    await memory.stop();
                }
                expect(timers.pending.size).toBe(0);
                await other.release(LIVE, "them");
                timers.advance(REVIEW_CLAIM_RETRY_MS);
                await settle();
                expect(fake.calls).toHaveLength(0);
            } finally {
                await memory.stop();
                other.close();
            }
        }
    });

    it("leaves another conversation another process has claimed", async () => {
        await transcript(OTHER, [user("a"), reply("b")]);
        const other = await claimed(OTHER);
        const fake = reviews(NOTES);
        const { memory, timers } = setup({
            queryFn: fake.fn,
            index,
            entries: [entry(OTHER, null)],
        });
        try {
            memory.ready();
            await settle();
            expect(fake.calls).toHaveLength(0);
            expect(timers.pending.size).toBe(0);
        } finally {
            other.close();
        }
    });
});

describe("the block for a compacted session", () => {
    it("leaves the abstracts' tokens out of the budget", () => {
        const { memory } = setup({
            queryFn: reviews().fn,
            config: { ...DEFAULT_CONFIG.memory, budget: 200 },
            entries: [
                entry(phrase(1), { ...NOTES, title: "First" }),
                entry(phrase(2), { ...NOTES, title: "Second" }),
            ],
        });
        expect(memory.block()).toContain("Second");
        expect(memory.block(190)).not.toContain("Second");
    });

    it("tells a review of a compacted conversation how to read it", async () => {
        await transcript(LIVE, [
            user("Old"),
            reply("Older"),
            user("New"),
            reply("Newer"),
        ]);
        await writeFile(
            sidecarPath(dir, LIVE),
            JSON.stringify({
                ...EMPTY_SIDECAR,
                ...NOTES,
                clusters: [
                    {
                        from: 1,
                        through: 2,
                        abstract: "Old.",
                        at: NOW.toISOString(),
                        model: "claude-test",
                    },
                ],
            }),
        );
        const query = reviews(NOTES);
        const { memory } = setup({ queryFn: query.fn });
        memory.turnEnded();
        await until(() => query.calls.length > 0);
        const call = query.calls[0];
        expect(String(call?.options.systemPrompt)).toEndWith(
            CLUSTERS_INSTRUCTION,
        );
        expect(call?.prompt).toContain(
            '<cluster n="1" turns="1-2">Old.</cluster>',
        );
        expect(call?.prompt).not.toContain("Older");
    });
});
