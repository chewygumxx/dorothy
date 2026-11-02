// vim:set expandtab shiftwidth=4 filetype=typescript:
// SPDX-License-Identifier: GPL-3.0-only

//
//
// ~chewygumxx/dorothy.git
// ::: :/packages/orchestra/src/broker/clone.test.ts
//
//

import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import {
    chmod,
    mkdir,
    readdir,
    readFile,
    rm,
    symlink,
    writeFile,
} from "node:fs/promises";
import { join } from "node:path";
import { makeRepos, type Repos } from "../fixtures/repos.js";
import { fetchBase } from "./base.js";
import { makeClone } from "./clone.js";
import { resolveGit } from "./git.js";
import { type Broker, openBroker } from "./repository.js";

describe("the base and the worker's clone", () => {
    let repos: Repos;

    beforeEach(async () => {
        repos = await makeRepos();
    });

    afterEach(async () => {
        await rm(repos.root, { recursive: true, force: true });
    });

    const open = () =>
        openBroker({
            git: resolveGit(repos.env),
            env: repos.env,
            state: repos.state,
            checkout: repos.checkout,
            localRemotes: true,
        });

    const start = async (broker: Broker, server: string, branch: string) => {
        const base = await fetchBase(broker, server, "codex-1");
        const clone = await makeClone(broker, {
            root: repos.worktrees,
            server,
            worker: "codex-1",
            branch,
            base: base.oid,
        });
        return { base, clone };
    };

    it("starts from the remote's default branch, not the checkout's local main", async () => {
        const broker = await open();
        const { base, clone } = await start(broker, "s1", "feature");
        expect(base).toEqual({
            ref: "refs/orchestra/s1/codex-1/base",
            oid: repos.remoteMain,
        });
        expect(repos.remoteMain).not.toBe(repos.localMain);
        expect(repos.git(["rev-parse", base.ref], broker.repo)).toBe(
            repos.remoteMain,
        );
        expect(clone).toBe(join(repos.worktrees, "s1", "codex-1"));
        expect(repos.git(["symbolic-ref", "HEAD"], clone)).toBe(
            "refs/heads/feature",
        );
        expect(repos.git(["rev-parse", "HEAD"], clone)).toBe(repos.remoteMain);
        expect(repos.git(["status", "--porcelain"], clone)).toBe("");
    });

    it("borrows the broker repository's objects and copies none", async () => {
        const broker = await open();
        const { clone } = await start(broker, "s1", "feature");
        expect(
            await readFile(
                join(clone, ".git", "objects", "info", "alternates"),
                "utf8",
            ),
        ).toBe(`${join(broker.repo, "objects")}\n`);
        const counts = repos.git(["count-objects", "-v"], clone);
        expect(counts).toContain("count: 0");
        expect(counts).toContain("packs: 0");
        expect(await readdir(join(clone, ".git", "objects", "pack"))).toEqual(
            [],
        );
    });

    it("keeps the refs of a worker name reused across launches apart", async () => {
        const broker = await open();
        const first = await start(broker, "s1", "first");
        const ahead = join(repos.root, "ahead");
        repos.git(["clone", "-q", repos.remote, ahead], repos.root);
        const moved = repos.commit(ahead, "moved");
        repos.git(["push", "-q", "origin", "main"], ahead);
        const second = await start(broker, "s2", "second");
        expect(first.base.oid).toBe(repos.remoteMain);
        expect(second.base.oid).toBe(moved);
        expect(
            repos.git(
                ["rev-parse", "refs/orchestra/s1/codex-1/base"],
                broker.repo,
            ),
        ).toBe(repos.remoteMain);
        expect(
            repos.git(
                ["rev-parse", "refs/orchestra/s2/codex-1/base"],
                broker.repo,
            ),
        ).toBe(moved);
        expect(second.clone).not.toBe(first.clone);
    });

    it("refuses a clone whose canonical path leaves the root, writing nothing there", async () => {
        const broker = await open();
        const base = await fetchBase(broker, "s9", "codex-1");
        const outside = join(repos.root, "outside");
        await mkdir(outside);
        await symlink(outside, join(repos.worktrees, "s9"));
        await expect(
            makeClone(broker, {
                root: repos.worktrees,
                server: "s9",
                worker: "codex-1",
                branch: "feature",
                base: base.oid,
            }),
        ).rejects.toThrow(/root/);
        expect(await readdir(outside)).toEqual([]);
    });

    it("rejects an existing worker leaf symlink without touching its target", async () => {
        const broker = await open();
        const base = await fetchBase(broker, "s1", "codex-1");
        const outside = join(repos.root, "outside-leaf");
        await mkdir(outside);
        await mkdir(join(repos.worktrees, "s1"));
        await symlink(outside, join(repos.worktrees, "s1", "codex-1"));
        await expect(
            makeClone(broker, {
                root: repos.worktrees,
                server: "s1",
                worker: "codex-1",
                branch: "feature",
                base: base.oid,
            }),
        ).rejects.toThrow();
        expect(await readdir(outside)).toEqual([]);
    });

    it("clones a hostile checkout and starts its worker with none of its config acting", async () => {
        const marks = join(repos.root, "marks");
        const bin = join(repos.root, "bin");
        await mkdir(marks);
        await mkdir(bin);
        const mark = async (name: string) => {
            const path = join(bin, name);
            await writeFile(path, `#!/bin/sh\ntouch ${join(marks, name)}\n`);
            await chmod(path, 0o755);
            return path;
        };
        const hooks = join(repos.checkout, ".git", "hooks");
        for (const hook of [
            "post-checkout",
            "reference-transaction",
            "pre-push",
            "post-update",
            "pre-receive",
        ]) {
            await writeFile(
                join(hooks, hook),
                `#!/bin/sh\ntouch ${join(marks, hook)}\n`,
            );
            await chmod(join(hooks, hook), 0o755);
        }
        const evil = join(repos.root, "evil.git");
        repos.git(["init", "-q", "--bare", evil], repos.root);
        const included = join(repos.root, "included.gitconfig");
        await writeFile(
            included,
            `[uploadpack]\n\tpackObjectsHook = ${await mark("included-pack")}\n` +
                `[core]\n\tfsmonitor = ${await mark("included-fsmonitor")}\n`,
        );
        const set = (args: string[]) =>
            repos.git(["config", ...args], repos.checkout);
        set(["core.hooksPath", bin]);
        set(["include.path", included]);
        set(["uploadpack.packObjectsHook", await mark("pack")]);
        set(["core.alternateRefsCommand", await mark("alternate-refs")]);
        set(["core.sshCommand", await mark("ssh")]);
        set(["core.fsmonitor", await mark("fsmonitor")]);
        set([`url.${evil}.insteadOf`, repos.remote]);
        set(["--add", `url.${evil}.insteadOf`, repos.checkout]);
        set(["remote.origin.pushurl", evil]);
        set(["--add", "remote.origin.fetch", "+refs/*:refs/*"]);
        set(["remote.origin.mirror", "true"]);
        set(["push.followTags", "true"]);
        set(["push.recurseSubmodules", "on-demand"]);
        set(["submodule.recurse", "true"]);
        set(["core.repositoryformatversion", "1"]);
        set(["extensions.worktreeConfig", "true"]);
        set(["--worktree", "core.hooksPath", bin]);
        set([
            "--worktree",
            "uploadpack.packObjectsHook",
            await mark("worktree-pack"),
        ]);
        set(["--worktree", `url.${evil}.insteadOf`, repos.remote]);

        const broker = await open();
        const { base, clone } = await start(broker, "s1", "feature");

        expect(base.oid).toBe(repos.remoteMain);
        expect(repos.git(["rev-parse", "refs/heads/main"], broker.repo)).toBe(
            repos.localMain,
        );
        expect(repos.git(["rev-parse", "HEAD"], clone)).toBe(repos.remoteMain);
        expect(await readdir(marks)).toEqual([]);
        expect(repos.git(["for-each-ref"], evil)).toBe("");
        const config = repos.git(
            ["config", "--file", join(broker.repo, "config"), "--list"],
            repos.root,
        );
        for (const key of [
            "remote.",
            "url.",
            "include.",
            "uploadpack.",
            "push.",
            "submodule.",
            "extensions.",
            "core.hookspath",
            "core.fsmonitor",
            "core.sshcommand",
            "core.alternaterefscommand",
        ]) {
            expect(config).not.toContain(key);
        }
    });
});
