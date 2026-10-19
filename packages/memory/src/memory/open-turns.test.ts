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
