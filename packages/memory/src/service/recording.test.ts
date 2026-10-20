// vim:set expandtab shiftwidth=4 filetype=typescript:
// SPDX-License-Identifier: GPL-3.0-only

//
//
// ~chewygumxx/dorothy.git
// ::: :/packages/memory/src/service/recording.test.ts
//
//

import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdir, mkdtemp, rm, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { type Env, newPhrase } from "@dorothy/core";
import {
    assistantLine,
    SESSION as CLAUDE_SESSION,
    text,
    userLine,
} from "../bodies/fixtures.js";
import { dataRoot, type FactStore } from "../facts/store.js";
import type { Lock } from "../memory/sidecar.js";
import { indexPath, RecallIndex } from "../recall/store.js";
import { syncIndex } from "../recall/sync.js";
import {
    SESSION as CODEX_SESSION,
    context,
    message,
    meta,
} from "../recording/fixtures.js";
import { transcriptDir } from "../transcript.js";
import { Recent } from "./recent.js";
import { sweepBinding, sweepDeps } from "./recording.js";

// Events are of 2026-10-15 (Claude Code's) and 2026-10-20 (Codex's) at
// nine: a service started before them records them live, one started
// after leaves them to the backfill.
const EARLY = new Date("2026-10-14T00:00:00.000Z");
const LATE = new Date("2026-10-21T00:00:00.000Z");
const LIVE = new Date("2026-10-21T06:00:00.000Z");
const OLD = new Date("2026-10-19T09:30:00.000Z");

let home: string;
let env: Env;
let index: RecallIndex;
let depth = 0;
let deepest = 0;
let said: string[];

beforeEach(async () => {
    home = await mkdtemp(join(tmpdir(), "dorothy-recording-"));
    env = {
        HOME: home,
        XDG_DATA_HOME: join(home, "data"),
        XDG_CACHE_HOME: join(home, "cache"),
        XDG_STATE_HOME: join(home, "state"),
    };
    await mkdir(join(home, "cache", "dorothy"), { recursive: true });
    index = RecallIndex.open(indexPath(env));
    depth = 0;
    deepest = 0;
    said = [];
});
afterEach(async () => {
    index.close();
    await rm(home, { recursive: true, force: true });
});

// The index's lock, which says if it is taken while held: it is not
// re-entrant, and a nested take would wait on itself.
const watched: Lock = (work) =>
    index.lock(async () => {
        depth += 1;
        deepest = Math.max(deepest, depth);
        try {
            return await work();
        } finally {
            depth -= 1;
        }
    });

const binding = (started: Date) => {
    const store: FactStore = {
        root: dataRoot(env),
        lock: watched,
        recorder: null,
    };
    const idle = new Map<string, number>();
    const backfilled = new Set<string>();
    const touched = new Set<string>();
    return {
        idle,
        backfilled,
        touched,
        bound: sweepBinding({
            env,
            hosts: ["claude-code", "codex"],
            claudeDirs: [],
            store,
            index,
            versions: {
                recorder: async () => {},
                lock: watched,
                sweep: async () => {},
                heal: async () => false,
                close: () => {},
            },
            sync: () => syncIndex(index, transcriptDir(env)),
            sessions: new Recent<string, string>(100),
            held: new Recent(100),
            idle,
            backfilled,
            touched,
            log: {
                info: (m) => said.push(`info ${m}`),
                warn: (m) => said.push(`warn ${m}`),
                error: (m) => said.push(`error ${m}`),
            },
            now: () => started,
        }),
    };
};

const rollout = async (cwd: string, when: Date, name = "rollout-one.jsonl") => {
    const path = join(home, ".codex/sessions/2026/10/20", name);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(
        path,
        `${[meta(), context(cwd), message("user", "Synthetic question.", 1), message("assistant", "Synthetic answer.", 2)].join("\n")}\n`,
    );
    await utimes(path, when, when);
    return path;
};
const repoAt = async (name: string) => {
    const repo = join(home, name);
    await mkdir(join(repo, ".git"), { recursive: true });
    await writeFile(
        join(repo, ".git/config"),
        `[remote "origin"]\n\turl = git@github.com:me/${name}.git\n`,
    );
    return repo;
};
const codex = (results: { host: string }[]) => {
    const found = results.find((each) => each.host === "codex");
    if (!found) throw new Error("no codex result");
    return found;
};

describe("the sweep as the service binds it", () => {
    it("queues a live conversation for extraction and its project for export", async () => {
        const repo = await repoAt("app");
        await rollout(repo, LIVE);
        const { bound, idle, backfilled, touched } = binding(EARLY);
        expect(codex(await bound.run())).toMatchObject({
            sessions: 1,
            events: 2,
        });
        expect(idle.size).toBe(1);
        expect(backfilled.size).toBe(0);
        expect([...touched]).toEqual(["github.com/me/app"]);
    });

    it("marks a backfilled conversation and queues nothing", async () => {
        await rollout("/fixture/project", OLD);
        const { bound, idle, backfilled } = binding(LATE);
        expect(codex(await bound.run())).toMatchObject({ waiting: 1 });
        expect(codex(await bound.run({ backfill: true }))).toMatchObject({
            sessions: 1,
        });
        expect(idle.size).toBe(0);
        expect(backfilled.size).toBe(1);
    });

    it("frees a backfilled conversation once a live record reaches it", async () => {
        const path = await rollout("/fixture/project", OLD);
        const { bound, idle, backfilled } = binding(LATE);
        await bound.run();
        await bound.run({ backfill: true });
        const [phrase] = [...backfilled];
        await writeFile(
            path,
            `${[meta(), context(), message("user", "Synthetic question.", 1), message("assistant", "Synthetic answer.", 2), message("user", "Synthetic more.", 3600 * 20)].join("\n")}\n`,
        );
        await utimes(path, LIVE, LIVE);
        expect(codex(await bound.run())).toMatchObject({ events: 1 });
        expect(backfilled.size).toBe(0);
        expect([...idle.keys()]).toEqual([phrase as string]);
    });

    it("takes the store's lock for Claude Code and the others alike, never nested", async () => {
        await rollout("/fixture/project", LIVE);
        const claude = join(
            home,
            ".claude/projects/-work",
            `${CLAUDE_SESSION}.jsonl`,
        );
        await mkdir(dirname(claude), { recursive: true });
        await writeFile(
            claude,
            `${[userLine("u1", 0, "Synthetic."), assistantLine("a1", 1, [text("Synthetic.")])].join("\n")}\n`,
        );
        await utimes(claude, LIVE, LIVE);
        const { bound } = binding(EARLY);
        const results = await bound.run();
        expect(results.map((each) => each.sessions)).toEqual([1, 1]);
        expect(deepest).toBe(1);
        expect(said.filter((each) => each.startsWith("error"))).toEqual([]);
    });

    it("finds a session's conversation in the index, syncing it first", async () => {
        await rollout("/fixture/project", LIVE);
        const { bound } = binding(EARLY);
        await bound.run();
        // Another process's view: the index knows nothing of it yet.
        index.db.run("DELETE FROM conversation_sessions");
        const deps = sweepDeps(
            { ...bound.binding, sessions: new Recent(10) },
            false,
        );
        const phrase = await deps.conversation?.("codex", CODEX_SESSION);
        expect(phrase).toMatch(/^[a-z]+(-[a-z]+){3}$/);
        expect(await deps.conversation?.("codex", newPhrase())).toBeNull();
    });

    it("judges no session private: no harness marks one in its store", async () => {
        await rollout("/fixture/project", LIVE);
        const { bound } = binding(EARLY);
        const deps = sweepDeps(bound.binding, false);
        expect(
            deps.isPrivate?.({
                host: "codex",
                session: CODEX_SESSION,
                cwd: null,
            }),
        ).toBe(false);
    });
});
