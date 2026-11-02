// vim:set expandtab shiftwidth=4 filetype=typescript:
// SPDX-License-Identifier: GPL-3.0-only

//
//
// ~chewygumxx/dorothy.git
// ::: :/packages/orchestra/src/broker/branches.test.ts
//
//

import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { EventEmitter } from "node:events";
import { existsSync, readFileSync } from "node:fs";
import { chmod, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { PassThrough } from "node:stream";
import { makeRepos, type Repos } from "../fixtures/repos.js";
import { FakeTimers } from "../fixtures/timers.js";
import { closeOn, GRACE_MS, Operations } from "../operations.js";
import { fetchBase } from "./base.js";
import { Branches } from "./branches.js";
import { makeClone } from "./clone.js";
import { GIT_DEADLINE, resolveGit } from "./git.js";
import type { Ask } from "./push.js";
import { type Broker, openBroker } from "./repository.js";

const WORK = "refs/orchestra/s1/codex-1/feature";

// Gone, or a zombie awaiting its reaper.
function alive(pid: number): boolean {
    try {
        const stat = readFileSync(`/proc/${pid}/stat`, "utf8");
        return stat.slice(stat.lastIndexOf(")") + 2)[0] !== "Z";
    } catch {
        return false;
    }
}

async function until(done: () => boolean): Promise<void> {
    for (let waited = 0; !done(); waited += 20) {
        if (waited > 10_000) {
            throw new Error("waited too long");
        }
        await Bun.sleep(20);
    }
}

describe("the branches' operations", () => {
    let repos: Repos;
    let broker: Broker;
    let base: string;
    let clone: string;
    // The broker's deadlines, and the operations' grace.
    let deadlines: FakeTimers;
    let timers: FakeTimers;
    let stopped: boolean;
    let operations: Operations;
    let branches: Branches;

    beforeEach(async () => {
        repos = await makeRepos();
        deadlines = new FakeTimers();
        timers = new FakeTimers();
        broker = await openBroker({
            git: resolveGit(repos.env),
            env: repos.env,
            state: repos.state,
            checkout: repos.checkout,
            localRemotes: true,
            timers: deadlines,
        });
        base = (await fetchBase(broker, "s1", "codex-1")).oid;
        clone = await makeClone(broker, {
            root: repos.worktrees,
            server: "s1",
            worker: "codex-1",
            branch: "feature",
            base,
        });
        stopped = false;
        operations = new Operations({
            log: () => {},
            clock: { now: () => 0 },
            timers,
            stopWorkers: async () => {
                stopped = true;
            },
        });
        branches = new Branches();
    });

    afterEach(async () => {
        await rm(repos.root, { recursive: true, force: true });
    });

    // A commit on the worker's branch.
    const work = (file: string) => repos.commit(clone, file);

    // The worker's branch brought back as fetchWork would, unboxed.
    const fetched = async () => {
        repos.git(
            ["fetch", "-q", clone, `+refs/heads/feature:${WORK}`],
            broker.repo,
        );
        return repos.git(["rev-parse", WORK], broker.repo);
    };

    const never: Ask = () => {
        throw new Error("asked");
    };

    const push = (operationId: string, ask = never) =>
        operations.begin(
            {
                operationId,
                tool: "push_worker",
                args: { worker: "codex-1", forceWithLease: false },
                worker: "codex-1",
                queue: "codex-1",
            },
            branches.push(broker, {
                branch: "feature",
                base,
                forceWithLease: false,
                ask,
                fetch: fetched,
            }),
        );

    const settled = (operationId: string) =>
        until(() => {
            const { status } = operations.read(operationId);
            return status !== "pending" && status !== "running";
        });

    const remoteFeature = () =>
        repos.git(
            ["for-each-ref", "--format=%(objectname)", "refs/heads/feature"],
            repos.remote,
        );

    // A remote hook that hangs, its pid written beside it.
    const pidFile = () => join(repos.root, "hook.pid");
    const hang = async (name: string) => {
        const path = join(repos.remote, "hooks", name);
        await writeFile(
            path,
            `#!/bin/sh\necho $$ > ${pidFile()}\nexec sleep 60\n`,
        );
        await chmod(path, 0o755);
    };
    const unhang = (name: string) => rm(join(repos.remote, "hooks", name));
    const hookPid = async () => {
        await until(
            () =>
                existsSync(pidFile()) && readFileSync(pidFile(), "utf8") !== "",
        );
        return Number(readFileSync(pidFile(), "utf8"));
    };

    it("pushes with the branch's last OID, and a repeat acts not again", async () => {
        const first = work("a");
        push("op-1");
        await settled("op-1");
        expect(operations.read("op-1")).toMatchObject({
            status: "succeeded",
            values: { oid: first, expected: null, ref: "refs/heads/feature" },
        });
        const second = work("b");
        expect(push("op-1").status).toBe("succeeded");
        expect(remoteFeature()).toBe(first);
        push("op-2");
        await settled("op-2");
        expect(operations.read("op-2")).toMatchObject({
            status: "succeeded",
            values: { oid: second, expected: first },
        });
        expect(remoteFeature()).toBe(second);
    });

    it("reconciles a push killed after sending, its process group gone", async () => {
        await hang("post-receive");
        const oid = work("a");
        push("op-1");
        const pid = await hookPid();
        deadlines.advance(GIT_DEADLINE);
        await settled("op-1");
        expect(operations.read("op-1")).toMatchObject({
            status: "succeeded",
            detail: `the remote holds ${oid} at refs/heads/feature`,
        });
        expect(alive(pid)).toBe(false);
        await unhang("post-receive");
        const next = work("b");
        push("op-2");
        await settled("op-2");
        expect(operations.read("op-2")).toMatchObject({
            status: "succeeded",
            values: { oid: next, expected: oid },
        });
    });

    it("keeps unknown a push reconciled to neither; the branch's next push asks", async () => {
        await hang("pre-receive");
        const oid = work("a");
        push("op-1");
        const pid = await hookPid();
        repos.git(
            ["update-ref", "refs/heads/feature", repos.remoteMain],
            repos.remote,
        );
        deadlines.advance(GIT_DEADLINE);
        await settled("op-1");
        expect(operations.read("op-1").status).toBe("unknown");
        expect(alive(pid)).toBe(false);
        await unhang("pre-receive");
        const questions: string[] = [];
        push("op-2", async (question) => {
            questions.push(question);
            return "deny";
        });
        await settled("op-2");
        expect(operations.read("op-2")).toMatchObject({
            status: "failed",
            detail: "denied by the user",
        });
        expect(questions).toHaveLength(1);
        for (const shown of [
            "op-1",
            oid,
            `the remote holds ${repos.remoteMain} at refs/heads/feature`,
        ]) {
            expect(questions[0]).toContain(shown);
        }
        expect(remoteFeature()).toBe(repos.remoteMain);
    });

    it("lets stop_worker cancel what is pending; a running push goes on to its deadline", async () => {
        await hang("pre-receive");
        work("a");
        push("op-1");
        const pid = await hookPid();
        let acted = false;
        operations.begin(
            {
                operationId: "op-2",
                tool: "open_pull_request",
                args: { worker: "codex-1" },
                worker: "codex-1",
                queue: "codex-1",
            },
            async () => {
                acted = true;
                return { status: "succeeded", detail: "" };
            },
        );
        operations.cancel("codex-1");
        expect(operations.read("op-2").status).toBe("failed");
        await Bun.sleep(100);
        expect(operations.read("op-1").status).toBe("running");
        expect(alive(pid)).toBe(true);
        deadlines.advance(GIT_DEADLINE);
        await settled("op-1");
        expect(operations.read("op-1").status).toBe("failed");
        expect(alive(pid)).toBe(false);
        expect(acted).toBe(false);
        expect(remoteFeature()).toBe("");
    });

    for (const trigger of ["end", "SIGTERM"]) {
        it(`on ${trigger === "end" ? "the client's EOF" : "a signal"}, kills a running push after the grace and reconciles it`, async () => {
            const input = new PassThrough();
            const signals = new EventEmitter();
            let closing: Promise<void> | undefined;
            closeOn(input, signals, () => {
                closing = operations.close();
                return closing;
            });
            input.resume();
            await hang("post-receive");
            const oid = work("a");
            push("op-1");
            const pid = await hookPid();
            if (trigger === "end") {
                input.end();
            } else {
                signals.emit(trigger);
            }
            await until(() => stopped);
            await Bun.sleep(100);
            expect(alive(pid)).toBe(true);
            timers.advance(GRACE_MS);
            await closing;
            expect(operations.read("op-1")).toMatchObject({
                status: "succeeded",
                detail: `the remote holds ${oid} at refs/heads/feature`,
            });
            expect(alive(pid)).toBe(false);
        });
    }

    it("refuses a pull request for a branch with no successful push", async () => {
        const request = () =>
            branches.pullRequest(broker, {
                gh: "/bin/false",
                branch: "feature",
                title: "Add the feature",
                body: "Body",
            });
        expect(request).toThrow(/no push of feature has succeeded/);
        work("a");
        push("op-1");
        await settled("op-1");
        expect(request).not.toThrow();
    });
});
