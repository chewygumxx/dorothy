// vim:set expandtab shiftwidth=4 filetype=typescript:
// SPDX-License-Identifier: GPL-3.0-only

//
//
// ~chewygumxx/dorothy.git
// ::: :/src/history/heal.test.ts
//
//

import { afterAll, beforeEach, describe, expect, it } from "bun:test";
import { readdirSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { binaryRepo } from "./binary.js";
import {
    goodVersion,
    keepCopy,
    putBack,
    RECOVERY_DEPTH,
    recoverFile,
    stamp,
} from "./heal.js";
import type { MemoryRepo } from "./repo.js";
import { put, removeRoots, TEST_ENV, tempRoot } from "./testing.js";

afterAll(removeRoots);

const NOW = new Date("2026-10-08T00:00:00.000Z");
const LATER = new Date("2026-10-09T00:00:00.000Z");
const vocabulary = (rev: number) =>
    `${JSON.stringify({ v: 1, rev, concepts: {} })}\n`;
const event = (text: string) =>
    `${JSON.stringify({ v: 1, kind: "user", at: NOW.toISOString(), text })}\n`;
const TRANSCRIPT = "transcripts/a-b-c-d.jsonl";

let repo: MemoryRepo;
let root = "";
const read = (path: string) => readFileSync(join(root, path), "utf8");
const commitFile = async (path: string, text: string, message: string) => {
    put(root, path, text);
    return (await repo.commit([path], message)) as string;
};

beforeEach(async () => {
    root = join(tempRoot(), "data");
    repo = binaryRepo(root, { env: TEST_ENV });
    await repo.init();
});

describe("stamp", () => {
    it("is a UTC time safe in a file name", () => {
        expect(stamp(NOW)).toBe("2026-10-08T00-00-00-000Z");
    });
});

describe("goodVersion", () => {
    it("finds the newest committed version that passes the lint", async () => {
        await commitFile("tags.json", vocabulary(1), "one");
        const two = await commitFile("tags.json", vocabulary(2), "two");
        // Committed by hand, past the lint.
        await commitFile("tags.json", "{", "three");
        expect(await goodVersion(repo, "tags.json")).toMatchObject({
            sha: two,
            bytes: new TextEncoder().encode(vocabulary(2)),
        });
        expect(await goodVersion(repo, "missing.json")).toBeNull();
        expect(RECOVERY_DEPTH).toBe(200);
    });
});

describe("recoverFile", () => {
    it("restores the newest good version and keeps the broken bytes", async () => {
        await commitFile("tags.json", vocabulary(1), "one");
        const two = await commitFile("tags.json", vocabulary(2), "two");
        put(root, "tags.json", "{{");
        expect(await recoverFile(repo, root, "tags.json", NOW)).toEqual({
            kind: "restored",
            path: "tags.json",
            from: two,
            at: expect.any(String),
            broken: "broken/tags.json.2026-10-08T00-00-00-000Z",
        });
        expect(read("tags.json")).toBe(vocabulary(2));
        expect(read("broken/tags.json.2026-10-08T00-00-00-000Z")).toBe("{{");
        expect((await repo.log())[0]?.message).toBe(
            `restore: tags.json from ${two.slice(0, 7)} (broken kept)`,
        );
        expect(await repo.changed()).toEqual([]);
    });

    it("keeps one copy of the same broken bytes", async () => {
        await commitFile("tags.json", vocabulary(1), "one");
        put(root, "tags.json", "{{");
        const first = await recoverFile(repo, root, "tags.json", NOW);
        put(root, "tags.json", "{{");
        const second = await recoverFile(repo, root, "tags.json", LATER);
        expect(second.broken).toBe(first.broken);
        expect(readdirSync(join(root, "broken"))).toHaveLength(1);
    });

    it("keeps a copy and restores nothing when no version is good", async () => {
        put(root, "tags.json", "{");
        expect(await recoverFile(repo, root, "tags.json", NOW)).toEqual({
            kind: "unrecoverable",
            path: "tags.json",
            broken: "broken/tags.json.2026-10-08T00-00-00-000Z",
        });
        expect(read("tags.json")).toBe("{");
        expect((await repo.log())[0]?.message).toBe(
            "broken: tags.json kept, no good version",
        );
    });

    it("restores a cut transcript, keeping what was left of it", async () => {
        await commitFile(TRANSCRIPT, event("one") + event("two"), "turn");
        put(root, TRANSCRIPT, event("one"));
        expect((await recoverFile(repo, root, TRANSCRIPT, NOW)).kind).toBe(
            "restored",
        );
        expect(read(TRANSCRIPT)).toBe(event("one") + event("two"));
        expect(
            read("broken/transcripts/a-b-c-d.jsonl.2026-10-08T00-00-00-000Z"),
        ).toBe(event("one"));
    });
});

describe("putBack", () => {
    it("puts an earlier version over a valid file, keeping the file", async () => {
        const one = await commitFile("tags.json", vocabulary(1), "one");
        await commitFile("tags.json", vocabulary(2), "two");
        const bytes = (await repo.show("tags.json", one)) as Uint8Array;
        const copy = await putBack(
            repo,
            root,
            "tags.json",
            { sha: one, at: NOW.toISOString(), bytes },
            NOW,
        );
        expect(copy).toBe("broken/tags.json.2026-10-08T00-00-00-000Z");
        expect(read("tags.json")).toBe(vocabulary(1));
        expect(read(copy as string)).toBe(vocabulary(2));
    });

    it("puts back a deleted file with nothing to keep", async () => {
        const one = await commitFile("tags.json", vocabulary(1), "one");
        rmSync(join(root, "tags.json"));
        const bytes = (await repo.show("tags.json", one)) as Uint8Array;
        expect(
            await putBack(
                repo,
                root,
                "tags.json",
                { sha: one, at: NOW.toISOString(), bytes },
                NOW,
            ),
        ).toBeNull();
        expect(read("tags.json")).toBe(vocabulary(1));
    });
});

describe("keepCopy", () => {
    it("files a copy under broken/, beside the path it came from", async () => {
        expect(await keepCopy(root, TRANSCRIPT, new Uint8Array([1]), NOW)).toBe(
            "broken/transcripts/a-b-c-d.jsonl.2026-10-08T00-00-00-000Z",
        );
    });
});
