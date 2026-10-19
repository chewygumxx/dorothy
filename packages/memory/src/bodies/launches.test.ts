// vim:set expandtab shiftwidth=4 filetype=typescript:
// SPDX-License-Identifier: GPL-3.0-only

//
//
// ~chewygumxx/dorothy.git
// ::: :/packages/memory/src/bodies/launches.test.ts
//
//

import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import {
    mkdir,
    mkdtemp,
    readdir,
    rm,
    stat,
    utimes,
    writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
    launchesDir,
    launchHolds,
    launchSessions,
    legacyLaunchesDir,
    liveSession,
    noteLaunch,
    noteSession,
    readBootId,
    readLaunch,
    removeLaunch,
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
        XDG_STATE_HOME: join(home, "state"),
        XDG_RUNTIME_DIR: join(home, "run"),
    };
});
afterEach(async () => {
    await rm(home, { recursive: true, force: true });
});

const BOOT = { boot: async () => "boot-a" };
const LIVE = { ...BOOT, alive: () => true };

// An earlier Dorothy's note, in the runtime directory.
const legacyEnv = () => ({ ...env, XDG_STATE_HOME: join(home, "run") });

const note = (launch: string, pid = 100) => ({
    launch,
    pid,
    started: "2026-10-15T09:00:00.000Z",
    dir: "/work",
    session: S1,
    claude: "/home/u/.claude",
});

describe("launch notes", () => {
    it("keep a launch privately in the state directory, with its boot", async () => {
        await noteLaunch(env, note(LAUNCH), BOOT);
        expect(await readLaunch(env, LAUNCH)).toEqual({
            v: 1,
            ...note(LAUNCH),
            boot: "boot-a",
        });
        expect(launchesDir(env)).toBe(
            join(home, "state", "dorothy", "launches"),
        );
        expect(
            (await stat(join(launchesDir(env), LAUNCH, "launch.json"))).mode &
                0o777,
        ).toBe(0o600);
        expect((await stat(join(launchesDir(env), LAUNCH))).mode & 0o777).toBe(
            0o700,
        );
    });

    it("note no boot where the system gives none", async () => {
        await noteLaunch(env, note(LAUNCH), { boot: async () => null });
        expect(await readLaunch(env, LAUNCH)).toEqual({
            v: 1,
            ...note(LAUNCH),
        });
    });

    it("read the boot id from the file the system gives, else none", async () => {
        const path = join(home, "boot_id");
        await writeFile(path, "6c84fb90-12c4-11e1\n");
        expect(await readBootId(path)).toBe("6c84fb90-12c4-11e1");
        await writeFile(path, "\n");
        expect(await readBootId(path)).toBeNull();
        expect(await readBootId(join(home, "none"))).toBeNull();
    });

    it("look for old notes where the runtime directory was, else the cache", () => {
        expect(legacyLaunchesDir(env)).toBe(
            join(home, "run", "dorothy", "launches"),
        );
        expect(
            legacyLaunchesDir({
                HOME: home,
                XDG_CACHE_HOME: join(home, "cache"),
            }),
        ).toBe(join(home, "cache", "dorothy", "launches"));
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

    it("hold a session noted and not ended, or named and not noted", async () => {
        expect(await launchHolds(env, S1, LIVE)).toBe(false);
        await noteLaunch(env, note(LAUNCH), BOOT);
        expect(await launchHolds(env, S1, LIVE)).toBe(true);
        expect(await launchHolds(env, S2, LIVE)).toBe(false);
        await noteSession(env, LAUNCH, {
            session: S2,
            transcript: "/t/2.jsonl",
            cwd: "/work",
            seen: "2026-10-15T09:01:00.000Z",
        });
        expect(await launchHolds(env, S2, LIVE)).toBe(true);
        await noteSession(env, LAUNCH, {
            session: S1,
            transcript: "/t/1.jsonl",
            cwd: "/work",
            seen: "2026-10-15T09:02:00.000Z",
            ended: true,
        });
        expect(await launchHolds(env, S1, LIVE)).toBe(false);
        await removeLaunch(env, LAUNCH);
        expect(await launchHolds(env, S2, LIVE)).toBe(false);
    });

    it("find the launches whose dorothy is gone, and remove one", async () => {
        await noteLaunch(env, note(LAUNCH, 1), BOOT);
        await noteLaunch(env, note(OTHER, 2), BOOT);
        await mkdir(join(launchesDir(env), `.${S1}.tmp`), { recursive: true });
        expect(
            await staleLaunches(env, { ...BOOT, alive: (pid) => pid === 2 }),
        ).toEqual([LAUNCH]);
        await removeLaunch(env, LAUNCH);
        expect(await readLaunch(env, LAUNCH)).toBeNull();
        expect(
            await staleLaunches(env, { ...BOOT, alive: () => false }),
        ).toEqual([OTHER]);
    });

    it("are stale in another boot, whatever their pid", async () => {
        await noteLaunch(env, note(LAUNCH), BOOT);
        const alive = { alive: () => true };
        expect(await staleLaunches(env, { ...alive, ...BOOT })).toEqual([]);
        expect(
            await staleLaunches(env, { ...alive, boot: async () => "boot-b" }),
        ).toEqual([LAUNCH]);
        // Without an id to compare, only the pid tells.
        expect(
            await staleLaunches(env, { ...alive, boot: async () => null }),
        ).toEqual([]);
        await noteLaunch(env, note(OTHER), { boot: async () => null });
        expect(
            await staleLaunches(env, { ...alive, boot: async () => "boot-b" }),
        ).toEqual([LAUNCH]);
    });

    it("read a pid of 0 or below as gone, as it names no process", async () => {
        await noteLaunch(env, note(LAUNCH, 0), BOOT);
        await noteLaunch(env, note(OTHER, -1), BOOT);
        expect(await staleLaunches(env, BOOT)).toEqual([LAUNCH, OTHER]);
        expect(await launchHolds(env, S1, BOOT)).toBe(false);
    });

    it("hold no session of a launch that is over", async () => {
        await noteLaunch(env, note(LAUNCH, 1), BOOT);
        await noteLaunch(env, note(OTHER, 2), BOOT);
        const live = { ...BOOT, alive: (pid: number) => pid === 2 };
        expect(await launchHolds(env, S1, live)).toBe(true);
        await noteSession(env, OTHER, {
            session: S2,
            transcript: "/t/2.jsonl",
            cwd: "/work",
            seen: "2026-10-15T09:01:00.000Z",
        });
        await removeLaunch(env, OTHER);
        expect(await launchHolds(env, S1, live)).toBe(false);
        expect(await launchHolds(env, S1, { ...BOOT, alive: () => true })).toBe(
            true,
        );
    });

    it("do not make a launch again that a catch-up removed", async () => {
        await noteLaunch(env, note(LAUNCH), BOOT);
        await removeLaunch(env, LAUNCH);
        await expect(
            noteSession(env, LAUNCH, {
                session: S1,
                transcript: "/t/1.jsonl",
                cwd: "/work",
                seen: "2026-10-15T09:01:00.000Z",
            }),
        ).rejects.toThrow();
        expect(await readdir(launchesDir(env))).toEqual([]);
        expect(await staleLaunches(env, BOOT)).toEqual([]);
    });

    it("reap the temporary directory a crash left, once it is old", async () => {
        const old = join(launchesDir(env), `.${S1}.tmp`);
        const fresh = join(launchesDir(env), `.${S2}.tmp`);
        await mkdir(join(old, "sessions"), { recursive: true });
        await mkdir(fresh, { recursive: true });
        await utimes(old, 1, 1);
        await noteLaunch(env, note(LAUNCH), BOOT);
        expect((await readdir(launchesDir(env))).sort()).toEqual(
            [`.${S2}.tmp`, LAUNCH].sort(),
        );
    });

    it("are none under another launch's or session's name", async () => {
        await noteLaunch(env, note(LAUNCH), BOOT);
        await noteLaunch(env, note(OTHER), BOOT);
        await writeFile(
            join(launchesDir(env), LAUNCH, "launch.json"),
            `${JSON.stringify({ v: 1, ...note(OTHER) })}\n`,
        );
        expect(await readLaunch(env, LAUNCH)).toBeNull();
        expect(
            await staleLaunches(env, { ...BOOT, alive: () => true }),
        ).toEqual([LAUNCH]);
        const sessions = join(launchesDir(env), OTHER, "sessions");
        const body = (session: string) =>
            `${JSON.stringify({ v: 1, session, transcript: "/t", cwd: "/w", seen: "2026-10-15T09:01:00.000Z" })}\n`;
        await writeFile(join(sessions, `${S1}.json`), body(S2));
        await writeFile(join(sessions, "x.json"), body("x"));
        await writeFile(join(sessions, `${S2}.json`), body(S2));
        expect(
            (await launchSessions(env, OTHER)).map((one) => one.session),
        ).toEqual([S2]);
    });

    it("are read once more where an earlier Dorothy left them, and caught up", async () => {
        const before = legacyEnv();
        await noteLaunch(before, note(LAUNCH, 1), BOOT);
        await noteLaunch(env, note(OTHER, 2), BOOT);
        expect(await readdir(launchesDir(env))).toEqual([OTHER]);
        const gone = { ...BOOT, alive: (pid: number) => pid === 2 };
        expect(await staleLaunches(env, gone)).toEqual([LAUNCH]);
        // Read and written where they are, and not moved.
        expect((await readLaunch(env, LAUNCH))?.pid).toBe(1);
        await noteSession(env, LAUNCH, {
            session: S2,
            transcript: "/t/2.jsonl",
            cwd: "/work",
            seen: "2026-10-15T09:01:00.000Z",
        });
        expect(
            (await launchSessions(env, LAUNCH)).map((one) => one.session),
        ).toEqual([S2]);
        expect(await readdir(launchesDir(env))).toEqual([OTHER]);
        await removeLaunch(env, LAUNCH);
        expect(await readdir(legacyLaunchesDir(env))).toEqual([]);
        expect(await staleLaunches(env, gone)).toEqual([]);
    });
});
