// vim:set expandtab shiftwidth=4 filetype=typescript:
// SPDX-License-Identifier: GPL-3.0-only

//
//
// ~chewygumxx/dorothy.git
// ::: :/packages/memory/src/recording/sweep-watermark.test.ts
//
//

import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { DEFAULT_CONFIG } from "@dorothy/core";
import { assistantLine, use, userLine } from "../bodies/fixtures.js";
import { copyPath, readRecord } from "../bodies/unread.js";
import { fakeEngine } from "../contract/testing.js";
import { noteRecorded, startJobs } from "../service/jobs.js";
import { at, call, context, line, message, meta, SESSION } from "./fixtures.js";
import { hermesCall, hermesMessage, hermesSession } from "./hermes-fixtures.js";
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
        // Hermes joins days on: its session, of the 20th, now precedes it.
        const result = await r.run({
            hosts: ["codex", "hermes"],
            now: () => new Date("2026-10-25T00:00:00.000Z"),
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

describe("a session whose mtime was refreshed", () => {
    // A copy or restore makes an old session look new: the mark is judged
    // by the events too. The first sweep is on the 24th; events are older.
    const first = () => new Date("2026-10-24T00:00:00.000Z");
    const fresh = -10 * 24 * HOUR;

    it("waits for the backfill when every event precedes the mark", async () => {
        await r.file(rollout("rollout-copied.jsonl"), speech, fresh);
        const [codex] = await r.run({ hosts: ["codex"], now: first });
        expect(codex).toMatchObject({ sessions: 0, waiting: 1, events: 0 });
        expect(r.requests).toEqual([]);
        // Remembered, so not read again by the next live sweep...
        const [again] = await r.run({ hosts: ["codex"], now: first });
        expect(again).toMatchObject({ skipped: 1, waiting: 0 });
        // ...yet the backfill still records it.
        const [filled] = await r.run({
            hosts: ["codex"],
            now: first,
            backfill: true,
        });
        expect(filled).toMatchObject({ sessions: 1, events: 1 });
    });

    it("waits for the backfill in Claude Code too", async () => {
        const path = join(
            r.home,
            ".claude/projects/-work",
            "0f8fad5b-d9cb-469f-a165-70867728950e.jsonl",
        );
        await r.file(
            path,
            `${userLine("u1", 0, "Synthetic question.")}\n`,
            fresh,
        );
        const [claude] = await r.run({ hosts: ["claude-code"], now: first });
        expect(claude).toMatchObject({ sessions: 0, waiting: 1 });
        expect(await r.conversations()).toEqual([]);
        const [filled] = await r.run({
            hosts: ["claude-code"],
            now: first,
            backfill: true,
        });
        expect(filled).toMatchObject({ sessions: 1, events: 1 });
    });

    it("records the whole session once one event follows the mark", async () => {
        await r.file(
            rollout("rollout-mixed.jsonl"),
            text(
                meta(),
                context(),
                message("user", "Synthetic question.", 1),
                message("assistant", "Synthetic answer.", 2),
            ),
            fresh,
        );
        const live = new Date("2026-10-20T09:00:01.500Z");
        // The mark falls between the session's two events (:01 and :02).
        const [codex] = await r.run({ hosts: ["codex"], now: () => live });
        expect(codex).toMatchObject({ sessions: 1, events: 2, waiting: 0 });
    });
});

describe("a waiting session whose read is incomplete", () => {
    // The first sweep falls inside the session: its first event is old, a
    // later one (or the call it waits on) is live. The reader may stop
    // before that later one, so the old prefix alone must not settle it.
    const codexMid = () => new Date("2026-10-20T09:00:01.500Z");
    const hermesMid = () => new Date("2026-10-20T10:00:01.500Z");
    const claudeMid = () => new Date("2026-10-15T09:00:30.000Z");
    const touched = (iso: string) => NOW.getTime() - Date.parse(iso);
    const bad = line(
        "response_item",
        { type: "message", role: "user", content: "not blocks" },
        2,
    );
    const hints = async () =>
        JSON.parse(await readFile(sweepPath(r.env), "utf8")).sessions;
    const claudePath = () =>
        join(r.home, ".claude/projects/-work", `${SESSION}.jsonl`);

    it("keeps a Codex halt after an old event, and does not remember it", async () => {
        await r.file(
            rollout("rollout-halt.jsonl"),
            text(meta(), context(), message("user", "Old.", 1), bad),
            touched("2026-10-20T09:00:03.000Z"),
        );
        const [codex] = await r.run({ hosts: ["codex"], now: codexMid });
        expect(codex).toMatchObject({ waiting: 1, halted: 1, sessions: 0 });
        expect(await readRecord(r.env, SESSION, "codex")).toMatchObject({
            line: 4,
        });
        expect(await hints()).toEqual({});
    });

    it("keeps a new type after an old event, and retries if it cannot be kept", async () => {
        await r.file(
            rollout("rollout-type.jsonl"),
            text(
                meta(),
                context(),
                message("user", "Old.", 1),
                line("future_type", { x: 1 }, 2),
            ),
            touched("2026-10-20T09:00:03.000Z"),
        );
        await mkdir(join(r.home, "state/dorothy"), { recursive: true });
        await writeFile(join(r.home, "state/dorothy/unread"), "in the way");
        const [blocked] = await r.run({ hosts: ["codex"], now: codexMid });
        expect(blocked).toMatchObject({ waiting: 1, sessions: 0 });
        expect(await hints()).toEqual({});
        await rm(join(r.home, "state/dorothy/unread"));
        const [mended] = await r.run({ hosts: ["codex"], now: codexMid });
        expect(mended).toMatchObject({ waiting: 1, skipped: 0 });
        expect(
            await readdir(join(r.home, "state/dorothy/unread/types")),
        ).toHaveLength(1);
        // Kept and complete, a waiting session is remembered at last.
        expect(Object.keys(await hints())).toHaveLength(1);
    });

    it("holds a Codex call, then records the session once it is over", async () => {
        await r.file(
            rollout("rollout-call.jsonl"),
            text(
                meta(),
                context(),
                message("user", "Old.", 1),
                call("function_call", "c1", "tool", "{}", 2),
            ),
            touched("2026-10-20T09:00:03.000Z"),
        );
        const [young] = await r.run({ hosts: ["codex"], now: codexMid });
        expect(young).toMatchObject({ waiting: 1, sessions: 0 });
        expect(await hints()).toEqual({});
        const over = () => new Date(codexMid().getTime() + 2 * HOUR);
        const [later] = await r.run({ hosts: ["codex"], now: over });
        expect(later).toMatchObject({ sessions: 1, events: 2, waiting: 0 });
    });

    it("holds a Hermes call, then records the session once it is over", async () => {
        await r.hermes((db) => {
            hermesSession(db);
            hermesMessage(db, 1, "user", "Old.");
            hermesMessage(db, 2, "assistant", null, {
                calls: JSON.stringify([hermesCall("lost")]),
            });
            hermesMessage(db, 3, "assistant", "After.");
        });
        const [young] = await r.run({ hosts: ["hermes"], now: hermesMid });
        expect(young).toMatchObject({ waiting: 1, sessions: 0 });
        expect(await hints()).toEqual({});
        const over = () => new Date(hermesMid().getTime() + 2 * HOUR);
        const [later] = await r.run({ hosts: ["hermes"], now: over });
        expect(later).toMatchObject({ sessions: 1, events: 3, waiting: 0 });
    });

    it("keeps a Hermes halt after an old event", async () => {
        await r.hermes((db) => {
            hermesSession(db);
            hermesMessage(db, 1, "user", "Old.");
            hermesMessage(db, 2, "user", "\0json:{");
        });
        const [hermes] = await r.run({ hosts: ["hermes"], now: hermesMid });
        expect(hermes).toMatchObject({ waiting: 1, halted: 1 });
        expect(
            await readRecord(r.env, "fixture-session", "hermes"),
        ).toMatchObject({ line: 2 });
        expect(await hints()).toEqual({});
    });

    it("holds a Claude call, then records the session once it is over", async () => {
        await r.file(
            claudePath(),
            `${[
                userLine("u1", 0, "Old."),
                assistantLine("a1", 1, [use("t1", "Bash", {})]),
            ].join("\n")}\n`,
            touched("2026-10-15T09:01:30.000Z"),
        );
        const [young] = await r.run({ hosts: ["claude-code"], now: claudeMid });
        expect(young).toMatchObject({ waiting: 1, sessions: 0 });
        expect(await hints()).toEqual({});
        const over = () => new Date(claudeMid().getTime() + 2 * HOUR);
        const [later] = await r.run({ hosts: ["claude-code"], now: over });
        expect(later).toMatchObject({ sessions: 1, waiting: 0 });
        const [conversation] = await r.conversations();
        expect(conversation?.map((event) => event.kind)).toEqual([
            "session",
            "user",
            "tool",
        ]);
    });

    it("keeps a Claude halt after an old event, and does not remember it", async () => {
        await r.file(
            claudePath(),
            `${[userLine("u1", 0, "Old."), "{torn but whole"].join("\n")}\n`,
            touched("2026-10-15T09:01:30.000Z"),
        );
        const [claude] = await r.run({
            hosts: ["claude-code"],
            now: claudeMid,
        });
        expect(claude).toMatchObject({ waiting: 1, halted: 1, sessions: 0 });
        expect(await readRecord(r.env, SESSION)).toMatchObject({ line: 2 });
        expect(await readFile(copyPath(r.env, SESSION), "utf8")).toBe(
            "{torn but whole\n",
        );
        expect(await hints()).toEqual({});
    });

    it("keeps a Claude new type after an old event", async () => {
        await r.file(
            claudePath(),
            `${[userLine("u1", 0, "Old."), JSON.stringify({ type: "future", sessionId: SESSION })].join("\n")}\n`,
            touched("2026-10-15T09:01:30.000Z"),
        );
        await r.run({ hosts: ["claude-code"], now: claudeMid });
        expect(
            await readdir(join(r.home, "state/dorothy/unread/types")),
        ).toHaveLength(1);
    });
});

describe("a private session that also waits", () => {
    // Privacy is decided before anything is kept aside or recorded, even
    // for a session the watermark would leave to the backfill.
    const CANARY = "SYNTHETIC_PRIVATE_CANARY";
    const touched = (iso: string) => NOW.getTime() - Date.parse(iso);
    const nothingKept = async () =>
        expect(await readdir(join(r.home, "state/dorothy"))).not.toContain(
            "unread",
        );

    it("keeps nothing of a Codex halt or new type", async () => {
        const bad = line(
            "response_item",
            { type: "message", role: "user", content: CANARY },
            2,
        );
        await r.file(
            rollout("rollout-secret.jsonl"),
            text(
                meta(),
                context(),
                message("user", "Old.", 1),
                bad,
                line("future_type", { note: CANARY }, 3),
            ),
            touched("2026-10-20T09:00:04.000Z"),
        );
        const asked: string[] = [];
        const [codex] = await r.run({
            hosts: ["codex"],
            now: () => new Date("2026-10-20T09:00:01.500Z"),
            isPrivate: ({ session }) => {
                asked.push(session);
                return true;
            },
        });
        expect(asked).toEqual([SESSION]);
        expect(codex).toMatchObject({ private: 1, halted: 0, sessions: 0 });
        await nothingKept();
        expect(await r.conversations()).toEqual([]);
    });

    it("keeps nothing of a Hermes halt", async () => {
        await r.hermes((db) => {
            hermesSession(db);
            hermesMessage(db, 1, "user", "Old.");
            hermesMessage(db, 2, "user", "\0json:{");
        });
        const asked: string[] = [];
        const [hermes] = await r.run({
            hosts: ["hermes"],
            now: () => new Date("2026-10-20T10:00:01.500Z"),
            isPrivate: ({ session }) => {
                asked.push(session);
                return true;
            },
        });
        expect(asked).toEqual(["fixture-session"]);
        expect(hermes).toMatchObject({ private: 1, halted: 0, sessions: 0 });
        await nothingKept();
    });

    it("keeps nothing of a Claude Code halt or new type", async () => {
        await r.file(
            join(r.home, ".claude/projects/-work", `${SESSION}.jsonl`),
            `${[
                userLine("u1", 0, "Old."),
                `{torn ${CANARY}`,
                JSON.stringify({ type: "future", note: CANARY }),
            ].join("\n")}\n`,
            touched("2026-10-15T09:01:30.000Z"),
        );
        const asked: string[] = [];
        const [claude] = await r.run({
            hosts: ["claude-code"],
            now: () => new Date("2026-10-15T09:00:30.000Z"),
            isPrivate: ({ session }) => {
                asked.push(session);
                return true;
            },
        });
        expect(asked).toEqual([SESSION]);
        expect(claude).toMatchObject({ private: 1, halted: 0, sessions: 0 });
        await nothingKept();
        expect(await r.conversations()).toEqual([]);
    });
});

describe("a session whose identity is unresolved", () => {
    // Its privacy cannot be decided, so none of its content is kept: a
    // halt is kept as a pointer alone, and no new type's example.
    const CANARY = "SYNTHETIC_UNNAMED_CANARY";
    const asked: string[] = [];
    const isPrivate = ({ session }: { session: string }) => {
        asked.push(session);
        return true;
    };
    beforeEach(() => {
        asked.length = 0;
    });
    const files = async (dir: string): Promise<string[]> => {
        const found: string[] = [];
        for (const entry of await readdir(dir, { withFileTypes: true })) {
            const path = join(dir, entry.name);
            if (entry.isDirectory()) found.push(...(await files(path)));
            else found.push(path);
        }
        return found;
    };
    const noCanary = async () => {
        for (const path of await files(join(r.home, "state")))
            expect(await readFile(path, "utf8")).not.toContain(CANARY);
    };
    const noTypes = async () =>
        expect(
            await readdir(join(r.home, "state/dorothy/unread")),
        ).not.toContain("types");

    it("keeps only a pointer to a Codex halt in its metadata", async () => {
        const path = await r.file(
            rollout("rollout-unnamed.jsonl"),
            text(
                line("session_meta", {
                    id: null,
                    cwd: "/fixture/project",
                    timestamp: at(0),
                }),
                context(),
                message("user", CANARY, 1),
                line("future_type", { note: CANARY }, 2),
            ),
            0,
        );
        const [codex] = await r.run({ hosts: ["codex"], isPrivate });
        expect(asked).toEqual([]);
        expect(codex).toMatchObject({ private: 0, halted: 1, sessions: 0 });
        await noCanary();
        await noTypes();
        expect(
            await readRecord(r.env, "rollout-unnamed", "codex"),
        ).toMatchObject({
            host: "codex",
            session: "rollout-unnamed",
            conversation: null,
            transcript: path,
            line: 1,
            type: null,
            uuid: null,
        });
        expect(
            await readFile(copyPath(r.env, "rollout-unnamed", "codex"), "utf8"),
        ).toBe(
            `${JSON.stringify({ key: JSON.stringify(["codex", path]), line: 1 })}\n`,
        );
        expect(r.requests).toEqual([]);
    });

    it("keeps only a pointer to a waiting Codex halt", async () => {
        const path = await r.file(
            rollout("rollout-unnamed.jsonl"),
            text(
                context(),
                message("user", "Old.", 1),
                line(
                    "response_item",
                    { type: "message", role: "user", content: CANARY },
                    2,
                ),
                line("future_type", { note: CANARY }, 3),
            ),
            NOW.getTime() - Date.parse("2026-10-20T09:00:04.000Z"),
        );
        const [codex] = await r.run({
            hosts: ["codex"],
            now: () => new Date("2026-10-20T09:00:01.500Z"),
            isPrivate,
        });
        expect(asked).toEqual([]);
        expect(codex).toMatchObject({ waiting: 1, halted: 1, sessions: 0 });
        await noCanary();
        await noTypes();
        expect(
            await readRecord(r.env, "rollout-unnamed", "codex"),
        ).toMatchObject({ line: 3, type: null, transcript: path });
        expect(
            await readFile(copyPath(r.env, "rollout-unnamed", "codex"), "utf8"),
        ).toBe(
            `${JSON.stringify({ key: JSON.stringify(["codex", path]), line: 3 })}\n`,
        );
    });

    it("keeps only a pointer to a Hermes halt", async () => {
        const path = join(r.home, ".hermes/state.db");
        const key = JSON.stringify(["hermes", path, null]);
        const [hermes] = await r.run({
            hosts: ["hermes"],
            isPrivate,
            sources: {
                hermes: {
                    host: "hermes",
                    list: async () => [
                        {
                            host: "hermes",
                            key,
                            path,
                            fingerprint: { kind: "rows", maxId: 3, count: 3 },
                            at: NOW.toISOString(),
                            read: async () => ({
                                kind: "hermes",
                                fingerprint: {
                                    kind: "rows",
                                    maxId: 3,
                                    count: 3,
                                },
                                stable: true,
                                read: {
                                    session: null,
                                    parent: null,
                                    source: null,
                                    cwd: null,
                                    model: null,
                                    at: null,
                                    events: [],
                                    halt: {
                                        id: 3,
                                        type: `role-${CANARY}`,
                                        reason: "no session id",
                                    },
                                    unknown: [
                                        { id: 2, type: `role-${CANARY}` },
                                    ],
                                    pending: null,
                                },
                            }),
                        },
                    ],
                },
            },
        });
        expect(asked).toEqual([]);
        expect(hermes).toMatchObject({ private: 0, halted: 1, sessions: 0 });
        await noCanary();
        await noTypes();
        expect(await readRecord(r.env, "state.db", "hermes")).toMatchObject({
            host: "hermes",
            transcript: path,
            line: 3,
            type: null,
        });
        expect(
            await readFile(copyPath(r.env, "state.db", "hermes"), "utf8"),
        ).toBe(`${JSON.stringify({ key, row: 3 })}\n`);
    });

    it("never arises for Claude Code, named by its transcript", async () => {
        await r.file(
            join(r.home, ".claude/projects/-work", `${SESSION}.jsonl`),
            `${[`{torn ${CANARY}`, JSON.stringify({ note: CANARY })].join("\n")}\n`,
            0,
        );
        const [claude] = await r.run({ hosts: ["claude-code"], isPrivate });
        expect(asked).toEqual([SESSION]);
        expect(claude).toMatchObject({ private: 1, halted: 0 });
        await noCanary();
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
            noteRecorded({ idle, backfilled }, c.phrase, c.backfilled, 0);
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

describe("a backfilled conversation that goes live", () => {
    it("is extracted once a live sweep adds to it", async () => {
        const path = await r.file(
            rollout("rollout-old.jsonl"),
            speech,
            5 * HOUR,
        );
        const idle = new Map<string, number>();
        const backfilled = new Set<string>();
        const onRecorded = (c: SweepConversation) => {
            r.recorded.push(c);
            noteRecorded({ idle, backfilled }, c.phrase, c.backfilled, 0);
        };
        await r.run({ hosts: ["codex"] });
        await r.run({ hosts: ["codex"], backfill: true, onRecorded });
        const phrase = r.recorded[0]?.phrase;
        expect(backfilled.has(phrase ?? "")).toBe(true);
        await r.append(path, text(message("assistant", "Synthetic live.", 2)));
        await r.run({ hosts: ["codex"], onRecorded });
        expect(backfilled.size).toBe(0);
        expect([...idle.keys()]).toEqual([phrase ?? ""]);
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
