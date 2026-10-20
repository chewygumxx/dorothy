// vim:set expandtab shiftwidth=4 filetype=typescript:
// SPDX-License-Identifier: GPL-3.0-only

//
//
// ~chewygumxx/dorothy.git
// ::: :/packages/memory/src/recording/state.test.ts
//
//

import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import {
    chmod,
    mkdir,
    mkdtemp,
    readdir,
    readFile,
    rm,
    stat,
    writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import type { Env } from "@dorothy/core";
import { readCodex } from "./codex.js";
import { message, meta } from "./fixtures.js";
import { codexSource } from "./sources.js";
import {
    emptySweepState,
    forgetMissing,
    loadSweepState,
    rememberRead,
    saveSweepState,
    sweepPath,
} from "./state.js";

let root = "";
let env: Env;
beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "dorothy-recording-state-"));
    env = { HOME: root, XDG_STATE_HOME: join(root, "state") };
});
afterEach(async () => {
    await rm(root, { recursive: true, force: true });
});

describe("recording sweep state", () => {
    it("uses only injected XDG/HOME roots", () => {
        expect(sweepPath(env)).toBe(join(root, "state/dorothy/sweep.json"));
        expect(sweepPath({ HOME: root })).toBe(
            join(root, ".local/state/dorothy/sweep.json"),
        );
        expect(sweepPath({ HOME: root, XDG_STATE_HOME: "relative" })).toBe(
            join(root, ".local/state/dorothy/sweep.json"),
        );
        expect(() => sweepPath({})).toThrow("recording state root");
    });
    it("starts fresh with a warning when missing, without creating directories", async () => {
        const warnings: string[] = [];
        const state = await loadSweepState(env, (warning) =>
            warnings.push(warning),
        );
        expect(state).toEqual({ v: 1, sessions: {} });
        expect(warnings).toHaveLength(1);
        expect(warnings[0]).toContain("missing");
        expect(await readdir(root)).toEqual([]);
    });
    it("recovers from malformed JSON without echoing its contents", async () => {
        await mkdir(dirname(sweepPath(env)), { recursive: true });
        await writeFile(sweepPath(env), "SYNTHETIC_PRIVATE_CANARY not JSON");
        const warnings: string[] = [];
        expect(
            await loadSweepState(env, (value) => warnings.push(value)),
        ).toEqual(emptySweepState());
        expect(warnings).toHaveLength(1);
        expect(warnings.join()).not.toContain("SYNTHETIC_PRIVATE_CANARY");
    });
    for (const [name, value] of [
        ["version", { v: 2, sessions: {} }],
        ["old watermarks", { v: 1, watermarks: {}, sessions: {} }],
        [
            "source cursor",
            {
                v: 1,
                sessions: { key: { kind: "rows", maxSourceId: 8, count: 1 } },
            },
        ],
        [
            "negative physical id",
            {
                v: 1,
                sessions: { key: { kind: "rows", maxId: -1, count: 1 } },
            },
        ],
        [
            "fractional row count",
            {
                v: 1,
                sessions: { key: { kind: "rows", maxId: 8, count: 0.5 } },
            },
        ],
        [
            "invalid inode",
            {
                v: 1,
                sessions: {
                    key: {
                        kind: "file",
                        size: 5,
                        mtime: "1",
                        inode: "bad",
                        device: "1",
                    },
                },
            },
        ],
        [
            "extra cursor",
            {
                v: 1,
                sessions: {
                    key: { kind: "rows", maxId: 8, count: 1, sourceId: 8 },
                },
            },
        ],
    ]) {
        it(`discards an incompatible ${name} rather than letting it skip data`, async () => {
            await mkdir(dirname(sweepPath(env)), { recursive: true });
            await writeFile(sweepPath(env), JSON.stringify(value));
            const warnings: string[] = [];
            expect(
                await loadSweepState(env, (warning) => warnings.push(warning)),
            ).toEqual({ v: 1, sessions: {} });
            expect(warnings).toHaveLength(1);
        });
    }
    it("warns and starts fresh when the state path cannot be read as a file", async () => {
        await mkdir(sweepPath(env), { recursive: true });
        const warnings: string[] = [];
        expect(
            await loadSweepState(env, (warning) => warnings.push(warning)),
        ).toEqual(emptySweepState());
        expect(warnings).toHaveLength(1);
    });
    it("writes whole and private, clamping existing directory and file modes", async () => {
        const path = sweepPath(env);
        await mkdir(dirname(path), { recursive: true });
        await writeFile(path, "Older state.");
        await chmod(dirname(path), 0o777);
        await chmod(path, 0o666);
        const state = emptySweepState();
        rememberRead(state, "fixture", {
            stable: true,
            fingerprint: { kind: "rows", maxId: 9, count: 2 },
        });
        await saveSweepState(env, state);
        expect(JSON.parse(await readFile(path, "utf8"))).toEqual({
            v: 1,
            sessions: { fixture: { kind: "rows", maxId: 9, count: 2 } },
        });
        expect((await stat(path)).mode & 0o777).toBe(0o600);
        expect((await stat(dirname(path))).mode & 0o777).toBe(0o700);
        expect(await readdir(dirname(path))).toEqual(["sweep.json"]);
    });
    it("does not replace a valid file when supplied invalid state", async () => {
        const state = emptySweepState();
        rememberRead(state, "fixture", {
            stable: true,
            fingerprint: { kind: "rows", maxId: 9, count: 2 },
        });
        await saveSweepState(env, state);
        const before = await readFile(sweepPath(env));
        state.sessions.bad = { kind: "rows", maxId: -1, count: 1 };
        await expect(saveSweepState(env, state)).rejects.toThrow(
            "invalid sweep state",
        );
        expect(await readFile(sweepPath(env))).toEqual(before);
    });
    it("does not cache an unstable read and snapshots a completed fingerprint", () => {
        const state = emptySweepState();
        expect(
            rememberRead(state, "fixture", {
                stable: false,
                fingerprint: { kind: "rows", maxId: 9, count: 2 },
            }),
        ).toBe(false);
        expect(state.sessions).toEqual({});
        const fingerprint = { kind: "rows" as const, maxId: 9, count: 2 };
        expect(
            rememberRead(state, "fixture", { stable: true, fingerprint }),
        ).toBe(true);
        fingerprint.count = 3;
        expect(state.sessions.fixture).toEqual({
            kind: "rows",
            maxId: 9,
            count: 2,
        });
    });
    it("treats arbitrary session keys as data, including prototype-looking keys", async () => {
        const state = emptySweepState();
        rememberRead(state, "__proto__", {
            stable: true,
            fingerprint: { kind: "rows", maxId: 3, count: 1 },
        });
        await saveSweepState(env, state);
        const warnings: string[] = [];
        const loaded = await loadSweepState(env, (warning) =>
            warnings.push(warning),
        );
        expect(Object.hasOwn(loaded.sessions, "__proto__")).toBe(true);
        expect(
            Object.getOwnPropertyDescriptor(loaded.sessions, "__proto__")
                ?.value,
        ).toEqual({
            kind: "rows",
            maxId: 3,
            count: 1,
        });
        expect(warnings).toEqual([]);
    });
    it("losing the cache replays the same ids instead of suppressing any events", async () => {
        const path = join(root, ".codex/sessions/rollout-fixture.jsonl");
        await mkdir(dirname(path), { recursive: true });
        await writeFile(
            path,
            `${meta()}\n${message("user", "Synthetic speech.")}\n`,
        );
        const session = (await codexSource(env).list())[0];
        if (!session) throw new Error("missing fixture session");
        const read = await session.read();
        if (read?.kind !== "file") throw new Error("missing file read");
        const state = emptySweepState();
        rememberRead(state, session.key, read);
        await saveSweepState(env, state);
        const loaded = await loadSweepState(env, () => {});
        expect(await session.read(loaded.sessions[session.key])).toBeNull();
        await rm(sweepPath(env));
        const warnings: string[] = [];
        const fresh = await loadSweepState(env, (warning) =>
            warnings.push(warning),
        );
        const replay = await session.read(fresh.sessions[session.key]);
        if (replay?.kind !== "file") throw new Error("missing replay");
        expect(readCodex(replay.lines).events).toEqual([
            {
                kind: "user",
                text: "Synthetic speech.",
                sourceId: "2",
                at: "2026-10-20T09:00:01.000Z",
            },
        ]);
        expect(warnings).toHaveLength(1);
    });
    it("forgets a host's unlisted sessions and no other host's", () => {
        const state = emptySweepState();
        const fingerprint = { kind: "rows" as const, maxId: 1, count: 1 };
        for (const key of [
            JSON.stringify(["codex", "kept"]),
            JSON.stringify(["codex", "gone"]),
            JSON.stringify(["hermes", "other"]),
            "not a host key",
        ])
            rememberRead(state, key, { stable: true, fingerprint });
        forgetMissing(
            state,
            "codex",
            new Set([JSON.stringify(["codex", "kept"])]),
        );
        expect(Object.keys(state.sessions).sort()).toEqual(
            [
                "not a host key",
                JSON.stringify(["codex", "kept"]),
                JSON.stringify(["hermes", "other"]),
            ].sort(),
        );
    });
});
