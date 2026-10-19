// vim:set expandtab shiftwidth=4 filetype=typescript:
// SPDX-License-Identifier: GPL-3.0-only

//
//
// ~chewygumxx/dorothy.git
// ::: :/packages/memory/src/memory/open.test.ts
//
//

import { beforeEach, describe, expect, it } from "bun:test";
import { existsSync } from "node:fs";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
    configPath,
    type SessionStart,
    type StructuredCall,
    withSection,
    xdgDir,
} from "@dorothy/core";
import { stateDir } from "../bodies/state.js";
import { addNotice } from "../bodies/unread.js";
import { dataRoot, putFact } from "../facts/store.js";
import { projectsPath } from "../projects/registry.js";
import { transcriptDir, transcriptPath } from "../transcript.js";
import { FakeSession } from "./fake-session.js";
import { type MemoryPrompts, openMemory } from "./open.js";

import { dir, useXdgDir } from "./open-testing.js";

useXdgDir();

describe("openMemory", () => {
    const env = process.env;
    const prompts: MemoryPrompts = {
        review: "R",
        compaction: "C",
        hash: (recall) => (recall ? "with" : "without"),
        session: (start) => withSection("S", start.memory),
    };
    const quiet: StructuredCall = async () => ({
        ok: false,
        reason: "not under test",
        costUsd: 0,
    });

    it("settles canonical turn counts after an error before closing history", async () => {
        const inner = new FakeSession();
        const opened = await openMemory({
            resume: null,
            call: quiet,
            prompts,
            connect: () => inner,
            recallLaunch: () => ({ command: "x", args: [] }),
            env,
        });
        if (!opened.ok) throw new Error(opened.message);
        const session = opened.memory.createSession([]);
        session.send("failed turn");
        inner.emit({ type: "error", message: "failed", partial: "" });
        session.send("successful turn");
        inner.emit({
            type: "turn-end",
            reply: "done",
            interrupted: false,
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
        await opened.memory.close();
        const child = Bun.spawn(["git", "log", "--format=%s"], {
            cwd: dataRoot(env),
            env: { ...env, GIT_CONFIG_GLOBAL: "/dev/null" },
            stdout: "pipe",
            stderr: "ignore",
        });
        const log = await new Response(child.stdout).text();
        expect(await child.exited).toBe(0);
        expect(log).toContain(`turn: ${opened.memory.phrase} #2`);
    });

    it("reads and writes only under the test's directory", () => {
        // The cache holds the index and the CLI's home.
        const cache = xdgDir(process.env, "XDG_CACHE_HOME", ".cache");
        for (const path of [
            configPath(),
            transcriptDir(),
            cache,
            stateDir(process.env),
        ]) {
            expect(path).toStartWith(dir);
        }
    });

    it("tells at its start what Claude Code's hooks could not", async () => {
        await addNotice(env, "memory: Claude Code ran no hooks in session x");
        const opened = await openMemory({
            resume: null,
            call: quiet,
            prompts,
            connect: () => new FakeSession(),
            recallLaunch: (phrase) => ({ command: "x", args: [phrase] }),
            env,
        });
        if (!opened.ok) {
            throw new Error(opened.message);
        }
        try {
            expect(opened.memory.warnings).toContain(
                "memory: Claude Code ran no hooks in session x",
            );
        } finally {
            await opened.memory.close();
        }
    });

    it("fails to resume a chat that has no transcript", async () => {
        const opened = await openMemory({
            resume: "tumble-orchid-vapor-lantern",
            call: quiet,
            prompts,
            connect: () => {
                throw new Error("no session expected");
            },
            recallLaunch: (phrase) => ({ command: "x", args: [phrase] }),
            env,
        });
        expect(opened.ok).toBe(false);
        if (!opened.ok) {
            expect(opened.message).toStartWith(
                "cannot resume tumble-orchid-vapor-lantern: ",
            );
        }
    });

    it("refuses to resume a Claude Code conversation", async () => {
        const phrase = "tumble-orchid-vapor-lantern";
        const session = "0f8fad5b-d9cb-469f-a165-70867728950e";
        await mkdir(transcriptDir(env), { recursive: true });
        await writeFile(
            transcriptPath(phrase, env),
            `${[
                {
                    v: 1,
                    kind: "session",
                    at: "2026-10-16T02:52:00.000Z",
                    phrase,
                    sdkSessionId: "",
                    model: "m",
                    promptHash: "",
                    resumed: false,
                    source: "claude-code",
                    sourceSession: session,
                },
                {
                    v: 1,
                    kind: "user",
                    at: "2026-10-16T02:52:01.000Z",
                    text: "hello",
                },
            ]
                .map((event) => JSON.stringify(event))
                .join("\n")}\n`,
        );
        const before = await readFile(transcriptPath(phrase, env), "utf8");
        const opened = await openMemory({
            resume: phrase,
            call: quiet,
            prompts,
            connect: () => {
                throw new Error("no session expected");
            },
            recallLaunch: (launched) => ({ command: "x", args: [launched] }),
            env,
        });
        expect(opened.ok).toBe(false);
        if (!opened.ok) {
            expect(opened.message).toBe(
                `cannot resume ${phrase}: it is a Claude Code conversation; resume it there with dorothy --claude --resume ${session}`,
            );
        }
        expect(await readFile(transcriptPath(phrase, env), "utf8")).toBe(
            before,
        );
    });

    it("starts sessions with memory's start and records them", async () => {
        const starts: SessionStart[] = [];
        const inner = new FakeSession();
        const opened = await openMemory({
            resume: null,
            call: quiet,
            prompts,
            connect: (start) => {
                starts.push(start);
                return inner;
            },
            recallLaunch: (phrase) => ({ command: "x", args: [phrase] }),
            env,
        });
        if (!opened.ok) {
            throw new Error(opened.message);
        }
        const { memory } = opened;
        try {
            memory.createSession([]).send("hello");
            inner.emit({ type: "ready", model: "m", sdkSessionId: "s" });
            expect(starts).toHaveLength(1);
            expect(starts[0]).toMatchObject({
                history: [],
                earlier: "",
                recollect: false,
            });
            expect(inner.sent).toEqual(["hello"]);
        } finally {
            await memory.close();
        }
        const text = await Bun.file(transcriptPath(memory.phrase, env)).text();
        expect(text).toContain('"kind":"user"');
        expect(text).toContain('"promptHash":"with"');
    });

    // Chat syncs the project it starts in, at its start, unless
    // [memory] is off. A fact in the store shows it in the repository.
    describe("project sync", () => {
        let repo = "";
        beforeEach(async () => {
            repo = join(dir, "repo");
            await mkdir(join(repo, ".git"), { recursive: true });
            await writeFile(
                join(repo, ".git", "config"),
                '[remote "origin"]\n\turl = git@github.com:chewygumxx/dorothy.git\n',
            );
            await putFact(
                dataRoot(env),
                { kind: "project", id: "github.com/chewygumxx/dorothy" },
                {
                    name: "stack",
                    title: "Stack",
                    description: "What it is built on.",
                    type: "project",
                    extra: {},
                    tags: [],
                    importance: null,
                    provenance: {
                        origin: "dorothy",
                        by: "dorothy",
                        at: "2026-10-15T09:30:00.000Z",
                        created: "2026-10-15T09:30:00.000Z",
                    },
                    retired: null,
                    body: "Bun and TypeScript.",
                },
            );
        });

        const openIn = async () => {
            const opened = await openMemory({
                resume: null,
                call: quiet,
                prompts,
                connect: () => new FakeSession(),
                recallLaunch: (phrase) => ({ command: "x", args: [phrase] }),
                cwd: repo,
                env,
            });
            if (!opened.ok) {
                throw new Error(opened.message);
            }
            return opened.memory;
        };

        it("syncs the project at its start, exporting its facts", async () => {
            const memory = await openIn();
            await memory.close();
            expect(existsSync(projectsPath(dataRoot(env)))).toBe(true);
            expect(
                existsSync(join(repo, ".agents", "memory", "stack.md")),
            ).toBe(true);
        });

        it("syncs nothing with [memory] off", async () => {
            await mkdir(join(dir, "dorothy"), { recursive: true });
            await writeFile(configPath(), "[memory]\nenabled = false\n");
            const memory = await openIn();
            await memory.close();
            expect(existsSync(projectsPath(dataRoot(env)))).toBe(false);
            expect(existsSync(join(repo, ".agents"))).toBe(false);
        });
    });

    // The recorder's warning travels recorder, notice channel, merged
    // notices, to the screen. A directory put where the transcript was
    // makes the writer's reopen fail, so the append is refused for real.
    it("warns on its notices when a transcript append fails", async () => {
        const inner = new FakeSession();
        const opened = await openMemory({
            resume: null,
            call: quiet,
            prompts,
            connect: () => inner,
            recallLaunch: (phrase) => ({ command: "x", args: [phrase] }),
            env,
        });
        if (!opened.ok) {
            throw new Error(opened.message);
        }
        const { memory } = opened;
        try {
            const path = transcriptPath(memory.phrase, env);
            await rm(path);
            await mkdir(path);
            const warned = new Promise<string>((resolve) => {
                memory.notices?.subscribe((notice) => {
                    if (notice.type === "warning") {
                        resolve(notice.message);
                    }
                });
            });
            memory.createSession([]).send("hello");
            expect(await warned).toStartWith("transcript not saved: ");
        } finally {
            await memory.close();
        }
    });

    // Memory's turn-end hook starts the first review, which flushes the
    // transcript and reads it: the reply must have been appended by then.
    it("has a turn's reply in the transcript when memory reviews it", async () => {
        const inner = new FakeSession();
        let phrase = "";
        // What the review found on disk, or, should it never ask, a
        // note saying so once the wait is up, so the test fails rather
        // than hangs.
        let reviewed: (transcript: string) => void = () => {};
        const read = new Promise<string>((resolve) => {
            reviewed = resolve;
        });
        let timer: ReturnType<typeof setTimeout> | undefined;
        let system = "";
        const unasked = new Promise<string>((resolve) => {
            timer = setTimeout(() => resolve("no review asked"), 2000);
        });
        const opened = await openMemory({
            resume: null,
            call: async (request) => {
                // Reviews run on the review prompt, never compaction's.
                system = request.system;
                reviewed(await Bun.file(transcriptPath(phrase, env)).text());
                return quiet(request);
            },
            prompts,
            connect: () => inner,
            recallLaunch: (phrase) => ({ command: "x", args: [phrase] }),
            env,
        });
        if (!opened.ok) {
            throw new Error(opened.message);
        }
        const { memory } = opened;
        phrase = memory.phrase;
        try {
            memory.createSession([]).send("hello");
            inner.emit({ type: "ready", model: "m", sdkSessionId: "s" });
            inner.emit({
                type: "turn-end",
                reply: "a reply to review",
                interrupted: false,
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
            expect(await Promise.race([read, unasked])).toContain(
                '"text":"a reply to review"',
            );
            expect(system).toStartWith("R");
        } finally {
            clearTimeout(timer);
            await memory.close();
        }
    });
});
