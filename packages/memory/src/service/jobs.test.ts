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
