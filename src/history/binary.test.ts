// vim:set expandtab shiftwidth=4 filetype=typescript:
// SPDX-License-Identifier: GPL-3.0-only

//
//
// ~chewygumxx/dorothy.git
// ::: :/src/history/binary.test.ts
//
//

import { afterAll, describe, expect, it } from "bun:test";
import { chmodSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { binaryRepo, credentialHelpers, isolatedEnv } from "./binary.js";
import { bareRepo, put, removeRoots, TEST_ENV, tempRoot } from "./testing.js";

afterAll(removeRoots);

async function gitOut(root: string, args: string[]): Promise<string> {
    const proc = Bun.spawn(["git", ...args], {
        cwd: root,
        env: TEST_ENV,
        stdout: "pipe",
        stderr: "ignore",
    });
    return (await new Response(proc.stdout).text()).trim();
}

describe("isolatedEnv", () => {
    it("shuts out the user's configuration and anything locating a repository", () => {
        const env = isolatedEnv({
            PATH: "/usr/bin",
            GIT_DIR: "/elsewhere",
            GIT_WORK_TREE: "/elsewhere",
            GIT_INDEX_FILE: "/elsewhere/index",
            GIT_CONFIG_PARAMETERS: "'core.bare'='true'",
            GIT_CONFIG_COUNT: "1",
            GIT_CONFIG_KEY_0: "core.bare",
            GIT_CONFIG_VALUE_0: "true",
            GIT_SSH_COMMAND: "ssh -i key",
            HOME: undefined,
        });
        expect(env).toEqual({
            PATH: "/usr/bin",
            GIT_SSH_COMMAND: "ssh -i key",
            GIT_CONFIG_GLOBAL: "/dev/null",
            GIT_CONFIG_NOSYSTEM: "1",
            GIT_TERMINAL_PROMPT: "0",
            GIT_AUTHOR_NAME: "Dorothy",
            GIT_AUTHOR_EMAIL: "dorothy@localhost",
            GIT_COMMITTER_NAME: "Dorothy",
            GIT_COMMITTER_EMAIL: "dorothy@localhost",
        });
    });
});

describe("the git binary engine", () => {
    it("keeps the user's signing and hooks away from its commits", async () => {
        const home = tempRoot();
        const hook = join(home, "hooks", "pre-commit");
        put(home, "hooks/pre-commit", "#!/bin/sh\nexit 1\n");
        chmodSync(hook, 0o755);
        const config = join(home, "gitconfig");
        writeFileSync(
            config,
            `[commit]\n\tgpgsign = true\n[core]\n\thooksPath = ${join(home, "hooks")}\n`,
        );
        const root = join(tempRoot(), "data");
        const repo = binaryRepo(root, {
            env: { ...process.env, GIT_CONFIG_GLOBAL: config, GIT_DIR: home },
        });
        await repo.init();
        // The repository's own hook is skipped too.
        put(root, ".git/hooks/pre-commit", "#!/bin/sh\nexit 1\n");
        chmodSync(join(root, ".git/hooks/pre-commit"), 0o755);
        put(root, "a.txt", "1\n");
        expect(await repo.commit(["a.txt"], "one")).not.toBeNull();
        expect(
            await gitOut(root, ["log", "-1", "--format=%an <%ae> %cn %G?"]),
        ).toBe("Dorothy <dorothy@localhost> Dorothy N");
    });

    it("pushes a branch to a bare repository and fetches it back", async () => {
        const mirror = await bareRepo();
        const a = binaryRepo(join(tempRoot(), "a"), { env: TEST_ENV });
        await a.init();
        await a.appendSealed(
            "bundles/000001.enc",
            new Uint8Array([1]),
            "readme\n",
            "seal 1",
        );
        await a.setRemote("mirror", mirror);
        await a.push("mirror", "sealed", null);
        const b = binaryRepo(join(tempRoot(), "b"), { env: TEST_ENV });
        await b.init();
        await b.fetch(mirror, "sealed", null);
        expect(await b.sealedNames()).toEqual(["bundles/000001.enc"]);
    });

    it("refuses to push over a mirror that went its own way", async () => {
        const mirror = await bareRepo();
        for (const name of ["a", "b"]) {
            const repo = binaryRepo(join(tempRoot(), name), { env: TEST_ENV });
            await repo.init();
            await repo.appendSealed(
                "bundles/000001.enc",
                new TextEncoder().encode(name),
                "readme\n",
                "seal 1",
            );
            await repo.setRemote("mirror", mirror);
            if (name === "a") {
                await repo.push("mirror", "sealed", null);
            } else {
                await expect(
                    repo.push("mirror", "sealed", null),
                ).rejects.toThrow();
            }
        }
    });
});

describe("credentialHelpers", () => {
    it("reads the user's helpers from their global configuration", async () => {
        const config = join(tempRoot(), "gitconfig");
        writeFileSync(
            config,
            "[credential]\n\thelper = store\n\thelper = cache --timeout=60\n",
        );
        expect(
            await credentialHelpers({
                ...process.env,
                GIT_CONFIG_GLOBAL: config,
            }),
        ).toEqual(["store", "cache --timeout=60"]);
        expect(
            await credentialHelpers({
                ...process.env,
                GIT_CONFIG_GLOBAL: "/dev/null",
            }),
        ).toEqual([]);
    });
});
