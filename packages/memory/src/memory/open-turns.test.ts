// vim:set expandtab shiftwidth=4 filetype=typescript:
// SPDX-License-Identifier: GPL-3.0-only

//
//
// ~chewygumxx/dorothy.git
// ::: :/packages/memory/src/memory/open-turns.test.ts
//
//

import { describe, expect, it } from "bun:test";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { type ChatSession, newPhrase } from "@dorothy/core";
import {
    CLUSTERED,
    HISTORY,
    harness,
    settle,
    until,
} from "../compaction/testing.js";
import { FakeSession } from "./fake-session.js";
import {
    mergeNotices,
    notesReady,
    projectSyncer,
    sessionMaker,
    turnCommitter,
    withTurnEnd,
} from "./open.js";
import { dir, useXdgDir } from "./open-testing.js";

useXdgDir();

describe("sessionMaker", () => {
    it("tells memory of a message as it is sent, so a review can't take the claim while compaction holds it", () => {
        const log: string[] = [];
        const inner: ChatSession = {
            subscribe: () => () => {},
            send: (text) => log.push(`inner ${text}`),
            interrupt: async () => {},
            close: async () => {},
        };
        // Past hard: every message is held for the compaction under way.
        const compaction = {
            session: (
                _turns: unknown,
                connect: (seed: {
                    turns: never[];
                    clusters: never[];
                }) => ChatSession,
            ): ChatSession => ({
                ...connect({ turns: [], clusters: [] }),
                send: (text) => log.push(`held ${text}`),
            }),
        };
        const create = sessionMaker({
            compaction,
            connect: () => inner,
            clusters: [],
            memory: {
                sent: (text) => log.push(`memory ${text}`),
                ready: () => {},
                turnEnded: () => {},
            },
        });
        create([]).send("next");
        expect(log).toEqual(["memory next", "held next"]);
    });
});

describe("sessionMaker with a real Compaction", () => {
    it("tells memory of each send, ready and turn-end across a handover, after compaction's idle wait is armed", async () => {
        const { compaction, timers, calls, events } = harness();
        const log: string[] = [];
        const inners: FakeSession[] = [];
        const create = sessionMaker({
            compaction,
            connect: () => {
                const inner = new FakeSession();
                inners.push(inner);
                return inner;
            },
            clusters: [],
            memory: {
                sent: (text) => log.push(`sent ${text}`),
                ready: () => log.push("ready"),
                // Compaction's idle wait must be armed first, so that at a
                // shared idle it runs before the review.
                turnEnded: () =>
                    log.push(`turn-end, ${timers.pending.size} wait`),
            },
        });
        const session = create(HISTORY);
        session.subscribe((event) => events.push(event));
        const first = inners[0] as FakeSession;
        session.send("one");
        first.emit({ type: "ready", model: "m", sdkSessionId: "s" });
        first.emit({
            type: "turn-end",
            reply: "abcd",
            interrupted: false,
            contextTokens: 150,
            stats: {
                inputTokens: 1,
                cacheReadTokens: 0,
                cacheWriteTokens: 0,
                outputTokens: 1,
                ttftMs: null,
                durationMs: 1,
                costUsd: 0,
                sessionCostUsd: 0,
            },
        });
        expect(log).toEqual(["sent one", "ready", "turn-end, 1 wait"]);

        // The idle wait ends and compaction hands over to a second session.
        timers.advance(1000);
        await until(() => calls.length === 1);
        calls[0]?.answer(CLUSTERED);
        await until(() => inners.length === 2);
        await settle();
        const second = inners[1] as FakeSession;
        expect(events.map((event) => event.type)).toContain("compacted");
        session.send("two");
        second.emit({ type: "ready", model: "m", sdkSessionId: "t" });
        expect(second.sent).toEqual(["two"]);
        expect(log.slice(3)).toEqual(["sent two", "ready"]);
        await session.close();
    });
});

describe("notesReady", () => {
    it("refuses compaction once the notes became unreadable after launch", async () => {
        const phrase = newPhrase();
        expect(await notesReady(dir, phrase)).toEqual({ ok: true });
        await writeFile(join(dir, `${phrase}.meta.json`), "{");
        const ready = await notesReady(dir, phrase);
        expect(ready.ok).toBe(false);
        expect(ready.ok ? "" : ready.reason).toStartWith(
            "its notes can't be read (",
        );
    });
});

describe("withTurnEnd", () => {
    it("tells history of each turn's end after memory", () => {
        const log: string[] = [];
        const hooks = withTurnEnd(
            {
                sent: (text) => log.push(`sent ${text}`),
                ready: () => log.push("ready"),
                turnEnded: () => log.push("memory"),
            },
            () => log.push("history"),
        );
        hooks?.sent("hi");
        hooks?.ready();
        hooks?.turnEnded();
        expect(log).toEqual(["sent hi", "ready", "memory", "history"]);
        const alone = withTurnEnd(null, () => log.push("alone"));
        alone?.turnEnded();
        expect(log.at(-1)).toBe("alone");
        expect(withTurnEnd(null, null)).toBeNull();
    });
});

describe("turnCommitter", () => {
    it("commits each turn once its transcript is flushed, in order", async () => {
        const log: string[] = [];
        const turns = turnCommitter(
            {
                turn: async (...args) => {
                    log.push(`turn ${args.join(" ")}`);
                },
                warn: (message) => log.push(message),
            },
            "/data/x.jsonl",
            async () => {
                await new Promise((resolve) => setTimeout(resolve, 5));
                log.push("flushed");
            },
        );
        turns.ended();
        turns.ended();
        await turns.settled();
        expect(log).toEqual([
            "flushed",
            "turn /data/x.jsonl",
            "flushed",
            "turn /data/x.jsonl",
        ]);
    });

    it("warns rather than throws when a turn can't be committed", async () => {
        const warnings: string[] = [];
        const turns = turnCommitter(
            {
                turn: async () => {
                    throw new Error("locked");
                },
                warn: (message) => warnings.push(message),
            },
            "/data/x.jsonl",
            async () => {},
        );
        turns.ended();
        await turns.settled();
        expect(warnings).toEqual(["history: couldn't commit turn (locked)"]);
    });
});

describe("projectSyncer", () => {
    it("runs one sync at a time, and once more for any asked meanwhile", async () => {
        const gate = Promise.withResolvers<void>();
        let runs = 0;
        const syncer = projectSyncer(
            async () => {
                runs += 1;
                if (runs === 1) {
                    await gate.promise;
                }
                return { kind: "not-a-repository" };
            },
            () => {},
        );
        syncer.run();
        syncer.run();
        syncer.run();
        gate.resolve();
        await syncer.settled();
        expect(runs).toBe(2);
    });

    it("warns of a failure, never throwing", async () => {
        const warned: string[] = [];
        const syncer = projectSyncer(
            async () => ({ kind: "failed", reason: "a conflict" }),
            (message) => warned.push(message),
        );
        syncer.run();
        await syncer.settled();
        expect(warned).toEqual(["sync: a conflict"]);
    });
});

describe("mergeNotices", () => {
    it("listens to every source, and stops listening to all", () => {
        const listeners: ((notice: {
            type: "warning";
            message: string;
        }) => void)[] = [];
        let off = 0;
        const source = {
            subscribe: (
                listener: (notice: {
                    type: "warning";
                    message: string;
                }) => void,
            ) => {
                listeners.push(listener);
                return () => {
                    off += 1;
                };
            },
        };
        const seen: unknown[] = [];
        const merged = mergeNotices(source, null, source);
        const stop = merged?.subscribe((notice) => seen.push(notice));
        for (const listener of listeners) {
            listener({ type: "warning", message: "w" });
        }
        expect(seen).toHaveLength(2);
        stop?.();
        expect(off).toBe(2);
        expect(mergeNotices(null, undefined)).toBeUndefined();
        expect(mergeNotices(source)).toBe(source);
    });
});
