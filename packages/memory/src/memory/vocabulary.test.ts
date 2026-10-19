// vim:set expandtab shiftwidth=4 filetype=typescript:
// SPDX-License-Identifier: GPL-3.0-only

//
//
// ~chewygumxx/dorothy.git
// ::: :/packages/memory/src/memory/vocabulary.test.ts
//
//

import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
    ancestorsOf,
    type Concept,
    EMPTY_VOCABULARY,
    isBlocked,
    labelKey,
    liveConcepts,
    narrowerOf,
    newId,
    parentLabels,
    parseVocabulary,
    readVocabulary,
    resolveId,
    resolveLabel,
    resolveTags,
    updateVocabulary,
    type Vocabulary,
    vocabularyPath,
    wouldCycle,
} from "./vocabulary.js";

const AT = "2026-10-07T12:00:00.000Z";
const concept = (
    prefLabel: string,
    fields: Partial<Concept> = {},
): Concept => ({
    prefLabel,
    altLabel: [],
    broader: [],
    scopeNote: `About ${prefLabel}.`,
    by: "dorothy",
    at: AT,
    model: "claude-test",
    edited: null,
    ...fields,
});
const vocabulary = (concepts: Vocabulary["concepts"]): Vocabulary => ({
    v: 1,
    rev: 1,
    concepts,
});
const ID = {
    dorothy: "k00000001",
    memory: "k00000002",
    tui: "k00000003",
    tagging: "k00000004",
    gone: "k00000005",
    folded: "k00000006",
};
const SAMPLE = vocabulary({
    [ID.dorothy]: concept("dorothy"),
    [ID.memory]: concept("memory", {
        altLabel: ["recall", "Café"],
        broader: [ID.dorothy],
    }),
    [ID.tui]: concept("tui"),
    [ID.tagging]: concept("tagging", { broader: [ID.memory, ID.tui] }),
    [ID.gone]: { deleted: AT, labels: ["misc", "other"] },
    [ID.folded]: { mergedInto: ID.memory, at: AT },
});
const parsed = (value: unknown) => parseVocabulary(JSON.stringify(value));
const reason = (value: unknown) => {
    const read = parsed(value);
    return read.kind === "unparseable" ? read.reason : null;
};

describe("parseVocabulary", () => {
    it("reads concepts and tombstones, normalising text", () => {
        const read = parsed({
            ...SAMPLE,
            concepts: {
                ...SAMPLE.concepts,
                [ID.tui]: concept("  tui \n", { scopeNote: " About tui.\n" }),
            },
        });
        expect(read).toEqual({ kind: "ok", vocabulary: SAMPLE });
    });

    it("refuses what is not a vocabulary", () => {
        expect(parseVocabulary("{ bad").kind).toBe("unparseable");
        expect(parseVocabulary('{"v":1,"concepts": tea}')).toEqual({
            kind: "unparseable",
            reason: "it is not JSON",
        });
        expect(reason([])).toBe("not a JSON object");
        expect(reason({ ...SAMPLE, v: 2 })).toBe("unknown version 2");
        expect(reason({ v: 1, rev: 0, concepts: [] })).toBe(
            "concepts is not an object",
        );
    });

    it.each([
        [{ x1: concept("a") }, "x1 is not a concept id"],
        [{ k00000001: { prefLabel: "a" } }, "k00000001 has no scopeNote"],
        [
            { k00000001: concept("a".repeat(51)) },
            `k00000001: "${"a".repeat(51)}" is 51 characters, over 50`,
        ],
        [{ k00000001: concept("a;b") }, 'k00000001: "a;b" contains ;'],
        [
            {
                k00000001: concept("a", {
                    altLabel: ["b", "c", "d", "e", "f", "g"],
                }),
            },
            "k00000001 has more than 5 alternative labels",
        ],
        [
            {
                k00000001: concept("a", { scopeNote: "x".repeat(161) }),
            },
            "k00000001: a tag's note is 161 characters, over 160",
        ],
        [
            { k00000001: concept("a"), k00000002: concept("A") },
            'the label "A" is used twice',
        ],
        [
            {
                k00000001: concept("café"),
                k00000002: concept("b", { altLabel: ["CAFÉ"] }),
            },
            'the label "CAFÉ" is used twice',
        ],
        [
            {
                k00000001: concept("misc"),
                k00000002: { deleted: AT, labels: ["Misc"] },
            },
            'the label "Misc" is used twice',
        ],
        [
            { k00000001: concept("a", { broader: ["k00000009"] }) },
            "a is under k00000009, which is not a concept",
        ],
        [
            {
                k00000001: concept("a", { broader: ["k00000002"] }),
                k00000002: concept("b", { broader: ["k00000003"] }),
                k00000003: concept("c", { broader: ["k00000001"] }),
            },
            "a is under itself",
        ],
        [
            { k00000001: { mergedInto: "k00000002", at: AT } },
            "k00000001 was merged into k00000002, which is not a concept",
        ],
        [
            { k00000001: { nothing: true } },
            "k00000001 is neither a concept nor a tombstone",
        ],
    ])("refuses %j", (concepts, expected) => {
        expect(reason({ v: 1, rev: 0, concepts })).toBe(expected);
    });

    it.each([
        { prefLabel: "", scopeNote: "note", by: "user", at: AT },
        { prefLabel: "label", scopeNote: "", by: "user", at: AT },
        { prefLabel: "label", scopeNote: "note", by: "other", at: AT },
        { deleted: AT, labels: ["a;b"] },
        { deleted: AT, labels: ["x".repeat(51)] },
        { deleted: AT, labels: [" "] },
        { deleted: 12, labels: ["label"] },
        { deleted: AT, labels: "label" },
        { mergedInto: 12, at: AT },
        { mergedInto: ID.memory, at: 12 },
    ])("rejects malformed term %j", (term) => {
        expect(
            parsed({ v: 1, rev: 1, concepts: { [ID.gone]: term } }).kind,
        ).toBe("unparseable");
    });

    it("orders non-ASCII labels independently of the host locale", () => {
        const v = vocabulary({
            [ID.tui]: concept("ä"),
            [ID.memory]: concept("z"),
            [ID.dorothy]: concept("a"),
        });
        expect(liveConcepts(v).map(([, term]) => term.prefLabel)).toEqual([
            "a",
            "z",
            "ä",
        ]);
    });

    it("compares labels in normal form, case aside", () => {
        // The NFD spelling of é (e, then a combining accent) is the NFC one.
        expect(labelKey("Cafe\u0301")).toBe(labelKey("CAFÉ"));
        expect(resolveLabel(SAMPLE, "CAFE\u0301")).toBe(ID.memory);
    });
});

describe("resolving", () => {
    it("finds a live concept by any of its labels, case aside", () => {
        expect(resolveLabel(SAMPLE, "Memory")).toBe(ID.memory);
        expect(resolveLabel(SAMPLE, " recall ")).toBe(ID.memory);
        expect(resolveLabel(SAMPLE, "cafe\u0301")).toBe(ID.memory);
        expect(resolveLabel(SAMPLE, "misc")).toBeNull();
        expect(resolveLabel(SAMPLE, "nothing")).toBeNull();
    });

    it("blocks a deleted concept's labels", () => {
        expect(isBlocked(SAMPLE, "OTHER")).toBe(true);
        expect(isBlocked(SAMPLE, "memory")).toBe(false);
    });

    it("follows a merge and drops the gone", () => {
        expect(resolveId(SAMPLE, ID.folded)).toBe(ID.memory);
        expect(resolveId(SAMPLE, ID.gone)).toBeNull();
        expect(resolveId(SAMPLE, "k99999999")).toBeNull();
        expect(
            resolveTags(SAMPLE, [ID.folded, ID.memory, ID.gone, ID.tui]),
        ).toEqual([ID.memory, ID.tui]);
    });

    it("keeps at most 5 tags", () => {
        const many = vocabulary(
            Object.fromEntries(
                [1, 2, 3, 4, 5, 6].map((n) => [
                    `k0000000${n}`,
                    concept(`t${n}`),
                ]),
            ),
        );
        expect(resolveTags(many, Object.keys(many.concepts))).toHaveLength(5);
    });
});

describe("the hierarchy", () => {
    it("walks every parent, once, through a diamond", () => {
        expect([...ancestorsOf(SAMPLE, ID.tagging)].sort()).toEqual(
            [ID.dorothy, ID.memory, ID.tagging, ID.tui].sort(),
        );
    });

    it("sees a cycle before it is made", () => {
        expect(wouldCycle(SAMPLE, ID.dorothy, ID.tagging)).toBe(true);
        expect(wouldCycle(SAMPLE, ID.tui, ID.tui)).toBe(true);
        expect(wouldCycle(SAMPLE, ID.tui, ID.dorothy)).toBe(false);
    });

    it("lists live concepts and their children in label order", () => {
        expect(liveConcepts(SAMPLE).map(([id]) => id)).toEqual([
            ID.dorothy,
            ID.memory,
            ID.tagging,
            ID.tui,
        ]);
        expect(narrowerOf(SAMPLE).get(ID.memory)).toEqual([ID.tagging]);
        expect(narrowerOf(SAMPLE).get(ID.tui)).toEqual([ID.tagging]);
        expect(
            parentLabels(SAMPLE, SAMPLE.concepts[ID.tagging] as Concept),
        ).toEqual(["memory", "tui"]);
    });

    it("draws a new id until it is free", () => {
        const draws = [
            Uint8Array.from([0, 0, 0, 1]),
            Uint8Array.from([0xab, 0xcd, 0xef, 0x01]),
        ];
        expect(newId(SAMPLE, () => draws.shift() as Uint8Array)).toBe(
            "kabcdef01",
        );
    });
});

describe("the file", () => {
    let dir = "";
    beforeEach(async () => {
        dir = await mkdtemp(join(tmpdir(), "dorothy-vocabulary-"));
    });
    afterEach(async () => {
        await rm(dir, { recursive: true, force: true });
    });

    it("lives in the data directory", () => {
        expect(
            vocabularyPath({ XDG_DATA_HOME: "/data", HOME: "/home/u" }),
        ).toBe("/data/dorothy/tags.json");
    });

    it("reads a missing file as none and a broken one as unparseable", async () => {
        const path = join(dir, "tags.json");
        expect(await readVocabulary(path)).toEqual({ kind: "none" });
        await writeFile(path, "{ bad");
        expect((await readVocabulary(path)).kind).toBe("unparseable");
    });

    it("writes privately, counting revisions", async () => {
        const path = join(dir, "data", "tags.json");
        const result = await updateVocabulary(path, (current) => ({
            ...current,
            concepts: { ...current.concepts, [ID.tui]: concept("tui") },
        }));
        expect(result.kind).toBe("written");
        expect((await stat(path)).mode & 0o777).toBe(0o600);
        const read = await readVocabulary(path);
        expect(read.kind === "ok" && read.vocabulary.rev).toBe(1);
        expect(await updateVocabulary(path, () => null)).toEqual({
            kind: "unchanged",
            vocabulary: read.kind === "ok" ? read.vocabulary : EMPTY_VOCABULARY,
        });
    });

    it("serialises queued updates inside the supplied lock", async () => {
        const path = join(dir, "tags.json");
        const gate = Promise.withResolvers<void>();
        const entered = Promise.withResolvers<void>();
        let held = false;
        let calls = 0;
        const lock = async <T>(work: () => Promise<T>) => {
            calls++;
            held = true;
            if (calls === 1) {
                entered.resolve();
                await gate.promise;
            }
            try {
                return await work();
            } finally {
                held = false;
            }
        };
        const change = (id: string, label: string) => (v: Vocabulary) => {
            expect(held).toBe(true);
            return { ...v, concepts: { ...v.concepts, [id]: concept(label) } };
        };
        const first = updateVocabulary(path, change(ID.memory, "memory"), lock);
        await entered.promise;
        const second = updateVocabulary(path, change(ID.tui, "tui"), lock);
        expect(calls).toBe(1);
        gate.resolve();
        expect((await first).kind).toBe("written");
        expect((await second).kind).toBe("written");
        expect(await readVocabulary(path)).toMatchObject({
            kind: "ok",
            vocabulary: {
                rev: 2,
                concepts: {
                    [ID.memory]: { prefLabel: "memory" },
                    [ID.tui]: { prefLabel: "tui" },
                },
            },
        });
    });

    it("reports a failed change without altering the file", async () => {
        const path = join(dir, "tags.json");
        await writeFile(path, JSON.stringify(SAMPLE));
        const before = await readFile(path, "utf8");
        expect(
            await updateVocabulary(path, () => {
                throw new Error("change refused");
            }),
        ).toEqual({ kind: "failed", reason: "change refused" });
        expect(await readFile(path, "utf8")).toBe(before);
    });

    it("never writes over a broken file", async () => {
        const path = join(dir, "tags.json");
        await writeFile(path, "{ bad");
        const result = await updateVocabulary(path, (current) => current);
        expect(result.kind).toBe("unparseable");
        expect(await readFile(path, "utf8")).toBe("{ bad");
    });
});
