// vim:set expandtab shiftwidth=4 filetype=typescript:
// SPDX-License-Identifier: GPL-3.0-only

//
//
// ~chewygumxx/dorothy.git
// ::: :/packages/memory/src/memory/open.test.ts
//
//

import {
    afterEach,
    beforeEach,
    describe,
    expect,
    it,
    setSystemTime,
} from "bun:test";
import { randomBytes } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
    type ChatSession,
    configPath,
    DEFAULT_CONFIG,
    newPhrase,
    type SessionStart,
    type StructuredCall,
    withSection,
    xdgDir,
} from "@dorothy/core";
import { transcriptDir, transcriptPath } from "../transcript.js";
import { FakeSession } from "./fake-session.js";
import {
    closeInOrder,
    clusterSaver,
    indexClaims,
    indexUses,
    launchHistory,
    type MemoryPrompts,
    mergeNotices,
    notesReady,
    openChatIndex,
    openIndex,
    openMemory,
    sessionMaker,
    turnCommitter,
    withTurnEnd,
} from "./open.js";

// openMemory reads the config and opens the transcript and the index from
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

describe("indexUses", () => {
    it("asks for the index for compaction when this chat compacts, whatever memory says", () => {
        const memoryOff = {
            ...DEFAULT_CONFIG,
            memory: { ...DEFAULT_CONFIG.memory, enabled: false, recall: false },
        };
        expect(indexUses(memoryOff, true)).toEqual({
            memory: false,
            recall: false,
            compaction: true,
        });
        // Compaction on in the config, but off for this chat: its notes
        // can't be read.
        expect(indexUses(DEFAULT_CONFIG, false)).toEqual({
            memory: DEFAULT_CONFIG.memory.enabled,
            recall: DEFAULT_CONFIG.memory.recall,
            compaction: false,
        });
    });
});

describe("openChatIndex", () => {
    const memoryOff = {
        ...DEFAULT_CONFIG,
        memory: { ...DEFAULT_CONFIG.memory, enabled: false, recall: false },
    };
    const indexFile = () =>
        join(
            xdgDir(process.env, "XDG_CACHE_HOME", ".cache"),
            "dorothy",
            "recall.sqlite",
        );

    it("opens the index in the cache for compaction alone", () => {
        const opened = openChatIndex(memoryOff, true);
        try {
            expect(opened.index).not.toBeNull();
            expect(opened.warning).toBeNull();
            expect(indexFile()).toStartWith(dir);
            expect(existsSync(indexFile())).toBe(true);
        } finally {
            opened.index?.close();
        }
    });

    it("opens no index when nothing in this chat uses it", () => {
        const opened = openChatIndex(memoryOff, false);
        opened.index?.close();
        expect(opened).toEqual({ index: null, warning: null });
        expect(existsSync(indexFile())).toBe(false);
    });
});

describe("openIndex", () => {
    const off = { memory: false, recall: false, compaction: false };
    const failing = () => {
        throw new Error("disk gone");
    };

    it("opens the index for compaction alone, for its claim and lock", () => {
        const index = { name: "index" };
        expect(openIndex({ ...off, compaction: true }, () => index)).toEqual({
            index,
            warning: null,
        });
    });

    it("leaves the index shut when nothing uses it", () => {
        let opened = 0;
        expect(openIndex(off, () => ++opened)).toEqual({
            index: null,
            warning: null,
        });
        expect(opened).toBe(0);
    });

    it("names what starts without the index when it can't be opened", () => {
        expect(openIndex({ ...off, compaction: true }, failing)).toEqual({
            index: null,
            warning:
                "index: can't be opened (disk gone); starting without compaction's lock",
        });
        expect(
            openIndex({ memory: true, recall: true, compaction: true }, failing)
                .warning,
        ).toBe(
            "memory: the index can't be opened (disk gone); starting without memory, recall and compaction's lock",
        );
        expect(
            openIndex({ ...off, memory: true, recall: true }, failing).warning,
        ).toBe(
            "memory: the index can't be opened (disk gone); starting without memory and recall",
        );
    });
});

describe("closeInOrder", () => {
    it("runs every step in order even when an earlier one throws, then rethrows the first", async () => {
        const ran: string[] = [];
        const step = (name: string, fail?: string) => async () => {
            ran.push(name);
            if (fail !== undefined) {
                throw new Error(fail);
            }
        };
        await expect(
            closeInOrder([
                step("compaction", "first"),
                step("memory"),
                step("index", "second"),
                step("transcript"),
            ]),
        ).rejects.toThrow("first");
        expect(ran).toEqual(["compaction", "memory", "index", "transcript"]);
    });

    it("settles quietly when every step does", async () => {
        const ran: string[] = [];
        await closeInOrder([
            () => {
                ran.push("a");
            },
            async () => {
                ran.push("b");
            },
        ]);
        expect(ran).toEqual(["a", "b"]);
    });
});

describe("indexClaims", () => {
    it("renews a chain's claim at each take, so it lives a call's length from each run", async () => {
        // The index's claims table, as the store keeps it.
        const table = new Map<string, { owner: string; until: number }>();
        const index = {
            claim: async (
                phrase: string,
                owner: string,
                now: number,
                ms: number,
            ) => {
                const row = table.get(phrase);
                if (row === undefined || row.until <= now) {
                    table.set(phrase, { owner, until: now + ms });
                }
                return table.get(phrase)?.owner === owner;
            },
            renew: async (
                phrase: string,
                owner: string,
                now: number,
                ms: number,
            ) => {
                const row = table.get(phrase);
                if (row?.owner !== owner || row.until <= now) {
                    return false;
                }
                row.until = now + ms;
                return true;
            },
            release: async (phrase: string, owner: string) => {
                if (table.get(phrase)?.owner === owner) {
                    table.delete(phrase);
                }
            },
        };
        const claims = indexClaims(index, "a-phrase");
        const chain = claims();
        try {
            setSystemTime(new Date(0));
            expect(await chain.take()).toBe(true);
            // The chain's second run, near the end of the first's life.
            setSystemTime(new Date(140_000));
            expect(await chain.take()).toBe(true);
            setSystemTime(new Date(200_000));
            expect(await claims().take()).toBe(false);
        } finally {
            setSystemTime();
        }
    });

    it("gives each chain its own owner, so two chains of one TUI exclude each other", async () => {
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
            renew: async (phrase: string, owner: string) =>
                table.get(phrase) === owner,
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
                turn: async (path, count) => {
                    log.push(`turn ${path} #${count}`);
                },
                warn: (message) => log.push(message),
            },
            "/data/x.jsonl",
            async () => {
                await new Promise((resolve) => setTimeout(resolve, 5));
                log.push("flushed");
            },
            3,
        );
        turns.ended();
        turns.ended();
        await turns.settled();
        expect(log).toEqual([
            "flushed",
            "turn /data/x.jsonl #4",
            "flushed",
            "turn /data/x.jsonl #5",
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
            0,
        );
        turns.ended();
        await turns.settled();
        expect(warnings).toEqual(["history: couldn't commit turn 1 (locked)"]);
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

describe("launchHistory", () => {
    // A bare repository with git isolated, local to this file, which
    // may not import from history (the package graph keeps it out).
    const gitEnv = { ...process.env, GIT_CONFIG_GLOBAL: "/dev/null" };
    const bareRepo = async () => {
        const path = await mkdtemp(join(dir, "mirror-"));
        const proc = Bun.spawn(["git", "init", "-q", "--bare", path], {
            env: gitEnv,
        });
        expect(await proc.exited).toBe(0);
        return path;
    };
    const sealedAt = async (bare: string) => {
        const proc = Bun.spawn(
            ["git", "rev-parse", "--verify", "-q", "refs/heads/sealed"],
            { cwd: bare, env: gitEnv, stdout: "pipe", stderr: "ignore" },
        );
        const out = await new Response(proc.stdout).text();
        return (await proc.exited) === 0 ? out.trim() : null;
    };

    it("adopts the data directory and asks for a mirror", async () => {
        const warnings: string[] = [];
        const launched = await launchHistory({
            config: DEFAULT_CONFIG,
            index: null,
            warnings,
            hook: null,
        });
        expect(launched).not.toBeNull();
        expect(existsSync(join(dir, "dorothy", ".git", "HEAD"))).toBe(true);
        expect(warnings).toEqual([
            "memory has no mirror · dorothy --mirror <url>",
        ]);
        await launched?.close();
    });

    it("pushes to a mirror at every launch, even when nothing waits", async () => {
        const key = randomBytes(32).toString("base64");
        const env = { ...process.env, DOROTHY_MIRROR_KEY: key };
        const pushed = async (bare: string) => {
            for (let tries = 0; tries < 100; tries++) {
                const tip = await sealedAt(bare);
                if (tip !== null) {
                    return tip;
                }
                await new Promise((resolve) => setTimeout(resolve, 50));
            }
            return null;
        };
        const options = {
            config: DEFAULT_CONFIG,
            index: null,
            warnings: [] as string[],
            env,
            hook: null,
        };

        const first = await launchHistory(options);
        const bare = await bareRepo();
        await first?.history.repo.setRemote("mirror", bare);
        await first?.close();
        const second = await launchHistory(options);
        expect(await pushed(bare)).not.toBeNull();
        // Everything is sealed now, so nothing waits; a new mirror still
        // gets the branch at the next launch.
        const other = await bareRepo();
        await second?.history.repo.setRemote("mirror", other);
        await second?.close();
        const third = await launchHistory(options);
        expect(await pushed(other)).not.toBeNull();
        expect(options.warnings).toEqual([
            "memory has no mirror · dorothy --mirror <url>",
        ]);
        await third?.close();
    });

    it("repacks only once the launch's push is done", async () => {
        const options = {
            config: DEFAULT_CONFIG,
            index: null,
            warnings: [] as string[],
            env: {
                ...process.env,
                DOROTHY_MIRROR_KEY: randomBytes(32).toString("base64"),
            },
            hook: null,
        };
        const first = await launchHistory(options);
        const bare = await bareRepo();
        await first?.history.repo.setRemote("mirror", bare);
        await first?.close();
        let seen: string | null = null;
        let done!: () => void;
        const maintained = new Promise<void>((resolve) => {
            done = resolve;
        });
        const second = await launchHistory({
            ...options,
            maintain: async () => {
                seen = await sealedAt(bare);
                done();
                return true;
            },
        });
        await maintained;
        expect(seen).not.toBeNull();
        await second?.close();
    });

    it("is off when the config says so", async () => {
        expect(
            await launchHistory({
                config: { history: { enabled: false, pushSeconds: 60 } },
                index: null,
                warnings: [],
                hook: null,
            }),
        ).toBeNull();
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

    it("hands back the notes' clusters however much of those turns they cover, for compaction to judge", async () => {
        const phrase = newPhrase();
        const save = clusterSaver({ dir, phrase, transcript: true });
        expect(await save([cluster(5, 8)], 0.5)).toEqual({
            ok: true,
            clusters: [],
        });
        expect(await save([cluster(1, 6)], 0.5)).toEqual({ ok: true });
        expect(await save([cluster(5, 8)], 0.5)).toEqual({
            ok: true,
            clusters: [cluster(1, 6)],
        });
    });

    it("saves nothing without a transcript", async () => {
        const phrase = newPhrase();
        const save = clusterSaver({ dir, phrase, transcript: false });
        expect(await save([cluster(1, 4)], 0.25)).toEqual({ ok: true });
        await expect(notes(phrase)).rejects.toThrow();
    });

    it("records the compaction in history", async () => {
        const phrase = newPhrase();
        const recorded: { paths: readonly string[]; message: string }[] = [];
        const save = clusterSaver({
            dir,
            phrase,
            transcript: true,
            recorder: async (paths, message) => {
                recorded.push({ paths, message });
            },
        });
        expect(await save([cluster(1, 4)], 0.25)).toEqual({ ok: true });
        expect(recorded).toEqual([
            {
                paths: [join(dir, `${phrase}.meta.json`)],
                message: `compaction: ${phrase} (dorothy, claude-test)`,
            },
        ]);
    });
});

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

    it("reads and writes only under the test's directory", () => {
        // The cache holds the index and the CLI's home.
        const cache = xdgDir(process.env, "XDG_CACHE_HOME", ".cache");
        for (const path of [configPath(), transcriptDir(), cache]) {
            expect(path).toStartWith(dir);
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
