// vim:set expandtab shiftwidth=4 filetype=typescript:
// SPDX-License-Identifier: GPL-3.0-only

//
//
// ~chewygumxx/dorothy.git
// ::: :/packages/memory/src/facts/pending.test.ts
//
//

import { afterEach, beforeEach, expect, it } from "bun:test";
import { existsSync } from "node:fs";
import { appendFile, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
    clearPending,
    hashOf,
    notePending,
    pendingPath,
    pendingWrites,
} from "./pending.js";

let root = "";
beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "dorothy-pending-"));
});
afterEach(async () => {
    await rm(root, { recursive: true, force: true });
});

it("keeps nothing where there is no repository", async () => {
    await notePending(root, "knowledge/personal/a.md", "one");
    expect(existsSync(pendingPath(root))).toBe(false);
    expect((await pendingWrites(root)).writes.size).toBe(0);
});

it("keeps pending hashes of a path, and forgets a cleared one", async () => {
    await mkdir(join(root, ".git"));
    await notePending(root, "knowledge/personal/a.md", "one");
    await notePending(root, "knowledge/personal/a.md", "two");
    await notePending(root, "knowledge/personal/b.md", "three");
    expect([...(await pendingWrites(root)).writes]).toEqual([
        ["knowledge/personal/a.md", new Set([hashOf("one"), hashOf("two")])],
        ["knowledge/personal/b.md", new Set([hashOf("three")])],
    ]);
    await clearPending(root, ["knowledge/personal/a.md"]);
    expect([...(await pendingWrites(root)).writes]).toEqual([
        ["knowledge/personal/b.md", new Set([hashOf("three")])],
    ]);
    await clearPending(root, ["knowledge/personal/b.md"]);
    expect(existsSync(pendingPath(root))).toBe(false);
});

it("repairs a malformed journal without losing readable records", async () => {
    await mkdir(join(root, ".git"));
    await notePending(root, "knowledge/personal/a.md", "one");
    await appendFile(pendingPath(root), "interrupted record\n");
    await notePending(root, "knowledge/personal/b.md", "two");
    await clearPending(root, ["knowledge/personal/other.md"]);
    expect((await pendingWrites(root)).problem).toBeNull();
    expect([...(await pendingWrites(root)).writes]).toEqual([
        ["knowledge/personal/a.md", new Set([hashOf("one")])],
        ["knowledge/personal/b.md", new Set([hashOf("two")])],
    ]);
});

it("repairs an empty directory in place of the journal", async () => {
    await mkdir(pendingPath(root), { recursive: true });
    await clearPending(root, []);
    expect(existsSync(pendingPath(root))).toBe(false);
    await notePending(root, "knowledge/personal/a.md", "one");
    expect(
        (await pendingWrites(root)).writes.get("knowledge/personal/a.md"),
    ).toEqual(new Set([hashOf("one")]));
});

it("keeps the next note separate from a torn final record", async () => {
    await mkdir(join(root, ".git"));
    await writeFile(pendingPath(root), "interrupted record");
    await notePending(root, "knowledge/personal/a.md", "one");
    const pending = await pendingWrites(root);
    expect(pending.writes.get("knowledge/personal/a.md")).toEqual(
        new Set([hashOf("one")]),
    );
    expect(pending.problem).not.toBeNull();
});
