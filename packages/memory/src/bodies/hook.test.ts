// vim:set expandtab shiftwidth=4 filetype=typescript:
// SPDX-License-Identifier: GPL-3.0-only

//
//
// ~chewygumxx/dorothy.git
// ::: :/packages/memory/src/bodies/hook.test.ts
//
//

import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import {
    mkdir,
    mkdtemp,
    readdir,
    readFile,
    rm,
    writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { StructuredCall } from "@dorothy/core";
import { indexPath } from "../recall/store.js";
import { transcriptDir } from "../transcript.js";
import {
    assistantLine,
    meta,
    SESSION,
    text,
    use,
    userLine,
} from "./fixtures.js";
import {
    activitySince,
    afterEnd,
    afterStop,
    parseHookInput,
    runClaudeHook,
    type Steps,
} from "./hook.js";
import {
    launchesDir,
    launchSessions,
    legacyLaunchesDir,
    liveSession,
    noteLaunch,
    noteSession,
    readLaunch,
    removeLaunch,
} from "./launches.js";
import { hookLogPath } from "./log.js";
import type { Recorded } from "./record.js";
import { keepHalt, readRecord, startNotices } from "./unread.js";

const LAUNCH = "6c84fb90-12c4-11e1-840d-7b25c5ee775a";
const OLD = "7d95fc01-23d5-42f2-951e-8c36d6ff886b";
const NOTES = {
    title: "Hello",
    description: "A greeting.",
    abstract: "They said hello.",
};

// The steps as calls, each answering from a script.
function steps(script: {
    records?: Recorded[];
    state?: { reviewedThrough: number; turns: number; hidden: boolean }[];
    activity?: boolean;
}) {
    const calls: string[] = [];
    const records = [...(script.records ?? [])];
    const states = [...(script.state ?? [])];
    const fake: Steps = {
        record: async (ended) => {
            calls.push(`record${ended ? " ended" : ""}`);
            return records.shift() ?? { kind: "nothing", size: 0 };
        },
        sync: async () => {
            calls.push("sync");
        },
        state: async () => {
            calls.push("state");
            return (
                states.shift() ?? {
                    reviewedThrough: 0,
                    turns: 0,
                    hidden: false,
                }
            );
        },
        review: async (phrase) => {
            calls.push(`review ${phrase}`);
        },
        activity: async (size) => {
            calls.push(`activity ${size}`);
            return script.activity ?? false;
        },
        sleep: async (ms) => {
            calls.push(`sleep ${ms}`);
        },
    };
    return { fake, calls };
}
const recorded = (size = 10): Recorded => ({
    kind: "recorded",
    phrase: "a-b-c-d",
    appended: 1,
    size,
    halted: false,
});

describe("afterStop", () => {
    it("asks for the first review at once", async () => {
        const { fake, calls } = steps({
            records: [recorded()],
            state: [{ reviewedThrough: 0, turns: 2, hidden: false }],
        });
        await afterStop(fake, 60_000);
        expect(calls).toEqual(["record", "sync", "state", "review a-b-c-d"]);
    });

    it("waits while idle, then records again and reviews what is uncovered", async () => {
        const { fake, calls } = steps({
            records: [recorded(10), recorded(10)],
            state: [
                { reviewedThrough: 2, turns: 4, hidden: false },
                { reviewedThrough: 2, turns: 4, hidden: false },
            ],
        });
        await afterStop(fake, 60_000);
        expect(calls).toEqual([
            "record",
            "sync",
            "state",
            "sleep 60000",
            "activity 10",
            "record",
            "state",
            "review a-b-c-d",
        ]);
    });

    it("leaves the conversation to a later hook once a line has come", async () => {
        const { fake, calls } = steps({
            records: [recorded()],
            state: [{ reviewedThrough: 2, turns: 4, hidden: false }],
            activity: true,
        });
        await afterStop(fake, 60_000);
        expect(calls.at(-1)).toBe("activity 10");
    });

    it("reviews nothing covered, hidden, or not recorded", async () => {
        const covered = steps({
            records: [recorded(), recorded()],
            state: [
                { reviewedThrough: 4, turns: 4, hidden: false },
                { reviewedThrough: 4, turns: 4, hidden: false },
            ],
        });
        await afterStop(covered.fake, 1000);
        expect(covered.calls.some((call) => call.startsWith("review"))).toBe(
            false,
        );
        const hidden = steps({
            records: [recorded()],
            state: [{ reviewedThrough: 0, turns: 2, hidden: true }],
        });
        await afterStop(hidden.fake, 1000);
        expect(hidden.calls).toEqual(["record", "sync", "state"]);
        const none = steps({});
        await afterStop(none.fake, 1000);
        expect(none.calls).toEqual(["record"]);
    });
});

describe("afterEnd", () => {
    it("records to the end, syncs, and reviews what is uncovered", async () => {
        const { fake, calls } = steps({
            records: [recorded()],
            state: [{ reviewedThrough: 2, turns: 3, hidden: false }],
        });
        await afterEnd(fake);
        expect(calls).toEqual([
            "record ended",
            "sync",
            "state",
            "review a-b-c-d",
        ]);
    });
});

describe("activitySince", () => {
    it("sees a main-thread line after what was read, not bookkeeping or a sidechain", async () => {
        const dir = await mkdtemp(join(tmpdir(), "dorothy-activity-"));
        const path = join(dir, "t.jsonl");
        const first = `${userLine("u1", 0, "a")}\n`;
        await writeFile(
            path,
            `${first}${meta("ai-title")}\n${userLine("s1", 1, "x", { isSidechain: true })}\n`,
        );
        expect(await activitySince(path, Buffer.byteLength(first))).toBe(false);
        await writeFile(
            path,
            `${first}${meta("ai-title")}\n${userLine("u2", 2, "b")}\n`,
        );
        expect(await activitySince(path, Buffer.byteLength(first))).toBe(true);
        expect(await activitySince(join(dir, "gone"), 0)).toBe(false);
        await rm(dir, { recursive: true, force: true });
    });
});

describe("parseHookInput", () => {
    it("takes the fields a hook gives, and nothing malformed", () => {
        expect(
            parseHookInput(
                JSON.stringify({
                    hook_event_name: "Stop",
                    session_id: SESSION,
                    transcript_path: "/t.jsonl",
                    cwd: "/w",
                    stop_hook_active: false,
                }),
            ),
        ).toEqual({
            event: "Stop",
            session: SESSION,
            transcript: "/t.jsonl",
            cwd: "/w",
        });
        expect(parseHookInput("{")).toBeNull();
        expect(
            parseHookInput(
                JSON.stringify({
                    hook_event_name: "Stop",
                    session_id: "../x",
                    transcript_path: "/t",
                    cwd: "/w",
                }),
            ),
        ).toBeNull();
    });
});

describe("runClaudeHook", () => {
    let home = "";
    let env: Record<string, string>;
    let claude = "";
    let said = "";
    const out = { write: (text: string) => (said += text) };
    const reviews: string[] = [];
    let agents = 0;
    const call: StructuredCall = async ({ prompt }) => {
        reviews.push(prompt);
        return { ok: true, output: NOTES, model: "m", costUsd: 0.01 };
    };
    beforeEach(async () => {
        home = await mkdtemp(join(tmpdir(), "dorothy-hook-"));
        env = {
            HOME: home,
            XDG_DATA_HOME: join(home, "data"),
            XDG_CACHE_HOME: join(home, "cache"),
            XDG_CONFIG_HOME: join(home, "config"),
            XDG_STATE_HOME: join(home, "state"),
            XDG_RUNTIME_DIR: join(home, "run"),
            DOROTHY_LAUNCH: LAUNCH,
        };
        claude = join(home, "claude", "projects", "-work", `${SESSION}.jsonl`);
        await mkdir(join(home, "claude", "projects", "-work"), {
            recursive: true,
        });
        await mkdir(join(home, "work"));
        await writeFile(
            claude,
            `${userLine("u1", 1, "hello")}\n${assistantLine("a1", 2, [text("Hi.")])}\n`,
        );
        await noteLaunch(env, {
            launch: LAUNCH,
            pid: 1,
            started: "2026-10-15T09:00:00.000Z",
            dir: join(home, "work"),
            session: SESSION,
            claude: join(home, "claude"),
        });
        said = "";
        reviews.length = 0;
        agents = 0;
    });
    afterEach(async () => {
        await rm(home, { recursive: true, force: true });
    });
    const input = (event: string) =>
        JSON.stringify({
            hook_event_name: event,
            session_id: SESSION,
            transcript_path: claude,
            cwd: join(home, "work"),
        });
    const deps = (stdin: string, spawned: string[][] = []) => ({
        env,
        stdin: async () => stdin,
        agent: async () => {
            agents += 1;
            return { call, persona: "You are Dorothy." };
        },
        self: ["/bin/bun", "/d/index.ts"],
        spawnDetached: (cmd: string[]) => spawned.push(cmd),
        out,
        err: out,
    });
    const conversations = async () =>
        (await readdir(transcriptDir(env)).catch(() => [])).filter((name) =>
            name.endsWith(".jsonl"),
        );

    it("records a Stop, and asks for its first review at once, saying nothing", async () => {
        expect(await runClaudeHook({ kind: "hook" }, deps(input("Stop")))).toBe(
            0,
        );
        expect(await conversations()).toHaveLength(1);
        expect(reviews).toHaveLength(1);
        expect(said).toBe("");
    });

    it("hands a SessionEnd to a detached catch-up of its session", async () => {
        const spawned: string[][] = [];
        expect(
            await runClaudeHook(
                { kind: "hook" },
                deps(input("SessionEnd"), spawned),
            ),
        ).toBe(0);
        expect(spawned).toEqual([
            [
                "/bin/bun",
                "/d/index.ts",
                "--claude-hook",
                "--catch-up",
                LAUNCH,
                "--session",
                SESSION,
            ],
        ]);
        expect(await conversations()).toEqual([]);
    });

    it("loads the agent for a review alone, not for a SessionEnd", async () => {
        await runClaudeHook({ kind: "hook" }, deps(input("SessionEnd")));
        expect(agents).toBe(0);
        await runClaudeHook({ kind: "hook" }, deps(input("Stop")));
        expect(reviews).toHaveLength(1);
        expect(agents).toBe(1);
    });

    describe("the detached catch-up, really started", () => {
        let scripts = "";
        beforeEach(async () => {
            scripts = await mkdtemp(join(tmpdir(), "dorothy-hook-script-"));
        });
        afterEach(async () => {
            await rm(scripts, { recursive: true, force: true });
            delete process.env.DOROTHY_TEST_CANARY;
        });

        const until = async <T>(look: () => Promise<T | null>) => {
            for (let tries = 0; tries < 200; tries += 1) {
                const found = await look().catch(() => null);
                if (found !== null) {
                    return found;
                }
                await new Promise((resolve) => setTimeout(resolve, 25));
            }
            throw new Error("never came");
        };

        it("runs in the environment the hook was given, not this process's", async () => {
            const dump = join(home, "dump.json");
            const script = join(scripts, "dump.ts");
            await writeFile(
                script,
                [
                    'import { renameSync, writeFileSync } from "node:fs";',
                    "const to = process.env.DUMP_TO as string;",
                    'writeFileSync(to + ".tmp", JSON.stringify({',
                    "    argv: process.argv.slice(2),",
                    "    env: Object.keys(process.env),",
                    "}));",
                    'renameSync(to + ".tmp", to);',
                    "",
                ].join("\n"),
            );
            // What Dorothy's .env decrypted into this process, say.
            process.env.DOROTHY_TEST_CANARY = "decrypted";
            expect(
                await runClaudeHook(
                    { kind: "hook" },
                    {
                        ...deps(input("SessionEnd")),
                        env: { ...env, DUMP_TO: dump },
                        self: [process.execPath, script],
                        spawnDetached: undefined,
                    },
                ),
            ).toBe(0);
            const seen = await until(async () =>
                JSON.parse(await readFile(dump, "utf8")),
            );
            expect(seen.argv).toEqual([
                "--claude-hook",
                "--catch-up",
                LAUNCH,
                "--session",
                SESSION,
            ]);
            expect(seen.env).toContain("DUMP_TO");
            expect(seen.env).toContain("DOROTHY_LAUNCH");
            expect(seen.env).not.toContain("DOROTHY_TEST_CANARY");
        });

        it("logs a start that fails, and still exits 0", async () => {
            expect(
                await runClaudeHook(
                    { kind: "hook" },
                    {
                        ...deps(input("SessionEnd")),
                        self: [join(scripts, "no-such-program")],
                        spawnDetached: undefined,
                    },
                ),
            ).toBe(0);
            const log = await until(async () => {
                const text = await readFile(hookLogPath(env), "utf8");
                return text.includes("the catch-up could not start")
                    ? text
                    : null;
            });
            expect(log).toMatch(/ error \d+ the catch-up could not start/);
        });
    });

    it("leaves no live session once a SessionEnd has come", async () => {
        await runClaudeHook({ kind: "hook" }, deps(input("Stop")));
        expect(await liveSession(env, LAUNCH)).toBe(SESSION);
        await runClaudeHook({ kind: "hook" }, deps(input("SessionEnd")));
        expect(await liveSession(env, LAUNCH)).toBeNull();
    });

    it("logs what it cannot do, and still exits 0", async () => {
        expect(await runClaudeHook({ kind: "hook" }, deps("{"))).toBe(0);
        expect(
            await runClaudeHook(
                { kind: "hook" },
                { ...deps(input("Stop")), env: { ...env, DOROTHY_LAUNCH: "" } },
            ),
        ).toBe(0);
        const log = await readFile(hookLogPath(env), "utf8");
        expect(log).toContain("error");
        expect(said).toBe("");
    });

    it("catches up a launch: each session, then its notes go", async () => {
        await noteSession(env, LAUNCH, {
            session: SESSION,
            transcript: claude,
            cwd: join(home, "work"),
            seen: "2026-10-15T09:03:00.000Z",
        });
        expect(
            await runClaudeHook(
                { kind: "catch-up", launch: LAUNCH, session: null },
                deps(""),
            ),
        ).toBe(0);
        expect(await conversations()).toHaveLength(1);
        expect(reviews).toHaveLength(1);
        expect(await readLaunch(env, LAUNCH)).toBeNull();
        expect(await readdir(launchesDir(env))).toEqual([]);
    });

    it("catches up a launch an earlier Dorothy left in the runtime directory", async () => {
        const before = { ...env, XDG_STATE_HOME: join(home, "run") };
        await noteLaunch(before, {
            launch: OLD,
            pid: 1,
            started: "2026-10-15T09:00:00.000Z",
            dir: join(home, "work"),
            session: SESSION,
            claude: join(home, "claude"),
        });
        await noteSession(env, OLD, {
            session: SESSION,
            transcript: claude,
            cwd: join(home, "work"),
            seen: "2026-10-15T09:03:00.000Z",
        });
        await runClaudeHook(
            { kind: "catch-up", launch: OLD, session: null },
            deps(""),
        );
        expect(await conversations()).toHaveLength(1);
        expect(await readLaunch(env, OLD)).toBeNull();
        expect(await readdir(legacyLaunchesDir(env))).toEqual([]);
    });

    it("tells of a session no hook ran for once, though its catch-up is retried", async () => {
        await mkdir(join(home, "config", "dorothy"), { recursive: true });
        await writeFile(
            join(home, "config", "dorothy", "config.toml"),
            "[history]\nenabled = false\n",
        );
        await mkdir(indexPath(env), { recursive: true });
        const catchUp = () =>
            runClaudeHook(
                { kind: "catch-up", launch: LAUNCH, session: null },
                deps(""),
            );
        await catchUp();
        await catchUp();
        const locked = await startNotices(env);
        expect(locked).toHaveLength(2);
        expect(locked.join("\n")).not.toContain("ran no hooks");
        expect(await readLaunch(env, LAUNCH)).not.toBeNull();
        await rm(indexPath(env), { recursive: true });
        await rm(join(home, "config"), { recursive: true });
        await catchUp();
        const told = await startNotices(env);
        expect(told).toHaveLength(1);
        expect(told[0]).toContain("ran no hooks");
        expect(await readLaunch(env, LAUNCH)).toBeNull();
    });

    it("keeps a launch's notes when neither the index nor history can lock", async () => {
        await noteSession(env, LAUNCH, {
            session: SESSION,
            transcript: claude,
            cwd: join(home, "work"),
            seen: "2026-10-15T09:03:00.000Z",
        });
        await mkdir(join(home, "config", "dorothy"), { recursive: true });
        await writeFile(
            join(home, "config", "dorothy", "config.toml"),
            "[history]\nenabled = false\n",
        );
        // An index that cannot be opened: a directory where it should be.
        await mkdir(indexPath(env), { recursive: true });
        await runClaudeHook(
            { kind: "catch-up", launch: LAUNCH, session: null },
            deps(""),
        );
        expect(await conversations()).toEqual([]);
        expect(await readLaunch(env, LAUNCH)).not.toBeNull();
        expect(await launchSessions(env, LAUNCH)).toHaveLength(1);
        expect(await readFile(hookLogPath(env), "utf8")).toContain(
            "nothing recorded",
        );
        // The next start's catch-up has it once the store opens.
        await rm(indexPath(env), { recursive: true });
        await rm(join(home, "config"), { recursive: true });
        await runClaudeHook(
            { kind: "catch-up", launch: LAUNCH, session: null },
            deps(""),
        );
        expect(await conversations()).toHaveLength(1);
        expect(await readLaunch(env, LAUNCH)).toBeNull();
    });

    it("catches up one session and keeps the launch's notes", async () => {
        await noteSession(env, LAUNCH, {
            session: SESSION,
            transcript: claude,
            cwd: join(home, "work"),
            seen: "2026-10-15T09:03:00.000Z",
        });
        await runClaudeHook(
            { kind: "catch-up", launch: LAUNCH, session: SESSION },
            deps(""),
        );
        expect(await conversations()).toHaveLength(1);
        expect(await readLaunch(env, LAUNCH)).not.toBeNull();
    });

    it("records a session no hook ran for, and tells the next start", async () => {
        await runClaudeHook(
            { kind: "catch-up", launch: LAUNCH, session: null },
            deps(""),
        );
        expect(await conversations()).toHaveLength(1);
        const [told] = await startNotices(env);
        expect(told).toContain("ran no hooks");
        expect(told).toContain("recorded at the catch-up instead");
        expect(told).not.toContain("reviewed");
    });

    it("records a session no hook ran for though its notice can't be kept", async () => {
        // The notices' file a directory: adding a notice throws.
        await mkdir(join(home, "state", "dorothy", "notices.jsonl"), {
            recursive: true,
        });
        expect(
            await runClaudeHook(
                { kind: "catch-up", launch: LAUNCH, session: null },
                deps(""),
            ),
        ).toBe(0);
        expect(await conversations()).toHaveLength(1);
        expect(reviews).toHaveLength(1);
        expect(await readLaunch(env, LAUNCH)).toBeNull();
        expect(await readFile(hookLogPath(env), "utf8")).toContain(
            "can't be kept",
        );
    });

    it("logs a failed call with its error, never the conversation's title", async () => {
        const answers = [
            {
                ok: true as const,
                output: { ...NOTES, title: "Tea at the Ritz" },
                model: "m",
                costUsd: 0.01,
            },
            {
                ok: false as const,
                reason: "API Error: 401 Invalid bearer token",
                costUsd: 0,
            },
        ];
        const scripted: StructuredCall = async () =>
            answers.shift() ?? { ok: false, reason: "none left", costUsd: 0 };
        await runClaudeHook(
            { kind: "hook" },
            {
                ...deps(input("Stop")),
                agent: async () => ({ call: scripted, persona: "" }),
            },
        );
        await writeFile(
            claude,
            `${userLine("u1", 1, "hello")}\n${assistantLine("a1", 2, [text("Hi.")])}\n${userLine("u2", 3, "more")}\n${assistantLine("a2", 4, [text("Yes.")])}\n`,
        );
        await runClaudeHook(
            { kind: "catch-up", launch: LAUNCH, session: null },
            {
                ...deps(""),
                agent: async () => ({ call: scripted, persona: "" }),
            },
        );
        expect(answers).toEqual([]);
        const [name] = await conversations();
        const phrase = (name ?? "").replace(/\.jsonl$/, "");
        const log = await readFile(hookLogPath(env), "utf8");
        expect(log).toContain(
            `review of ${phrase}: the review call failed (API Error: 401 Invalid bearer token)`,
        );
        expect(log).not.toContain("Tea at the Ritz");
    });

    it("logs notes it could not use by their kind alone", async () => {
        const unusable: StructuredCall = async () => ({
            ok: true as const,
            output: { ...NOTES, title: "" },
            model: "m",
            costUsd: 0.01,
        });
        await runClaudeHook(
            { kind: "hook" },
            {
                ...deps(input("Stop")),
                agent: async () => ({ call: unusable, persona: "" }),
            },
        );
        const [name] = await conversations();
        const phrase = (name ?? "").replace(/\.jsonl$/, "");
        const log = await readFile(hookLogPath(env), "utf8");
        expect(log).toContain(
            `review of ${phrase}: the review's notes were not usable`,
        );
        expect(log).not.toContain("the title is empty");
    });

    it("reads a halted session again once it can, and dismisses one", async () => {
        await writeFile(claude, `${userLine("u1", 1, "hello")}\n{bad\n`);
        await runClaudeHook({ kind: "hook" }, deps(input("Stop")));
        expect(await readRecord(env, SESSION)).not.toBeNull();
        expect(await runClaudeHook({ kind: "reread" }, deps(""))).toBe(1);
        expect(said).toContain(`${SESSION} still can't be read`);
        await writeFile(
            claude,
            `${userLine("u1", 1, "hello")}\n${userLine("u2", 3, "mended")}\n`,
        );
        said = "";
        expect(await runClaudeHook({ kind: "reread" }, deps(""))).toBe(0);
        expect(said).toContain(`read ${SESSION} to its end`);
        expect(await readRecord(env, SESSION)).toBeNull();
        await keepHalt(
            env,
            {
                session: SESSION,
                conversation: null,
                transcript: claude,
                dir: "/w",
                since: null,
                line: 2,
                type: null,
                uuid: null,
                reason: "r",
                at: "t",
            },
            ["{bad"],
        );
        expect(
            await runClaudeHook(
                { kind: "dismiss", session: SESSION },
                deps(""),
            ),
        ).toBe(0);
        expect(await startNotices(env)).toEqual([]);
    });

    it("rereads a session whose launch is gone to its end, a call never answered failed", async () => {
        await writeFile(claude, `${userLine("u1", 1, "hello")}\n{bad\n`);
        await runClaudeHook({ kind: "hook" }, deps(input("Stop")));
        await removeLaunch(env, LAUNCH);
        await writeFile(
            claude,
            `${userLine("u1", 1, "hello")}\n${assistantLine("a1", 2, [use("t1", "Bash", { command: "ls" })])}\n`,
        );
        said = "";
        expect(await runClaudeHook({ kind: "reread" }, deps(""))).toBe(0);
        expect(said).toContain(`read ${SESSION} to its end`);
        const [name] = await conversations();
        const kept = await readFile(
            join(transcriptDir(env), name ?? ""),
            "utf8",
        );
        expect(kept).toContain('"kind":"tool"');
        expect(kept).toContain('"sourceUuid":"a1"');
    });

    it("rereads a session with nothing to record as read to its end", async () => {
        await writeFile(claude, "{bad\n");
        await runClaudeHook({ kind: "hook" }, deps(input("Stop")));
        expect(await readRecord(env, SESSION)).not.toBeNull();
        await writeFile(claude, `${meta("custom-title")}\n`);
        said = "";
        expect(await runClaudeHook({ kind: "reread" }, deps(""))).toBe(0);
        expect(said).toContain(`read ${SESSION} to its end`);
        expect(said).not.toContain("still can't be read");
        expect(await readRecord(env, SESSION)).toBeNull();
    });
});
