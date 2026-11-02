// vim:set expandtab shiftwidth=4 filetype=typescript:
// SPDX-License-Identifier: GPL-3.0-only

//
//
// ~chewygumxx/dorothy.git
// ::: :/packages/orchestra/src/broker/fetch.test.ts
//
//

import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import {
    appendFile,
    chmod,
    mkdir,
    readdir,
    rm,
    symlink,
    writeFile,
} from "node:fs/promises";
import { join } from "node:path";
import { boxAvailable } from "../box/box.js";
import { makeRepos, type Repos } from "../fixtures/repos.js";
import { fetchBase } from "./base.js";
import { makeClone } from "./clone.js";
import { fetchWork } from "./fetch.js";
import { resolveGit } from "./git.js";
import { pushWork, recordPush } from "./push.js";
import { type Broker, openBroker } from "./repository.js";

// upload-pack runs boxed, where bubblewrap can make a user namespace.
const available = await boxAvailable();

describe.if(available)("bringing a worker's branch back", () => {
    let repos: Repos;
    let git: string;

    beforeEach(async () => {
        repos = await makeRepos();
        git = resolveGit(repos.env);
    });

    afterEach(async () => {
        await rm(repos.root, { recursive: true, force: true });
    });

    const start = async (state = repos.state) => {
        const broker = await openBroker({
            git,
            env: repos.env,
            state,
            checkout: repos.checkout,
            localRemotes: true,
        });
        const base = (await fetchBase(broker, "s1", "codex-1")).oid;
        const clone = await makeClone(broker, {
            root: repos.worktrees,
            server: "s1",
            worker: "codex-1",
            branch: "feature",
            base,
        });
        return { broker, base, clone };
    };

    const fetch = (broker: Broker, clone: string) =>
        fetchWork(broker, {
            git,
            server: "s1",
            worker: "codex-1",
            clone,
            branch: "feature",
        });

    it("fetches the branch into the worker's ref, its OID recorded", async () => {
        const { broker, clone } = await start();
        const oid = repos.commit(clone, "a");
        expect(await fetch(broker, clone)).toEqual({
            ref: "refs/orchestra/s1/codex-1/work/feature",
            oid,
        });
        expect(
            repos.git(
                ["rev-parse", "refs/orchestra/s1/codex-1/work/feature"],
                broker.repo,
            ),
        ).toBe(oid);
    });

    for (const branch of ["base", "base/topic"]) {
        it(`fetches and pushes ${branch} without moving the pinned base`, async () => {
            const { broker, base, clone } = await start();
            repos.git(["switch", "-c", branch], clone);
            const oid = repos.commit(clone, "work");
            const work = await fetchWork(broker, {
                git,
                server: "s1",
                worker: "codex-1",
                clone,
                branch,
            });
            expect(work.ref).toBe(`refs/orchestra/s1/codex-1/work/${branch}`);
            expect(
                repos.git(
                    ["rev-parse", "refs/orchestra/s1/codex-1/base"],
                    broker.repo,
                ),
            ).toBe(base);
            const record = await recordPush(broker, {
                branch,
                oid,
                last: null,
                forceWithLease: false,
            });
            expect(
                (
                    await pushWork(broker, record, {
                        base,
                        ask: async () => "deny",
                    })
                ).status,
            ).toBe("succeeded");
            expect(
                repos.git(["rev-parse", `refs/heads/${branch}`], repos.remote),
            ).toBe(oid);
        });
    }

    it("fetches a rewritten branch over the last one fetched", async () => {
        const { broker, base, clone } = await start();
        repos.commit(clone, "a");
        await fetch(broker, clone);
        repos.git(["reset", "-q", "--hard", base], clone);
        const rewritten = repos.commit(clone, "b");
        expect((await fetch(broker, clone)).oid).toBe(rewritten);
    });

    it("fetches where the state root lies behind a symlink", async () => {
        await symlink(join(repos.root, "state"), join(repos.root, "link"));
        const { broker, clone } = await start(
            join(repos.root, "link", "dorothy", "orchestra"),
        );
        const oid = repos.commit(clone, "a");
        expect((await fetch(broker, clone)).oid).toBe(oid);
    });

    it("reads the clone boxed: objects it borrows from elsewhere stay out", async () => {
        const { broker, clone } = await start();
        const secret = join(repos.root, "secret");
        repos.git(["init", "-q", secret], repos.root);
        const hidden = repos.commit(secret, "hidden");
        await appendFile(
            join(clone, ".git", "objects", "info", "alternates"),
            `${join(secret, ".git", "objects")}\n`,
        );
        repos.git(["update-ref", "refs/heads/feature", hidden], clone);
        await expect(fetch(broker, clone)).rejects.toThrow(/git fetch/);
        expect(() =>
            repos.git(["cat-file", "-e", hidden], broker.repo),
        ).toThrow();
    });

    it("fetches and pushes a hostile clone's branch, exactly that commit to exactly that ref", async () => {
        const { broker, base, clone } = await start();
        const sub = join(repos.root, "sub");
        repos.git(["init", "-q", sub], repos.root);
        const subOid = repos.commit(sub, "inner");
        await writeFile(
            join(clone, ".gitmodules"),
            `[submodule "sub"]\n\tpath = sub\n\turl = ${sub}\n`,
        );
        repos.git(["add", ".gitmodules"], clone);
        repos.git(
            ["update-index", "--add", "--cacheinfo", `160000,${subOid},sub`],
            clone,
        );
        repos.git(["commit", "-q", "-m", "sub"], clone);
        const oid = repos.commit(clone, "a");
        repos.git(["tag", "v1"], clone);
        repos.git(["tag", "-a", "-m", "v0", "v0", "HEAD~1"], clone);

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
        const hooks = join(clone, ".git", "hooks");
        await mkdir(hooks, { recursive: true });
        for (const hook of [
            "pre-push",
            "reference-transaction",
            "post-checkout",
            "pre-receive",
            "post-update",
            "push-to-checkout",
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
                `[url "${evil}"]\n\tinsteadOf = ${repos.remote}\n`,
        );
        const set = (args: string[]) => repos.git(["config", ...args], clone);
        set(["core.hooksPath", bin]);
        set(["include.path", included]);
        set(["uploadpack.packObjectsHook", await mark("pack")]);
        set(["core.sshCommand", await mark("ssh")]);
        set(["core.fsmonitor", await mark("fsmonitor")]);
        set([`url.${evil}.insteadOf`, repos.remote]);
        set(["--add", `url.${evil}.pushInsteadOf`, repos.remote]);
        set(["remote.origin.url", repos.remote]);
        set(["remote.origin.pushurl", evil]);
        set(["--add", "remote.origin.fetch", "+refs/*:refs/*"]);
        set(["remote.origin.push", "+refs/*:refs/*"]);
        set(["remote.origin.mirror", "true"]);
        set(["push.followTags", "true"]);
        set(["push.recurseSubmodules", "on-demand"]);
        set(["fetch.recurseSubmodules", "true"]);
        set(["submodule.recurse", "true"]);

        const work = await fetch(broker, clone);
        expect(work.oid).toBe(oid);
        const record = await recordPush(broker, {
            branch: "feature",
            oid: work.oid,
            last: null,
            forceWithLease: false,
        });
        const outcome = await pushWork(broker, record, {
            base,
            ask: () => {
                throw new Error("asked");
            },
        });
        expect(outcome.status).toBe("succeeded");

        expect(
            repos.git(
                ["for-each-ref", "--format=%(refname) %(objectname)"],
                repos.remote,
            ),
        ).toBe(
            `refs/heads/feature ${oid}\nrefs/heads/main ${repos.remoteMain}`,
        );
        expect(repos.git(["for-each-ref"], evil)).toBe("");
        expect(await readdir(marks)).toEqual([]);
        expect(repos.git(["for-each-ref", "refs/tags"], broker.repo)).toBe("");
        for (const repo of [broker.repo, repos.remote]) {
            expect(() => repos.git(["cat-file", "-e", subOid], repo)).toThrow();
        }
        expect(await readdir(broker.repo)).not.toContain("modules");
    });
});
