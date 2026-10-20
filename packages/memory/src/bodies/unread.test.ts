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

    describe("another host's session", () => {
        it("tells a type it wrote once, under the host's name", async () => {
            await keepNewType(env, "codex/future_type", '{"type":"x"}');
            const [told, ...more] = await startNotices(env);
            expect(more).toEqual([]);
            expect(told).toContain("codex_future_type-");
            expect(told).not.toContain("Claude Code");
            expect(await startNotices(env)).toEqual([]);
        });

        const HERMES = "20261020_101500_fixture";
        const other = (host = "hermes", session = HERMES) => ({
            ...halt(3),
            host,
            session,
            transcript: "/h/state.db",
        });

        it("is kept under a name made of its host and a hash, not its id", async () => {
            const copy = await keepHalt(env, other(), ["row 3"]);
            expect(copy).not.toContain(HERMES);
            expect(copy.startsWith(join(unreadDir(env), "hermes-"))).toBe(true);
            expect(copy).toBe(copyPath(env, HERMES, "hermes"));
            expect(await readFile(copy, "utf8")).toBe("row 3\n");
            expect(await readRecord(env, HERMES, "hermes")).toMatchObject({
                host: "hermes",
                session: HERMES,
            });
            expect(await readRecord(env, HERMES)).toBeNull();
        });

        it("never collides with a Claude Code session of the same id", async () => {
            await keepHalt(env, halt(), ["{bad"]);
            await keepHalt(env, other("codex", S1), ["{bad too"]);
            expect(await readFile(copyPath(env, S1), "utf8")).toBe("{bad\n");
            expect(await readFile(copyPath(env, S1, "codex"), "utf8")).toBe(
                "{bad too\n",
            );
            expect(await halts(env)).toHaveLength(2);
            expect(await halts(env, "claude-code")).toHaveLength(1);
            expect(await halts(env, "codex")).toHaveLength(1);
        });

        it("is told with its host, and with the sweep's commands", async () => {
            await keepHalt(env, other("codex", S1), ["{bad"]);
            const [told] = await startNotices(env);
            expect(told).toContain("a Codex session");
            expect(told).toContain("past line 3");
            expect(told).not.toContain("--claude-hook");
            expect(told).toContain("dorothy --sweep --reread tries again");
            expect(told).toContain(`--sweep --dismiss codex ${S1} stops`);
        });

        it("quotes an id a shell would split in the command it offers", async () => {
            await keepHalt(env, other("hermes", "a b'c"), ["row 3"]);
            const [told] = await startNotices(env);
            expect(told).toContain(
                `--sweep --dismiss hermes 'a b'\\''c' stops`,
            );
        });

        it("is dismissed and resolved by host", async () => {
            await keepHalt(env, other(), ["row 3"]);
            expect(await dismissHalt(env, HERMES)).toBe(false);
            expect(await dismissHalt(env, HERMES, "hermes")).toBe(true);
            expect(await startNotices(env)).toEqual([]);
            await resolveHalt(env, HERMES, "hermes");
            expect(await halts(env)).toEqual([]);
            expect(await readdir(unreadDir(env))).toEqual([]);
        });

        it("is reported for --check", async () => {
            await keepHalt(env, other(), ["row 3"]);
            expect((await unreadReport(env))[0]).toContain("hermes");
        });
    });
});
