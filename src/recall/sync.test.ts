// vim:set expandtab shiftwidth=4 filetype=typescript:
// SPDX-License-Identifier: GPL-3.0-only

//
//
// ~chewygumxx/dorothy.git
// ::: :/src/recall/sync.test.ts
//
//

import { afterEach, beforeEach, describe, expect, it } from "bun:test";
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
import { EMPTY_SIDECAR, type Sidecar, sidecarPath } from "../memory/sidecar.js";
import { newPhrase } from "../session-id.js";
import { RecallIndex } from "./store.js";
import { readsByTarget, syncIndex, visitsByPhrase } from "./sync.js";

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
        expect(rows()).toHaveLength(2);
        await rm(transcript(A));
        await syncIndex(index, dir);
        expect(rows()).toEqual([]);
    });
});
