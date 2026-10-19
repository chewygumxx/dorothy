// vim:set expandtab shiftwidth=4 filetype=typescript:
// SPDX-License-Identifier: GPL-3.0-only

//
//
// ~chewygumxx/dorothy.git
// ::: :/packages/memory/src/recall/facts.test.ts
//
//

import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { chmod, mkdir, mkdtemp, rm, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type Fact, renderFact } from "../facts/file.js";
import { factPath, PERSONAL, putFact, type Scope } from "../facts/store.js";
import { syncFacts } from "./facts.js";
import { RecallIndex } from "./store.js";

const AT = "2026-10-15T09:30:00.000Z";
const PROJECT: Scope = { kind: "project", id: "github.com/chewygumxx/dorothy" };
const fact = (name: string, fields: Partial<Fact> = {}): Fact => ({
    name,
    title: `About ${name}`,
    description: `What Dorothy knows of ${name}.`,
    type: "user",
    extra: {},
    tags: [],
    importance: null,
    provenance: { origin: "user", by: "dorothy", at: AT, created: AT },
    retired: null,
    body: "Body.",
    ...fields,
});

let root = "";
let index: RecallIndex;
beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "dorothy-recall-facts-"));
    index = RecallIndex.open(join(root, "index", "recall.sqlite"));
});
afterEach(async () => {
    index.close();
    await rm(root, { recursive: true, force: true });
});

const rows = () =>
    index.db
        .query(
            "SELECT path, scope, name, title, type, origin, importance, retired FROM facts ORDER BY path",
        )
        .all();
const search = (words: string) =>
    (
        index.db
            .query(
                "SELECT f.name AS name FROM facts_fts JOIN facts f ON f.rowid = facts_fts.rowid WHERE facts_fts MATCH ? ORDER BY f.name",
            )
            .all(words) as { name: string }[]
    ).map(({ name }) => name);

describe("syncFacts", () => {
    it("indexes every fact, retired ones too, with scope, origin and importance", async () => {
        await putFact(root, PERSONAL, fact("tea", { importance: 7 }));
        await putFact(
            root,
            PROJECT,
            fact("gateway", {
                type: "project",
                provenance: { origin: "repo", by: "repo", at: AT, created: AT },
                retired: { at: AT, by: "user", why: "Done." },
            }),
        );
        expect(await syncFacts(index, root)).toEqual([]);
        expect(rows()).toEqual([
            {
                path: "knowledge/personal/tea.md",
                scope: "personal",
                name: "tea",
                title: "About tea",
                type: "user",
                origin: "user",
                importance: 7,
                retired: 0,
            },
            {
                path: "knowledge/projects/github.com/chewygumxx/dorothy/gateway.md",
                scope: "github.com/chewygumxx/dorothy",
                name: "gateway",
                title: "About gateway",
                type: "project",
                origin: "repo",
                importance: null,
                retired: 1,
            },
        ]);
    });

    it("finds facts by their title, description and body", async () => {
        await putFact(
            root,
            PERSONAL,
            fact("tea", { body: "Darjeeling, mostly." }),
        );
        await putFact(root, PERSONAL, fact("coffee"));
        await syncFacts(index, root);
        expect(search("darjeeling")).toEqual(["tea"]);
        expect(search("knows")).toEqual(["coffee", "tea"]);
    });

    it("reads a changed fact again, and drops one that is gone", async () => {
        await putFact(root, PERSONAL, fact("tea"));
        await putFact(root, PERSONAL, fact("coffee"));
        await syncFacts(index, root);
        await putFact(root, PERSONAL, fact("tea", { body: "Assam now." }));
        const later = new Date(Date.parse(AT) + 60_000);
        await utimes(factPath(root, PERSONAL, "tea"), later, later);
        await rm(factPath(root, PERSONAL, "coffee"));
        await syncFacts(index, root);
        expect(search("assam")).toEqual(["tea"]);
        expect(rows()).toHaveLength(1);
    });

    it.each(["Assam tea.", "Assam tea, with a longer description."])(
        "reindexes changed bytes with a preserved timestamp: %s",
        async (body) => {
            const path = await putFact(
                root,
                PERSONAL,
                fact("tea", { body: "Darjeeling" }),
            );
            const timestamp = new Date(AT);
            await utimes(path, timestamp, timestamp);
            await syncFacts(index, root);
            expect(search("darjeeling")).toEqual(["tea"]);
            await writeFile(path, renderFact(fact("tea", { body })));
            await utimes(path, timestamp, timestamp);
            expect(await syncFacts(index, root)).toEqual([]);
            expect(search("darjeeling")).toEqual([]);
            expect(search("assam")).toEqual(["tea"]);
        },
    );

    it("leaves out a fact it cannot read, and says why", async () => {
        await mkdir(join(root, "knowledge", "personal"), { recursive: true });
        await writeFile(
            join(root, "knowledge", "personal", "tea.md"),
            "no fact\n",
        );
        expect(await syncFacts(index, root)).toEqual([
            `${join(root, "knowledge", "personal", "tea.md")}: it has no frontmatter`,
        ]);
        expect(rows()).toEqual([]);
    });

    it("keeps a fact it cannot open as it was indexed, and says why", async () => {
        await putFact(root, PERSONAL, fact("tea"));
        await putFact(root, PERSONAL, fact("coffee"));
        await syncFacts(index, root);
        await putFact(root, PERSONAL, fact("tea", { body: "Assam now." }));
        const later = new Date(Date.parse(AT) + 60_000);
        await utimes(factPath(root, PERSONAL, "tea"), later, later);
        await chmod(factPath(root, PERSONAL, "tea"), 0o000);
        try {
            const warnings = await syncFacts(index, root);
            expect(warnings).toHaveLength(1);
            expect(warnings[0]).toStartWith(
                `${factPath(root, PERSONAL, "tea")}: `,
            );
            expect(rows().map((row) => (row as { name: string }).name)).toEqual(
                ["coffee", "tea"],
            );
            expect(search("assam")).toEqual([]);
        } finally {
            await chmod(factPath(root, PERSONAL, "tea"), 0o600);
        }
        // Readable again, it is read again at once.
        expect(await syncFacts(index, root)).toEqual([]);
        expect(search("assam")).toEqual(["tea"]);
    });

    it("keeps a fact's tags", async () => {
        await putFact(
            root,
            PERSONAL,
            fact("tea", { tags: ["k00000002", "k00000001"] }),
        );
        await syncFacts(index, root);
        expect(
            index.db.query("SELECT n, id FROM fact_tags ORDER BY n").all(),
        ).toEqual([
            { n: 0, id: "k00000002" },
            { n: 1, id: "k00000001" },
        ]);
    });
});
