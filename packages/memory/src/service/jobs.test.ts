// vim:set expandtab shiftwidth=4 filetype=typescript:
// SPDX-License-Identifier: GPL-3.0-only

//
//
// ~chewygumxx/dorothy.git
// ::: :/packages/memory/src/service/jobs.test.ts
//
//

import { describe, expect, it } from "bun:test";
import { DEFAULT_CONFIG } from "@dorothy/core";
import { fakeEngine } from "../contract/testing.js";
import type { HostSweep } from "../recording/sweep.js";
import { noteRecorded, startJobs } from "./jobs.js";

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

describe("extraction of idle conversations", () => {
    it("extracts those recorded and passes over the backfilled", async () => {
        const engine = fakeEngine();
        const idle = new Map([
            ["live-one", 0],
            ["old-one", 0],
        ]);
        const backfilled = new Set(["old-one"]);
        const warnings: string[] = [];
        const jobs = startJobs({
            config: {
                ...DEFAULT_CONFIG,
                memory: { ...DEFAULT_CONFIG.memory, idleSeconds: 0 },
            },
            engine,
            store: { root: "/unused", lock: (work) => work(), recorder: null },
            idle,
            backfilled,
            touched: new Set(),
            loadCatalogue: null,
            warn: (message) => warnings.push(message),
            tickMs: 5,
        });
        try {
            for (let tries = 0; idle.size > 0 && tries < 100; tries++)
                await sleep(5);
        } finally {
            jobs.stop();
        }
        expect(
            engine.calls.filter((call) => call.startsWith("extract")),
        ).toEqual(["extract live-one"]);
        expect(idle.size).toBe(0);
        expect(warnings).toEqual([]);
    });
    it("passes over one marked after the service began, not yet due", async () => {
        const engine = fakeEngine();
        const idle = new Map<string, number>();
        const backfilled = new Set<string>();
        const jobs = startJobs({
            config: {
                ...DEFAULT_CONFIG,
                memory: { ...DEFAULT_CONFIG.memory, idleSeconds: 0 },
            },
            engine,
            store: { root: "/unused", lock: (work) => work(), recorder: null },
            idle,
            backfilled,
            touched: new Set(),
            loadCatalogue: null,
            warn: () => {},
            tickMs: 5,
        });
        try {
            await sleep(20);
            backfilled.add("late");
            idle.set("late", 0);
            for (let tries = 0; idle.size > 0 && tries < 100; tries++)
                await sleep(5);
        } finally {
            jobs.stop();
        }
        expect(engine.calls).toEqual([]);
        expect(idle.size).toBe(0);
    });
    it("extracts a backfilled conversation once it gains live turns", async () => {
        const engine = fakeEngine();
        const idle = new Map<string, number>();
        const backfilled = new Set<string>();
        noteRecorded({ idle, backfilled }, "old-one", true, 0);
        expect(backfilled.has("old-one")).toBe(true);
        expect(idle.size).toBe(0);
        noteRecorded({ idle, backfilled }, "old-one", false, 0);
        expect(backfilled.size).toBe(0);
        expect([...idle.keys()]).toEqual(["old-one"]);
        const jobs = startJobs({
            config: {
                ...DEFAULT_CONFIG,
                memory: { ...DEFAULT_CONFIG.memory, idleSeconds: 0 },
            },
            engine,
            store: { root: "/unused", lock: (work) => work(), recorder: null },
            idle,
            backfilled,
            touched: new Set(),
            loadCatalogue: null,
            warn: () => {},
            tickMs: 5,
        });
        try {
            for (let tries = 0; idle.size > 0 && tries < 100; tries++)
                await sleep(5);
        } finally {
            jobs.stop();
        }
        expect(engine.calls).toEqual(["extract old-one"]);
    });
    it("does not hold back a live conversation a backfill reaches", () => {
        const idle = new Map([["live-one", 5]]);
        const backfilled = new Set<string>();
        noteRecorded({ idle, backfilled }, "live-one", true, 9);
        expect(backfilled.size).toBe(0);
        expect(idle.get("live-one")).toBe(5);
    });
});

const swept = (host: HostSweep["host"], events: number): HostSweep => ({
    host,
    sessions: 1,
    events,
    skipped: 0,
    waiting: 0,
    private: 0,
    halted: 0,
    failed: 0,
    error: null,
});

describe("the sweep", () => {
    const start = (
        sweep: () => Promise<HostSweep[]>,
        said: { info: string[]; warn: string[] },
        everyMs = 10_000,
    ) =>
        startJobs({
            config: DEFAULT_CONFIG,
            engine: fakeEngine(),
            store: { root: "/unused", lock: (work) => work(), recorder: null },
            idle: new Map(),
            backfilled: new Set(),
            touched: new Set(),
            loadCatalogue: null,
            info: (message) => said.info.push(message),
            warn: (message) => said.warn.push(message),
            tickMs: 1000,
            sweep: { run: sweep, everyMs },
        });

    it("runs at start and on its interval, and logs a line each time", async () => {
        const said = { info: [] as string[], warn: [] as string[] };
        let count = 0;
        const jobs = start(async () => [swept("codex", ++count)], said, 10);
        try {
            for (let tries = 0; said.info.length < 3 && tries < 200; tries++)
                await sleep(5);
        } finally {
            await jobs.stop();
        }
        expect(said.info.slice(0, 3)).toEqual([
            "recording: swept codex: 1 event in 1 session",
            "recording: swept codex: 2 events in 1 session",
            "recording: swept codex: 3 events in 1 session",
        ]);
        expect(said.warn).toEqual([]);
    });

    it("keeps unchanged and waiting sweep counts out of the log", async () => {
        const said = { info: [] as string[], warn: [] as string[] };
        let count = 0;
        const jobs = start(
            async () => {
                count++;
                return [
                    {
                        ...swept("codex", 0),
                        sessions: 0,
                        waiting: 970,
                        skipped: 20,
                    },
                ];
            },
            said,
            5,
        );
        try {
            for (let tries = 0; count < 3 && tries < 100; tries++)
                await sleep(5);
        } finally {
            await jobs.stop();
        }
        expect(count).toBeGreaterThanOrEqual(3);
        expect(said.info).toEqual([]);
    });

    for (const kind of ["halted", "failed"] as const)
        it(`logs a sweep with ${kind} sessions but no events`, async () => {
            const said = { info: [] as string[], warn: [] as string[] };
            const jobs = start(
                async () => [{ ...swept("codex", 0), sessions: 0, [kind]: 1 }],
                said,
            );
            try {
                for (
                    let tries = 0;
                    said.info.length === 0 && tries < 100;
                    tries++
                )
                    await sleep(5);
            } finally {
                await jobs.stop();
            }
            expect(said.info).toHaveLength(1);
        });

    it("never runs two at once", async () => {
        const said = { info: [] as string[], warn: [] as string[] };
        let running = 0;
        let most = 0;
        let count = 0;
        const jobs = start(
            async () => {
                running += 1;
                most = Math.max(most, running);
                await sleep(30);
                running -= 1;
                return [swept("codex", ++count)];
            },
            said,
            5,
        );
        try {
            for (let tries = 0; count < 3 && tries < 200; tries++)
                await sleep(5);
        } finally {
            await jobs.stop();
        }
        expect(count).toBeGreaterThanOrEqual(3);
        expect(most).toBe(1);
    });

    it("says a sweep that fails, and sweeps again", async () => {
        const said = { info: [] as string[], warn: [] as string[] };
        let count = 0;
        const jobs = start(
            async () => {
                count += 1;
                if (count === 1) throw new Error("injected");
                return [swept("hermes", 0)];
            },
            said,
            10,
        );
        try {
            for (let tries = 0; said.info.length < 1 && tries < 200; tries++)
                await sleep(5);
        } finally {
            await jobs.stop();
        }
        expect(said.warn).toEqual(["recording: sweep failed: injected"]);
        expect(said.info[0]).toBe(
            "recording: swept hermes: 0 events in 1 session",
        );
    });

    it("waits for a sweep under way when stopped", async () => {
        const said = { info: [] as string[], warn: [] as string[] };
        let finished = false;
        const jobs = start(async () => {
            await sleep(40);
            finished = true;
            return [];
        }, said);
        await sleep(5);
        await jobs.stop();
        expect(finished).toBe(true);
    });
});
