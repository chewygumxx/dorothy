// vim:set expandtab shiftwidth=4 filetype=typescript:
// SPDX-License-Identifier: GPL-3.0-only

//
//
// ~chewygumxx/dorothy.git
// ::: :/packages/memory/src/memory/service-tags.test.ts
//
//

import { afterEach, beforeEach, describe, expect, it, spyOn } from "bun:test";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { RecallIndex } from "../recall/store.js";
import { TAGS_INSTRUCTION } from "./review.js";
import {
    dir,
    entry,
    NOTES,
    NOW,
    phrase,
    reply,
    reviews,
    settle,
    setup,
    sidecarOf,
    transcript,
    until,
    user,
    useTempDir,
} from "./service-testing.js";
import {
    EMPTY_SIDECAR,
    mergeEdit,
    type Sidecar,
    sidecarPath,
} from "./sidecar.js";
import * as tagging from "./tagging.js";
import { type Concept, readVocabulary, type Vocabulary } from "./vocabulary.js";

useTempDir();

describe("tagging", () => {
    const OTHER = phrase(1);
    const AT = NOW.toISOString();
    let vocabulary = "";
    beforeEach(() => {
        vocabulary = join(dir, "tags.json");
    });
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
        edited: null,
        ...fields,
    });
    const writeVocabularyFile = (concepts: Vocabulary["concepts"]) =>
        writeFile(vocabulary, JSON.stringify({ v: 1, rev: 1, concepts }));
    const saved = (of: string, fields: Partial<Sidecar>) =>
        writeFile(
            sidecarPath(dir, of),
            JSON.stringify({ ...EMPTY_SIDECAR, ...fields }),
        );
    const conceptsIn = async () => {
        const read = await readVocabulary(vocabulary);
        return read.kind === "ok" ? read.vocabulary.concepts : {};
    };
    const schemaOf = (call: { options: unknown } | undefined) =>
        JSON.stringify(
            (call?.options as { outputFormat?: unknown } | undefined)
                ?.outputFormat,
        );

    it("coins what nothing fits and tags the conversation with it", async () => {
        await transcript(OTHER, [user("a"), reply("b")]);
        const fake = reviews({
            ...NOTES,
            tags: ["memory"],
            coined: [{ prefLabel: "memory", scopeNote: "Remembering." }],
        });
        const { memory } = setup({
            call: fake.fn,
            vocabulary,
            entries: [entry(OTHER, null)],
        });
        memory.ready();
        await until(async () => (await sidecarOf(OTHER)) !== null);
        const concepts = await conceptsIn();
        const [id] = Object.keys(concepts);
        expect(concepts[id as string]).toMatchObject({
            prefLabel: "memory",
            scopeNote: "Remembering.",
            by: "dorothy",
            model: "claude-test",
        });
        const sidecar = await sidecarOf(OTHER);
        expect(sidecar?.tags).toEqual([id as string]);
        expect(sidecar?.fields.tags).toMatchObject({
            by: "dorothy",
            throughTurn: 2,
        });
        expect(fake.calls[0]?.options.systemPrompt).toContain(TAGS_INSTRUCTION);
        expect(fake.calls[0]?.prompt).toContain("<vocabulary/>");
        expect(schemaOf(fake.calls[0])).toContain("coined");
    });

    it("shows her the vocabulary, but not what only hidden chats carry", async () => {
        await writeVocabularyFile({
            k00000001: concept("memory", { altLabel: ["recall"] }),
            k00000002: concept("secret"),
        });
        await transcript(OTHER, [user("a"), reply("b")]);
        const fake = reviews({ ...NOTES, tags: ["Recall"], coined: [] });
        const { memory } = setup({
            call: fake.fn,
            vocabulary,
            entries: [
                entry(OTHER, null),
                entry(phrase(2), { hidden: true, tags: ["k00000002"] }),
            ],
        });
        memory.ready();
        await until(async () => (await sidecarOf(OTHER)) !== null);
        expect(fake.calls[0]?.prompt).toContain(
            '<concept label="memory" alt="recall">About memory.</concept>',
        );
        expect(fake.calls[0]?.prompt).not.toContain("secret");
        expect((await sidecarOf(OTHER))?.tags).toEqual(["k00000001"]);
        expect(Object.keys(await conceptsIn())).toHaveLength(2);
    });

    it("keeps the user's tags, following merges and dropping the gone", async () => {
        await writeVocabularyFile({
            k00000001: concept("memory"),
            k00000002: { mergedInto: "k00000001", at: AT },
            k00000003: { deleted: AT, labels: ["misc"] },
        });
        const theirs = mergeEdit(
            null,
            { tags: ["k00000002", "k00000003"] },
            AT,
        );
        await transcript(OTHER, [user("a"), reply("b")]);
        await saved(OTHER, theirs);
        const fake = reviews({
            ...NOTES,
            tags: ["new"],
            coined: [{ prefLabel: "new", scopeNote: "New." }],
        });
        const { memory } = setup({
            call: fake.fn,
            vocabulary,
            entries: [entry(OTHER, theirs)],
        });
        memory.ready();
        await until(
            async () => (await sidecarOf(OTHER))?.reviewedThrough === 2,
        );
        const sidecar = await sidecarOf(OTHER);
        expect(sidecar?.tags).toEqual(["k00000001"]);
        expect(sidecar?.fields.tags?.by).toBe("user");
        expect(fake.calls[0]?.prompt).toContain(
            '<tags fixed="true">memory</tags>',
        );
        expect(Object.keys(await conceptsIn())).toHaveLength(3);
    });

    it("prunes unresolved user tags when all fields are fixed", async () => {
        await writeVocabularyFile({
            k00000001: concept("memory"),
            k00000002: { mergedInto: "k00000001", at: AT },
            k00000003: { deleted: AT, labels: ["misc"] },
        });
        const owned = mergeEdit(
            null,
            { ...NOTES, tags: ["k00000002", "k00000003"] },
            AT,
        );
        await transcript(OTHER, [user("a"), reply("b")]);
        await saved(OTHER, owned);
        const fake = reviews(NOTES);
        const { memory } = setup({
            call: fake.fn,
            vocabulary,
            entries: [entry(OTHER, owned)],
        });
        memory.ready();
        await until(
            async () => (await sidecarOf(OTHER))?.reviewedThrough === 2,
        );
        expect(fake.calls).toHaveLength(0);
        expect((await sidecarOf(OTHER))?.tags).toEqual(["k00000001"]);
        expect((await sidecarOf(OTHER))?.fields.tags).toEqual(
            owned.fields.tags,
        );
    });

    it("pauses tags while the vocabulary is broken, saying so once", async () => {
        await writeFile(vocabulary, "{ broken");
        await transcript(OTHER, [user("a"), reply("b")]);
        const kept = { tags: ["k00000001"], reviewedThrough: 0 };
        await saved(OTHER, kept);
        const fake = reviews(NOTES);
        const { memory, notices } = setup({
            call: fake.fn,
            vocabulary,
            entries: [entry(OTHER, kept)],
        });
        memory.ready();
        await until(
            async () => (await sidecarOf(OTHER))?.title === "Remembering",
        );
        const sidecar = await sidecarOf(OTHER);
        expect(sidecar?.tags).toEqual(["k00000001"]);
        expect(sidecar?.fields.tags).toBeUndefined();
        expect(schemaOf(fake.calls[0])).not.toContain("coined");
        expect(fake.calls[0]?.prompt).not.toContain("vocabulary");
        const warnings = notices.filter(
            (notice) =>
                notice.type === "warning" &&
                notice.message.startsWith("memory: tags are paused: "),
        );
        expect(warnings).toHaveLength(1);
        expect(await readFile(vocabulary, "utf8")).toBe("{ broken");
    });

    it("writes no vocabulary that breaks the rules, nor tags from it", async () => {
        await writeVocabularyFile({ k00000001: concept("memory") });
        const before = await readFile(vocabulary, "utf8");
        await transcript(OTHER, [user("a"), reply("b")]);
        const kept = { tags: ["k00000001"], reviewedThrough: 0 };
        await saved(OTHER, kept);
        const broken = spyOn(tagging, "applyTagging").mockImplementation(
            (current) => ({
                vocabulary: {
                    ...current,
                    concepts: {
                        ...current.concepts,
                        k00000002: concept("Memory"),
                    },
                },
                coined: 1,
                tags: ["k00000002"],
                dropped: [],
            }),
        );
        try {
            const fake = reviews({
                ...NOTES,
                tags: ["Memory"],
                coined: [{ prefLabel: "Memory", scopeNote: "Again." }],
            });
            const { memory } = setup({
                call: fake.fn,
                vocabulary,
                entries: [entry(OTHER, kept)],
            });
            memory.ready();
            await until(
                async () => (await sidecarOf(OTHER))?.title === "Remembering",
            );
            expect(broken).toHaveBeenCalled();
        } finally {
            broken.mockRestore();
        }
        const sidecar = await sidecarOf(OTHER);
        expect(sidecar?.tags).toEqual(["k00000001"]);
        expect(sidecar?.fields.tags).toBeUndefined();
        expect(await readFile(vocabulary, "utf8")).toBe(before);
    });

    it("catches up conversations reviewed before tags, while tags work", async () => {
        const old = { title: "Old", reviewedThrough: 2 };
        await transcript(OTHER, [user("a"), reply("b")]);
        await saved(OTHER, old);
        const fake = reviews({ ...NOTES, tags: [], coined: [] });
        const { memory } = setup({
            call: fake.fn,
            vocabulary,
            entries: [entry(OTHER, old)],
        });
        memory.ready();
        await until(
            async () => (await sidecarOf(OTHER))?.fields.tags !== undefined,
        );
        expect(fake.calls).toHaveLength(1);
        expect((await sidecarOf(OTHER))?.tags).toEqual([]);
    });

    it("leaves them be while the vocabulary is broken", async () => {
        await writeFile(vocabulary, "{ broken");
        const old = { title: "Old", reviewedThrough: 2 };
        await transcript(OTHER, [user("a"), reply("b")]);
        await saved(OTHER, old);
        const fake = reviews(NOTES);
        const { memory } = setup({
            call: fake.fn,
            vocabulary,
            entries: [entry(OTHER, old)],
        });
        memory.ready();
        await settle();
        expect(fake.calls).toHaveLength(0);
    });

    it("leaves tags alone without a vocabulary path", async () => {
        await transcript(OTHER, [user("a"), reply("b")]);
        const fake = reviews(NOTES);
        const { memory } = setup({
            call: fake.fn,
            entries: [entry(OTHER, null)],
        });
        memory.ready();
        await until(async () => (await sidecarOf(OTHER)) !== null);
        expect(fake.calls[0]?.prompt).not.toContain("vocabulary");
        expect((await sidecarOf(OTHER))?.fields.tags).toBeUndefined();
    });

    describe("with the index", () => {
        let index: RecallIndex;
        beforeEach(() => {
            index = RecallIndex.open(join(dir, "index", "recall.sqlite"));
        });
        afterEach(() => {
            index.close();
        });

        it("makes two coins of one label, in two runs, one concept", async () => {
            const [a, b] = [phrase(1), phrase(2)];
            for (const of of [a, b]) {
                await transcript(of, [user("a"), reply("b")]);
            }
            const answer = {
                ...NOTES,
                tags: ["memory"],
                coined: [{ prefLabel: "memory", scopeNote: "Remembering." }],
            };
            const first = setup({
                call: reviews(answer).fn,
                vocabulary,
                index,
                entries: [entry(a, null)],
            });
            const second = setup({
                call: reviews(answer).fn,
                vocabulary,
                index,
                entries: [entry(b, null)],
            });
            first.memory.ready();
            second.memory.ready();
            await until(
                async () =>
                    (await sidecarOf(a)) !== null &&
                    (await sidecarOf(b)) !== null,
            );
            const concepts = Object.keys(await conceptsIn());
            expect(concepts).toHaveLength(1);
            expect((await sidecarOf(a))?.tags).toEqual(concepts);
            expect((await sidecarOf(b))?.tags).toEqual(concepts);
        });
    });
});
