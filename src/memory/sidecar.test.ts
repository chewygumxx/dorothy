// vim:set expandtab shiftwidth=4 filetype=typescript:
// SPDX-License-Identifier: GPL-3.0-only

//
//
// ~chewygumxx/dorothy.git
// ::: :/src/memory/sidecar.test.ts
//
//

import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import {
    chmod,
    mkdir,
    mkdtemp,
    readdir,
    readFile,
    rm,
    stat,
    writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
    EMPTY_SIDECAR,
    mergeEdit,
    mergeReview,
    normalise,
    type Provenance,
    parseSidecar,
    provisionalTitle,
    readSidecar,
    type Sidecar,
    sidecarPath,
    updateSidecar,
    withProvisional,
} from "./sidecar.js";

const PHRASE = "tumble-orchid-vapor-lantern";
const AT = "2026-10-05T05:40:12.000Z";
const LATER = "2026-10-05T06:02:00.000Z";

let dir = "";
beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "dorothy-sidecar-"));
});
afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
});

const reviewed: Sidecar = {
    ...EMPTY_SIDECAR,
    rev: 3,
    title: "Memory and metadata",
    description: "Designing how Dorothy remembers.",
    abstract: "The user proposed tiered notes.",
    titles: [],
    fields: {
        title: { by: "dorothy", model: "m1", at: AT, throughTurn: 4 },
        description: { by: "dorothy", model: "m1", at: AT, throughTurn: 4 },
        abstract: { by: "dorothy", model: "m1", at: AT, throughTurn: 4 },
    },
    reviewedThrough: 4,
    reviewCostUsd: 0.25,
};
const notes = {
    title: "Remembering",
    description: "How Dorothy remembers.",
    abstract: "Notes, tiers and budgets.",
};
const review = { model: "m2", at: LATER, throughTurn: 8, costUsd: 0.5 };

describe("parseSidecar", () => {
    it("reads back what was written", () => {
        expect(parseSidecar(JSON.stringify(reviewed))).toEqual({
            kind: "ok",
            sidecar: reviewed,
        });
    });

    it("calls bad JSON, a non-object and an unknown version unparseable", () => {
        expect(parseSidecar("{").kind).toBe("unparseable");
        expect(parseSidecar("[]")).toEqual({
            kind: "unparseable",
            reason: "not a JSON object",
        });
        expect(parseSidecar('{"v":2}')).toEqual({
            kind: "unparseable",
            reason: "unknown version 2",
        });
    });

    it("normalises notes, and reads one over its limit or of the wrong shape as null", () => {
        const text = JSON.stringify({
            ...reviewed,
            title: "x".repeat(61),
            description: 7,
            abstract: " two\n  lines ",
            titles: [
                { title: "Hey\nthere", at: AT, by: "prompt" },
                { title: " ", at: AT, by: "dorothy" },
            ],
        });
        expect(parseSidecar(text)).toEqual({
            kind: "ok",
            sidecar: {
                ...reviewed,
                title: null,
                description: null,
                abstract: "two lines",
                titles: [{ title: "Hey there", at: AT, by: "prompt" }],
                fields: { abstract: reviewed.fields.abstract },
            },
        });
    });

    it("fills in whatever is missing", () => {
        expect(parseSidecar('{"v":1}')).toEqual({
            kind: "ok",
            sidecar: EMPTY_SIDECAR,
        });
    });
});

describe("normalise", () => {
    it("turns control characters into spaces", () => {
        expect(normalise("a\x07b")).toBe("a b");
        expect(normalise("\x1b]0;x\x07 \x1b[31m")).toBe("]0;x [31m");
        expect(normalise("a\x7fb")).toBe("a b");
        expect(normalise("a\u009bb\u0085c")).toBe("a b c");
        expect(normalise("\x00a\x1f")).toBe("a");
    });

    it("still collapses tabs and newlines to single spaces", () => {
        expect(normalise("  a\t\tb\n\nc  ")).toBe("a b c");
    });
});

describe("readSidecar", () => {
    it("reads back a note holding an escape sequence clean", async () => {
        await writeFile(
            sidecarPath(dir, PHRASE),
            JSON.stringify({
                v: 1,
                title: "Hi\x1b[31m red\x07",
                titles: [{ title: "Old\x1b[2Jone", at: AT, by: "dorothy" }],
            }),
        );
        const read = await readSidecar(dir, PHRASE);
        expect(read.kind === "ok" && read.sidecar.title).toBe("Hi [31m red");
        expect(read.kind === "ok" && read.sidecar.titles[0]?.title).toBe(
            "Old [2Jone",
        );
    });

    it("tells no sidecar from one that cannot be read", async () => {
        expect(await readSidecar(dir, PHRASE)).toEqual({ kind: "none" });
        await mkdir(sidecarPath(dir, PHRASE));
        expect((await readSidecar(dir, PHRASE)).kind).toBe("unparseable");
    });
});

describe("updateSidecar", () => {
    it("writes a private file atomically and counts revisions", async () => {
        expect(await updateSidecar(dir, PHRASE, () => reviewed)).toEqual({
            kind: "written",
            sidecar: { ...reviewed, rev: 1 },
        });
        await updateSidecar(
            dir,
            PHRASE,
            (current) => current && { ...current, pinned: true },
        );
        expect(await readSidecar(dir, PHRASE)).toEqual({
            kind: "ok",
            sidecar: { ...reviewed, rev: 2, pinned: true },
        });
        expect((await stat(sidecarPath(dir, PHRASE))).mode & 0o777).toBe(0o600);
        expect(await readdir(dir)).toEqual([`${PHRASE}.meta.json`]);
    });

    it("writes nothing when the change gives null", async () => {
        expect(await updateSidecar(dir, PHRASE, () => null)).toEqual({
            kind: "unchanged",
            sidecar: null,
        });
        expect(await readdir(dir)).toEqual([]);
    });

    it("never writes over an unparseable sidecar", async () => {
        await writeFile(sidecarPath(dir, PHRASE), "{ broken");
        const result = await updateSidecar(dir, PHRASE, () => reviewed);
        expect(result.kind).toBe("unparseable");
        expect(await readFile(sidecarPath(dir, PHRASE), "utf8")).toBe(
            "{ broken",
        );
    });

    it("lets writers in one process take turns", async () => {
        await Promise.all([
            updateSidecar(dir, PHRASE, (current) => ({
                ...(current ?? EMPTY_SIDECAR),
                pinned: true,
            })),
            updateSidecar(dir, PHRASE, (current) => ({
                ...(current ?? EMPTY_SIDECAR),
                hidden: true,
            })),
        ]);
        expect(await readSidecar(dir, PHRASE)).toEqual({
            kind: "ok",
            sidecar: { ...EMPTY_SIDECAR, rev: 2, pinned: true, hidden: true },
        });
    });

    // Root ignores directory modes, so there the write cannot fail.
    it.skipIf(process.getuid?.() === 0)(
        "reports a write that failed",
        async () => {
            await chmod(dir, 0o500);
            try {
                expect(
                    (await updateSidecar(dir, PHRASE, () => reviewed)).kind,
                ).toBe("failed");
            } finally {
                await chmod(dir, 0o700);
            }
        },
    );
});

describe("provisionalTitle", () => {
    it("takes the first non-blank line, spaces collapsed", () => {
        expect(provisionalTitle("\n  \n  Hey   there o/ \nmore")).toBe(
            "Hey there o/",
        );
    });

    it("cuts a long line to 60 characters, ending in an ellipsis", () => {
        expect(provisionalTitle("a".repeat(80))).toBe(`${"a".repeat(59)}…`);
    });

    it("counts an emoji as one character and never splits one", () => {
        const title = provisionalTitle("😀".repeat(70)) ?? "";
        expect([...title]).toHaveLength(60);
        const read = parseSidecar(JSON.stringify({ v: 1, title }));
        expect(read.kind === "ok" && read.sidecar.title).toBe(title);
    });

    it("cleans an escape sequence out of the title", () => {
        expect(provisionalTitle("\x1b]0;x\x07 hello\x1b[31m")).toBe(
            "]0;x hello [31m",
        );
        expect(provisionalTitle("\x07\n\x1b\nreal")).toBe("real");
    });

    it("gives nothing for a blank message", () => {
        expect(provisionalTitle(" \n\t")).toBeNull();
    });
});

describe("withProvisional", () => {
    it("starts a sidecar with the title, owned by the prompt", () => {
        expect(withProvisional(null, "Hey there o/", AT)).toEqual({
            ...EMPTY_SIDECAR,
            title: "Hey there o/",
            fields: { title: { by: "prompt", at: AT } },
        });
    });

    it("leaves an existing sidecar alone", () => {
        expect(withProvisional(reviewed, "Hey", AT)).toBeNull();
    });
});

describe("mergeReview", () => {
    it("writes every note Dorothy owns, stamped, keeping the old title", () => {
        const stamp: Provenance = {
            by: "dorothy",
            model: "m2",
            at: LATER,
            throughTurn: 8,
        };
        expect(mergeReview(reviewed, notes, review)).toEqual({
            ...reviewed,
            ...notes,
            titles: [{ title: "Memory and metadata", at: AT, by: "dorothy" }],
            fields: { title: stamp, description: stamp, abstract: stamp },
            reviewedThrough: 8,
            reviewCostUsd: 0.75,
        });
    });

    it("adds no history when the title stays", () => {
        const same = { ...notes, title: "Memory and metadata" };
        expect(mergeReview(reviewed, same, review).titles).toEqual([]);
    });

    it("replaces a provisional title, keeping it in the history", () => {
        const merged = mergeReview(
            withProvisional(null, "Hey there o/", AT),
            notes,
            review,
        );
        expect(merged.title).toBe("Remembering");
        expect(merged.titles).toEqual([
            { title: "Hey there o/", at: AT, by: "prompt" },
        ]);
    });

    it("never overwrites a note the user owns", () => {
        const edited = mergeEdit(reviewed, { abstract: "Mine." }, AT);
        const merged = mergeReview(edited, notes, review);
        expect(merged.abstract).toBe("Mine.");
        expect(merged.fields.abstract).toEqual({ by: "user", at: AT });
        expect(merged.description).toBe(notes.description);
    });

    it("lets the user win whichever lands first", () => {
        const editFirst = mergeReview(
            mergeEdit(reviewed, { title: "Mine" }, AT),
            notes,
            review,
        );
        const reviewFirst = mergeEdit(
            mergeReview(reviewed, notes, review),
            { title: "Mine" },
            AT,
        );
        expect(editFirst.title).toBe("Mine");
        expect(reviewFirst.title).toBe("Mine");
    });
});

describe("mergeEdit", () => {
    it("makes an edited note the user's, keeping the old title", () => {
        const merged = mergeEdit(
            reviewed,
            { title: "Mine", pinned: true },
            LATER,
        );
        expect(merged.title).toBe("Mine");
        expect(merged.pinned).toBe(true);
        expect(merged.fields.title).toEqual({ by: "user", at: LATER });
        expect(merged.titles).toEqual([
            { title: "Memory and metadata", at: AT, by: "dorothy" },
        ]);
        expect(merged.reviewedThrough).toBe(4);
    });

    it("hands an emptied note back to Dorothy for the next review", () => {
        const merged = mergeEdit(reviewed, { description: null }, LATER);
        expect(merged.description).toBeNull();
        expect(merged.fields.description).toBeUndefined();
        expect(merged.reviewedThrough).toBe(0);
    });
});
