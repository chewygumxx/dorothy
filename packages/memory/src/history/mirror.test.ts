// vim:set expandtab shiftwidth=4 filetype=typescript:
// SPDX-License-Identifier: GPL-3.0-only

//
//
// ~chewygumxx/dorothy.git
// ::: :/packages/memory/src/history/mirror.test.ts
//
//

import { afterAll, describe, expect, it } from "bun:test";
import { readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import type { Timers } from "@dorothy/core";
import type { Lock } from "../memory/sidecar.js";
import { binaryRepo } from "./binary.js";
import { isoRepo } from "./iso.js";
import { Mirror, recover, sealPending, waiting } from "./mirror.js";
import { MAIN, type MemoryRepo, SEALED, SEALED_THROUGH } from "./repo.js";
import { SEALED_README, seal, sealedName } from "./seal.js";
import { bareRepo, put, removeRoots, TEST_ENV, tempRoot } from "./testing.js";

afterAll(removeRoots);

const KEY = new Uint8Array(32).fill(3);
const OTHER = new Uint8Array(32).fill(4);
const lock: Lock = (work) => work();

class FakeTimers implements Timers {
    #next = 1;
    readonly pending = new Map<number, () => void>();
    set(fn: () => void): number {
        const id = this.#next++;
        this.pending.set(id, fn);
        return id;
    }
    clear(handle: unknown): void {
        this.pending.delete(handle as number);
    }
    fire(): void {
        for (const [id, fn] of [...this.pending]) {
            this.pending.delete(id);
            fn();
        }
    }
}

async function repoWith(files: Record<string, string>): Promise<MemoryRepo> {
    const repo = binaryRepo(join(tempRoot(), "data"), { env: TEST_ENV });
    await repo.init();
    await commit(repo, files, "adopt");
    return repo;
}

async function commit(
    repo: MemoryRepo,
    files: Record<string, string>,
    message: string,
): Promise<void> {
    for (const [path, text] of Object.entries(files)) {
        put(repo.root, path, text);
    }
    await repo.commit(Object.keys(files), message);
}

function mirrorOf(
    repo: MemoryRepo,
    {
        key = KEY,
        timers = new FakeTimers(),
        locked = lock,
    }: { key?: Uint8Array | null; timers?: FakeTimers; locked?: Lock } = {},
) {
    const warnings: string[] = [];
    const mirror = new Mirror({
        repo,
        lock: locked,
        key: () => key,
        token: () => null,
        warn: (message) => warnings.push(message),
        pushMs: 60_000,
        timers,
    });
    return { mirror, warnings, timers };
}

describe("sealPending", () => {
    it("seals new commits as the next bundle, and nothing twice", async () => {
        const repo = await repoWith({ "tags.json": "{}\n" });
        expect(await waiting(repo)).toBe(true);
        expect(await sealPending(repo, KEY)).toBe("sealed");
        expect(await waiting(repo)).toBe(false);
        expect(await sealPending(repo, KEY)).toBe("nothing");
        await commit(repo, { "tags.json": "{ }\n" }, "two");
        expect(await sealPending(repo, KEY)).toBe("sealed");
        expect(await repo.sealedNames()).toEqual([
            "bundles/000001.enc",
            "bundles/000002.enc",
        ]);
        expect(await repo.resolve(SEALED_THROUGH)).toBe(
            await repo.resolve(MAIN),
        );
    });

    it("seals nothing under a key that does not open the bundles before", async () => {
        const repo = await repoWith({ "tags.json": "{}\n" });
        expect(await sealPending(repo, KEY)).toBe("sealed");
        const through = await repo.resolve(SEALED_THROUGH);
        await commit(repo, { "tags.json": "{ }\n" }, "two");
        expect(await sealPending(repo, OTHER)).toBe("wrong-key");
        expect(await repo.sealedNames()).toEqual(["bundles/000001.enc"]);
        expect(await repo.resolve(SEALED_THROUGH)).toBe(through);
        expect(await waiting(repo)).toBe(true);
        expect(await sealPending(repo, KEY)).toBe("sealed");
    });
});

describe("Mirror", () => {
    it("pushes the sealed branch to the mirror", async () => {
        const bare = await bareRepo();
        const repo = await repoWith({ "tags.json": "{}\n" });
        await repo.setRemote("mirror", bare);
        const { mirror, warnings } = mirrorOf(repo);
        expect(await mirror.push()).toEqual({ kind: "pushed", sealed: true });
        expect(await mirror.push()).toEqual({ kind: "pushed", sealed: false });
        const proc = Bun.spawn(
            [
                "git",
                "--git-dir",
                bare,
                "ls-tree",
                "-r",
                "--name-only",
                "refs/heads/sealed",
            ],
            { env: TEST_ENV, stdout: "pipe" },
        );
        expect(
            (await new Response(proc.stdout).text()).trim().split("\n"),
        ).toEqual(["SEALED", "bundles/000001.enc"]);
        expect(warnings).toEqual([]);
    });

    it("says when there is no mirror, and warns when there is no key", async () => {
        const repo = await repoWith({ "tags.json": "{}\n" });
        const without = mirrorOf(repo);
        expect(await without.mirror.push()).toEqual({ kind: "no-mirror" });
        expect(without.warnings).toEqual([]);
        await repo.setRemote("mirror", await bareRepo());
        const keyless = mirrorOf(repo, { key: null });
        expect(await keyless.mirror.push()).toEqual({ kind: "no-key" });
        expect(keyless.warnings).toEqual([
            "history: the mirror needs DOROTHY_MIRROR_KEY (32 bytes, base64) in .env; set it with dotenvx set",
        ]);
        expect(await repo.sealedNames()).toEqual([]);
    });

    it("warns of a key that does not open the bundles, and seals nothing", async () => {
        const bare = await bareRepo();
        const repo = await repoWith({ "tags.json": "{}\n" });
        await repo.setRemote("mirror", bare);
        expect(await mirrorOf(repo).mirror.push()).toEqual({
            kind: "pushed",
            sealed: true,
        });
        await commit(repo, { "tags.json": "{ }\n" }, "two");
        const other = mirrorOf(repo, { key: OTHER });
        expect(await other.mirror.push()).toEqual({ kind: "wrong-key" });
        expect(other.warnings).toEqual([
            "history: DOROTHY_MIRROR_KEY does not open the sealed bundles; set the key they were sealed with",
        ]);
        expect(await repo.sealedNames()).toEqual(["bundles/000001.enc"]);
        // The right key goes on with the chain, and recovery opens it all.
        await mirrorOf(repo).mirror.push();
        const fresh = binaryRepo(join(tempRoot(), "data"), { env: TEST_ENV });
        expect(
            await recover({ repo: fresh, url: bare, key: KEY, token: null }),
        ).toEqual({
            applied: 2,
            of: 2,
            tip: await repo.resolve(MAIN),
            stopped: null,
        });
    });

    it("warns of a failed push and keeps what it sealed", async () => {
        const repo = await repoWith({ "tags.json": "{}\n" });
        await repo.setRemote("mirror", join(tempRoot(), "nowhere.git"));
        const { mirror, warnings } = mirrorOf(repo);
        const outcome = await mirror.push();
        expect(outcome.kind).toBe("failed");
        expect(warnings[0]).toStartWith(
            "history: couldn't push to the mirror (",
        );
        expect(await repo.sealedNames()).toEqual(["bundles/000001.enc"]);
    });

    it("pushes at most once a period, and not after it stops", async () => {
        const repo = await repoWith({ "tags.json": "{}\n" });
        const { mirror, timers } = mirrorOf(repo);
        mirror.schedule();
        mirror.schedule();
        expect(timers.pending.size).toBe(1);
        timers.fire();
        expect(timers.pending.size).toBe(0);
        mirror.schedule();
        await mirror.stop();
        expect(timers.pending.size).toBe(0);
        mirror.schedule();
        expect(timers.pending.size).toBe(0);
    });
});

describe("Mirror.stop", () => {
    it("waits for a seal in progress", async () => {
        const repo = await repoWith({ "tags.json": "{}\n" });
        await repo.setRemote("mirror", await bareRepo());
        let entered!: () => void;
        const inside = new Promise<void>((resolve) => {
            entered = resolve;
        });
        let release!: () => void;
        const gate = new Promise<void>((resolve) => {
            release = resolve;
        });
        const gated: Lock = async (work) => {
            entered();
            await gate;
            return work();
        };
        const { mirror } = mirrorOf(repo, { locked: gated });
        const pushing = mirror.push();
        await inside;
        let stopped = false;
        const stopping = mirror.stop().then(() => {
            stopped = true;
        });
        await Bun.sleep(20);
        expect(stopped).toBe(false);
        release();
        await stopping;
        expect(await repo.sealedNames()).toEqual(["bundles/000001.enc"]);
        expect((await pushing).kind).toBe("pushed");
    });

    it("leaves nothing to seal after it", async () => {
        const repo = await repoWith({ "tags.json": "{}\n" });
        await repo.setRemote("mirror", await bareRepo());
        const { mirror } = mirrorOf(repo);
        const pushing = mirror.push();
        await mirror.stop();
        expect(await pushing).toEqual({ kind: "stopped" });
        expect(await repo.sealedNames()).toEqual([]);
    });
});

describe("recover", () => {
    async function mirrored(): Promise<{ bare: string; repo: MemoryRepo }> {
        const bare = await bareRepo();
        const repo = await repoWith({
            "tags.json": "{}\n",
            "transcripts/a-b-c-d.jsonl": '{"v":1,"kind":"user"}\n',
        });
        await repo.setRemote("mirror", bare);
        const { mirror } = mirrorOf(repo);
        await mirror.push();
        await commit(
            repo,
            {
                "transcripts/a-b-c-d.jsonl":
                    '{"v":1,"kind":"user"}\n{"v":1,"kind":"assistant"}\n',
            },
            "turn: a-b-c-d #1",
        );
        await mirror.push();
        return { bare, repo };
    }

    it("rebuilds a data directory from every sealed bundle", async () => {
        const { bare, repo } = await mirrored();
        const fresh = binaryRepo(join(tempRoot(), "data"), { env: TEST_ENV });
        expect(
            await recover({ repo: fresh, url: bare, key: KEY, token: null }),
        ).toEqual({
            applied: 2,
            of: 2,
            tip: await repo.resolve(MAIN),
            stopped: null,
        });
        for (const path of ["tags.json", "transcripts/a-b-c-d.jsonl"]) {
            expect(readFileSync(join(fresh.root, path), "utf8")).toBe(
                readFileSync(join(repo.root, path), "utf8"),
            );
        }
        expect((await fresh.log()).map((commit) => commit.message)).toEqual([
            "turn: a-b-c-d #1",
            "adopt",
        ]);
        expect(await fresh.remote("mirror")).toBe(bare);
        expect(await waiting(fresh)).toBe(false);
        // The user's alone, whatever git made them.
        expect(statSync(fresh.root).mode & 0o777).toBe(0o700);
        expect(statSync(join(fresh.root, ".git")).mode & 0o777).toBe(0o700);
    });

    it("stops at a bundle that will not open", async () => {
        const { bare } = await mirrored();
        const fresh = binaryRepo(join(tempRoot(), "data"), { env: TEST_ENV });
        expect(
            await recover({ repo: fresh, url: bare, key: OTHER, token: null }),
        ).toEqual({
            applied: 0,
            of: 2,
            tip: null,
            stopped:
                "bundles/000001.enc: it does not open with this key, or it was changed",
        });
        expect(await fresh.remote("mirror")).toBeNull();
        expect(await fresh.resolve(SEALED)).toBeNull();
    });

    it("leaves no mirror and no sealed branch after a part-way stop", async () => {
        const bare = await bareRepo();
        const repo = await repoWith({ "tags.json": "{}\n" });
        await repo.setRemote("mirror", bare);
        await mirrorOf(repo).mirror.push();
        const first = await repo.resolve(MAIN);
        await commit(repo, { "tags.json": "{ }\n" }, "two");
        // The second bundle is sealed under another key, by hand: sealing
        // itself refuses to.
        const bundle = await repo.bundle(first);
        await repo.appendSealed(
            sealedName(2),
            await seal(bundle as Uint8Array, OTHER),
            SEALED_README,
            "seal 2",
        );
        await repo.push("mirror", "sealed", null);

        const fresh = binaryRepo(join(tempRoot(), "data"), { env: TEST_ENV });
        expect(
            await recover({ repo: fresh, url: bare, key: KEY, token: null }),
        ).toEqual({
            applied: 1,
            of: 2,
            tip: first,
            stopped:
                "bundles/000002.enc: it does not open with this key, or it was changed",
        });
        expect(await fresh.resolve(MAIN)).toBe(first);
        expect(await fresh.remote("mirror")).toBeNull();
        expect(await fresh.resolve(SEALED)).toBeNull();

        // Whatever comes next never extends the broken chain.
        await commit(fresh, { "tags.json": "{  }\n" }, "three");
        await fresh.setRemote("mirror", bare);
        const { mirror } = mirrorOf(fresh);
        expect((await mirror.push()).kind).toBe("failed");
    });

    it("says why when the mirror can't be reached", async () => {
        const { bare } = await mirrored();
        const fresh = isoRepo(join(tempRoot(), "data"));
        const recovered = await recover({
            repo: fresh,
            url: bare,
            key: KEY,
            token: null,
        });
        expect(recovered).toEqual({
            applied: 0,
            of: 0,
            tip: null,
            stopped: "this mirror needs the git binary",
        });
    });
});
