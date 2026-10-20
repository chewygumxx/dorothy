// vim:set expandtab shiftwidth=4 filetype=typescript:
// SPDX-License-Identifier: GPL-3.0-only

//
//
// ~chewygumxx/dorothy.git
// ::: :/packages/memory/src/recording/sources.test.ts
//
//

import { Database } from "bun:sqlite";
import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import {
    mkdir,
    mkdtemp,
    readdir,
    readFile,
    rename,
    rm,
    stat,
    symlink,
    utimes,
    writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import type { Env } from "@dorothy/core";
import { readCodex } from "./codex.js";
import { message, meta } from "./fixtures.js";
import {
    HERMES_SCHEMA,
    hermesAt,
    hermesMessage,
    hermesSession,
} from "./hermes-fixtures.js";
import {
    claudeSource,
    codexSource,
    fileSessions,
    hermesSource,
    type SourceSession,
} from "./sources.js";

let root = "";
let env: Env;
beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "dorothy-recording-sources-"));
    env = { HOME: root };
});
afterEach(async () => {
    await rm(root, { recursive: true, force: true });
});
async function file(path: string, text = "Synthetic.\n") {
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, text);
    return path;
}
function only(sessions: SourceSession[]): SourceSession {
    expect(sessions).toHaveLength(1);
    const session = sessions[0];
    if (!session) throw new Error("missing fixture session");
    return session;
}
async function hermesFixture(seed: (db: Database) => void) {
    const path = join(env.HERMES_HOME ?? join(root, ".hermes"), "state.db");
    await mkdir(dirname(path), { recursive: true });
    const writer = new Database(path);
    try {
        writer.exec(HERMES_SCHEMA);
        seed(writer);
    } finally {
        writer.close();
    }
    return path;
}

describe("recording source roots", () => {
    it("lists Claude's default and all configured account directories without subagents", async () => {
        const first = await file(
            join(root, ".claude/projects/project-one/first.jsonl"),
        );
        const second = await file(
            join(root, "second/projects/project-two/second.jsonl"),
        );
        await file(
            join(
                root,
                ".claude/projects/project-one/first/subagents/agent-child.jsonl",
            ),
        );
        await file(join(root, ".claude/projects/project-one/agent-old.jsonl"));
        await file(join(root, ".claude/projects/project-one/notes.txt"));
        const sessions = await claudeSource(env, [join(root, "second")]).list();
        expect(sessions.map((session) => session.path).sort()).toEqual(
            [first, second].sort(),
        );
        expect(
            sessions.every((session) => session.host === "claude-code"),
        ).toBe(true);
        expect(new Set(sessions.map((session) => session.key)).size).toBe(2);
    });
    it("respects CLAUDE_CONFIG_DIR and deduplicates configured aliases", async () => {
        env.CLAUDE_CONFIG_DIR = join(root, "custom-claude");
        const path = await file(
            join(env.CLAUDE_CONFIG_DIR, "projects/p/session.jsonl"),
        );
        await file(join(root, ".claude/projects/p/unselected.jsonl"));
        await symlink(env.CLAUDE_CONFIG_DIR, join(root, "alias"));
        expect(
            only(
                await claudeSource(env, [
                    env.CLAUDE_CONFIG_DIR,
                    join(root, "alias"),
                ]).list(),
            ).path,
        ).toBe(path);
    });
    it("finds nested Codex rollouts under CODEX_HOME and ignores other files", async () => {
        env.CODEX_HOME = join(root, "custom-codex");
        const path = await file(
            join(env.CODEX_HOME, "sessions/2026/10/20/rollout-fixture.jsonl"),
        );
        await file(join(env.CODEX_HOME, "sessions/2026/10/20/other.jsonl"));
        await file(join(root, ".codex/sessions/rollout-unselected.jsonl"));
        const session = only(await codexSource(env).list());
        expect(session.host).toBe("codex");
        expect(session.path).toBe(path);
    });
    it("uses HOME for Codex when its override is unset", async () => {
        const path = await file(
            join(root, ".codex/sessions/rollout-fixture.jsonl"),
        );
        expect(only(await codexSource(env).list()).path).toBe(path);
    });
    it("does not follow nested symlinks or symlinked transcript files", async () => {
        const outside = join(root, "outside");
        await file(join(outside, "rollout-hidden.jsonl"));
        const sessions = join(root, ".codex/sessions");
        await mkdir(sessions, { recursive: true });
        await symlink(outside, join(sessions, "linked-directory"));
        await symlink(
            join(outside, "rollout-hidden.jsonl"),
            join(sessions, "rollout-link.jsonl"),
        );
        expect(await codexSource(env).list()).toEqual([]);
    });
    it("treats absent stores as empty without creating them", async () => {
        expect(await claudeSource(env).list()).toEqual([]);
        expect(await codexSource(env).list()).toEqual([]);
        expect(await hermesSource(env).list()).toEqual([]);
        expect(await readdir(root)).toEqual([]);
    });
    it("never falls back to the process home when the injected home is missing", async () => {
        await expect(codexSource({}).list()).rejects.toThrow("recording root");
        await expect(claudeSource({}).list()).rejects.toThrow("recording root");
        await expect(hermesSource({}).list()).rejects.toThrow("recording root");
    });
    it("accepts an explicit host root without HOME and rejects relative roots", async () => {
        const path = await file(join(root, "sessions/rollout-fixture.jsonl"));
        expect(only(await codexSource({ CODEX_HOME: root }).list()).path).toBe(
            path,
        );
        await expect(
            codexSource({ HOME: root, CODEX_HOME: "relative" }).list(),
        ).rejects.toThrow("recording root");
        await expect(claudeSource(env, ["relative"]).list()).rejects.toThrow(
            "recording root",
        );
    });
});

describe("recording file observations", () => {
    const path = () => join(root, ".codex/sessions/rollout-fixture.jsonl");
    it("skips an unchanged file after a completed observation", async () => {
        await file(path(), `${meta()}\n${message("user", "First.")}\n`);
        const session = only(await codexSource(env).list());
        const read = await session.read();
        expect(read?.kind).toBe("file");
        expect(await session.read(read?.fingerprint)).toBeNull();
    });
    it("reads an appended file whole, preserving byte-independent physical source ids", async () => {
        const first = `${meta()}\n${message("user", "Synthetic moss: é 🌿.")}\n`;
        await file(path(), first);
        const session = only(await codexSource(env).list());
        const initial = await session.read();
        await writeFile(
            path(),
            `${first}${message("assistant", "New speech.")}\n`,
        );
        const appended = await session.read(initial?.fingerprint);
        if (appended?.kind !== "file") throw new Error("missing file read");
        expect(appended.lineOffset).toBe(0);
        expect(
            readCodex(appended.lines).events.map((event) => event.sourceId),
        ).toEqual(["2", "3"]);
        expect(appended.lines).toHaveLength(3);
        expect(appended.stable).toBe(true);
    });
    it("reads a same-inode rewrite whole rather than treating growth as proof of an append", async () => {
        await file(path(), "First.\n");
        const session = only(await codexSource(env).list());
        const before = await session.read();
        await writeFile(path(), "Replacement prefix.\nNew tail.\n");
        const read = await session.read(before?.fingerprint);
        if (read?.kind !== "file") throw new Error("missing file read");
        expect(read.lines).toEqual(["Replacement prefix.", "New tail."]);
    });
    it("reads a shrunk file whole", async () => {
        await file(path(), "First.\nSecond.\n");
        const session = only(await codexSource(env).list());
        const before = await session.read();
        await writeFile(path(), "Short.\n");
        const read = await session.read(before?.fingerprint);
        if (read?.kind !== "file") throw new Error("missing file read");
        expect(read.lines).toEqual(["Short."]);
    });
    it("detects a replacement even with equal size and mtime, without relying on inode reuse", async () => {
        await file(path(), "Original.\n");
        const fixed = new Date("2026-10-20T00:00:00.000Z");
        await utimes(path(), fixed, fixed);
        const session = only(await codexSource(env).list());
        const before = await session.read();
        const replacement = await file(
            join(root, "replacement.jsonl"),
            "Replaced.\n",
        );
        await utimes(replacement, fixed, fixed);
        await rename(replacement, path());
        const read = await session.read(before?.fingerprint);
        if (read?.kind !== "file") throw new Error("missing file read");
        expect(read.lines).toEqual(["Replaced."]);
    });
    it("detects a same-size rewrite by mtime", async () => {
        await file(path(), "First.\n");
        await utimes(path(), 100, 100);
        const session = only(await codexSource(env).list());
        const before = await session.read();
        await writeFile(path(), "Other.\n");
        await utimes(path(), 101, 101);
        const read = await session.read(before?.fingerprint);
        if (read?.kind !== "file") throw new Error("missing file read");
        expect(read.lines).toEqual(["Other."]);
    });
    it("re-reads a torn tail whole when it completes and retains genuine blank lines", async () => {
        await file(path(), "First.\n\nTorn");
        const session = only(await codexSource(env).list());
        const before = await session.read();
        if (before?.kind !== "file") throw new Error("missing file read");
        expect(before.lines).toEqual(["First.", "", "Torn"]);
        expect(before.stable).toBe(false);
        await writeFile(path(), "First.\n\nTorn completed.\n");
        const read = await session.read(before.fingerprint);
        if (read?.kind !== "file") throw new Error("missing file read");
        expect(read.lines).toEqual(["First.", "", "Torn completed."]);
        expect(read.stable).toBe(true);
    });
    it("refreshes a descriptor's stats before deciding whether to skip", async () => {
        await file(path(), "Before.\n");
        const session = only(await codexSource(env).list());
        await writeFile(path(), "Changed since listing.\n");
        const read = await session.read(session.fingerprint);
        if (read?.kind !== "file") throw new Error("missing file read");
        expect(read.lines).toEqual(["Changed since listing."]);
    });
});

describe("recording Hermes observations", () => {
    it("lists sessions from HERMES_HOME with all physical rows counted, including invisible rows", async () => {
        env.HERMES_HOME = join(root, "custom-hermes");
        const path = await hermesFixture((db) => {
            hermesSession(db, "active");
            hermesSession(db, "empty");
            hermesMessage(db, 1, "user", "Invisible.", {
                session: "active",
                active: 0,
            });
            hermesMessage(db, 9, "assistant", "Visible.", {
                session: "active",
            });
        });
        const sessions = await hermesSource(env).list();
        expect(sessions.map((session) => session.session)).toEqual([
            "active",
            "empty",
        ]);
        expect(sessions[0]?.path).toBe(path);
        expect(sessions[0]?.at).toBe(hermesAt(9));
        expect(sessions[0]?.fingerprint).toEqual({
            kind: "rows",
            maxId: 9,
            count: 2,
        });
        expect(sessions[1]?.fingerprint).toEqual({
            kind: "rows",
            maxId: 0,
            count: 0,
        });
        expect(new Set(sessions.map((session) => session.key)).size).toBe(2);
    });
    it("skips an unchanged session and reads its whole payload otherwise", async () => {
        await hermesFixture((db) => {
            hermesSession(db);
            hermesMessage(db, 1, "user", "Synthetic speech.");
        });
        const session = only(await hermesSource(env).list());
        const read = await session.read();
        if (read?.kind !== "hermes") throw new Error("missing Hermes read");
        expect(read.read.events).toEqual([
            {
                kind: "user",
                text: "Synthetic speech.",
                sourceId: "1",
                at: hermesAt(1),
            },
        ]);
        expect(read.stable).toBe(true);
        expect(await session.read(read.fingerprint)).toBeNull();
    });
    it("replays changed sessions without dropping a stable id below the old maximum", async () => {
        const path = await hermesFixture((db) => {
            hermesSession(db);
            hermesMessage(db, 1, "user", "Previously invisible.", {
                active: 0,
            });
            hermesMessage(db, 8, "user", "Already visible.");
            db.run(
                "UPDATE messages SET message_uid = 'fixture-old' WHERE id = 1",
            );
            db.run(
                "UPDATE messages SET message_uid = 'fixture-visible' WHERE id = 8",
            );
        });
        const session = only(await hermesSource(env).list());
        const before = await session.read();
        if (before?.kind !== "hermes") throw new Error("missing Hermes read");
        expect(before.read.events.map((event) => event.sourceId)).toEqual([
            "8",
        ]);
        const writer = new Database(path);
        try {
            hermesMessage(writer, 9, "user", "Previously invisible.", {
                second: 1,
            });
            writer.run(
                "UPDATE messages SET message_uid = 'fixture-old' WHERE id = 9",
            );
        } finally {
            writer.close();
        }
        const read = await session.read(before.fingerprint);
        if (read?.kind !== "hermes")
            throw new Error("missing changed Hermes read");
        expect(read.read.events.map((event) => event.sourceId)).toEqual([
            "8",
            "1",
        ]);
        expect(read.fingerprint).toEqual({ kind: "rows", maxId: 9, count: 3 });
    });
    it("detects a row-count change even when the maximum id is unchanged", async () => {
        const path = await hermesFixture((db) => {
            hermesSession(db);
            hermesMessage(db, 1, "user", "First.");
            hermesMessage(db, 9, "user", "Last.");
        });
        const session = only(await hermesSource(env).list());
        const before = await session.read();
        const writer = new Database(path);
        try {
            writer.run("DELETE FROM messages WHERE id = 1");
        } finally {
            writer.close();
        }
        const read = await session.read(before?.fingerprint);
        if (read?.kind !== "hermes")
            throw new Error("missing changed Hermes read");
        expect(read.fingerprint).toEqual({ kind: "rows", maxId: 9, count: 1 });
        expect(read.read.events.map((event) => event.sourceId)).toEqual(["9"]);
    });
    it("decodes only the requested session and keeps another session's failure separate", async () => {
        await hermesFixture((db) => {
            hermesSession(db, "first");
            hermesSession(db, "other");
            hermesMessage(db, 1, "user", "First.", { session: "first" });
            hermesMessage(db, 2, "user", "\0json:{", { session: "other" });
        });
        const sessions = await hermesSource(env).list();
        const first = sessions.find((session) => session.session === "first");
        const other = sessions.find((session) => session.session === "other");
        const firstRead = await first?.read();
        const otherRead = await other?.read();
        if (firstRead?.kind !== "hermes" || otherRead?.kind !== "hermes")
            throw new Error("missing Hermes read");
        expect(firstRead.read.session).toBe("first");
        expect(firstRead.read.halt).toBeNull();
        expect(otherRead.read.halt?.id).toBe(2);
    });
    it("leaves database bytes, mtime and directory entries untouched", async () => {
        const path = await hermesFixture((db) => {
            hermesSession(db);
            hermesMessage(db, 1, "user", "Synthetic speech.");
        });
        const before = await readFile(path);
        const stamp = await stat(path);
        const files = await readdir(dirname(path));
        const session = only(await hermesSource(env).list());
        await session.read();
        expect(await readFile(path)).toEqual(before);
        expect((await stat(path)).mtimeMs).toBe(stamp.mtimeMs);
        expect(await readdir(dirname(path))).toEqual(files);
    });
    it("accepts HERMES_HOME without an ambient HOME", async () => {
        env = { HERMES_HOME: join(root, "explicit-hermes") };
        const path = await hermesFixture((db) => hermesSession(db));
        expect(only(await hermesSource(env).list()).path).toBe(path);
    });
    it("reads a Hermes session deleted since the listing as nothing", async () => {
        const path = await hermesFixture((db) => {
            hermesSession(db);
            hermesMessage(db, 1, "user", "Synthetic speech.");
        });
        const session = only(await hermesSource(env).list());
        const writer = new Database(path);
        try {
            writer.run("DELETE FROM messages");
            writer.run("DELETE FROM sessions");
        } finally {
            writer.close();
        }
        expect(await session.read()).toBeNull();
    });
});

describe("recording vanishing entries", () => {
    it("reads a file removed since the listing as nothing", async () => {
        const path = await file(
            join(root, ".codex/sessions/rollout-gone.jsonl"),
            `${meta()}\n`,
        );
        const session = only(await codexSource(env).list());
        await rm(path);
        expect(await session.read()).toBeNull();
    });
    it("skips a listed path that is gone, not the whole listing", async () => {
        const kept = await file(join(root, "kept.jsonl"));
        const sessions = await fileSessions("codex", [
            join(root, "gone.jsonl"),
            kept,
        ]);
        expect(sessions.map((session) => session.path)).toEqual([kept]);
    });
    it("still fails on an error other than a vanished entry", async () => {
        const kept = await file(join(root, "kept.jsonl"));
        await expect(
            fileSessions("codex", [`${kept}/under-a-file`]),
        ).rejects.toThrow();
    });
});
