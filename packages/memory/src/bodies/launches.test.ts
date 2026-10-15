// vim:set expandtab shiftwidth=4 filetype=typescript:
// SPDX-License-Identifier: GPL-3.0-only

//
//
// ~chewygumxx/dorothy.git
// ::: :/packages/memory/src/bodies/launches.test.ts
//
//

import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdir, mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
    launchesDir,
    launchSessions,
    liveSession,
    noteLaunch,
    noteSession,
    readLaunch,
    removeLaunch,
    runtimeDir,
    staleLaunches,
} from "./launches.js";

const LAUNCH = "6c84fb90-12c4-11e1-840d-7b25c5ee775a";
const OTHER = "7d95fc01-23d5-42f2-951e-8c36d6ff886b";
const S1 = "0f8fad5b-d9cb-469f-a165-70867728950e";
const S2 = "1a9fbe6c-eadc-4a7f-b276-81978839a61f";

let home = "";
let env: Record<string, string>;
beforeEach(async () => {
    home = await mkdtemp(join(tmpdir(), "dorothy-launches-"));
    env = {
        HOME: home,
        XDG_CACHE_HOME: join(home, "cache"),
        XDG_RUNTIME_DIR: join(home, "run"),
    };
});
afterEach(async () => {
    await rm(home, { recursive: true, force: true });
});

const note = (launch: string, pid = 100) => ({
    launch,
    pid,
    started: "2026-10-15T09:00:00.000Z",
    dir: "/work",
    session: S1,
    claude: "/home/u/.claude",
});

describe("launch notes", () => {
    it("keep a launch privately, beside nothing else in the runtime directory", async () => {
        await noteLaunch(env, note(LAUNCH));
        expect(await readLaunch(env, LAUNCH)).toEqual({
            v: 1,
            ...note(LAUNCH),
        });
        expect(launchesDir(env)).toBe(join(home, "run", "dorothy", "launches"));
        expect(
            (await stat(join(launchesDir(env), LAUNCH, "launch.json"))).mode &
                0o777,
        ).toBe(0o600);
        expect((await stat(join(launchesDir(env), LAUNCH))).mode & 0o777).toBe(
            0o700,
        );
    });

    it("fall back to the cache directory without a runtime directory", () => {
        expect(
            runtimeDir({ HOME: home, XDG_CACHE_HOME: join(home, "cache") }),
        ).toBe(join(home, "cache", "dorothy"));
    });

    it("refuse an id that is no uuid", async () => {
        await expect(noteLaunch(env, note("../x"))).rejects.toThrow(
            "not a launch id",
        );
        expect(await readLaunch(env, "../x")).toBeNull();
        expect(await liveSession(env, "../x")).toBeNull();
    });

    it("keep each session apart, the live one noted last, else the one named", async () => {
        await noteLaunch(env, note(LAUNCH));
        expect(await liveSession(env, LAUNCH)).toBe(S1);
        await noteSession(env, LAUNCH, {
            session: S2,
            transcript: "/t/2.jsonl",
            cwd: "/work",
            seen: "2026-10-15T09:02:00.000Z",
        });
        await noteSession(env, LAUNCH, {
            session: S1,
            transcript: "/t/1.jsonl",
            cwd: "/work",
            seen: "2026-10-15T09:01:00.000Z",
        });
        expect(
            (await launchSessions(env, LAUNCH)).map((s) => s.session),
        ).toEqual([S1, S2]);
        expect(await liveSession(env, LAUNCH)).toBe(S2);
    });

    it("have no live session once the one noted last has ended", async () => {
        await noteLaunch(env, note(LAUNCH));
        await noteSession(env, LAUNCH, {
            session: S1,
            transcript: "/t/1.jsonl",
            cwd: "/work",
            seen: "2026-10-15T09:01:00.000Z",
        });
        await noteSession(env, LAUNCH, {
            session: S2,
            transcript: "/t/2.jsonl",
            cwd: "/work",
            seen: "2026-10-15T09:02:00.000Z",
            ended: true,
        });
        expect(await liveSession(env, LAUNCH)).toBeNull();
        await noteSession(env, LAUNCH, {
            session: S2,
            transcript: "/t/2.jsonl",
            cwd: "/work",
            seen: "2026-10-15T09:03:00.000Z",
        });
        expect(await liveSession(env, LAUNCH)).toBe(S2);
    });

    it("find the launches whose dorothy is gone, and remove one", async () => {
        await noteLaunch(env, note(LAUNCH, 1));
        await noteLaunch(env, note(OTHER, 2));
        await mkdir(join(launchesDir(env), `.${S1}.tmp`), { recursive: true });
        expect(await staleLaunches(env, (pid) => pid === 2)).toEqual([LAUNCH]);
        await removeLaunch(env, LAUNCH);
        expect(await readLaunch(env, LAUNCH)).toBeNull();
        expect(await staleLaunches(env, () => false)).toEqual([OTHER]);
    });
});
