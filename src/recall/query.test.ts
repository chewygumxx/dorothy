// vim:set expandtab shiftwidth=4 filetype=typescript:
// SPDX-License-Identifier: GPL-3.0-only

//
//
// ~chewygumxx/dorothy.git
// ::: :/src/recall/query.test.ts
//
//

import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { EMPTY_SIDECAR, type Sidecar, sidecarPath } from "../memory/sidecar.js";
import { newPhrase } from "../session-id.js";
import {
    NO_CLUSTER,
    NOT_FOUND,
    openConversation,
    RecallError,
    recollect,
    search,
    termsOf,
    WINDOW_TOKENS,
    windowOf,
} from "./query.js";
import { RecallIndex } from "./store.js";
import { syncIndex } from "./sync.js";

const phrase = (seed: number) =>
    newPhrase(() => Uint8Array.from([seed, 1, 2, 3, 4, 5, 6, 7]));
const A = phrase(1);
const B = phrase(2);
const C = phrase(3);
const LIVE = phrase(9);
const OWN = phrase(8);
const LONG = phrase(7);
// Local noon on the day, so dates read the same in every time zone.
const day = (date: number, minute = 0) =>
    new Date(2026, 9, date, 12, minute).toISOString();
const line = (kind: string, at: string, fields: object) =>
    `${JSON.stringify({ v: 1, kind, at, ...fields })}\n`;
const session = (at: string) =>
    line("session", at, {
        phrase: "p",
        sdkSessionId: "s",
        model: "m",
        promptHash: "h",
        resumed: false,
    });
const user = (at: string, text: string) => line("user", at, { text });
const reply = (at: string, text: string) =>
    line("assistant", at, { text, interrupted: false });

let dir = "";
let index: RecallIndex;
const OPTIONS = { exclude: LIVE, now: Date.parse(day(20)), halfLifeDays: 30 };
beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "dorothy-query-"));
    index = RecallIndex.open(join(dir, "index", "recall.sqlite"));
});
afterEach(async () => {
    index.close();
    await rm(dir, { recursive: true, force: true });
});

async function conversation(
    of: string,
    lines: string[],
    notes: Partial<Sidecar> | null = null,
): Promise<void> {
    await writeFile(join(dir, `${of}.jsonl`), lines.join(""));
    if (notes !== null) {
        await writeFile(
            sidecarPath(dir, of),
            JSON.stringify({ ...EMPTY_SIDECAR, ...notes }),
        );
    }
}
const found = (input: Parameters<typeof search>[1]) =>
    search(index, input, OPTIONS).results.map((hit) => hit.identifier);

beforeEach(async () => {
    await conversation(
        A,
        [
            session(day(4)),
            user(
                day(4),
                "Text artefacts from render malfunction pollute the view.",
            ),
            reply(
                day(4, 1),
                "Keeping the garbage under 30% is a real milestone.",
            ),
        ],
        { title: "Terminal rendering chaos", description: "Render artefacts." },
    );
    await conversation(
        B,
        [
            session(day(10)),
            user(day(10), "Shall we bake a café au lait cake?"),
            reply(day(10, 1), "A coffee cake, yes."),
        ],
        { title: "Baking", description: "Weekend pastry plans." },
    );
    await conversation(
        C,
        [session(day(12)), user(day(12), "render me a poem")],
        {
            title: "Poetry",
            hidden: true,
        },
    );
    await conversation(LIVE, [session(day(20)), user(day(20), "render again")]);
    await syncIndex(index, dir);
});

describe("termsOf", () => {
    it("quotes each word, doubling quotes, at most 16", () => {
        expect(termsOf('  say "hi"  now ')).toEqual([
            '"say"',
            '"""hi"""',
            '"now"',
        ]);
        expect(
            termsOf(Array.from({ length: 20 }, (_, i) => `w${i}`).join(" ")),
        ).toHaveLength(16);
        expect(termsOf("   ")).toEqual([]);
    });
});

describe("search", () => {
    it("finds stemmed words, unaccented, with snippets", () => {
        const result = search(index, { query: "rendering" }, OPTIONS);
        expect(result.results.map((hit) => hit.identifier)).toEqual([A]);
        expect(result.results[0]).toMatchObject({
            "@type": "Conversation",
            identifier: A,
            name: "Terminal rendering chaos",
            description: "Render artefacts.",
            dateCreated: "2026-10-04",
            dateModified: "2026-10-04",
        });
        expect(result.results[0]?.matches[0]).toEqual({
            turn: 1,
            role: "user",
            text: expect.stringContaining("«render»"),
        });
        expect(found({ query: "cafe" })).toEqual([B]);
    });

    it("leaves out hidden conversations and the excluded one", () => {
        expect(found({ query: "render" })).toEqual([A]);
        expect(
            search(index, { query: "render" }, { ...OPTIONS, exclude: null })
                .results.map((hit) => hit.identifier)
                .sort(),
        ).toEqual([A, LIVE].sort());
    });

    it("needs every word, then settles for any", () => {
        expect(found({ query: "garbage milestone" })).toEqual([A]);
        expect(found({ query: "garbage cake" }).sort()).toEqual([A, B].sort());
    });

    it("finds a conversation by its notes, with no matches", () => {
        const result = search(index, { query: "pastry" }, OPTIONS);
        expect(result.results).toEqual([
            expect.objectContaining({ identifier: B, matches: [] }),
        ]);
    });

    it("bounds by local dates, inclusive", () => {
        expect(found({ query: "render cake", after: "2026-10-05" })).toEqual([
            B,
        ]);
        expect(found({ query: "render cake", before: "2026-10-04" })).toEqual([
            A,
        ]);
        expect(
            found({
                query: "render cake",
                after: "2026-10-04",
                before: "2026-10-10",
            }).sort(),
        ).toEqual([A, B].sort());
    });

    it("refuses dates written loosely", () => {
        for (const after of ["last week", "2026-02-30", "2026-1-5"]) {
            expect(() => search(index, { query: "x", after }, OPTIONS)).toThrow(
                new RecallError("after must be a date like 2026-10-05."),
            );
        }
        expect(() =>
            search(index, { query: "x", before: "soon" }, OPTIONS),
        ).toThrow("before must be a date like 2026-10-05.");
    });

    it("refuses an empty query", () => {
        expect(() => search(index, { query: " \n " }, OPTIONS)).toThrow(
            "Give some words or tags to search for.",
        );
    });

    it("treats FTS5 syntax and bare punctuation as text", () => {
        for (const query of [
            "NEAR(render",
            '"',
            "???",
            "-x",
            "render*",
            "a OR",
        ]) {
            expect(() => search(index, { query }, OPTIONS)).not.toThrow();
        }
        expect(found({ query: "???" })).toEqual([]);
    });

    it("limits results, clamped, and counts the rest", () => {
        const many = search(index, { query: "render cake", limit: 1 }, OPTIONS);
        expect(many.results).toHaveLength(1);
        expect(many.more).toBe(1);
        expect(
            search(index, { query: "render cake", limit: 0 }, OPTIONS).results,
        ).toHaveLength(1);
        expect(
            search(index, { query: "render cake", limit: 99 }, OPTIONS).results,
        ).toHaveLength(2);
    });

    it("breaks a tie in relevance by salience, not by name", async () => {
        // The busier conversation sorts later, so a tie broken by name
        // would put it second.
        const [early, late] = [phrase(4), phrase(5)].sort() as [string, string];
        await conversation(early, [
            session(day(6)),
            user(day(6), "zebra crossing"),
        ]);
        await conversation(late, [
            session(day(6)),
            user(day(6), "zebra crossing"),
            session(day(7)),
            user(day(7), "elsewhere"),
        ]);
        await syncIndex(index, dir);
        expect(found({ query: "zebra" })).toEqual([late, early]);
    });
});

describe("openConversation", () => {
    it("opens a conversation with its notes and a window", () => {
        const result = openConversation(
            index,
            { conversation: A, purpose: "the render bug", turn: 2 },
            OPTIONS,
        );
        expect(result).toMatchObject({
            identifier: A,
            name: "Terminal rendering chaos",
            turns: 2,
        });
        expect(result.window.map((turn) => turn.turn)).toEqual([1, 2]);
        expect(result.window[0]?.at).toBe(new Date(day(4)).toISOString());
    });

    it("says the same of unknown, hidden and excluded conversations", () => {
        for (const conversation of [phrase(7), C, LIVE]) {
            expect(() =>
                openConversation(
                    index,
                    { conversation, purpose: "p" },
                    OPTIONS,
                ),
            ).toThrow(NOT_FOUND);
        }
        expect(NOT_FOUND).toBe("No conversation by that name.");
    });

    it("needs a purpose of at most 160 characters", () => {
        expect(() =>
            openConversation(
                index,
                { conversation: A, purpose: "  " },
                OPTIONS,
            ),
        ).toThrow("Say in purpose what you hope to find.");
        expect(() =>
            openConversation(
                index,
                { conversation: A, purpose: "x".repeat(161) },
                OPTIONS,
            ),
        ).toThrow("purpose is 161 characters, over 160.");
    });
});

describe("windowOf", () => {
    const turn = (text: string) => ({ text });
    const sized = (tokens: number) => turn("x".repeat(tokens * 4));

    it("grows forward and back from the turn asked for", () => {
        const turns = [
            sized(1000),
            sized(1000),
            sized(1000),
            sized(1000),
            sized(1000),
        ];
        const window = windowOf(turns, 3);
        expect(window).toEqual(turns.slice(1, 5));
    });

    it("starts at the first turn, and takes a turn past the end as the last", () => {
        const turns = [turn("a"), turn("b")];
        expect(windowOf(turns, undefined)).toEqual(turns);
        expect(windowOf([sized(3000), sized(3000)], 9)).toEqual([sized(3000)]);
    });

    it("stops a side at the first turn that does not fit", () => {
        const turns = [sized(100), sized(3900), sized(100), sized(100)];
        expect(windowOf(turns, 3)).toEqual(turns.slice(2));
    });

    it("cuts a turn longer than the window, on a code point", () => {
        const emoji = "🎉".repeat(WINDOW_TOKENS * 4 + 10);
        const [cut] = windowOf([turn(emoji)], 1);
        expect(cut?.text.endsWith("… [cut]")).toBe(true);
        expect([...(cut?.text ?? "")]).toHaveLength(WINDOW_TOKENS * 4);
        expect(cut?.text.includes("�")).toBe(false);
        expect(
            [...(cut?.text ?? "").replace("… [cut]", "")].every(
                (c) => c === "🎉",
            ),
        ).toBe(true);
    });

    it("gives nothing for no turns", () => {
        expect(windowOf([], 1)).toEqual([]);
    });
});

describe("recollect", () => {
    const cluster = (from: number, through: number) => ({
        from,
        through,
        abstract: `Turns ${from} to ${through}.`,
        at: day(1),
        model: "m",
    });
    // Eight turns: two clusters of three, and two turns of tail.
    beforeEach(async () => {
        await conversation(
            OWN,
            [
                session(day(1)),
                user(day(1, 1), "the cat sat"),
                reply(day(1, 2), "on the mat"),
                user(day(1, 3), "a render bug"),
                reply(day(1, 4), "the dog barked"),
                user(day(1, 5), "a render fix"),
                reply(day(1, 6), "the bird sang"),
                user(day(1, 7), "now"),
                reply(day(1, 8), "then"),
            ],
            { clusters: [cluster(1, 3), cluster(4, 6)] },
        );
        await syncIndex(index, dir);
    });
    const opened = (input: Parameters<typeof recollect>[1]) =>
        recollect(index, input, { phrase: OWN });

    it("opens a cluster from its first turn, never past its last", () => {
        const result = opened({ cluster: 1 });
        expect(result.cluster).toBe(1);
        expect(result.turns).toEqual([1, 3]);
        expect(result.total).toBe(8);
        expect(result.matched).toBeUndefined();
        expect(result.window.map((turn) => turn.turn)).toEqual([1, 2, 3]);
    });

    it("starts at the turn asked for", () => {
        expect(
            opened({ cluster: 2, turn: 5 }).window.map((turn) => turn.turn),
        ).toEqual([5, 6]);
    });

    it("centres on the first turn matching the words", async () => {
        // Six turns of about 1200 tokens: the window holds three. Read from
        // the first turn it would be turns 1-3; centred on the match, 4-6.
        const long = (word: string) => `${word} ${"x".repeat(4800)}`;
        await conversation(
            LONG,
            [
                session(day(1)),
                user(day(1, 1), long("alpha")),
                reply(day(1, 2), long("bravo")),
                user(day(1, 3), long("charlie")),
                reply(day(1, 4), long("delta")),
                user(day(1, 5), long("echo")),
                reply(day(1, 6), long("foxtrot")),
            ],
            { clusters: [cluster(1, 6)] },
        );
        await syncIndex(index, dir);
        const ask = (input: Parameters<typeof recollect>[1]) =>
            recollect(index, input, { phrase: LONG });
        expect(ask({ cluster: 1 }).window.map((turn) => turn.turn)).toEqual([
            1, 2, 3,
        ]);
        const result = ask({ cluster: 1, words: "echo" });
        expect(result.matched).toBe(true);
        expect(result.window.map((turn) => turn.turn)).toEqual([4, 5, 6]);
    });

    it("looks for words only from the turn asked for, within the cluster", () => {
        const after = opened({ cluster: 2, words: "render bug", turn: 5 });
        expect(after.matched).toBe(true);
        expect(after.window[0]?.turn).toBe(5);
        const before = opened({ cluster: 2, words: "dog", turn: 5 });
        expect(before.matched).toBe(false);
        expect(before.window[0]?.turn).toBe(5);
        const elsewhere = opened({ cluster: 1, words: "bird" });
        expect(elsewhere.matched).toBe(false);
        expect(elsewhere.window.map((turn) => turn.turn)).toEqual([1, 2, 3]);
    });

    it("refuses an unknown cluster, a turn outside it and empty words", () => {
        expect(() => opened({ cluster: 3 })).toThrow(NO_CLUSTER);
        expect(() => opened({ cluster: 1, turn: 4 })).toThrow(
            "turn must be from 1 to 3, within cluster 1.",
        );
        expect(() => opened({ cluster: 1, words: " ?? " })).not.toThrow();
        expect(() => opened({ cluster: 1, words: "   " })).toThrow(
            "Give some words to look for.",
        );
        expect(() =>
            recollect(index, { cluster: 1 }, { phrase: null }),
        ).toThrow(NO_CLUSTER);
    });

    it("refuses a cluster number that is not a whole number", () => {
        for (const cluster of [
            1.5,
            0.5,
            Number.NaN,
            Number.POSITIVE_INFINITY,
        ]) {
            expect(() => opened({ cluster })).toThrow(NO_CLUSTER);
        }
    });

    it("never opens another conversation's clusters", async () => {
        await conversation(A, [user(day(2), "elsewhere")], {
            clusters: [cluster(1, 1)],
        });
        await syncIndex(index, dir);
        expect(opened({ cluster: 1 }).window[0]?.text).toBe("the cat sat");
    });
});
