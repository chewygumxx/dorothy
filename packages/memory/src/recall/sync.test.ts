// vim:set expandtab shiftwidth=4 filetype=typescript:
// SPDX-License-Identifier: GPL-3.0-only

//
//
// ~chewygumxx/dorothy.git
// ::: :/packages/memory/src/recall/sync.test.ts
//
//

import { afterEach, beforeEach, describe, expect, it, spyOn } from "bun:test";
import {
    appendFile,
    chmod,
    mkdtemp,
    rename,
    rm,
    stat,
    truncate,
    utimes,
    writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { newPhrase } from "@dorothy/core";
import { PERSONAL, putFact } from "../facts/store.js";
import { EMPTY_SIDECAR, type Sidecar, sidecarPath } from "../memory/sidecar.js";
import type { Concept } from "../memory/vocabulary.js";
import * as vocabularies from "../memory/vocabulary.js";
import { RecallIndex } from "./store.js";
import {
    readsByTarget,
    sessionPhrase,
    syncIndex,
    visitsByPhrase,
} from "./sync.js";

const phrase = (seed: number) =>
    newPhrase(() => Uint8Array.from([seed, 1, 2, 3, 4, 5, 6, 7]));
const A = phrase(1);
const B = phrase(2);
const T = (minute: number) =>
    new Date(Date.UTC(2026, 9, 1, 0, minute)).toISOString();
const event = (kind: string, minute: number, fields: object = {}) =>
    `${JSON.stringify({ v: 1, kind, at: T(minute), ...fields })}\n`;
const session = (minute: number) =>
    event("session", minute, {
        phrase: "p",
        sdkSessionId: "s",
        model: "m",
        promptHash: "h",
        resumed: false,
    });
const user = (minute: number, text: string) => event("user", minute, { text });
const reply = (minute: number, text: string) =>
    event("assistant", minute, { text, interrupted: false });
const opened = (minute: number, id: string, target: string, ok = true) =>
    event("recall", minute, {
        id,
        ok,
        offset: 0,
        tool: "open",
        conversation: target,
        name: target,
        purpose: "p",
        turns: ok ? [1, 2] : null,
    });

let dir = "";
let index: RecallIndex;
beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "dorothy-sync-"));
    index = RecallIndex.open(join(dir, "index", "recall.sqlite"));
});
afterEach(async () => {
    index.close();
    await rm(dir, { recursive: true, force: true });
});

const transcript = (of: string) => join(dir, `${of}.jsonl`);
const sidecar = (of: string, fields: Partial<Sidecar>) =>
    writeFile(
        sidecarPath(dir, of),
        JSON.stringify({ ...EMPTY_SIDECAR, ...fields }),
    );
const turns = (of: string) =>
    index.db
        .query("SELECT n, role, text FROM turns WHERE phrase = ? ORDER BY n")
        .all(of);
const row = (of: string) =>
    index.db
        .query("SELECT * FROM conversations WHERE phrase = ?")
        .get(of) as Record<string, unknown> | null;

describe("syncIndex", () => {
    it("indexes turns as parseTranscript numbers them", async () => {
        await writeFile(
            transcript(A),
            [
                session(0),
                user(1, "hello"),
                "not json\n",
                event("stats", 2, {}),
                reply(2, "hi there"),
            ].join(""),
        );
        await syncIndex(index, dir);
        expect(turns(A)).toEqual([
            { n: 1, role: "user", text: "hello" },
            { n: 2, role: "assistant", text: "hi there" },
        ]);
        expect(row(A)).toMatchObject({
            turns: 2,
            sessions: 1,
            first_at: Date.parse(T(1)),
            last_at: Date.parse(T(2)),
        });
    });

    it("reads only what was appended, and waits for a half-written line", async () => {
        await writeFile(transcript(A), user(1, "one"));
        await syncIndex(index, dir);
        const half = reply(2, "two");
        await appendFile(transcript(A), half.slice(0, 10));
        await syncIndex(index, dir);
        expect(turns(A)).toHaveLength(1);
        await appendFile(transcript(A), half.slice(10));
        await syncIndex(index, dir);
        expect(turns(A)).toEqual([
            { n: 1, role: "user", text: "one" },
            { n: 2, role: "assistant", text: "two" },
        ]);
        expect(row(A)?.t_size).toBe((await stat(transcript(A))).size);
    });

    it("indexes a shrunk transcript again in full", async () => {
        await writeFile(transcript(A), user(1, "one") + reply(2, "two"));
        await syncIndex(index, dir);
        await truncate(transcript(A), user(1, "one").length);
        await syncIndex(index, dir);
        expect(turns(A)).toEqual([{ n: 1, role: "user", text: "one" }]);
    });

    it("indexes a replaced transcript again, even at the same size", async () => {
        await writeFile(transcript(A), user(1, "aaa"));
        await syncIndex(index, dir);
        const other = join(dir, "other");
        await writeFile(other, user(1, "bbb"));
        await rename(other, transcript(A));
        await syncIndex(index, dir);
        expect(turns(A)).toEqual([{ n: 1, role: "user", text: "bbb" }]);
    });

    it("forgets a deleted transcript", async () => {
        await writeFile(transcript(A), user(1, "one"));
        await syncIndex(index, dir);
        await rm(transcript(A));
        await syncIndex(index, dir);
        expect(row(A)).toBeNull();
        expect(turns(A)).toEqual([]);
    });

    it("counts visits as visitsOf does, appends included", async () => {
        await writeFile(
            transcript(A),
            user(0, "early") + session(1) + user(2, "a") + reply(3, "b"),
        );
        await syncIndex(index, dir);
        await appendFile(
            transcript(A),
            user(4, "c") + session(10) + session(11) + user(12, "d"),
        );
        await syncIndex(index, dir);
        expect(visitsByPhrase(index).get(A)).toEqual([
            { userTurns: 3, lastAt: Date.parse(T(4)) },
            { userTurns: 1, lastAt: Date.parse(T(12)) },
        ]);
    });

    it("copies notes, hiding and appraisals, and re-reads a changed sidecar", async () => {
        await writeFile(transcript(A), user(1, "one"));
        await sidecar(A, { title: "First", hidden: true });
        await syncIndex(index, dir);
        expect(row(A)).toMatchObject({ title: "First", hidden: 1 });
        await sidecar(A, { title: "Second" });
        const later = new Date(Date.now() + 5000);
        await utimes(sidecarPath(dir, A), later, later);
        await syncIndex(index, dir);
        expect(row(A)).toMatchObject({ title: "Second", hidden: 0 });
        expect(JSON.parse(row(A)?.sidecar as string)).toMatchObject({
            kind: "ok",
        });
    });

    it("keeps an unparseable sidecar's reason and no notes", async () => {
        await writeFile(transcript(A), user(1, "one"));
        await writeFile(sidecarPath(dir, A), "{");
        await syncIndex(index, dir);
        expect(row(A)?.title).toBeNull();
        expect(JSON.parse(row(A)?.sidecar as string).kind).toBe("unparseable");
    });

    it("derives appraised reads by other conversations", async () => {
        await writeFile(transcript(B), user(1, "b"));
        await writeFile(
            transcript(A),
            user(2, "a") +
                opened(3, "toolu_1", B) +
                opened(4, "toolu_2", B) +
                opened(5, "toolu_3", B, false) +
                reply(6, "x"),
        );
        await sidecar(A, {
            appraisals: {
                toolu_1: { served: "useful", at: "t", model: "m" },
            },
        });
        await syncIndex(index, dir);
        expect(readsByTarget(index).get(B)).toEqual([
            { at: Date.parse(T(3)), served: "useful" },
        ]);
        expect(readsByTarget(index).get(A)).toBeUndefined();
    });

    it("removes leftover temporary files over an hour old", async () => {
        const now = Date.now();
        const old = join(dir, `${A}.meta.json.0a1b2c3d.tmp`);
        const fresh = join(dir, `${B}.meta.json.0a1b2c3e.tmp`);
        await writeFile(old, "{}");
        await writeFile(fresh, "{}");
        const hourAgo = new Date(now - 3_700_000);
        await utimes(old, hourAgo, hourAgo);
        await syncIndex(index, dir, now);
        expect(await Bun.file(old).exists()).toBe(false);
        expect(await Bun.file(fresh).exists()).toBe(true);
    });

    it("lists transcripts only once it holds the lock", async () => {
        await writeFile(transcript(B), user(1, "b"));
        await syncIndex(index, dir);
        // Another process indexes a new transcript while this sync waits
        // for the lock; the sync must list the directory only after that.
        const pending = index.exclusive(async () => {
            await Bun.sleep(50);
            await writeFile(transcript(A), user(2, "a"));
            const { ino, size } = await stat(transcript(A));
            index.db.run(
                "INSERT INTO conversations (phrase, t_size, t_ino, turns, first_at, last_at) VALUES (?, ?, ?, 1, 1, 1)",
                [A, size, ino],
            );
            index.db.run(
                "INSERT INTO turns (phrase, n, role, at, text) VALUES (?, 1, 'user', 1, 'a')",
                [A],
            );
        });
        const syncing = syncIndex(index, dir);
        await Promise.all([pending, syncing]);
        expect(turns(A)).toEqual([{ n: 1, role: "user", text: "a" }]);
        expect(turns(B)).toEqual([{ n: 1, role: "user", text: "b" }]);
    });

    it("ignores files that are not transcripts, and a missing directory", async () => {
        await writeFile(join(dir, "notes.jsonl"), user(1, "x"));
        await syncIndex(index, dir);
        expect(
            index.db.query("SELECT count(*) AS n FROM conversations").get(),
        ).toEqual({ n: 0 });
        await syncIndex(index, join(dir, "missing"));
    });

    // Root ignores file modes, so there is nothing to make unreadable.
    const unreadable = process.getuid?.() === 0 ? it.skip : it;

    unreadable(
        "syncs the other transcripts past one it cannot read",
        async () => {
            const C = phrase(3);
            await writeFile(transcript(A), user(1, "a"));
            await writeFile(transcript(B), user(1, "b"));
            await writeFile(transcript(C), user(1, "c"));
            await chmod(transcript(B), 0o000);
            const warnings = await syncIndex(index, dir);
            expect(warnings).toEqual([expect.stringContaining(transcript(B))]);
            expect(warnings[0]).toContain("EACCES");
            expect(turns(A)).toEqual([{ n: 1, role: "user", text: "a" }]);
            expect(turns(B)).toEqual([]);
            expect(turns(C)).toEqual([{ n: 1, role: "user", text: "c" }]);
            expect(index.db.inTransaction).toBe(false);
        },
    );

    unreadable("keeps the rows of a transcript that fails later", async () => {
        await writeFile(transcript(A), user(1, "old"));
        expect(await syncIndex(index, dir)).toEqual([]);
        // Replaced by a file that cannot be read: the old rows are forgotten
        // inside the savepoint, which the failure rolls back.
        await rm(transcript(A));
        await writeFile(transcript(A), user(1, "new") + user(2, "newer"));
        await chmod(transcript(A), 0o000);
        const warnings = await syncIndex(index, dir);
        expect(warnings).toHaveLength(1);
        expect(turns(A)).toEqual([{ n: 1, role: "user", text: "old" }]);
    });

    it("takes a conversation's source and project from its first session", async () => {
        await writeFile(
            transcript(A),
            [
                event("session", 0, {
                    phrase: "p",
                    sdkSessionId: "",
                    model: "m",
                    promptHash: "",
                    resumed: false,
                    source: "claude-code",
                    project: "github.com/chewygumxx/dorothy",
                }),
                user(1, "fix it"),
                reply(2, "Looking."),
                event("tool", 2, {
                    name: "Bash",
                    input: "{}",
                    output: "secret-free output",
                    ok: true,
                    cut: { input: 0, output: 0 },
                }),
                reply(3, "Fixed."),
                session(4),
            ].join(""),
        );
        await writeFile(transcript(B), [session(0), user(1, "hi")].join(""));
        await syncIndex(index, dir);
        // Tool output is never indexed; consecutive replies are turns.
        expect(turns(A)).toEqual([
            { n: 1, role: "user", text: "fix it" },
            { n: 2, role: "assistant", text: "Looking." },
            { n: 3, role: "assistant", text: "Fixed." },
        ]);
        expect(row(A)).toMatchObject({
            source: "claude-code",
            project: "github.com/chewygumxx/dorothy",
        });
        expect(row(B)).toMatchObject({ source: "chat", project: null });
    });

    it("syncs facts too when given the data directory", async () => {
        await putFact(dir, PERSONAL, {
            name: "tea",
            title: "Tea",
            description: "Likes tea.",
            type: "user",
            extra: {},
            tags: [],
            importance: null,
            provenance: {
                origin: "user",
                by: "dorothy",
                at: T(0),
                created: T(0),
            },
            retired: null,
            body: "Tea.",
        });
        await syncIndex(index, dir, Date.now(), null, dir);
        expect(index.db.query("SELECT name FROM facts").all()).toEqual([
            { name: "tea" },
        ]);
    });
});

describe("a failure while syncing", () => {
    // Makes the statements starting as a key does throw its error, others
    // as they were.
    const failing = (faults: Record<string, Error>) => {
        const run = index.db.run.bind(index.db);
        return spyOn(index.db, "run").mockImplementation(((
            statement: string,
            ...rest: never[]
        ) => {
            for (const [sql, error] of Object.entries(faults)) {
                if (statement.startsWith(sql)) {
                    throw error;
                }
            }
            return run(statement, ...rest);
        }) as typeof index.db.run);
    };

    it("is told as it was when the savepoint's rollback cannot be", async () => {
        await writeFile(transcript(A), user(1, "hello"));
        // A statement that aborts the whole transaction leaves no savepoint
        // to roll back to.
        const failure = failing({
            "INSERT INTO turns": new Error("disk full"),
            "ROLLBACK TO": new Error("no such savepoint: sync"),
        });
        const error = await syncIndex(index, dir).catch(
            (caught: unknown) => caught,
        );
        failure.mockRestore();
        expect(String(error)).toContain("disk full");
        expect(String(error)).not.toContain("no such savepoint");
    });
});

describe("clusters", () => {
    const cluster = (from: number, through: number) => ({
        from,
        through,
        abstract: `Turns ${from} to ${through}.`,
        at: "2026-10-07T08:00:00.000Z",
        model: "claude-test",
    });
    const rows = () =>
        index.db
            .query(
                "SELECT phrase, n, first_turn AS first, last_turn AS last FROM clusters ORDER BY phrase, n",
            )
            .all();

    it("are synced from the sidecar, numbered from 1", async () => {
        await writeFile(transcript(A), user(1, "hello"));
        await sidecar(A, { clusters: [cluster(1, 4), cluster(5, 9)] });
        await syncIndex(index, dir);
        expect(rows()).toEqual([
            { phrase: A, n: 1, first: 1, last: 4 },
            { phrase: A, n: 2, first: 5, last: 9 },
        ]);
    });

    it("follow the sidecar as it changes, and go with the transcript", async () => {
        await writeFile(transcript(A), user(1, "hello"));
        await sidecar(A, { clusters: [cluster(1, 4)] });
        await syncIndex(index, dir);
        await sidecar(A, { clusters: [cluster(1, 4), cluster(5, 6)] });
        // A new mtime, as a rename by updateSidecar would give it.
        const later = new Date(Date.now() + 5000);
        await utimes(sidecarPath(dir, A), later, later);
        await syncIndex(index, dir);
        expect(rows()).toEqual([
            { phrase: A, n: 1, first: 1, last: 4 },
            { phrase: A, n: 2, first: 5, last: 6 },
        ]);
        await rm(transcript(A));
        await syncIndex(index, dir);
        expect(rows()).toEqual([]);
    });
});

describe("hidden conversations", () => {
    const words = (word: string) =>
        index.db
            .query("SELECT rowid FROM turns_fts WHERE turns_fts MATCH ?")
            .all(word);
    const counts = (of: string) =>
        index.db
            .query(
                "SELECT turns, sessions, (SELECT count(*) FROM visits WHERE phrase = ?1) AS visits FROM conversations WHERE phrase = ?1",
            )
            .get(of);
    const body = () =>
        [
            session(0),
            user(1, "the walnut cake"),
            reply(2, "baked at four"),
        ].join("");
    // A new mtime, as a rename by updateSidecar would give it.
    const touched = async (of: string) => {
        const later = new Date(Date.now() + 5000 * ++tick);
        await utimes(sidecarPath(dir, of), later, later);
    };
    let tick = 0;

    it("keep their text out of the index, counting their turns", async () => {
        await writeFile(transcript(A), body());
        await sidecar(A, { hidden: true });
        await syncIndex(index, dir);
        expect(turns(A)).toEqual([]);
        expect(words("walnut")).toEqual([]);
        expect(row(A)).toMatchObject({ hidden: 1, turns: 2, sessions: 1 });
        expect(counts(A)).toEqual({ turns: 2, sessions: 1, visits: 1 });
        await appendFile(transcript(A), user(3, "more walnut"));
        await syncIndex(index, dir);
        expect(turns(A)).toEqual([]);
        expect(row(A)).toMatchObject({ turns: 3 });
    });

    it("lose their text from the index once hidden", async () => {
        await writeFile(transcript(A), body());
        await syncIndex(index, dir);
        expect(turns(A)).toHaveLength(2);
        expect(words("walnut")).toHaveLength(1);
        await sidecar(A, { hidden: true });
        await syncIndex(index, dir);
        expect(turns(A)).toEqual([]);
        expect(words("walnut")).toEqual([]);
        expect(counts(A)).toEqual({ turns: 2, sessions: 1, visits: 1 });
    });

    it("have the text of an index that held it before swept out", async () => {
        await writeFile(transcript(A), body());
        await sidecar(A, {});
        await syncIndex(index, dir);
        // As an index from before hidden text was left out would hold it.
        index.db.run("UPDATE conversations SET hidden = 1 WHERE phrase = ?", [
            A,
        ]);
        await syncIndex(index, dir);
        expect(turns(A)).toEqual([]);
        expect(words("walnut")).toEqual([]);
    });

    it("get their text back, with the rest, once shown again", async () => {
        await writeFile(transcript(A), body());
        await sidecar(A, { hidden: true });
        await syncIndex(index, dir);
        await appendFile(transcript(A), user(3, "and the kiln"));
        await sidecar(A, { hidden: false, title: "Cakes" });
        await touched(A);
        await syncIndex(index, dir);
        expect(turns(A)).toEqual([
            { n: 1, role: "user", text: "the walnut cake" },
            { n: 2, role: "assistant", text: "baked at four" },
            { n: 3, role: "user", text: "and the kiln" },
        ]);
        expect(words("walnut")).toHaveLength(1);
        expect(row(A)).toMatchObject({ hidden: 0, turns: 3, title: "Cakes" });
        expect(counts(A)).toEqual({ turns: 3, sessions: 1, visits: 1 });
    });

    it("leave other conversations' text alone", async () => {
        await writeFile(transcript(A), body());
        await writeFile(transcript(B), user(1, "the other walnut"));
        await sidecar(A, { hidden: true });
        await syncIndex(index, dir);
        expect(turns(B)).toEqual([
            { n: 1, role: "user", text: "the other walnut" },
        ]);
        expect(words("walnut")).toHaveLength(1);
    });
});

describe("the vocabulary", () => {
    const AT = "2026-10-07T12:00:00.000Z";
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
    let path = "";
    beforeEach(() => {
        path = join(dir, "tags.json");
    });
    const write = (concepts: object) =>
        writeFile(path, JSON.stringify({ v: 1, rev: 1, concepts }));
    const rows = (sql: string) => index.db.query(sql).all();
    const state = () =>
        index.db.query("SELECT mtime, broken FROM vocabulary").get() as {
            mtime: number | null;
            broken: string | null;
        };

    it("copies concepts, labels, edges and merges", async () => {
        await write({
            k00000001: concept("dorothy"),
            k00000002: concept("Memory", {
                altLabel: ["Recall"],
                broader: ["k00000001"],
            }),
            k00000003: { mergedInto: "k00000002", at: AT },
            k00000004: { deleted: AT, labels: ["misc"] },
        });
        expect(await syncIndex(index, dir, Date.now(), path)).toEqual([]);
        expect(
            rows("SELECT id, label, alt, scope_note FROM concepts ORDER BY id"),
        ).toEqual([
            {
                id: "k00000001",
                label: "dorothy",
                alt: "[]",
                scope_note: "About dorothy.",
            },
            {
                id: "k00000002",
                label: "Memory",
                alt: '["Recall"]',
                scope_note: "About Memory.",
            },
        ]);
        expect(rows("SELECT norm, id FROM labels ORDER BY norm")).toEqual([
            { norm: "dorothy", id: "k00000001" },
            { norm: "memory", id: "k00000002" },
            { norm: "recall", id: "k00000002" },
        ]);
        expect(rows("SELECT id, parent FROM broader")).toEqual([
            { id: "k00000002", parent: "k00000001" },
        ]);
        expect(rows("SELECT id, into_id FROM merged")).toEqual([
            { id: "k00000003", into_id: "k00000002" },
        ]);
        expect(state().broken).toBeNull();
    });

    it("reads the file again only when it changes", async () => {
        // Whole seconds: utimes cannot restore a fractional mtimeMs.
        const mtime = new Date(Date.UTC(2026, 9, 7, 12));
        await write({ k00000001: concept("one") });
        await utimes(path, mtime, mtime);
        await syncIndex(index, dir, Date.now(), path);
        // Same mtime, different text: left as it was.
        await write({ k00000001: concept("two") });
        await utimes(path, mtime, mtime);
        await syncIndex(index, dir, Date.now(), path);
        expect(rows("SELECT label FROM concepts")).toEqual([{ label: "one" }]);
        await utimes(path, mtime, new Date(mtime.getTime() + 1000));
        await syncIndex(index, dir, Date.now(), path);
        expect(rows("SELECT label FROM concepts")).toEqual([{ label: "two" }]);
    });

    it("empties the tables for a broken or missing file, saying why", async () => {
        await write({ k00000001: concept("one") });
        await syncIndex(index, dir, Date.now(), path);
        await writeFile(path, "{ broken");
        await syncIndex(index, dir, Date.now(), path);
        expect(rows("SELECT * FROM concepts")).toEqual([]);
        expect(state().broken).not.toBeNull();
        await rm(path);
        await syncIndex(index, dir, Date.now(), path);
        expect(state()).toEqual({ mtime: null, broken: null });
    });

    it("rolls back all tag tables and state when copying fails", async () => {
        await write({ k00000001: concept("one") });
        await syncIndex(index, dir, Date.now(), path);
        const before = [
            "concepts",
            "labels",
            "broader",
            "merged",
            "vocabulary",
        ].map((table) => rows(`SELECT * FROM ${table}`));
        index.db.run(
            "CREATE TEMP TRIGGER reject_tag BEFORE INSERT ON concepts WHEN NEW.label = 'two' BEGIN SELECT RAISE(ABORT, 'fixture sync failed'); END",
        );
        await write({
            k00000001: concept("two"),
            k00000002: concept("child", { broader: ["k00000001"] }),
        });
        const later = new Date(Date.now() + 5000);
        await utimes(path, later, later);
        expect(
            (await syncIndex(index, dir, Date.now(), path)).join("\n"),
        ).toContain("fixture sync failed");
        expect(
            ["concepts", "labels", "broader", "merged", "vocabulary"].map(
                (table) => rows(`SELECT * FROM ${table}`),
            ),
        ).toEqual(before);
        index.db.run("DROP TRIGGER reject_tag");
        expect(await syncIndex(index, dir, Date.now(), path)).toEqual([]);
        expect(rows("SELECT label FROM concepts ORDER BY label")).toEqual([
            { label: "child" },
            { label: "two" },
        ]);
    });

    it("remembers an unparseable file's mtime until it changes", async () => {
        const at = new Date("2026-10-07T12:00:00Z");
        await writeFile(path, "{ broken");
        await utimes(path, at, at);
        await syncIndex(index, dir, Date.now(), path);
        expect(state()).toEqual({
            mtime: at.getTime(),
            broken: "it is not JSON",
        });
        await write({ k00000001: concept("repaired") });
        await utimes(path, at, at);
        await syncIndex(index, dir, Date.now(), path);
        expect(state().broken).toBe("it is not JSON");
        expect(rows("SELECT label FROM concepts")).toEqual([]);
        const later = new Date(at.getTime() + 1000);
        await utimes(path, later, later);
        await syncIndex(index, dir, Date.now(), path);
        expect(state().broken).toBeNull();
        expect(rows("SELECT label FROM concepts")).toEqual([
            { label: "repaired" },
        ]);
    });

    it("repairs state next sync when the file vanishes after stat", async () => {
        await write({ k00000001: concept("one") });
        const read = vocabularies.readVocabulary;
        const vanished = spyOn(
            vocabularies,
            "readVocabulary",
        ).mockImplementation(async (file) => {
            await rm(file);
            return read(file);
        });
        try {
            expect(await syncIndex(index, dir, Date.now(), path)).toEqual([]);
        } finally {
            vanished.mockRestore();
        }
        expect(state().mtime).not.toBeNull();
        expect(rows("SELECT label FROM concepts")).toEqual([]);
        expect(await syncIndex(index, dir, Date.now(), path)).toEqual([]);
        expect(state()).toEqual({ mtime: null, broken: null });
    });

    it("leaves the tables alone without a path", async () => {
        await write({ k00000001: concept("one") });
        await syncIndex(index, dir, Date.now(), path);
        await syncIndex(index, dir);
        expect(rows("SELECT label FROM concepts")).toEqual([{ label: "one" }]);
    });

    it("copies each sidecar's tags, in order, and forgets them with it", async () => {
        await writeFile(transcript(A), user(1, "hi"));
        await sidecar(A, { tags: ["k00000002", "k00000001"] });
        await syncIndex(index, dir);
        expect(rows("SELECT phrase, n, id FROM tagged ORDER BY n")).toEqual([
            { phrase: A, n: 0, id: "k00000002" },
            { phrase: A, n: 1, id: "k00000001" },
        ]);
        await sidecar(A, { tags: ["k00000003"] });
        await utimes(
            sidecarPath(dir, A),
            new Date(),
            new Date(Date.now() + 2000),
        );
        await syncIndex(index, dir);
        expect(rows("SELECT id FROM tagged")).toEqual([{ id: "k00000003" }]);
        await rm(transcript(A));
        await syncIndex(index, dir);
        expect(rows("SELECT id FROM tagged")).toEqual([]);
    });
});

describe("conversation_sessions", () => {
    it("is filled from session events naming a body's session, and forgotten with them", async () => {
        const body = (
            minute: number,
            sourceSession: string,
            resumed: boolean,
        ) =>
            event("session", minute, {
                phrase: A,
                sdkSessionId: "",
                model: "m",
                promptHash: "",
                resumed,
                source: "claude-code",
                sourceSession,
            });
        await writeFile(
            transcript(A),
            [body(0, "s-1", false), user(1, "hi"), body(2, "s-2", true)].join(
                "",
            ),
        );
        await syncIndex(index, dir);
        expect(sessionPhrase(index, "s-1")).toBe(A);
        expect(sessionPhrase(index, "s-2")).toBe(A);
        expect(sessionPhrase(index, "s-3")).toBeNull();
        await rm(transcript(A));
        await syncIndex(index, dir);
        expect(sessionPhrase(index, "s-1")).toBeNull();
    });
});
