// vim:set expandtab shiftwidth=4 filetype=typescript:
// SPDX-License-Identifier: GPL-3.0-only

//
//
// ~chewygumxx/dorothy.git
// ::: :/src/tui/run.test.ts
//
//

import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ChatSession } from "../conversation.js";
import { newPhrase } from "../session-id.js";
import {
    clusterSaver,
    indexClaims,
    notesReady,
    runTui,
    sessionMaker,
} from "./run.js";

let dir = "";
let saved: string | undefined;
beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "dorothy-run-"));
    saved = process.env.XDG_DATA_HOME;
    process.env.XDG_DATA_HOME = dir;
});
afterEach(async () => {
    if (saved === undefined) {
        delete process.env.XDG_DATA_HOME;
    } else {
        process.env.XDG_DATA_HOME = saved;
    }
    await rm(dir, { recursive: true, force: true });
});

describe("runTui", () => {
    it("exits 1 before rendering when the transcript to resume is missing", async () => {
        expect(await runTui(newPhrase())).toBe(1);
    });
});

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

describe("indexClaims", () => {
    it("gives each run its own owner, so two runs of one TUI exclude each other", async () => {
        // The index's claims table: one owner a conversation, released only
        // by that owner.
        const table = new Map<string, string>();
        const index = {
            claim: async (phrase: string, owner: string) => {
                if (!table.has(phrase)) {
                    table.set(phrase, owner);
                }
                return table.get(phrase) === owner;
            },
            release: async (phrase: string, owner: string) => {
                if (table.get(phrase) === owner) {
                    table.delete(phrase);
                }
            },
        };
        const claim = indexClaims(index, "a-phrase");
        const old = claim();
        const next = claim();
        expect(await old.take()).toBe(true);
        expect(await next.take()).toBe(false);
        await old.release();
        expect(await next.take()).toBe(true);
        // A late release by the old run leaves the new run's claim alone.
        await old.release();
        expect(await claim().take()).toBe(false);
    });
});

describe("clusterSaver", () => {
    const cluster = (from: number, through: number) => ({
        from,
        through,
        abstract: "Turns.",
        at: "2026-10-07T08:00:00.000Z",
        model: "claude-test",
    });
    const notes = async (phrase: string) =>
        JSON.parse(await readFile(join(dir, `${phrase}.meta.json`), "utf8"));

    it("saves the clusters and adds the compaction's cost", async () => {
        const phrase = newPhrase();
        const save = clusterSaver({ dir, phrase, transcript: true });
        expect(await save([cluster(1, 4)], 0.25)).toEqual({ ok: true });
        expect(await save([cluster(5, 8)], 0.5)).toEqual({ ok: true });
        const written = await notes(phrase);
        expect(written.clusters).toHaveLength(2);
        expect(written.compactionCostUsd).toBe(0.75);
    });

    it("saves nothing without a transcript", async () => {
        const phrase = newPhrase();
        const save = clusterSaver({ dir, phrase, transcript: false });
        expect(await save([cluster(1, 4)], 0.25)).toEqual({ ok: true });
        await expect(notes(phrase)).rejects.toThrow();
    });
});
