// vim:set expandtab shiftwidth=4 filetype=typescript:
// SPDX-License-Identifier: GPL-3.0-only

//
//
// ~chewygumxx/dorothy.git
// ::: :/src/tui/run.test.ts
//
//

import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ChatSession } from "../conversation.js";
import { newPhrase } from "../session-id.js";
import { notesReady, runTui, sessionMaker } from "./run.js";

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
