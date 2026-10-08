// vim:set expandtab shiftwidth=4 filetype=typescript:
// SPDX-License-Identifier: GPL-3.0-only

//
//
// ~chewygumxx/dorothy.git
// ::: :/packages/memory/src/history/cross.test.ts
//
//

import { afterAll, describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { isAbsolute, join } from "node:path";
import { binaryRepo } from "./binary.js";
import { isoRepo } from "./iso.js";
import { MAIN, type MemoryRepo, NEEDS_BINARY } from "./repo.js";
import { bareRepo, put, removeRoots, TEST_ENV, tempRoot } from "./testing.js";

afterAll(removeRoots);

const text = (bytes: Uint8Array | null) =>
    bytes === null ? null : new TextDecoder().decode(bytes);
const git = (root: string) => binaryRepo(root, { env: TEST_ENV });
const iso = (root: string) => isoRepo(root);
const ENGINES: [
    string,
    (root: string) => MemoryRepo,
    (root: string) => MemoryRepo,
][] = [
    ["git then isomorphic-git", git, iso],
    ["isomorphic-git then git", iso, git],
];

// A long transcript, so that the binary's bundles carry deltas against
// objects the receiving side already holds.
const transcript = (lines: number) =>
    Array.from(
        { length: lines },
        (_, index) =>
            `${JSON.stringify({ v: 1, kind: "user", text: `line ${index} of a long chat` })}\n`,
    ).join("");

describe.each(ENGINES)("%s", (_, first, second) => {
    it("reads and continues the other's commits", async () => {
        const root = join(tempRoot(), "data");
        const a = first(root);
        await a.init();
        put(root, "tags.json", "{}\n");
        const one = (await a.commit(["tags.json"], "one")) as string;
        const b = second(root);
        expect(b.exists()).toBe(true);
        expect((await b.log()).map((commit) => commit.message)).toEqual([
            "one",
        ]);
        expect(text(await b.show("tags.json", one))).toBe("{}\n");
        expect(await b.changed()).toEqual([]);
        put(root, "tags.json", "{ }\n");
        expect(await b.changed()).toEqual(["tags.json"]);
        await b.commit(["tags.json"], "two");
        expect((await a.log()).map((commit) => commit.message)).toEqual([
            "two",
            "one",
        ]);
    });

    it("applies the other's bundles, thin ones included", async () => {
        const a = first(join(tempRoot(), "a"));
        await a.init();
        put(a.root, "transcripts/x.jsonl", transcript(3000));
        const one = (await a.commit(["transcripts/x.jsonl"], "one")) as string;
        const full = (await a.bundle(null)) as Uint8Array;
        put(a.root, "transcripts/x.jsonl", transcript(3001));
        const two = (await a.commit(["transcripts/x.jsonl"], "two")) as string;
        const later = (await a.bundle(one)) as Uint8Array;
        const b = second(join(tempRoot(), "b"));
        await b.init();
        expect(await b.unbundle(full)).toBe(one);
        expect(await b.unbundle(later)).toBe(two);
        await b.checkout();
        expect(readFileSync(join(b.root, "transcripts/x.jsonl"), "utf8")).toBe(
            transcript(3001),
        );
    });

    it("continues the other's sealed branch", async () => {
        const root = join(tempRoot(), "data");
        const a = first(root);
        await a.init();
        await a.appendSealed(
            "bundles/000001.enc",
            new Uint8Array([1]),
            "r\n",
            "seal 1",
        );
        const b = second(root);
        await b.appendSealed(
            "bundles/000002.enc",
            new Uint8Array([2]),
            "r\n",
            "seal 2",
        );
        expect(await a.sealedNames()).toEqual([
            "bundles/000001.enc",
            "bundles/000002.enc",
        ]);
        expect([...(await a.sealedFile("bundles/000002.enc"))]).toEqual([2]);
        expect(await a.resolve(MAIN)).toBeNull();
    });
});

describe("the isomorphic-git engine", () => {
    it("resolves a relative root", () => {
        const repo = iso("relative/data");
        expect(isAbsolute(repo.root)).toBe(true);
        expect(repo.root).toBe(join(process.cwd(), "relative/data"));
    });

    it("pushes only over https", async () => {
        const mirror = await bareRepo();
        const repo = iso(join(tempRoot(), "data"));
        await repo.init();
        await repo.appendSealed(
            "bundles/000001.enc",
            new Uint8Array([1]),
            "r\n",
            "seal 1",
        );
        await repo.setRemote("mirror", mirror);
        await expect(repo.push("mirror", "sealed", null)).rejects.toThrow(
            NEEDS_BINARY,
        );
        await expect(repo.fetch(mirror, "sealed", null)).rejects.toThrow(
            NEEDS_BINARY,
        );
    });
});
