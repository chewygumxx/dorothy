// vim:set expandtab shiftwidth=4 filetype=typescript:
// SPDX-License-Identifier: GPL-3.0-only

//
//
// ~chewygumxx/dorothy.git
// ::: :/packages/memory/src/recording/sweep-watermark.test.ts
//
//

import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { readdir, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { DEFAULT_CONFIG } from "@dorothy/core";
import { fakeEngine } from "../contract/testing.js";
import { startJobs } from "../service/jobs.js";
import { context, line, message, meta, SESSION } from "./fixtures.js";
import { hermesMessage, hermesSession } from "./hermes-fixtures.js";
import { sweepPath } from "./state.js";
import type { SweepConversation } from "./sweep.js";
import { HOUR, NOW, type Rig, rig } from "./sweep-testing.js";
import { watermarkPath } from "./watermark.js";

let r: Rig;
beforeEach(async () => {
    r = await rig();
});
afterEach(async () => {
    await r.close();
});

const rollout = (name: string) =>
    join(r.home, ".codex/sessions/2026/10/20", name);
const text = (...lines: string[]) => `${lines.join("\n")}\n`;
const speech = text(
    meta(),
    context(),
    message("user", "Synthetic question.", 1),
);
const later = (hours: number) => () => new Date(NOW.getTime() + hours * HOUR);
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

describe("the watermark", () => {
    it("is a host's first sweep time, in the data directory", async () => {
        await r.hermes((db) => hermesSession(db));
        await r.run({ hosts: ["codex", "hermes"] });
        expect(
            JSON.parse(await readFile(watermarkPath(r.store.root), "utf8")),
        ).toEqual({
            v: 1,
            watermarks: {
                codex: NOW.toISOString(),
                hermes: NOW.toISOString(),
            },
        });
        expect(r.commits).toContain("recording: codex watermark");
        await r.run({ hosts: ["codex"], now: later(5) });
        expect(
            JSON.parse(await readFile(watermarkPath(r.store.root), "utf8"))
                .watermarks.codex,
        ).toBe(NOW.toISOString());
    });

    it("leaves a session that ended before it for the backfill", async () => {
        await r.file(rollout("rollout-old.jsonl"), speech, HOUR);
        const [codex] = await r.run({ hosts: ["codex"] });
        expect(codex).toMatchObject({ sessions: 0, waiting: 1, events: 0 });
        expect(r.requests).toEqual([]);
        expect(await r.conversations()).toEqual([]);
    });

    it("records a session with events after it whole, old ones too", async () => {
        const path = await r.file(rollout("rollout-live.jsonl"), speech, HOUR);
        await r.run({ hosts: ["codex"] });
        await r.append(
            path,
            text(message("assistant", "Synthetic answer.", 2)),
        );
        const [codex] = await r.run({ hosts: ["codex"] });
        expect(codex).toMatchObject({ sessions: 1, events: 2, waiting: 0 });
    });

    it("holds when sweep.json is lost, so old sessions still wait", async () => {
        await r.file(rollout("rollout-old.jsonl"), speech, HOUR);
        await r.run({ hosts: ["codex"] });
        await rm(sweepPath(r.env), { force: true });
        const [codex] = await r.run({ hosts: ["codex"], now: later(3) });
        expect(codex).toMatchObject({ waiting: 1, sessions: 0 });
    });

    it("is kept per host", async () => {
        await r.file(rollout("rollout-one.jsonl"), speech, 0);
        await r.run({ hosts: ["codex"] });
        await r.hermes((db) => {
            hermesSession(db);
            hermesMessage(db, 1, "user", "Synthetic question.");
        });
        // Hermes joins a day on: its session, from 10:00, now precedes it.
        const result = await r.run({
            hosts: ["codex", "hermes"],
            now: later(24),
        });
        expect(result.map((each) => each.waiting)).toEqual([0, 1]);
    });

    it("treats a Hermes session by its last message", async () => {
        await r.hermes((db) => {
            hermesSession(db);
            hermesMessage(db, 1, "user", "Synthetic question.");
        });
        const [hermes] = await r.run({ hosts: ["hermes"] });
        expect(hermes).toMatchObject({ sessions: 1, waiting: 0 });
    });
});

describe("the backfill", () => {
    it("records every session regardless of the watermark, marked backfilled", async () => {
        await r.file(rollout("rollout-old.jsonl"), speech, 5 * HOUR);
        await r.run({ hosts: ["codex"] });
        expect(r.recorded).toEqual([]);
        const [codex] = await r.run({ hosts: ["codex"], backfill: true });
        expect(codex).toMatchObject({ sessions: 1, events: 1, waiting: 0 });
        expect(r.recorded).toMatchObject([
            { host: "codex", session: SESSION, backfilled: true, accepted: 1 },
        ]);
        expect(await r.conversations()).toHaveLength(1);
    });

    it("does not mark a live sweep's sessions", async () => {
        await r.file(rollout("rollout-live.jsonl"), speech, 0);
        await r.run({ hosts: ["codex"] });
        expect(r.recorded).toMatchObject([{ backfilled: false }]);
    });

    it("records nothing twice, whichever sweep came first", async () => {
        await r.file(rollout("rollout-live.jsonl"), speech, 0);
        await r.run({ hosts: ["codex"] });
        await rm(sweepPath(r.env));
        const [codex] = await r.run({ hosts: ["codex"], backfill: true });
        expect(codex).toMatchObject({ sessions: 0, events: 0 });
        expect((await r.conversations())[0]).toHaveLength(2);
    });

    it("is passed over by extraction, while a live session is extracted", async () => {
        await r.file(rollout("rollout-old.jsonl"), speech, 5 * HOUR);
        await r.run({ hosts: ["codex"] });
        await r.hermes((db) => {
            hermesSession(db);
            hermesMessage(db, 1, "user", "Synthetic question.");
        });
        const engine = fakeEngine();
        const idle = new Map<string, number>();
        const backfilled = new Set<string>();
        const onRecorded = (c: SweepConversation) => {
            r.recorded.push(c);
            if (c.backfilled) backfilled.add(c.phrase);
            else idle.set(c.phrase, 0);
        };
        await r.run({ hosts: ["codex"], backfill: true, onRecorded });
        await r.run({ hosts: ["hermes"], onRecorded });
        const jobs = startJobs({
            config: {
                ...DEFAULT_CONFIG,
                memory: { ...DEFAULT_CONFIG.memory, idleSeconds: 0 },
            },
            engine,
            store: r.store,
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
        const live = r.recorded.find((each) => !each.backfilled)?.phrase;
        expect(live).toBeDefined();
        expect(r.recorded.map((each) => each.host)).toEqual([
            "codex",
            "hermes",
        ]);
        expect(
            engine.calls.filter((call) => call.startsWith("extract")),
        ).toEqual([`extract ${live}`]);
        expect(backfilled.size).toBe(1);
    });
});

describe("private sessions", () => {
    it("are not recorded, asked of the contract by its flag", async () => {
        await r.file(rollout("rollout-secret.jsonl"), speech, 0);
        const [codex] = await r.run({
            hosts: ["codex"],
            isPrivate: ({ host, session, cwd }) =>
                host === "codex" &&
                session === SESSION &&
                cwd === "/fixture/project",
        });
        expect(codex).toMatchObject({ private: 1, sessions: 0, events: 0 });
        expect(r.requests).toEqual([
            { host: "codex", session: SESSION, private: true },
        ]);
        expect(await r.conversations()).toEqual([]);
        expect(r.recorded).toEqual([]);
    });

    it("keep nothing aside, though their records are unreadable", async () => {
        const bad = line(
            "response_item",
            { type: "message", role: "user", content: "not blocks" },
            3,
        );
        await r.file(rollout("rollout-secret.jsonl"), `${speech}${bad}\n`, 0);
        await r.run({ hosts: ["codex"], isPrivate: () => true });
        expect(await readdir(join(r.home, "state/dorothy"))).not.toContain(
            "unread",
        );
    });
});
