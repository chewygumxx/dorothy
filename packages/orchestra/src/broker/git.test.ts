// vim:set expandtab shiftwidth=4 filetype=typescript:
// SPDX-License-Identifier: GPL-3.0-only

//
//
// ~chewygumxx/dorothy.git
// ::: :/packages/orchestra/src/broker/git.test.ts
//
//

import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { chmod, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { makeRepos, type Repos } from "../fixtures/repos.js";
import { resolveGit, sealedEnvironment, sealedGit } from "./git.js";

const HOSTILE = {
    GIT_DIR: "/elsewhere",
    GIT_WORK_TREE: "/elsewhere",
    GIT_CONFIG_PARAMETERS: "'core.hookspath'='/evil'",
    GIT_CONFIG_GLOBAL: "/evil.gitconfig",
    GIT_SSH_COMMAND: "/evil-ssh",
    GIT_EXEC_PATH: "/evil-exec",
    GIT_ASKPASS: "/evil-askpass",
};

describe("sealedEnvironment", () => {
    it("keeps HOME, SSH_AUTH_SOCK and PATH, names the broker's config, and drops every other GIT_* variable", () => {
        const env = sealedEnvironment(
            {
                ...HOSTILE,
                PATH: "/usr/bin",
                HOME: "/home/u",
                SSH_AUTH_SOCK: "/run/user/1000/ssh-agent",
                GH_TOKEN: "ghp",
            },
            "/state/broker.gitconfig",
        );
        expect(env).toEqual({
            PATH: "/usr/bin",
            HOME: "/home/u",
            SSH_AUTH_SOCK: "/run/user/1000/ssh-agent",
            GIT_CONFIG_NOSYSTEM: "1",
            GIT_CONFIG_GLOBAL: "/state/broker.gitconfig",
        });
    });
});

describe("sealedGit", () => {
    let repos: Repos;
    let repo: string;
    let config: string;

    beforeEach(async () => {
        repos = await makeRepos();
        repo = join(repos.root, "broker.git");
        repos.git(["init", "-q", "--bare", repo], repos.root);
        config = join(repos.root, "broker.gitconfig");
        await writeFile(config, "[user]\n\tname = Broker\n");
    });

    afterEach(async () => {
        await rm(repos.root, { recursive: true, force: true });
    });

    const sealed = (deadline?: number) =>
        sealedGit({
            git: resolveGit(repos.env),
            env: { ...repos.env, ...HOSTILE },
            config,
            cwd: repo,
            deadline,
        });

    it("runs in its own directory, whatever GIT_DIR says", async () => {
        expect(await sealed().out(["rev-parse", "--absolute-git-dir"])).toBe(
            repo,
        );
    });

    it("reads the broker's config, the repository's and its own flags, and nothing else", async () => {
        const lines = (
            await sealed().out(["config", "--list", "--show-scope"])
        ).split("\n");
        const scopes = new Set(lines.map((line) => line.split("\t")[0]));
        expect([...scopes].sort()).toEqual(["command", "global", "local"]);
        expect(lines).toContain("global\tuser.name=Broker");
        for (const flag of [
            "core.hookspath=/dev/null",
            "maintenance.auto=false",
            "gc.auto=0",
            "submodule.recurse=false",
        ]) {
            expect(lines).toContain(`command\t${flag}`);
        }
        expect(lines.join("\n")).not.toContain("/evil");
    });

    it("runs a clone-making step in the directory it names", async () => {
        expect(
            await sealed().out(
                ["rev-parse", "--show-toplevel"],
                repos.checkout,
            ),
        ).toBe(repos.checkout);
    });

    it("says which command failed", async () => {
        await expect(
            sealed().out(["rev-parse", "--verify", "refs/heads/none"]),
        ).rejects.toThrow(/git rev-parse --verify refs\/heads\/none/);
    });

    it("refuses to spawn an already-aborted command", async () => {
        const marker = join(repos.root, "spawned");
        const script = join(repos.root, "spawn.sh");
        await writeFile(script, `#!/bin/sh\ntouch '${marker}'\n`);
        await chmod(script, 0o755);
        const { runGroup } = await import("./git.js");
        await expect(
            runGroup([script], {
                cwd: repos.root,
                env: repos.env,
                deadline: 1000,
                signal: AbortSignal.abort(),
            }),
        ).rejects.toThrow();
        expect(() => readFileSync(marker)).toThrow();
    });

    it("kills a process past its deadline with its whole group", async () => {
        const hang = join(repos.root, "hang.sh");
        await writeFile(
            hang,
            '#!/bin/sh\nsleep 30 &\necho "$$ $!" > "$0.pids"\nwait\n',
        );
        await chmod(hang, 0o755);
        const started = Date.now();
        const result = await sealed(300).run([
            "ls-remote",
            `--upload-pack=${hang}`,
            repos.remote,
        ]);
        expect(result.timedOut).toBe(true);
        expect(result.code).not.toBe(0);
        expect(Date.now() - started).toBeLessThan(5000);
        const pids = readFileSync(`${hang}.pids`, "utf8")
            .trim()
            .split(" ")
            .map(Number);
        expect(pids).toHaveLength(2);
        await Bun.sleep(100);
        for (const pid of pids) {
            expect(alive(pid)).toBe(false);
        }
    });
});

// Gone, or a zombie awaiting its reaper.
function alive(pid: number): boolean {
    try {
        const stat = readFileSync(`/proc/${pid}/stat`, "utf8");
        return stat.slice(stat.lastIndexOf(")") + 2)[0] !== "Z";
    } catch {
        return false;
    }
}
