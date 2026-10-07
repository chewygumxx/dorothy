// vim:set expandtab shiftwidth=4 filetype=typescript:
// SPDX-License-Identifier: GPL-3.0-only

//
//
// ~chewygumxx/dorothy.git
// ::: :/src/history/repo.test.ts
//
//

import { afterAll, describe, expect, it } from "bun:test";
import { readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { binaryRepo } from "./binary.js";
import { MAIN, type MemoryRepo, SEALED } from "./repo.js";
import { put, removeRoots, TEST_ENV, tempRoot } from "./testing.js";

afterAll(removeRoots);

const text = (bytes: Uint8Array | null) =>
    bytes === null ? null : new TextDecoder().decode(bytes);
const messages = async (repo: MemoryRepo, path?: string, limit?: number) =>
    (await repo.log(path, limit)).map((commit) => commit.message);

function contract(make: (root: string) => MemoryRepo): void {
    const fresh = async () => {
        const repo = make(join(tempRoot(), "data"));
        await repo.init();
        return repo;
    };

    it("starts empty", async () => {
        const repo = await fresh();
        expect(repo.exists()).toBe(true);
        expect(await repo.log()).toEqual([]);
        expect(await repo.resolve(MAIN)).toBeNull();
        expect(await repo.show("tags.json", "HEAD")).toBeNull();
        expect(await repo.bundle(null)).toBeNull();
        expect(await repo.sealedNames()).toEqual([]);
        expect(await repo.changed()).toEqual([]);
    });

    it("commits the paths it is given, and nothing when they are unchanged", async () => {
        const repo = await fresh();
        put(repo.root, "tags.json", "{}\n");
        // A space in a name, printed as it is.
        put(repo.root, "transcripts/a b.jsonl", "1\n");
        const sha = await repo.commit(
            ["tags.json", "transcripts/a b.jsonl"],
            "adopt: 2 files",
        );
        expect(sha).toMatch(/^[0-9a-f]{40}$/);
        expect(await repo.commit(["tags.json"], "again")).toBeNull();
        const [head] = await repo.log();
        expect(head?.sha).toBe(sha as string);
        expect(head?.message).toBe("adopt: 2 files");
        expect(head?.at).toMatch(/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.000Z$/);
        expect(await repo.files(sha as string)).toEqual([
            "tags.json",
            "transcripts/a b.jsonl",
        ]);
        expect(text(await repo.show("transcripts/a b.jsonl", "HEAD"))).toBe(
            "1\n",
        );
    });

    it("logs one path's commits, newest first, up to a limit", async () => {
        const repo = await fresh();
        put(repo.root, "a.txt", "1\n");
        await repo.commit(["a.txt"], "one");
        put(repo.root, "b.txt", "1\n");
        await repo.commit(["b.txt"], "two");
        put(repo.root, "a.txt", "2\n");
        await repo.commit(["a.txt"], "three");
        expect(await messages(repo, "a.txt")).toEqual(["three", "one"]);
        expect(await messages(repo, undefined, 2)).toEqual(["three", "two"]);
        expect(await messages(repo, "never.txt")).toEqual([]);
    });

    it("shows a file as it was at a revision", async () => {
        const repo = await fresh();
        put(repo.root, "a.txt", "1\n");
        const first = (await repo.commit(["a.txt"], "one")) as string;
        put(repo.root, "a.txt", "2\n");
        await repo.commit(["a.txt"], "two");
        expect(text(await repo.show("a.txt", first))).toBe("1\n");
        expect(text(await repo.show("a.txt", "HEAD"))).toBe("2\n");
        expect(await repo.show("missing.txt", "HEAD")).toBeNull();
        expect(await repo.show("a.txt", "nonsense")).toBeNull();
        expect(await repo.resolve(first.slice(0, 7))).toBe(first);
        expect(await repo.resolve("nonsense")).toBeNull();
    });

    it("commits a deletion, and passes over a path never tracked", async () => {
        const repo = await fresh();
        put(repo.root, "a.txt", "1\n");
        put(repo.root, "b.txt", "1\n");
        await repo.commit(["a.txt", "b.txt"], "one");
        rmSync(join(repo.root, "a.txt"));
        expect(
            await repo.commit(["a.txt", "never.txt"], "outside: a.txt"),
        ).not.toBeNull();
        expect(await repo.files("HEAD")).toEqual(["b.txt"]);
        expect(await repo.commit(["never.txt"], "nothing")).toBeNull();
    });

    it("lists what changed since the last commit, ignored files aside", async () => {
        const repo = await fresh();
        put(repo.root, ".gitignore", "*.tmp\n");
        put(repo.root, "a.txt", "1\n");
        put(repo.root, "d.txt", "1\n");
        await repo.commit([".gitignore", "a.txt", "d.txt"], "one");
        put(repo.root, "a.txt", "22\n");
        put(repo.root, "transcripts/b.jsonl", "1\n");
        put(repo.root, "c.tmp", "x");
        rmSync(join(repo.root, "d.txt"));
        expect((await repo.changed()).sort()).toEqual([
            "a.txt",
            "d.txt",
            "transcripts/b.jsonl",
        ]);
        await repo.commit(["a.txt", "d.txt", "transcripts/b.jsonl"], "two");
        expect(await repo.changed()).toEqual([]);
    });

    it("bundles commits and applies them to another repository", async () => {
        const a = await fresh();
        put(a.root, "a.txt", "1\n");
        const first = (await a.commit(["a.txt"], "one")) as string;
        const b = await fresh();
        expect(await b.unbundle((await a.bundle(null)) as Uint8Array)).toBe(
            first,
        );
        put(a.root, "a.txt", "1\n2\n");
        const second = (await a.commit(["a.txt"], "two")) as string;
        const later = (await a.bundle(first)) as Uint8Array;
        expect(await a.bundle(second)).toBeNull();
        expect(await b.unbundle(later)).toBe(second);
        expect(await b.resolve(MAIN)).toBe(second);
        await b.checkout();
        expect(readFileSync(join(b.root, "a.txt"), "utf8")).toBe("1\n2\n");
        expect(await messages(b)).toEqual(["two", "one"]);
    });

    it("refuses a bundle whose prerequisite it lacks", async () => {
        const a = await fresh();
        put(a.root, "a.txt", "1\n");
        const first = (await a.commit(["a.txt"], "one")) as string;
        put(a.root, "a.txt", "2\n");
        await a.commit(["a.txt"], "two");
        const b = await fresh();
        await expect(
            b.unbundle((await a.bundle(first)) as Uint8Array),
        ).rejects.toThrow();
        expect(await b.resolve(MAIN)).toBeNull();
    });

    it("appends sealed files on their own branch, leaving main alone", async () => {
        const repo = await fresh();
        put(repo.root, "a.txt", "1\n");
        const tip = await repo.commit(["a.txt"], "one");
        await repo.appendSealed(
            "bundles/000001.enc",
            new Uint8Array([1, 2]),
            "readme\n",
            "seal 1",
        );
        await repo.appendSealed(
            "bundles/000002.enc",
            new Uint8Array([3]),
            "readme\n",
            "seal 2",
        );
        expect(await repo.sealedNames()).toEqual([
            "bundles/000001.enc",
            "bundles/000002.enc",
        ]);
        expect([...(await repo.sealedFile("bundles/000001.enc"))]).toEqual([
            1, 2,
        ]);
        expect(await repo.files(SEALED)).toEqual([
            "SEALED",
            "bundles/000001.enc",
            "bundles/000002.enc",
        ]);
        expect(text(await repo.show("SEALED", SEALED))).toBe("readme\n");
        expect(await repo.resolve(MAIN)).toBe(tip);
        expect(await repo.changed()).toEqual([]);
    });

    it("records a remote and replaces it", async () => {
        const repo = await fresh();
        expect(await repo.remote("mirror")).toBeNull();
        await repo.setRemote("mirror", "/tmp/one.git");
        expect(await repo.remote("mirror")).toBe("/tmp/one.git");
        await repo.setRemote("mirror", "/tmp/two.git");
        expect(await repo.remote("mirror")).toBe("/tmp/two.git");
    });

    it("moves a ref", async () => {
        const repo = await fresh();
        put(repo.root, "a.txt", "1\n");
        const sha = (await repo.commit(["a.txt"], "one")) as string;
        await repo.setRef("refs/dorothy/sealed-through", sha);
        expect(await repo.resolve("refs/dorothy/sealed-through")).toBe(sha);
    });

    it("maintains itself without complaint", async () => {
        const repo = await fresh();
        put(repo.root, "a.txt", "1\n");
        await repo.commit(["a.txt"], "one");
        await repo.maintain();
        expect(await messages(repo)).toEqual(["one"]);
    });
}

describe("the git binary engine", () => {
    contract((root) => binaryRepo(root, { env: TEST_ENV }));
});
