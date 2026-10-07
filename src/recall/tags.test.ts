// vim:set expandtab shiftwidth=4 filetype=typescript:
// SPDX-License-Identifier: GPL-3.0-only

//
//
// ~chewygumxx/dorothy.git
// ::: :/src/recall/tags.test.ts
//
//

import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdtemp, rm, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { EMPTY_SIDECAR, type Sidecar, sidecarPath } from "../memory/sidecar.js";
import type { Concept } from "../memory/vocabulary.js";
import { newPhrase } from "../session-id.js";
import {
    listTags,
    NO_TAG,
    openConversation,
    RecallError,
    search,
    TAGS_UNAVAILABLE,
} from "./query.js";
import { RecallIndex } from "./store.js";
import { syncIndex } from "./sync.js";
import { carrierCounts, keywordsOf, listedConcepts } from "./tags.js";

const phrase = (seed: number) =>
    newPhrase(() => Uint8Array.from([seed, 1, 2, 3, 4, 5, 6, 7]));
const A = phrase(1);
const B = phrase(2);
const C = phrase(3);
const H = phrase(4);
const LIVE = phrase(9);
// Local noon on the day, so dates read the same in every time zone.
const day = (date: number) => new Date(2026, 9, date, 12).toISOString();
const line = (kind: string, at: string, fields: object) =>
    `${JSON.stringify({ v: 1, kind, at, ...fields })}\n`;
const chat = (at: string, text: string) =>
    line("session", at, {
        phrase: "p",
        sdkSessionId: "s",
        model: "m",
        promptHash: "h",
        resumed: false,
    }) +
    line("user", at, { text }) +
    line("assistant", at, { text: "ok", interrupted: false });
const AT = day(1);
const concept = (prefLabel: string, fields: Partial<Concept> = {}) => ({
    prefLabel,
    altLabel: [],
    broader: [],
    scopeNote: `About ${prefLabel}.`,
    by: "dorothy",
    at: AT,
    edited: null,
    ...fields,
});
const K = {
    dorothy: "k00000001",
    memory: "k00000002",
    tui: "k00000003",
    tagging: "k00000004",
    secret: "k00000005",
    unused: "k00000006",
    folded: "k00000007",
    gone: "k00000008",
};
const OPTIONS = { exclude: LIVE, now: Date.parse(day(20)), halfLifeDays: 30 };

let dir = "";
let vocabulary = "";
let index: RecallIndex;
async function conversation(
    of: string,
    at: string,
    text: string,
    fields: Partial<Sidecar>,
): Promise<void> {
    await writeFile(join(dir, `${of}.jsonl`), chat(at, text));
    await writeFile(
        sidecarPath(dir, of),
        JSON.stringify({ ...EMPTY_SIDECAR, ...fields }),
    );
}
const sync = () => syncIndex(index, dir, OPTIONS.now, vocabulary);

beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "dorothy-tags-"));
    vocabulary = join(dir, "tags.json");
    index = RecallIndex.open(join(dir, "index", "recall.sqlite"));
    await writeFile(
        vocabulary,
        JSON.stringify({
            v: 1,
            rev: 1,
            concepts: {
                [K.dorothy]: concept("dorothy"),
                [K.memory]: concept("memory", {
                    altLabel: ["recall"],
                    broader: [K.dorothy],
                }),
                [K.tui]: concept("tui"),
                [K.tagging]: concept("tagging", {
                    broader: [K.memory, K.tui],
                }),
                [K.secret]: concept("secret"),
                [K.unused]: concept("unused"),
                [K.folded]: { mergedInto: K.memory, at: AT },
                [K.gone]: { deleted: AT, labels: ["misc"] },
            },
        }),
    );
    await conversation(A, day(4), "the render bug", {
        title: "Rendering",
        tags: [K.tagging, K.gone],
    });
    await conversation(B, day(10), "render the memory", {
        title: "Memory",
        tags: [K.folded],
    });
    await conversation(C, day(12), "render the tui", {
        title: "TUI",
        tags: [K.tui],
    });
    await conversation(H, day(13), "a secret", {
        title: "Secret",
        hidden: true,
        tags: [K.secret],
    });
    await conversation(LIVE, day(19), "now", { tags: [K.tui] });
    await sync();
});
afterEach(async () => {
    index.close();
    await rm(dir, { recursive: true, force: true });
});

const names = (result: { results: { name: string }[] }) =>
    result.results.map((tag) => tag.name);
const found = (input: Parameters<typeof search>[1]) =>
    search(index, input, OPTIONS).results.map((hit) => hit.identifier);
const refusal = (work: () => unknown) => {
    try {
        work();
    } catch (error) {
        expect(error).toBeInstanceOf(RecallError);
        return (error as Error).message;
    }
    return null;
};
async function breakVocabulary(): Promise<void> {
    await writeFile(vocabulary, "{ broken");
    const later = new Date(Date.now() + 5000);
    await utimes(vocabulary, later, later);
    await sync();
}

describe("carriers", () => {
    it("counts every carrier, through narrower concepts and merges", () => {
        expect(Object.fromEntries(carrierCounts(index))).toEqual({
            [K.dorothy]: 2,
            [K.memory]: 2,
            [K.tui]: 3,
            [K.tagging]: 1,
            [K.secret]: 1,
        });
    });

    it("lists all but what only hidden or excluded chats carry", () => {
        expect([...listedConcepts(index, LIVE)].sort()).toEqual(
            [K.dorothy, K.memory, K.tui, K.tagging, K.unused].sort(),
        );
    });

    it("names a chat's own concepts, merges followed, the gone dropped", () => {
        expect(keywordsOf(index, A)).toEqual(["tagging"]);
        expect(keywordsOf(index, B)).toEqual(["memory"]);
    });
});

describe("listTags", () => {
    it("lists concepts by frecency, then label", () => {
        expect(names(listTags(index, {}, OPTIONS))).toEqual([
            "tui",
            "dorothy",
            "memory",
            "tagging",
            "unused",
        ]);
    });

    it("describes a concept as a DefinedTerm", () => {
        const memory = listTags(index, {}, OPTIONS).results.find(
            (tag) => tag.name === "memory",
        );
        expect(memory).toEqual({
            "@type": "DefinedTerm",
            name: "memory",
            alternateName: ["recall"],
            description: "About memory.",
            broader: ["dorothy"],
            narrower: ["tagging"],
            conversations: 2,
            dateCreated: "2026-10-04",
            dateModified: "2026-10-10",
        });
        const unused = listTags(index, {}, OPTIONS).results.find(
            (tag) => tag.name === "unused",
        );
        expect(unused).toEqual({
            "@type": "DefinedTerm",
            name: "unused",
            description: "About unused.",
            conversations: 0,
        });
    });

    it("lists what lies beneath a concept, named by any label", () => {
        expect(names(listTags(index, { under: "Recall" }, OPTIONS))).toEqual([
            "tagging",
        ]);
        expect(names(listTags(index, { under: "dorothy" }, OPTIONS))).toEqual([
            "memory",
            "tagging",
        ]);
    });

    it("keeps to the limit and counts the rest", () => {
        const result = listTags(index, { limit: 2 }, OPTIONS);
        expect(names(result)).toEqual(["tui", "dorothy"]);
        expect(result.more).toBe(3);
    });

    it("knows no tag only hidden chats carry", () => {
        expect(
            refusal(() => listTags(index, { under: "secret" }, OPTIONS)),
        ).toBe(`${NO_TAG}: secret.`);
        expect(refusal(() => listTags(index, { under: "misc" }, OPTIONS))).toBe(
            `${NO_TAG}: misc.`,
        );
    });

    it("counts only visible chats, though hidden and live ones carry it too", async () => {
        const P = phrase(5);
        const PRIVATE = "k00000009";
        await writeFile(
            vocabulary,
            JSON.stringify({
                v: 1,
                rev: 2,
                concepts: {
                    [K.dorothy]: concept("dorothy"),
                    [K.memory]: concept("memory", {
                        altLabel: ["recall"],
                        broader: [K.dorothy],
                    }),
                    [K.tui]: concept("tui"),
                    [K.tagging]: concept("tagging", {
                        broader: [K.memory, K.tui],
                    }),
                    [K.secret]: concept("secret"),
                    [K.unused]: concept("unused"),
                    [K.folded]: { mergedInto: K.memory, at: AT },
                    [K.gone]: { deleted: AT, labels: ["misc"] },
                    [PRIVATE]: concept("private", { broader: [K.memory] }),
                },
            }),
        );
        // Under memory, carried only by a hidden chat and the live one,
        // both later than any visible carrier of memory or dorothy.
        await conversation(P, day(18), "private", {
            hidden: true,
            tags: [PRIVATE],
        });
        await conversation(LIVE, day(19), "now", { tags: [PRIVATE] });
        const later = new Date(Date.now() + 5000);
        for (const path of [
            vocabulary,
            join(dir, `${LIVE}.jsonl`),
            sidecarPath(dir, LIVE),
        ]) {
            await utimes(path, later, later);
        }
        await sync();
        const listed = listTags(index, {}, OPTIONS).results;
        expect(listed.map((tag) => tag.name)).toEqual([
            "tui",
            "dorothy",
            "memory",
            "tagging",
            "unused",
        ]);
        expect(listed.find((tag) => tag.name === "memory")).toMatchObject({
            narrower: ["tagging"],
            conversations: 2,
            dateCreated: "2026-10-04",
            dateModified: "2026-10-10",
        });
        expect(listed.find((tag) => tag.name === "dorothy")).toMatchObject({
            conversations: 2,
            dateModified: "2026-10-10",
        });
        expect(names(listTags(index, { under: "memory" }, OPTIONS))).toEqual([
            "tagging",
        ]);
        expect(
            refusal(() => listTags(index, { under: "private" }, OPTIONS)),
        ).toBe(`${NO_TAG}: private.`);
    });

    it("is unavailable while the vocabulary is broken", async () => {
        await breakVocabulary();
        expect(refusal(() => listTags(index, {}, OPTIONS))).toBe(
            TAGS_UNAVAILABLE,
        );
    });
});

describe("search by tag", () => {
    it("finds a concept's chats and its narrower ones', by salience", () => {
        expect(found({ tags: ["memory"] })).toEqual([B, A]);
        expect(found({ tags: ["RECALL"] })).toEqual([B, A]);
        expect(found({ tags: ["memory", "tui"] })).toEqual([A]);
        expect(found({ tags: ["tui"] })).toEqual([C, A]);
    });

    it("bounds tags alone by the chats' activity", () => {
        expect(found({ tags: ["memory"], after: "2026-10-08" })).toEqual([B]);
    });

    it("narrows a word search to the tagged", () => {
        expect(found({ query: "render", tags: ["memory"] }).sort()).toEqual(
            [A, B].sort(),
        );
        expect(found({ query: "render" }).sort()).toEqual([A, B, C].sort());
    });

    it("gives each result its keywords", () => {
        const hits = search(index, { tags: ["memory"] }, OPTIONS).results;
        expect(hits.map((hit) => hit.keywords)).toEqual([
            ["memory"],
            ["tagging"],
        ]);
        expect(
            openConversation(
                index,
                { conversation: B, purpose: "see" },
                { exclude: LIVE },
            ).keywords,
        ).toEqual(["memory"]);
        expect(
            search(index, { query: "tui" }, OPTIONS).results[0],
        ).toMatchObject({ identifier: C, keywords: ["tui"] });
    });

    it("refuses what it cannot search by", () => {
        expect(refusal(() => found({}))).toBe(
            "Give some words or tags to search for.",
        );
        expect(refusal(() => found({ query: " ", tags: [" "] }))).toBe(
            "Give some words or tags to search for.",
        );
        expect(
            refusal(() => found({ tags: ["a", "b", "c", "d", "e", "f"] })),
        ).toBe("Give at most 5 tags.");
        expect(refusal(() => found({ tags: ["secret"] }))).toBe(
            `${NO_TAG}: secret.`,
        );
        expect(refusal(() => found({ tags: ["nothing"] }))).toBe(
            `${NO_TAG}: nothing.`,
        );
    });

    it("searches words alone, without keywords, while tags are broken", async () => {
        await breakVocabulary();
        expect(refusal(() => found({ tags: ["memory"] }))).toBe(
            TAGS_UNAVAILABLE,
        );
        const hits = search(index, { query: "render" }, OPTIONS).results;
        expect(hits).toHaveLength(3);
        expect(hits.every((hit) => hit.keywords === undefined)).toBe(true);
    });
});
