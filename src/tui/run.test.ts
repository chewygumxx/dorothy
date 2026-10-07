// vim:set expandtab shiftwidth=4 filetype=typescript:
// SPDX-License-Identifier: GPL-3.0-only

//
//
// ~chewygumxx/dorothy.git
// ::: :/src/tui/run.test.ts
//
//

import { afterEach, beforeEach, describe, expect, it, spyOn } from "bun:test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { configPath } from "../config.js";
import type { ChatSession } from "../conversation.js";
import { newPhrase } from "../session-id.js";
import { transcriptDir } from "../transcript.js";
import { xdgDir } from "../xdg.js";
import {
    clusterSaver,
    indexClaims,
    notesReady,
    runTui,
    sessionMaker,
} from "./run.js";

// runTui reads the config and opens the transcript and the index from
// these, so every one points into the test's directory.
const XDG = ["XDG_CONFIG_HOME", "XDG_DATA_HOME", "XDG_CACHE_HOME"] as const;
let dir = "";
let saved: Partial<Record<(typeof XDG)[number], string>> = {};
beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "dorothy-run-"));
    saved = {};
    for (const variable of XDG) {
        saved[variable] = process.env[variable];
        process.env[variable] = dir;
    }
});
afterEach(async () => {
    for (const variable of XDG) {
        const value = saved[variable];
        if (value === undefined) {
            delete process.env[variable];
        } else {
            process.env[variable] = value;
        }
    }
    await rm(dir, { recursive: true, force: true });
});

describe("runTui", () => {
    it("reads and writes only under the test's directory", () => {
        // The cache holds the index and the CLI's home.
        const cache = xdgDir(process.env, "XDG_CACHE_HOME", ".cache");
        for (const path of [configPath(), transcriptDir(), cache]) {
            expect(path).toStartWith(dir);
        }
    });

    it("exits 1 before rendering when the transcript to resume is missing", async () => {
        const phrase = newPhrase();
        const written: string[] = [];
        const write = spyOn(process.stderr, "write").mockImplementation(
            (chunk) => {
                written.push(String(chunk));
                return true;
            },
        );
        try {
            expect(await runTui(phrase)).toBe(1);
        } finally {
            write.mockRestore();
        }
        expect(written.join("")).toStartWith(
            `dorothy: cannot resume ${phrase}: `,
        );
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

    it("hands back the notes' clusters when another writer covered those turns first", async () => {
        const phrase = newPhrase();
        const other = clusterSaver({ dir, phrase, transcript: true });
        expect(await other([cluster(1, 4), cluster(5, 8)], 0.25)).toEqual({
            ok: true,
        });
        const save = clusterSaver({ dir, phrase, transcript: true });
        expect(await save([cluster(1, 4)], 0.5)).toEqual({
            ok: true,
            clusters: [cluster(1, 4), cluster(5, 8)],
        });
        // Nothing written: the cost is the other writer's alone.
        expect((await notes(phrase)).compactionCostUsd).toBe(0.25);
    });

    it("fails when the notes' clusters don't lead up to those turns", async () => {
        const phrase = newPhrase();
        const save = clusterSaver({ dir, phrase, transcript: true });
        expect(await save([cluster(5, 8)], 0.5)).toEqual({
            ok: false,
            reason: "the notes' clusters end at turn 0, not 4",
        });
        expect(await save([cluster(1, 6)], 0.5)).toEqual({ ok: true });
        expect(await save([cluster(5, 8)], 0.5)).toEqual({
            ok: false,
            reason: "the notes' clusters end at turn 6, not 4",
        });
    });

    it("saves nothing without a transcript", async () => {
        const phrase = newPhrase();
        const save = clusterSaver({ dir, phrase, transcript: false });
        expect(await save([cluster(1, 4)], 0.25)).toEqual({ ok: true });
        await expect(notes(phrase)).rejects.toThrow();
    });
});
