// vim:set expandtab shiftwidth=4 filetype=typescript:
// SPDX-License-Identifier: GPL-3.0-only

//
//
// ~chewygumxx/dorothy.git
// ::: :/packages/cli/src/claude.test.ts
//
//

import { describe, expect, it } from "bun:test";
import { EventEmitter } from "node:events";
import {
    existsSync,
    mkdtempSync,
    readdirSync,
    readFileSync,
    rmSync,
    statSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type Config, DEFAULT_CONFIG } from "@dorothy/core";
import { MARKER } from "@dorothy/gateway";
import type { LaunchNote } from "@dorothy/memory";
import {
    type ClaudeDeps,
    type ClaudeMemory,
    claudeArgs,
    dorothyFlags,
    hookSettings,
    mergeJson,
    privateWriter,
    runClaude,
} from "./claude.js";

const LAUNCH = "6c84fb90-12c4-11e1-840d-7b25c5ee775a";
const SESSION = "0f8fad5b-d9cb-469f-a165-70867728950e";
const OTHER = "7d95fc01-23d5-42f2-951e-8c36d6ff886b";
const SESSION2 = "1a9fbe6c-eadc-4a7f-b276-81978839a61f";
const SELF = ["/bin/bun", "/d/index.ts"];

function harness(exit: number | Promise<number> = 0, memoryOn = false) {
    const calls = {
        cmd: [] as string[],
        env: {} as Record<string, string | undefined>,
        cwd: undefined as string | undefined,
        upstream: "",
        section: "",
        stopped: false,
        killed: [] as string[],
        err: "",
        spawned: [] as string[][],
    };
    const signals = new EventEmitter();
    const stats = { injected: 0, drift: 0 };
    const memory = {
        synced: [] as string[],
        blocks: 0,
        blockFor: [] as (string | null)[],
        noted: [] as Omit<LaunchNote, "v">[],
        // What the fakes answer: launches left behind, notices left.
        stale: [] as string[],
        notices: [] as string[],
    };
    const withMemory = (enabled: boolean, recall = true): Config => ({
        ...DEFAULT_CONFIG,
        memory: { ...DEFAULT_CONFIG.memory, enabled, recall },
    });
    const deps: ClaudeDeps = {
        env: { PATH: "/bin", HOME: "/home/u" },
        which: (command, { PATH }) =>
            command === "claude" && PATH === "/bin" ? "/bin/claude" : null,
        startGateway: ({ upstream, section }) => {
            calls.upstream = upstream;
            calls.section = section;
            return {
                url: "http://127.0.0.1:4321",
                stats,
                stop: () => {
                    calls.stopped = true;
                },
            };
        },
        spawn: (cmd, env, cwd) => {
            calls.cmd = cmd;
            calls.env = env;
            calls.cwd = cwd;
            return {
                exited: Promise.resolve(exit),
                kill: (signal) => {
                    calls.killed.push(String(signal));
                },
            };
        },
        write: (text) => {
            calls.err += text;
        },
        signals,
        config: async () => ({ config: withMemory(memoryOn), warnings: [] }),
        memory: {
            block: async (_env, session) => {
                memory.blocks += 1;
                memory.blockFor.push(session);
                return { block: "<memory>m</memory>", warnings: [] };
            },
            sync: async (dir) => {
                memory.synced.push(dir);
                return null;
            },
            note: async (note) => {
                memory.noted.push(note);
            },
            stale: async () => memory.stale,
            notices: async () => memory.notices,
        },
        spawnDetached: (cmd) => {
            calls.spawned.push(cmd);
        },
        newId: (() => {
            const ids = [LAUNCH, SESSION];
            return () => ids.shift() ?? "no more ids";
        })(),
        now: () => new Date("2026-10-15T09:00:00.000Z"),
        cwd: "/work",
        self: SELF,
        read: () => {
            throw new Error("no such file");
        },
        writePrivate: () => {
            throw new Error("no private file expected");
        },
    };
    return { calls, deps, memory, signals, stats };
}

describe("runClaude", () => {
    it("runs claude through the gateway, the marker first", async () => {
        const { calls, deps } = harness();
        expect(await runClaude(["-p", "hi"], deps)).toBe(0);
        expect(calls.cmd).toEqual([
            "/bin/claude",
            "--append-system-prompt",
            MARKER,
            "-p",
            "hi",
        ]);
        expect(calls.env).toEqual({
            PATH: "/bin",
            HOME: "/home/u",
            ANTHROPIC_BASE_URL: "http://127.0.0.1:4321",
            ENABLE_TOOL_SEARCH: "1",
        });
        expect(calls.upstream).toBe("https://api.anthropic.com");
        expect(calls.cwd).toBeUndefined();
        expect(calls.stopped).toBe(true);
        expect(calls.err).toBe("");
    });

    it("chains onto the user's own base URL", async () => {
        const { calls, deps } = harness();
        deps.env = { ...deps.env, ANTHROPIC_BASE_URL: "http://proxy/x" };
        await runClaude([], deps);
        expect(calls.upstream).toBe("http://proxy/x");
        expect(calls.env.ANTHROPIC_BASE_URL).toBe("http://127.0.0.1:4321");
    });

    it("passes the user's own base URL on to the hook's reviews, and no other", async () => {
        const { calls, deps } = harness();
        deps.env = { ...deps.env, ANTHROPIC_BASE_URL: "http://proxy/x" };
        await runClaude([], deps);
        expect(calls.env.DOROTHY_ANTHROPIC_BASE_URL).toBe("http://proxy/x");
        // Without one, a variable of an outer launch is not passed on.
        const bare = harness();
        bare.deps.env = {
            ...bare.deps.env,
            DOROTHY_ANTHROPIC_BASE_URL: "http://outer/x",
        };
        await runClaude([], bare.deps);
        expect("DOROTHY_ANTHROPIC_BASE_URL" in bare.calls.env).toBe(false);
        const empty = harness();
        empty.deps.env = { ...empty.deps.env, ANTHROPIC_BASE_URL: "" };
        await runClaude([], empty.deps);
        expect("DOROTHY_ANTHROPIC_BASE_URL" in empty.calls.env).toBe(false);
    });

    it("exits as claude did, a signal's code included", async () => {
        expect(await runClaude([], harness(3).deps)).toBe(3);
        // A real child killed by TERM, in claude's place.
        const { deps } = harness();
        deps.spawn = (_, env) =>
            Bun.spawn(["sh", "-c", "kill -TERM $$"], { env });
        expect(await runClaude([], deps)).toBe(143);
    });

    it("leaves a user's own ENABLE_TOOL_SEARCH alone", async () => {
        const { calls, deps } = harness();
        deps.env = { ...deps.env, ENABLE_TOOL_SEARCH: "0" };
        await runClaude([], deps);
        expect(calls.env.ENABLE_TOOL_SEARCH).toBe("0");
    });

    it("runs claude where a package script was run, with its PATH", async () => {
        const { calls, deps } = harness();
        deps.which = (_, { PATH }) =>
            PATH === "/bin:/opt/tool/node_modules/.bin" ? "/bin/claude" : null;
        deps.env = {
            HOME: "/home/u",
            PATH: [
                "/tmp/bun-node-1",
                "/repo/docs/node_modules/.bin",
                "/repo/node_modules/.bin",
                "/node_modules/.bin",
                "/bin",
                "/opt/tool/node_modules/.bin",
            ].join(":"),
            npm_lifecycle_event: "dev",
            npm_config_local_prefix: "/repo/docs",
        };
        expect(await runClaude([], deps)).toBe(0);
        expect(calls.cwd).toBe("/repo/docs");
        expect(calls.env).toEqual({
            HOME: "/home/u",
            PATH: "/bin:/opt/tool/node_modules/.bin",
            ANTHROPIC_BASE_URL: "http://127.0.0.1:4321",
            ENABLE_TOOL_SEARCH: "1",
        });
    });

    it("says so, and exits 127, when claude is not on PATH", async () => {
        const { calls, deps } = harness();
        deps.env = { PATH: "/nowhere" };
        expect(await runClaude([], deps)).toBe(127);
        expect(calls.err).toBe("dorothy: claude is not on PATH\n");
        expect(calls.cmd).toEqual([]);
    });

    it("exits 1 without claude when the gateway cannot start", async () => {
        const { calls, deps } = harness();
        deps.startGateway = () => {
            throw new Error("EADDRINUSE");
        };
        expect(await runClaude([], deps)).toBe(1);
        expect(calls.err).toBe(
            "dorothy: the gateway could not start: EADDRINUSE\n",
        );
        expect(calls.cmd).toEqual([]);
    });

    it("forwards TERM and HUP, and leaves INT to the terminal", async () => {
        let finish = (_: number) => {};
        const { calls, deps, signals } = harness(
            new Promise<number>((resolve) => {
                finish = resolve;
            }),
        );
        const running = runClaude([], deps);
        await Bun.sleep(0);
        signals.emit("SIGINT");
        signals.emit("SIGTERM");
        signals.emit("SIGHUP");
        expect(calls.killed).toEqual(["SIGTERM", "SIGHUP"]);
        expect(signals.listenerCount("SIGINT")).toBe(1);
        finish(0);
        await running;
        for (const name of ["SIGINT", "SIGTERM", "SIGHUP"]) {
            expect(signals.listenerCount(name)).toBe(0);
        }
    });

    it("warns after claude exits if any marked request slipped through", async () => {
        const { calls, deps, stats } = harness();
        // The fake gateway's stats, read once claude has exited.
        stats.drift = 2;
        await runClaude([], deps);
        expect(calls.err).toBe(
            "dorothy: 2 requests carried the identity marker but could not be rewritten; Claude Code may have changed how it sends its prompt\n",
        );
    });
});

describe("claudeArgs", () => {
    const FLAG = "--append-system-prompt";

    it("appends the marker before the user's arguments", () => {
        expect(claudeArgs(["-p", "hi"])).toEqual([FLAG, MARKER, "-p", "hi"]);
    });

    // Claude Code keeps only the last --append-system-prompt, so the
    // user's own would drop the marker; it goes in the same one.
    it("carries the user's own appended text with the marker", () => {
        expect(claudeArgs(["-p", FLAG, "Be brief.", "hi"])).toEqual([
            FLAG,
            `Be brief.\n\n${MARKER}`,
            "-p",
            "hi",
        ]);
        expect(claudeArgs([`${FLAG}=Be brief.`, "-p"])).toEqual([
            FLAG,
            `Be brief.\n\n${MARKER}`,
            "-p",
        ]);
    });

    it("keeps only the last, as Claude Code would", () => {
        expect(claudeArgs([FLAG, "First.", `${FLAG}=Second.`])).toEqual([
            FLAG,
            `Second.\n\n${MARKER}`,
        ]);
    });

    it("leaves what follows -- and a flag without a value alone", () => {
        expect(claudeArgs(["--", FLAG, "x"])).toEqual([
            FLAG,
            MARKER,
            "--",
            FLAG,
            "x",
        ]);
        expect(claudeArgs(["-p", FLAG])).toEqual([FLAG, MARKER, "-p", FLAG]);
    });
});

describe("dorothy --claude with memory", () => {
    const SETTINGS = `--settings=${JSON.stringify({
        permissions: {
            allow: [
                "mcp__dorothy-memory__search",
                "mcp__dorothy-memory__open",
                "mcp__dorothy-memory__tags",
                "mcp__dorothy-memory__remember",
            ],
        },
        ...hookSettings(SELF),
    })}`;
    const MCP = `--mcp-config=${JSON.stringify({
        mcpServers: {
            "dorothy-memory": {
                type: "stdio",
                command: "/bin/bun",
                args: ["/d/index.ts", "--recall-server", "--project", "/work"],
            },
        },
    })}`;

    it("syncs, places the block, serves recall and turns auto memory off", async () => {
        const { calls, deps, memory } = harness(0, true);
        expect(await runClaude(["-p", "hi"], deps)).toBe(0);
        expect(memory.synced).toEqual(["/work"]);
        expect(calls.section).toBe("<memory>m</memory>");
        expect(calls.cmd).toEqual([
            "/bin/claude",
            "--append-system-prompt",
            MARKER,
            SETTINGS,
            MCP,
            `--session-id=${SESSION}`,
            "-p",
            "hi",
        ]);
        expect(calls.env.CLAUDE_CODE_DISABLE_AUTO_MEMORY).toBe("1");
    });

    it("goes on when sync fails, saying so", async () => {
        const { calls, deps } = harness(0, true);
        deps.memory = {
            ...(deps.memory as ClaudeMemory),
            block: async () => ({ block: "", warnings: [] }),
            sync: async () => "a conflict",
        };
        expect(await runClaude([], deps)).toBe(0);
        expect(calls.err).toBe("dorothy: sync failed: a conflict\n");
    });

    it("starts without the block when it cannot be built, saying so", async () => {
        const { calls, deps } = harness(0, true);
        deps.memory = {
            ...(deps.memory as ClaudeMemory),
            block: async () => {
                throw new Error("index locked");
            },
            sync: async () => null,
        };
        expect(await runClaude([], deps)).toBe(0);
        expect(calls.section).toBe("");
        expect(calls.err).toBe(
            "dorothy: the memory block could not be built (index locked); starting without it\n",
        );
    });

    it("serves no recall with recall off, but keeps the block", async () => {
        const { calls, deps } = harness(0, true);
        deps.config = async () => ({
            config: {
                ...DEFAULT_CONFIG,
                memory: { ...DEFAULT_CONFIG.memory, recall: false },
            },
            warnings: [],
        });
        await runClaude([], deps);
        expect(calls.cmd).toEqual([
            "/bin/claude",
            "--append-system-prompt",
            MARKER,
            `--settings=${JSON.stringify(hookSettings(SELF))}`,
            `--session-id=${SESSION}`,
        ]);
        expect(calls.section).toBe("<memory>m</memory>");
    });

    it("runs claude as today with memory off", async () => {
        const { calls, deps, memory } = harness(0, false);
        deps.env = { ...deps.env, DOROTHY_LAUNCH: OTHER };
        await runClaude(["-p", "hi"], deps);
        expect(memory).toMatchObject({ synced: [], blocks: 0, noted: [] });
        // A launch it runs inside is not its own.
        expect(calls.env.DOROTHY_LAUNCH).toBeUndefined();
        expect(calls.spawned).toEqual([]);
        expect(calls.cmd).toEqual([
            "/bin/claude",
            "--append-system-prompt",
            MARKER,
            "-p",
            "hi",
        ]);
        expect(calls.env.CLAUDE_CODE_DISABLE_AUTO_MEMORY).toBeUndefined();
    });
});

describe("dorothy --claude records her sessions", () => {
    const HOOK = "'/bin/bun' '/d/index.ts' '--claude-hook'";

    it("notes the launch, names a new session, and passes hooks that run this program", async () => {
        const { calls, deps, memory } = harness(0, true);
        deps.config = async () => ({
            config: {
                ...DEFAULT_CONFIG,
                memory: { ...DEFAULT_CONFIG.memory, recall: false },
            },
            warnings: [],
        });
        expect(await runClaude(["-p", "hi"], deps)).toBe(0);
        expect(memory.noted).toEqual([
            {
                launch: LAUNCH,
                pid: process.pid,
                started: "2026-10-15T09:00:00.000Z",
                dir: "/work",
                session: SESSION,
                claude: "/home/u/.claude",
            },
        ]);
        expect(calls.env.DOROTHY_LAUNCH).toBe(LAUNCH);
        expect(calls.cmd).toEqual([
            "/bin/claude",
            "--append-system-prompt",
            MARKER,
            `--settings=${JSON.stringify({
                hooks: {
                    Stop: [
                        {
                            hooks: [
                                { type: "command", command: HOOK, async: true },
                            ],
                        },
                    ],
                    SessionEnd: [
                        {
                            hooks: [
                                { type: "command", command: HOOK, timeout: 10 },
                            ],
                        },
                    ],
                },
            })}`,
            `--session-id=${SESSION}`,
            "-p",
            "hi",
        ]);
    });

    it("takes Claude Code's config directory from claude's environment", async () => {
        const { deps, memory } = harness(0, true);
        deps.env = { ...deps.env, CLAUDE_CONFIG_DIR: "/cfg" };
        await runClaude([], deps);
        expect(memory.noted[0]?.claude).toBe("/cfg");
    });

    it("catches up its launch once claude exits, in a process of its own", async () => {
        const { calls, deps } = harness(0, true);
        await runClaude([], deps);
        expect(calls.spawned).toEqual([
            [...SELF, "--claude-hook", "--catch-up", LAUNCH],
        ]);
    });

    it("catches up its launch though claude never started", async () => {
        const { calls, deps } = harness(0, true);
        deps.spawn = () => {
            throw new Error("ENOENT: spawn claude");
        };
        await expect(runClaude([], deps)).rejects.toThrow("ENOENT");
        expect(calls.stopped).toBe(true);
        expect(calls.spawned).toEqual([
            [...SELF, "--claude-hook", "--catch-up", LAUNCH],
        ]);
    });

    it("cleans up and catches up though stopping the gateway throws", async () => {
        const { calls, deps } = harness(0, true);
        const removed: string[] = [];
        deps.startGateway = () => ({
            url: "http://127.0.0.1:4321",
            stats: { injected: 0, drift: 0 },
            stop: () => {
                throw new Error("already closed");
            },
        });
        deps.read = () => '{"model":"x"}';
        deps.writePrivate = () => "/run/dorothy/settings-1.json";
        deps.remove = (path) => removed.push(path);
        await expect(
            runClaude(["--settings", "mine.json"], deps),
        ).rejects.toThrow("already closed");
        expect(removed).toEqual(["/run/dorothy/settings-1.json"]);
        expect(calls.spawned).toEqual([
            [...SELF, "--claude-hook", "--catch-up", LAUNCH],
        ]);
    });

    it("catches up launches left behind and tells what hooks left, with memory off too", async () => {
        const { calls, deps, memory } = harness(0, false);
        memory.stale = [OTHER];
        memory.notices = ["memory: Claude Code ran no hooks in session x"];
        await runClaude([], deps);
        expect(calls.spawned).toEqual([
            [...SELF, "--claude-hook", "--catch-up", OTHER],
        ]);
        expect(calls.err).toBe(
            "dorothy: memory: Claude Code ran no hooks in session x\n",
        );
        expect(memory.noted).toEqual([]);
    });

    it("lets the arguments choose the session, leaving a resumed one's conversation out of the block", async () => {
        // The arguments, the session noted, the one the block leaves out.
        const cases: [string[], string | null, string | null][] = [
            [["--resume", OTHER], null, OTHER],
            [["-r", OTHER, "-p", "x"], null, OTHER],
            [[`--resume=${OTHER}`], null, OTHER],
            [["--resume", "my-title"], null, null],
            [["--resume"], null, null],
            [["-c"], null, null],
            [["--continue", "-p", "x"], null, null],
            [["--from-pr", "12"], null, null],
            [["--session-id", OTHER], OTHER, null],
            [[`--session-id=${OTHER}`], OTHER, null],
            [["-p", "--", "--resume", OTHER], SESSION, null],
            // -r with its value attached, as claude takes it.
            [[`-r${OTHER}`], null, OTHER],
            [["-rmy-title"], null, null],
            // A resume decides it wherever a --session-id stands.
            [["--session-id", SESSION2, "--resume", OTHER], null, OTHER],
            [["--resume", OTHER, "--session-id", SESSION2], null, OTHER],
            [["-c", "--session-id", SESSION2], null, null],
            // The last --session-id, as Claude Code keeps it.
            [["--session-id", SESSION2, "--session-id", OTHER], OTHER, null],
            // A value that is itself a flag is not one.
            [["--system-prompt", "-c"], SESSION, null],
            [["--append-system-prompt=-c"], SESSION, null],
            [["--name", "--resume", "-p"], SESSION, null],
            [["--settings", "-r", "-p", "x"], SESSION, null],
        ];
        for (const [args, noted, left] of cases) {
            const { calls, deps, memory } = harness(0, true);
            await runClaude(args, deps);
            expect([args, memory.noted[0]?.session ?? null]).toEqual([
                args,
                noted,
            ]);
            expect([args, memory.blockFor]).toEqual([args, [left]]);
            expect([
                args,
                calls.cmd.includes(`--session-id=${SESSION}`),
            ]).toEqual([args, noted === SESSION]);
        }
    });

    it("records nothing when the launch cannot be noted, saying so", async () => {
        const { calls, deps } = harness(0, true);
        deps.memory = {
            ...(deps.memory as ClaudeMemory),
            note: async () => {
                throw new Error("read-only");
            },
        };
        await runClaude([], deps);
        expect(calls.err).toBe(
            "dorothy: this launch could not be noted (read-only); its sessions will not be recorded\n",
        );
        expect(calls.env.DOROTHY_LAUNCH).toBeUndefined();
        expect(
            calls.cmd.some(
                (arg) =>
                    arg.includes("--claude-hook") ||
                    arg.startsWith("--session-id"),
            ),
        ).toBe(false);
        expect(calls.spawned).toEqual([]);
    });

    it("goes on when memory cannot say what was left behind", async () => {
        const { calls, deps } = harness(0, false);
        deps.memory = {
            ...(deps.memory as ClaudeMemory),
            stale: async () => {
                throw new Error("no runtime directory");
            },
            notices: async () => {
                throw new Error("no state directory");
            },
        };
        expect(await runClaude([], deps)).toBe(0);
        expect(calls.err).toBe("");
    });
});

describe("dorothy --claude with the user's own settings file", () => {
    const withRuntime = async (
        name: string,
        run: (runtime: string) => Promise<void>,
    ) => {
        const runtime = mkdtempSync(join(tmpdir(), `${name}-`));
        try {
            await run(runtime);
        } finally {
            rmSync(runtime, { recursive: true, force: true });
        }
    };

    it("merges it into a private file, removed once claude exits", async () => {
        await withRuntime("dorothy-settings", async (runtime) => {
            const { calls, deps } = harness(0, true);
            deps.env = { ...deps.env, XDG_RUNTIME_DIR: runtime };
            deps.read = (path) => {
                expect(path).toBe("/work/mine.json");
                return '{"env":{"TOKEN":"secret"}}';
            };
            deps.writePrivate = privateWriter(
                deps.env as Record<string, string>,
            );
            let during:
                | { path: string; text: string; mode: number }
                | undefined;
            const spawn = deps.spawn as NonNullable<ClaudeDeps["spawn"]>;
            deps.spawn = (cmd, env, cwd) => {
                const flag = cmd.find((arg) => arg.startsWith("--settings="));
                const path = (flag ?? "").slice("--settings=".length);
                during = {
                    path,
                    text: readFileSync(path, "utf8"),
                    mode: statSync(path).mode & 0o777,
                };
                return spawn(cmd, env, cwd);
            };
            expect(await runClaude(["--settings", "mine.json"], deps)).toBe(0);
            expect(calls.cmd.join(" ")).not.toContain("secret");
            expect(
                during?.path.startsWith(join(runtime, "dorothy", "settings-")),
            ).toBe(true);
            expect(JSON.parse(during?.text ?? "")).toEqual({
                env: { TOKEN: "secret" },
                permissions: {
                    allow: [
                        "mcp__dorothy-memory__search",
                        "mcp__dorothy-memory__open",
                        "mcp__dorothy-memory__tags",
                        "mcp__dorothy-memory__remember",
                    ],
                },
                ...hookSettings(SELF),
            });
            expect(during?.mode).toBe(0o600);
            expect(statSync(join(runtime, "dorothy")).mode & 0o777).toBe(0o700);
            expect(existsSync(during?.path ?? "")).toBe(false);
        });
    });

    it("keeps inline settings in argv, writing no file", async () => {
        await withRuntime("dorothy-inline", async (runtime) => {
            const { calls, deps } = harness(0, true);
            deps.env = { ...deps.env, XDG_RUNTIME_DIR: runtime };
            deps.writePrivate = privateWriter(
                deps.env as Record<string, string>,
            );
            await runClaude(["--settings", '{"model":"y"}'], deps);
            expect(calls.cmd.some((arg) => arg.includes('"model":"y"'))).toBe(
                true,
            );
            expect(readdirSync(runtime)).toEqual([]);
        });
    });

    it("falls back to a directory of its own in the temporary directory", async () => {
        await withRuntime("dorothy-tmp", async (tmp) => {
            const path = privateWriter({ TMPDIR: tmp })("{}");
            const uid = process.getuid?.() ?? 0;
            expect(
                path.startsWith(join(tmp, `dorothy-${uid}`, "settings-")),
            ).toBe(true);
            expect(statSync(path).mode & 0o777).toBe(0o600);
            expect(statSync(join(tmp, `dorothy-${uid}`)).mode & 0o777).toBe(
                0o700,
            );
        });
    });
});

describe("dorothyFlags", () => {
    const written: string[] = [];
    const io = (files: Record<string, string> = {}) => ({
        cwd: "/work",
        writePrivate: (text: string) => {
            written.push(text);
            return `/run/dorothy/s${written.length}.json`;
        },
        read: (path: string) => {
            const text = files[path];
            if (text === undefined) {
                throw new Error(`ENOENT: ${path}`);
            }
            return text;
        },
    });
    const ours = {
        settings: { permissions: { allow: ["a"] } },
        mcpConfig: null,
    };

    it("merges a settings file into a private file, passed by path", () => {
        const merged = { permissions: { allow: ["b", "a"] }, model: "x" };
        expect(
            dorothyFlags(
                ["--settings", "mine.json", "-p", "hi"],
                ours,
                io({
                    "/work/mine.json":
                        '{"permissions":{"allow":["b"]},"model":"x"}',
                }),
            ),
        ).toEqual({
            args: ["--settings=/run/dorothy/s1.json", "-p", "hi"],
            warnings: [],
            files: ["/run/dorothy/s1.json"],
        });
        expect(written).toEqual([JSON.stringify(merged)]);
    });

    it("keeps inline settings inline, with no file", () => {
        written.length = 0;
        expect(dorothyFlags([`--settings={"model":"y"}`], ours, io())).toEqual({
            args: [
                `--settings=${JSON.stringify({ model: "y", permissions: { allow: ["a"] } })}`,
            ],
            warnings: [],
            files: [],
        });
        expect(written).toEqual([]);
    });

    it("passes a file on as given, saying so, if the private file fails", () => {
        const failing = {
            ...io({ "/work/mine.json": '{"model":"x"}' }),
            writePrivate: () => {
                throw new Error("EACCES");
            },
        };
        expect(dorothyFlags(["--settings=mine.json"], ours, failing)).toEqual({
            args: [
                `--settings=${JSON.stringify(ours.settings)}`,
                "--settings=mine.json",
            ],
            warnings: [
                "a private settings file could not be written (EACCES); your --settings is passed on as given, and may override Dorothy's",
            ],
            files: [],
        });
    });

    it("passes on settings it cannot read, warning that they may override hers", () => {
        expect(dorothyFlags(["--settings", "gone.json"], ours, io())).toEqual({
            args: [
                `--settings=${JSON.stringify(ours.settings)}`,
                "--settings",
                "gone.json",
            ],
            warnings: [
                "your --settings could not be read (ENOENT: /work/gone.json); it is passed on as given, and may override Dorothy's",
            ],
            files: [],
        });
    });

    it("leaves what follows -- alone, and the user's flags without hers", () => {
        expect(
            dorothyFlags(["--", "--settings", "x"], ours, io()).args,
        ).toEqual([
            `--settings=${JSON.stringify(ours.settings)}`,
            "--",
            "--settings",
            "x",
        ]);
        expect(
            dorothyFlags(
                ["--settings", "x"],
                { settings: null, mcpConfig: null },
                io(),
            ).args,
        ).toEqual(["--settings", "x"]);
    });

    it("passes a user's --mcp-config on as given, after hers", () => {
        const mcpConfig = { mcpServers: { dorothy: { type: "stdio" } } };
        expect(
            dorothyFlags(
                ["--mcp-config", "mine.json", "-p", "hi"],
                { settings: null, mcpConfig },
                io(),
            ),
        ).toEqual({
            args: [
                `--mcp-config=${JSON.stringify(mcpConfig)}`,
                "--mcp-config",
                "mine.json",
                "-p",
                "hi",
            ],
            warnings: [],
            files: [],
        });
    });

    it("merges objects key by key and joins arrays without repeats", () => {
        expect(
            mergeJson(
                { a: [1, 2], b: { c: 1 } },
                { a: [2, 3], b: { d: 2 }, e: 1 },
            ),
        ).toEqual({
            a: [1, 2, 3],
            b: { c: 1, d: 2 },
            e: 1,
        });
    });
});
