// vim:set expandtab shiftwidth=4 filetype=typescript:
// SPDX-License-Identifier: GPL-3.0-only

//
//
// ~chewygumxx/dorothy.git
// ::: :/packages/memory/src/bodies/unread.test.ts
//
//

import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import {
    mkdtemp,
    readdir,
    readFile,
    rm,
    stat,
    writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { hookLog } from "./log.js";
import {
    addNotice,
    copyPath,
    dismissHalt,
    halts,
    keepHalt,
    keepNewType,
    readRecord,
    resolveHalt,
    startNotices,
    unreadDir,
    unreadReport,
} from "./unread.js";

const S1 = "0f8fad5b-d9cb-469f-a165-70867728950e";
let home = "";
let env: Record<string, string>;
beforeEach(async () => {
    home = await mkdtemp(join(tmpdir(), "dorothy-unread-"));
    env = {
        HOME: home,
        XDG_STATE_HOME: join(home, "state"),
        XDG_CACHE_HOME: join(home, "cache"),
    };
});
afterEach(async () => {
    await rm(home, { recursive: true, force: true });
});

const halt = (line = 7) => ({
    session: S1,
    conversation: "a-b-c-d",
    transcript: "/t/s.jsonl",
    dir: "/work",
    since: null,
    line,
    type: "user",
    uuid: "u7",
    reason: "a user line without its content",
    at: "2026-10-15T09:00:00.000Z",
});

describe("lines kept aside", () => {
    it("keeps a halt's lines and record outside the data directory, the user's alone", async () => {
        const copy = await keepHalt(env, halt(), ["{bad", '{"type":"user"}']);
        expect(copy).toBe(
            join(home, "state", "dorothy", "unread", `${S1}.jsonl`),
        );
        expect(await readFile(copy, "utf8")).toBe('{bad\n{"type":"user"}\n');
        expect((await stat(copy)).mode & 0o777).toBe(0o600);
        expect((await stat(unreadDir(env))).mode & 0o777).toBe(0o700);
        expect(await readRecord(env, S1)).toEqual({ v: 1, ...halt() });
        expect((await halts(env)).map((r) => r.session)).toEqual([S1]);
    });

    it("tells a halt at every start until it is dismissed, then keeps its copy", async () => {
        await keepHalt(env, halt(), ["{bad"]);
        const told = await startNotices(env);
        expect(told).toHaveLength(1);
        expect(told[0]).toContain(
            `past line 7 (a user line without its content)`,
        );
        expect(told[0]).toContain("dorothy --claude-hook --reread");
        expect(await startNotices(env)).toHaveLength(1);
        expect(await dismissHalt(env, S1)).toBe(true);
        expect(await startNotices(env)).toEqual([]);
        expect(await readFile(copyPath(env, S1), "utf8")).toBe("{bad\n");
        expect(
            await dismissHalt(env, "1a9fbe6c-eadc-4a7f-b276-81978839a61f"),
        ).toBe(false);
    });

    it("tells a halt again once it halts at another line, dismissed or not", async () => {
        await keepHalt(env, halt(7), ["{bad"]);
        await dismissHalt(env, S1);
        await keepHalt(env, halt(7), ["{bad"]);
        expect(await startNotices(env)).toEqual([]);
        await keepHalt(env, halt(9), ["{worse"]);
        expect(await startNotices(env)).toHaveLength(1);
    });

    it("goes once resolved", async () => {
        await keepHalt(env, halt(), ["{bad"]);
        await resolveHalt(env, S1);
        expect(await halts(env)).toEqual([]);
        await expect(readFile(copyPath(env, S1), "utf8")).rejects.toThrow();
        await resolveHalt(env, S1);
    });

    it("keeps one example of a new type, told once", async () => {
        await keepNewType(env, "brand-new", '{"type":"brand-new","n":1}');
        await keepNewType(env, "brand-new", '{"type":"brand-new","n":2}');
        await keepNewType(env, "../odd type", '{"type":"../odd type"}');
        expect(
            await readFile(
                join(unreadDir(env), "types", "brand-new.jsonl"),
                "utf8",
            ),
        ).toBe('{"type":"brand-new","n":1}\n');
        const [told] = await startNotices(env);
        expect(told).toMatch(/\(___odd_type-[0-9a-f]{8}, brand-new\)/);
        expect(await startNotices(env)).toEqual([]);
    });

    it("keeps an example of each type, though their names sanitise alike", async () => {
        await keepNewType(env, "a/b", '{"type":"a/b"}');
        await keepNewType(env, "a?b", '{"type":"a?b"}');
        await keepNewType(env, "a_b", '{"type":"a_b"}');
        const names = await readdir(join(unreadDir(env), "types"));
        expect(names).toHaveLength(3);
        const kept = await Promise.all(
            names.map((name) =>
                readFile(join(unreadDir(env), "types", name), "utf8"),
            ),
        );
        expect(kept.sort()).toEqual([
            '{"type":"a/b"}\n',
            '{"type":"a?b"}\n',
            '{"type":"a_b"}\n',
        ]);
        expect(await readdir(unreadDir(env))).toEqual(["types"]);
    });

    it("tells a new type once, though two starts ask at once", async () => {
        await keepNewType(env, "brand-new", '{"type":"brand-new"}');
        await keepNewType(env, "newer", '{"type":"newer"}');
        const told = (
            await Promise.all(
                Array.from({ length: 6 }, () => startNotices(env)),
            )
        ).flat();
        const text = told.join("\n");
        expect(text.match(/brand-new/g)).toHaveLength(1);
        expect(text.match(/newer/g)).toHaveLength(1);
        await keepNewType(env, "newest", '{"type":"newest"}');
        expect(await startNotices(env)).toHaveLength(1);
    });

    it("does not tell again a type an earlier version told", async () => {
        await keepNewType(env, "brand-new", '{"type":"brand-new"}');
        await writeFile(join(unreadDir(env), "types.json"), '["brand-new"]\n');
        expect(await startNotices(env)).toEqual([]);
    });

    it("tells a hook's notice once, at the next start", async () => {
        await addNotice(env, "memory: Claude Code ran no hooks");
        await addNotice(env, "memory: and again");
        expect(await startNotices(env)).toEqual([
            "memory: Claude Code ran no hooks",
            "memory: and again",
        ]);
        expect(await startNotices(env)).toEqual([]);
    });

    it("reports what is kept, and errors in the hook's log, for --check", async () => {
        expect(await unreadReport(env)).toEqual([]);
        await keepHalt(env, halt(), ["{bad"]);
        hookLog(env).error("session x halted");
        const report = await unreadReport(env);
        expect(report[0]).toStartWith(
            `unread: ${S1} (a-b-c-d), line 7: a user line without its content`,
        );
        expect(report.at(-1)).toContain("claude-hook.log holds errors");
    });
});
