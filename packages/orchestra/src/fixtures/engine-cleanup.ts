// vim:set expandtab shiftwidth=4 filetype=typescript:
// SPDX-License-Identifier: GPL-3.0-only

//
//
// ~chewygumxx/dorothy.git
// ::: :/packages/orchestra/src/fixtures/engine-cleanup.ts
//
//

// Module replacement is isolated in this child process, never in the suite.
import { mock } from "bun:test";
import assert from "node:assert/strict";
import { rm } from "node:fs/promises";
import { resolveGit } from "../broker/git.js";
import { DEFAULT_ORCHESTRA } from "../config.js";
import { makeRepos } from "./repos.js";
import { ManualTime } from "./time.js";

const phase = process.argv[2];
let held!: () => void;
const acquired = new Promise<void>((resolve) => {
    held = resolve;
});
let release!: () => void;
const barrier = new Promise<void>((resolve) => {
    release = resolve;
});
let cleaned = false;
mock.module("../engine/session.js", () => ({
    openSession: async ({
        hold,
    }: {
        hold: (close: () => Promise<void>) => void;
    }) => {
        if (phase === "startup") {
            held();
            await barrier;
            hold(async () => {
                cleaned = true;
            });
        } else {
            hold(async () => {
                held();
                await barrier;
                cleaned = true;
            });
        }
        return {
            mode: async () => "default",
            turn: async () => ({ status: "failed", error: "lost" }),
            cancel: async () => {},
        };
    },
}));
const { Engine } = await import("../engine/engine.js");
const repos = await makeRepos();
const time = new ManualTime();
const engine = new Engine({
    server: "s1",
    config: {
        ...DEFAULT_ORCHESTRA,
        enabled: true,
        worktreeRoot: repos.worktrees,
    },
    env: repos.env,
    state: repos.state,
    git: resolveGit(repos.env),
    secrets: {},
    logins: { claude: repos.root, codex: repos.root },
    call: async () => {
        throw new Error("no judge");
    },
    questions: {
        ask: async () => {
            throw new Error("no question");
        },
        stop: async () => {},
        pending: () => [],
    },
    log: () => {},
    clock: time,
    timers: time,
    localRemotes: true,
    adapter: async () => ({
        runtime: "/usr/bin/true",
        entry: "/usr/bin/true",
        readOnly: [],
    }),
});
try {
    await engine.start({
        agent: "claude",
        repo: repos.checkout,
        branch: "feature",
        task: "fail",
        operationId: "start",
    });
    await acquired;
    let returned = false;
    const closing = engine.close().then(() => {
        returned = true;
    });
    await Bun.sleep(50);
    assert.equal(
        returned,
        false,
        "close returned while cleanup or acquisition was held",
    );
    release();
    await closing;
    assert.equal(
        cleaned,
        true,
        "close missed a resource acquired during startup",
    );
} finally {
    release();
    await engine.close();
    await rm(repos.root, { recursive: true, force: true });
}
