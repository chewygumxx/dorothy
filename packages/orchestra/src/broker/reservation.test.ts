// vim:set expandtab shiftwidth=4 filetype=typescript:
// SPDX-License-Identifier: GPL-3.0-only

//
//
// ~chewygumxx/dorothy.git
// ::: :/packages/orchestra/src/broker/reservation.test.ts
//
//

import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { existsSync } from "node:fs";
import { readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { makeRepos, type Repos } from "../fixtures/repos.js";
import { resolveGit } from "./git.js";
import { type Broker, openBroker } from "./repository.js";
import { reserveBranch } from "./reservation.js";

describe("reserveBranch", () => {
    let repos: Repos;
    let broker: Broker;

    beforeEach(async () => {
        repos = await makeRepos();
        broker = await openBroker({
            git: resolveGit(repos.env),
            env: repos.env,
            state: repos.state,
            checkout: repos.checkout,
            localRemotes: true,
        });
    });

    afterEach(async () => {
        await rm(repos.root, { recursive: true, force: true });
    });

    const reserve = (server: string, worker: string, branch: string) =>
        reserveBranch(broker, {
            server,
            worker,
            branch,
            base: repos.remoteMain,
        });

    const fileOf = (branch: string) =>
        join(
            repos.state,
            "branches",
            "acme",
            "widget",
            Buffer.from(branch).toString("hex"),
        );

    it("creates the branch's file, holding the server, the worker and the base", async () => {
        const reservation = await reserve("s1", "codex-1", "feat/x");
        expect(reservation.path).toBe(fileOf("feat/x"));
        expect(JSON.parse(await readFile(fileOf("feat/x"), "utf8"))).toEqual({
            server: "s1",
            worker: "codex-1",
            base: repos.remoteMain,
        });
    });

    it("refuses one of two simultaneous reservations of a branch", async () => {
        const results = await Promise.allSettled([
            reserve("s1", "codex-1", "feature"),
            reserve("s1", "claude-1", "feature"),
        ]);
        const kept = results.filter((result) => result.status === "fulfilled");
        const refused = results.filter(
            (result) => result.status === "rejected",
        );
        expect(kept).toHaveLength(1);
        expect(refused).toHaveLength(1);
        expect(String((refused[0] as PromiseRejectedResult).reason)).toMatch(
            /reserved/,
        );
    });

    it("refuses a branch an earlier launch reserved", async () => {
        await reserve("s0", "codex-1", "feature");
        await expect(reserve("s1", "codex-1", "feature")).rejects.toThrow(
            /reserved/,
        );
        expect(
            JSON.parse(await readFile(fileOf("feature"), "utf8")).server,
        ).toBe("s0");
    });

    it("refuses a branch the remote has already, reserving nothing", async () => {
        repos.git(
            ["push", "-q", "origin", "main:refs/heads/taken"],
            repos.checkout,
        );
        await expect(reserve("s1", "codex-1", "taken")).rejects.toThrow(
            /remote/,
        );
        expect(existsSync(fileOf("taken"))).toBe(false);
    });

    it("reserves a branch the remote has only within a longer name", async () => {
        repos.git(
            ["push", "-q", "origin", "main:refs/heads/team/taken"],
            repos.checkout,
        );
        expect((await reserve("s1", "codex-1", "taken")).path).toBe(
            fileOf("taken"),
        );
    });

    it.each(["-x", "HEAD", "a..b", "@{-1}", "x@{u}", "a b"])(
        "refuses %s, no valid branch name",
        async (branch) => {
            await expect(reserve("s1", "codex-1", branch)).rejects.toThrow(
                /branch name/,
            );
        },
    );
});
