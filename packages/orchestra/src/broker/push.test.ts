// vim:set expandtab shiftwidth=4 filetype=typescript:
// SPDX-License-Identifier: GPL-3.0-only

//
//
// ~chewygumxx/dorothy.git
// ::: :/packages/orchestra/src/broker/push.test.ts
//
//

import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { chmod, mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { makeRepos, type Repos } from "../fixtures/repos.js";
import { fetchBase } from "./base.js";
import { makeClone } from "./clone.js";
import { resolveGit } from "./git.js";
import {
    type Ask,
    capDiff,
    DIFF_BYTES,
    DIFF_LINES,
    type PushRecord,
    pushWork,
    reconcilePush,
    recordPush,
} from "./push.js";
import { type Broker, openBroker } from "./repository.js";

const WORK = "refs/orchestra/s1/codex-1/feature";

describe("the broker's push", () => {
    let repos: Repos;
    let broker: Broker;
    let base: string;
    let clone: string;

    const open = (deadline?: number) =>
        openBroker({
            git: resolveGit(repos.env),
            env: repos.env,
            state: repos.state,
            checkout: repos.checkout,
            deadline,
            localRemotes: true,
        });

    beforeEach(async () => {
        repos = await makeRepos();
        broker = await open();
        base = (await fetchBase(broker, "s1", "codex-1")).oid;
        clone = await makeClone(broker, {
            root: repos.worktrees,
            server: "s1",
            worker: "codex-1",
            branch: "feature",
            base,
        });
    });

    afterEach(async () => {
        await rm(repos.root, { recursive: true, force: true });
    });

    // The worker's branch brought back as fetchWork would, unboxed.
    const fetched = () => {
        repos.git(
            ["fetch", "-q", clone, `+refs/heads/feature:${WORK}`],
            broker.repo,
        );
        return repos.git(["rev-parse", WORK], broker.repo);
    };

    const work = (file: string) => {
        repos.commit(clone, file);
        return fetched();
    };

    const remoteRefs = () =>
        repos.git(
            ["for-each-ref", "--format=%(refname) %(objectname)"],
            repos.remote,
        );

    const remoteFeature = () =>
        repos.git(
            ["for-each-ref", "--format=%(objectname)", "refs/heads/feature"],
            repos.remote,
        );

    // Another hand moving the remote's feature, from a checkout of its own.
    const moveRemote = (file: string) => {
        const other = join(repos.root, `other-${file}`);
        repos.git(["clone", "-q", repos.remote, other], repos.root);
        const oid = repos.commit(other, file);
        repos.git(["push", "-q", "origin", "+HEAD:refs/heads/feature"], other);
        return oid;
    };

    const never: Ask = () => {
        throw new Error("asked");
    };

    const asking = (answer: "allow" | "deny") => {
        const questions: string[] = [];
        const ask: Ask = async (question) => {
            questions.push(question);
            return answer;
        };
        return { ask, questions };
    };

    it("records the push and sends exactly the fetched commit to exactly that ref", async () => {
        const oid = work("a");
        const record = await recordPush(broker, {
            branch: "feature",
            oid,
            last: null,
            forceWithLease: false,
        });
        expect(record).toEqual({
            identity: "acme/widget",
            url: repos.remote,
            ref: "refs/heads/feature",
            oid,
            expected: null,
            force: false,
        });
        const outcome = await pushWork(broker, record, { base, ask: never });
        expect(outcome.status).toBe("succeeded");
        expect(remoteRefs().split("\n").sort()).toEqual([
            `refs/heads/feature ${oid}`,
            `refs/heads/main ${repos.remoteMain}`,
        ]);
    });

    it("pushes the recorded OID when the worker's branch moves afterwards", async () => {
        const oid = work("a");
        const record = await recordPush(broker, {
            branch: "feature",
            oid,
            last: null,
            forceWithLease: false,
        });
        const moved = work("b");
        expect(moved).not.toBe(oid);
        await pushWork(broker, record, { base, ask: never });
        expect(remoteFeature()).toBe(oid);
    });

    it("pushes a fast-forward of the last push by rule", async () => {
        const first = work("a");
        await pushWork(
            broker,
            await recordPush(broker, {
                branch: "feature",
                oid: first,
                last: null,
                forceWithLease: false,
            }),
            { base, ask: never },
        );
        const second = work("b");
        const record = await recordPush(broker, {
            branch: "feature",
            oid: second,
            last: first,
            forceWithLease: false,
        });
        expect(record.expected).toBe(first);
        const outcome = await pushWork(broker, record, { base, ask: never });
        expect(outcome.status).toBe("succeeded");
        expect(remoteFeature()).toBe(second);
    });

    it("refuses a plain push that is no fast-forward of the last", async () => {
        const first = work("a");
        await pushWork(
            broker,
            await recordPush(broker, {
                branch: "feature",
                oid: first,
                last: null,
                forceWithLease: false,
            }),
            { base, ask: never },
        );
        repos.git(["reset", "-q", "--hard", base], clone);
        const rewritten = work("c");
        const outcome = await pushWork(
            broker,
            await recordPush(broker, {
                branch: "feature",
                oid: rewritten,
                last: first,
                forceWithLease: false,
            }),
            { base, ask: never },
        );
        expect(outcome.status).toBe("failed");
        expect(outcome.detail).toMatch(/fast-forward/);
        expect(remoteFeature()).toBe(first);
    });

    it("fails the lease when the remote moved since the last push", async () => {
        const first = work("a");
        await pushWork(
            broker,
            await recordPush(broker, {
                branch: "feature",
                oid: first,
                last: null,
                forceWithLease: false,
            }),
            { base, ask: never },
        );
        const theirs = moveRemote("theirs");
        const second = work("b");
        const outcome = await pushWork(
            broker,
            await recordPush(broker, {
                branch: "feature",
                oid: second,
                last: first,
                forceWithLease: false,
            }),
            { base, ask: never },
        );
        expect(outcome.status).toBe("failed");
        expect(remoteFeature()).toBe(theirs);
    });

    it("fails a first push when the branch was made on the remote meanwhile", async () => {
        const theirs = moveRemote("theirs");
        const oid = work("a");
        const outcome = await pushWork(
            broker,
            await recordPush(broker, {
                branch: "feature",
                oid,
                last: null,
                forceWithLease: false,
            }),
            { base, ask: never },
        );
        expect(outcome.status).toBe("failed");
        expect(remoteFeature()).toBe(theirs);
    });

    it("asks before pushing a change to a dependency file at any depth, showing its diff", async () => {
        await mkdir(join(clone, "tools", "lint"), { recursive: true });
        repos.commit(clone, "tools/lint/package.json");
        repos.commit(clone, "requirements-dev.txt");
        const oid = work("readme");
        const record = await recordPush(broker, {
            branch: "feature",
            oid,
            last: null,
            forceWithLease: false,
        });
        const denying = asking("deny");
        const denied = await pushWork(broker, record, {
            base,
            ask: denying.ask,
        });
        expect(denied.status).toBe("failed");
        expect(remoteFeature()).toBe("");
        expect(denying.questions).toHaveLength(1);
        const [question] = denying.questions;
        expect(question).toContain("+++ b/tools/lint/package.json");
        expect(question).toContain("+++ b/requirements-dev.txt");
        expect(question).not.toContain("readme");
        const allowing = asking("allow");
        const allowed = await pushWork(broker, record, {
            base,
            ask: allowing.ask,
        });
        expect(allowed.status).toBe("succeeded");
        expect(remoteFeature()).toBe(oid);
    });

    it("caps the dependency diff it shows", async () => {
        const lock = Array.from({ length: 1000 }, (_, n) => `line ${n}`);
        await writeFile(join(clone, "bun.lock"), `${lock.join("\n")}\n`);
        repos.git(["add", "bun.lock"], clone);
        repos.git(["commit", "-q", "-m", "lock"], clone);
        const denying = asking("deny");
        await pushWork(
            broker,
            await recordPush(broker, {
                branch: "feature",
                oid: fetched(),
                last: null,
                forceWithLease: false,
            }),
            { base, ask: denying.ask },
        );
        const [question = ""] = denying.questions;
        expect(question).toContain("+line 0\n");
        expect(question).not.toContain("+line 999");
        expect(question).toMatch(/\n\[cut: \d+ more lines, \d+ bytes\]$/);
        expect(question.split("\n").length).toBeLessThan(DIFF_LINES + 10);
    });

    it("asks before a forceWithLease, naming every recorded value", async () => {
        const first = work("a");
        await pushWork(
            broker,
            await recordPush(broker, {
                branch: "feature",
                oid: first,
                last: null,
                forceWithLease: false,
            }),
            { base, ask: never },
        );
        repos.git(["reset", "-q", "--hard", base], clone);
        const rewritten = work("c");
        const record = await recordPush(broker, {
            branch: "feature",
            oid: rewritten,
            last: null,
            forceWithLease: true,
        });
        expect(record.expected).toBe(first);
        expect(record.force).toBe(true);
        const denying = asking("deny");
        await pushWork(broker, record, { base, ask: denying.ask });
        expect(remoteFeature()).toBe(first);
        const [question] = denying.questions;
        for (const value of [
            "acme/widget",
            repos.remote,
            "refs/heads/feature",
            rewritten,
            first,
        ]) {
            expect(question).toContain(value);
        }
        const outcome = await pushWork(broker, record, {
            base,
            ask: asking("allow").ask,
        });
        expect(outcome.status).toBe("succeeded");
        expect(remoteFeature()).toBe(rewritten);
    });

    describe("reconciliation", () => {
        const recordOf = (
            oid: string,
            expected: string | null,
        ): PushRecord => ({
            identity: "acme/widget",
            url: repos.remote,
            ref: "refs/heads/feature",
            oid,
            expected,
            force: false,
        });

        it("is succeeded where the remote shows the pushed OID", async () => {
            const oid = moveRemote("ours");
            const outcome = await reconcilePush(broker, recordOf(oid, null));
            expect(outcome.status).toBe("succeeded");
        });

        it("is failed where the remote shows the expected state", async () => {
            const oid = work("a");
            expect(
                (await reconcilePush(broker, recordOf(oid, null))).status,
            ).toBe("failed");
            const theirs = moveRemote("theirs");
            expect(
                (await reconcilePush(broker, recordOf(oid, theirs))).status,
            ).toBe("failed");
        });

        it("is unknown where the remote shows anything else", async () => {
            const oid = work("a");
            moveRemote("theirs");
            expect(
                (await reconcilePush(broker, recordOf(oid, base))).status,
            ).toBe("unknown");
            expect(
                (await reconcilePush(broker, recordOf(oid, null))).status,
            ).toBe("unknown");
        });

        it("is unknown where the remote cannot be read", async () => {
            const oid = work("a");
            const outcome = await reconcilePush(broker, {
                ...recordOf(oid, null),
                url: join(repos.root, "gone.git"),
            });
            expect(outcome.status).toBe("unknown");
        });

        const hook = async (name: string) => {
            const path = join(repos.remote, "hooks", name);
            await writeFile(path, "#!/bin/sh\nsleep 30\n");
            await chmod(path, 0o755);
        };

        it("reconciles a push killed at its deadline after the remote took it", async () => {
            await hook("post-receive");
            const oid = work("a");
            const late = await open(1500);
            const outcome = await pushWork(
                late,
                await recordPush(late, {
                    branch: "feature",
                    oid,
                    last: null,
                    forceWithLease: false,
                }),
                { base, ask: never },
            );
            expect(outcome.status).toBe("succeeded");
            expect(remoteFeature()).toBe(oid);
        });

        it("reconciles a push killed at its deadline before the remote took it", async () => {
            await hook("pre-receive");
            const oid = work("a");
            const late = await open(1500);
            const outcome = await pushWork(
                late,
                await recordPush(late, {
                    branch: "feature",
                    oid,
                    last: null,
                    forceWithLease: false,
                }),
                { base, ask: never },
            );
            expect(outcome.status).toBe("failed");
            expect(remoteFeature()).toBe("");
        });
    });
});

describe("capDiff", () => {
    it("leaves a diff within its caps whole", () => {
        expect(capDiff("+a\n+b")).toBe("+a\n+b");
    });

    it("keeps its first lines, then says how much was cut", () => {
        const lines = Array.from({ length: DIFF_LINES + 100 }, () => "+x");
        expect(capDiff(lines.join("\n"))).toBe(
            `${lines.slice(0, DIFF_LINES).join("\n")}\n[cut: 100 more lines, 299 bytes]`,
        );
        const wide = Array.from({ length: 100 }, () => "x".repeat(1024));
        const kept = Math.floor(DIFF_BYTES / 1025);
        expect(capDiff(wide.join("\n"))).toBe(
            `${wide.slice(0, kept).join("\n")}\n[cut: ${100 - kept} more lines, ${100 * 1025 - 1 - kept * 1025} bytes]`,
        );
    });
});
