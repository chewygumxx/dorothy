// vim:set expandtab shiftwidth=4 filetype=typescript:
// SPDX-License-Identifier: GPL-3.0-only

//
//
// ~chewygumxx/dorothy.git
// ::: :/packages/memory/src/service/sweep-command.test.ts
//
//

import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import {
    mkdir,
    mkdtemp,
    readdir,
    rm,
    utimes,
    writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import type { Env } from "@dorothy/core";
import { halts, readRecord } from "../bodies/unread.js";
import {
    context,
    line,
    message,
    meta,
    SESSION,
} from "../recording/fixtures.js";
import { transcriptDir } from "../transcript.js";
import { runSweep, runSweepDismiss } from "./sweep-command.js";

// Events of 2026-10-20 at nine.
const BEFORE = new Date("2026-10-14T00:00:00.000Z");
const AFTER = new Date("2026-10-21T00:00:00.000Z");
const FRESH = new Date("2026-10-21T06:00:00.000Z");
const STALE = new Date("2026-10-19T09:30:00.000Z");

let home: string;
let env: Env;
let out: string[];
let err: string[];

const settings = async (text: string) => {
    await mkdir(join(home, "config", "dorothy"), { recursive: true });
    await writeFile(join(home, "config", "dorothy", "config.toml"), text);
};
const io = () => ({
    env,
    out: { write: (text: string) => out.push(text) },
    err: { write: (text: string) => err.push(text) },
});
const rollout = async (lines: string[], when: Date, name = "one.jsonl") => {
    const path = join(home, ".codex/sessions/2026/10/20", `rollout-${name}`);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, `${lines.join("\n")}\n`);
    await utimes(path, when, when);
    return path;
};
const speech = [
    meta(),
    context(),
    message("user", "Synthetic question.", 1),
    message("assistant", "Synthetic answer.", 2),
];
const unknownBlock = line("response_item", {
    type: "message",
    role: "user",
    content: [{ type: "synthetic_unknown_block" }],
});
const conversations = async () =>
    (await readdir(transcriptDir(env)).catch(() => [])).filter((name) =>
        name.endsWith(".jsonl"),
    );

beforeEach(async () => {
    home = await mkdtemp(join(tmpdir(), "dorothy-sweep-command-"));
    env = {
        HOME: home,
        XDG_DATA_HOME: join(home, "data"),
        XDG_CACHE_HOME: join(home, "cache"),
        XDG_STATE_HOME: join(home, "state"),
        XDG_CONFIG_HOME: join(home, "config"),
    };
    out = [];
    err = [];
    await settings(
        '[history]\nenabled = false\n[recording]\nhosts = ["codex"]\n',
    );
});
afterEach(async () => {
    await rm(home, { recursive: true, force: true });
});

describe("dorothy --sweep", () => {
    it("says what to set when no host is", async () => {
        await settings("[history]\nenabled = false\n");
        expect(await runSweep({ ...io(), backfill: false })).toBe(1);
        expect(out).toEqual([]);
        expect(err.join("")).toContain("[recording] hosts");
    });

    it("prints a host and a count a line", async () => {
        await settings(
            '[history]\nenabled = false\n[recording]\nhosts = ["codex", "hermes"]\n',
        );
        await rollout(speech, FRESH);
        expect(
            await runSweep({ ...io(), backfill: false, now: () => BEFORE }),
        ).toBe(0);
        expect(out.join("")).toBe(
            "codex: 2 events in 1 sessions\nhermes: 0 events in 0 sessions\n",
        );
        expect(await conversations()).toHaveLength(1);
    });

    it("leaves an old session to the backfill, which records it", async () => {
        await rollout(speech, STALE);
        await runSweep({ ...io(), backfill: false, now: () => AFTER });
        expect(out.join("")).toBe(
            "codex: 0 events in 0 sessions (1 waiting for the backfill)\n",
        );
        expect(await conversations()).toEqual([]);
        out.length = 0;
        expect(
            await runSweep({ ...io(), backfill: true, now: () => AFTER }),
        ).toBe(0);
        expect(out.join("")).toBe("codex: 2 events in 1 sessions\n");
        expect(await conversations()).toHaveLength(1);
    });

    it("keeps a halt, which a reread resolves once the session reads", async () => {
        await rollout([...speech, unknownBlock], FRESH);
        await runSweep({ ...io(), backfill: false, now: () => BEFORE });
        const [kept] = await halts(env, "codex");
        expect(kept).toMatchObject({ session: SESSION, host: "codex" });
        out.length = 0;
        err.length = 0;
        expect(await runSweep({ ...io(), backfill: false, reread: true })).toBe(
            1,
        );
        expect(err.join("")).toContain(`codex ${SESSION} still can't be read`);
        await rollout(speech, FRESH);
        err.length = 0;
        expect(await runSweep({ ...io(), backfill: false, reread: true })).toBe(
            0,
        );
        expect(out.join("")).toContain(`read codex ${SESSION} to its end`);
        expect(await halts(env)).toEqual([]);
    });

    it("has nothing to reread when nothing is kept", async () => {
        expect(await runSweep({ ...io(), backfill: false, reread: true })).toBe(
            0,
        );
        expect(out.join("")).toContain("no unreadable sessions are kept");
    });
});

describe("dorothy --sweep --dismiss", () => {
    it("stops telling a halt, keeping its lines", async () => {
        await rollout([...speech, unknownBlock], FRESH);
        await runSweep({ ...io(), backfill: false, now: () => BEFORE });
        expect(await runSweepDismiss("codex", SESSION, io())).toBe(0);
        expect(await readRecord(env, SESSION, "codex")).toMatchObject({
            dismissed: true,
        });
        expect(out.join("")).toContain(`${SESSION} will not be told again`);
    });

    it("says when there is none to dismiss", async () => {
        expect(await runSweepDismiss("codex", SESSION, io())).toBe(1);
        expect(err.join("")).toContain(
            `no unreadable codex session ${SESSION}`,
        );
    });
});
