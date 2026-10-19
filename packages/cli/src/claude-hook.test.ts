// vim:set expandtab shiftwidth=4 filetype=typescript:
// SPDX-License-Identifier: GPL-3.0-only

//
//
// ~chewygumxx/dorothy.git
// ::: :/packages/cli/src/claude-hook.test.ts
//
//

import { describe, expect, it } from "bun:test";
import {
    existsSync,
    mkdirSync,
    mkdtempSync,
    readFileSync,
    rmSync,
    writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Env, StructuredCall } from "@dorothy/core";
import type { HookDeps, HookMode } from "@dorothy/memory/claude-hook";
import {
    checkoutRoot,
    type HookCliDeps,
    loadDotenv,
    reviewEnv,
    runHook,
} from "./claude-hook.js";

const LAUNCH = "6c84fb90-12c4-11e1-840d-7b25c5ee775a";
const SESSION = "0f8fad5b-d9cb-469f-a165-70867728950e";

// What claude gives its hooks: the gateway, the launch, its own
// variables and its sign-in, and the user's directories.
const fromClaude = (): Env => ({
    HOME: "/home/u",
    XDG_DATA_HOME: "/home/u/data",
    PATH: "/bin",
    ANTHROPIC_BASE_URL: "http://127.0.0.1:4321",
    ENABLE_TOOL_SEARCH: "1",
    DOROTHY_LAUNCH: LAUNCH,
    CLAUDECODE: "1",
    CLAUDE_CODE_ENTRYPOINT: "cli",
    CLAUDE_CODE_DISABLE_AUTO_MEMORY: "1",
    CLAUDE_CODE_OAUTH_TOKEN: "claude's",
});

const OURS = { HOME: "/home/u", XDG_DATA_HOME: "/home/u/data", PATH: "/bin" };

describe("reviewEnv", () => {
    it("drops the gateway, the launch and claude's own variables", () => {
        expect(reviewEnv(fromClaude())).toEqual(OURS);
    });

    it("takes the user's own base URL, which the launch passed on, as its own", () => {
        const proxied = {
            ...fromClaude(),
            DOROTHY_ANTHROPIC_BASE_URL: "http://proxy.example/v1",
        };
        expect(reviewEnv(proxied)).toEqual({
            ...OURS,
            DOROTHY_ANTHROPIC_BASE_URL: "http://proxy.example/v1",
            ANTHROPIC_BASE_URL: "http://proxy.example/v1",
        });
        // An empty one is none, and the gateway's is never kept.
        expect(
            reviewEnv({ ...fromClaude(), DOROTHY_ANTHROPIC_BASE_URL: "" })
                .ANTHROPIC_BASE_URL,
        ).toBeUndefined();
    });
});

describe("runHook", () => {
    function harness() {
        const env = fromClaude();
        const seen = {
            loaded: [] as string[],
            agents: 0,
            mode: undefined as HookMode | undefined,
            deps: undefined as HookDeps | undefined,
        };
        const call: StructuredCall = async () => ({
            ok: false,
            reason: "fake",
            costUsd: 0,
        });
        const deps: HookCliDeps = {
            env,
            root: "/d",
            self: ["/bin/bun", "/d/packages/cli/src/index.ts"],
            // As dotenvx does: a variable already set is kept.
            load: (path, keys, into) => {
                seen.loaded.push(path, keys);
                into.CLAUDE_CODE_OAUTH_TOKEN ??= "dorothy's";
            },
            agent: async () => {
                seen.agents += 1;
                return { call, persona: "You are Dorothy." };
            },
            run: async (mode, given) => {
                seen.mode = mode;
                seen.deps = given;
                return 0;
            },
        };
        return { env, seen, deps };
    }

    it("reviews on Dorothy's own .env, loaded by path once claude's variables are gone", async () => {
        const { env, seen, deps } = harness();
        expect(await runHook({ kind: "hook" }, deps)).toBe(0);
        expect(seen.loaded).toEqual(["/d/.env", "/d/.env.keys"]);
        expect(env).toEqual({ ...OURS, CLAUDE_CODE_OAUTH_TOKEN: "dorothy's" });
        // Loaded when a review asks, and once.
        expect(seen.agents).toBe(0);
        expect((await seen.deps?.agent())?.persona).toBe("You are Dorothy.");
        await seen.deps?.agent();
        expect(seen.agents).toBe(1);
        expect(seen.deps?.self).toEqual([
            "/bin/bun",
            "/d/packages/cli/src/index.ts",
        ]);
    });

    it("sends a review through the user's proxy, and tells memory the environment it was given", async () => {
        const { env, seen, deps } = harness();
        env.DOROTHY_ANTHROPIC_BASE_URL = "http://proxy.example/v1";
        await runHook({ kind: "hook" }, deps);
        // The SDK reads process.env, here env.
        expect(env.ANTHROPIC_BASE_URL).toBe("http://proxy.example/v1");
        // What memory spawns a catch-up in is what claude gave, which
        // holds neither Dorothy's credentials nor the review's URL.
        expect(seen.deps?.env).toMatchObject({
            ANTHROPIC_BASE_URL: "http://127.0.0.1:4321",
            DOROTHY_ANTHROPIC_BASE_URL: "http://proxy.example/v1",
        });
        expect(seen.deps?.env?.CLAUDE_CODE_OAUTH_TOKEN).toBe("claude's");
    });

    it("looks for Dotenvx Armor's session where the launch found it, before loading", async () => {
        const { env, seen, deps } = harness();
        env.XDG_CONFIG_HOME = "/claude/config";
        env.DOROTHY_DOTENVX_CONFIG = "/launch/dotenvx";
        const where: (string | undefined)[] = [];
        deps.load = (_path, _keys, into) => {
            where.push(into.DOTENVX_CONFIG);
        };
        await runHook({ kind: "hook" }, deps);
        expect(where).toEqual(["/launch/dotenvx"]);
        // A catch-up it starts is given the same.
        expect(seen.deps?.env?.DOROTHY_DOTENVX_CONFIG).toBe("/launch/dotenvx");
        // With none passed on, dotenvx looks where it would.
        const bare = harness();
        const bareWhere: (string | undefined)[] = [];
        bare.deps.load = (_path, _keys, into) => {
            bareWhere.push(into.DOTENVX_CONFIG);
        };
        await runHook({ kind: "hook" }, bare.deps);
        expect(bareWhere).toEqual([undefined]);
    });

    it("leaves memory the launch and the directories claude gave", async () => {
        const { seen, deps } = harness();
        await runHook(
            { kind: "catch-up", launch: LAUNCH, session: null },
            deps,
        );
        expect(seen.deps?.env).toMatchObject({
            DOROTHY_LAUNCH: LAUNCH,
            XDG_DATA_HOME: "/home/u/data",
        });
        expect(seen.agents).toBe(0);
    });

    it("loads no agent to reread or dismiss, and refuses a review there", async () => {
        const { seen, deps } = harness();
        await runHook({ kind: "reread" }, deps);
        await runHook({ kind: "dismiss", session: SESSION }, deps);
        const outcome = await (await seen.deps?.agent())?.call({
            what: "a review",
            system: "",
            prompt: "",
            schema: {},
            timeoutMs: 1,
        });
        expect(outcome?.ok).toBe(false);
        expect(seen.agents).toBe(0);
    });

    it("still runs the hook when the agent cannot load, its reviews failing", async () => {
        const { seen, deps } = harness();
        deps.agent = async () => {
            throw new Error("no sdk");
        };
        expect(await runHook({ kind: "hook" }, deps)).toBe(0);
        const outcome = await (await seen.deps?.agent())?.call({
            what: "a review",
            system: "",
            prompt: "",
            schema: {},
            timeoutMs: 1,
        });
        expect(outcome).toEqual({
            ok: false,
            reason: "the agent could not load (no sdk)",
            costUsd: 0,
        });
    });
});

describe("a hook that goes wrong", () => {
    const logOf = (cache: string) =>
        readFileSync(join(cache, "dorothy", "claude-hook.log"), "utf8");
    const withCache = async (
        body: (env: Env, cache: string) => Promise<void>,
    ) => {
        const cache = mkdtempSync(join(tmpdir(), "dorothy-hooklog-"));
        try {
            await body({ ...fromClaude(), XDG_CACHE_HOME: cache }, cache);
        } finally {
            rmSync(cache, { recursive: true, force: true });
        }
    };

    it("logs a run that throws, and exits 0", async () => {
        await withCache(async (env, cache) => {
            const code = await runHook(
                { kind: "hook" },
                {
                    env,
                    root: "/d",
                    load: () => null,
                    agent: async () => ({
                        call: async () => ({
                            ok: false,
                            reason: "x",
                            costUsd: 0,
                        }),
                        persona: "",
                    }),
                    run: async () => {
                        throw new Error("boom");
                    },
                },
            );
            expect(code).toBe(0);
            expect(logOf(cache)).toMatch(
                / error \d+ the hook could not run \(boom\)/,
            );
        });
    });

    it("logs memory failing to import, and exits 0", async () => {
        await withCache(async (env, cache) => {
            const code = await runHook(
                { kind: "catch-up", launch: LAUNCH, session: null },
                {
                    env,
                    root: "/d",
                    load: () => null,
                    agent: async () => {
                        throw new Error("no sdk");
                    },
                    memory: async () => {
                        throw new Error("no memory");
                    },
                },
            );
            expect(code).toBe(0);
            expect(logOf(cache)).toContain(
                "the hook could not run (no memory)",
            );
        });
    });

    it("rotates the fallback log as memory's does", async () => {
        await withCache(async (env, cache) => {
            const path = join(cache, "dorothy", "claude-hook.log");
            mkdirSync(join(cache, "dorothy"), { recursive: true });
            writeFileSync(path, "x".repeat(1_000_001));
            await runHook(
                { kind: "catch-up", launch: LAUNCH, session: null },
                {
                    env,
                    root: "/d",
                    load: () => null,
                    memory: async () => {
                        throw new Error("no memory");
                    },
                },
            );
            expect(readFileSync(`${path}.1`, "utf8")).toHaveLength(1_000_001);
            expect(readFileSync(path, "utf8")).toContain("no memory");
            expect(readFileSync(path, "utf8").split("\n")).toHaveLength(2);
        });
    });

    it("lets the other modes throw", async () => {
        const run = runHook(
            { kind: "reread" },
            {
                env: fromClaude(),
                root: "/d",
                load: () => null,
                run: async () => {
                    throw new Error("boom");
                },
            },
        );
        await expect(run).rejects.toThrow("boom");
    });

    it("logs a .env that cannot be decrypted by its code, and prints nothing", async () => {
        await withCache(async (env, cache) => {
            const dir = mkdtempSync(join(tmpdir(), "dorothy-dotenv-"));
            const printed: string[] = [];
            const spy = (...args: unknown[]) =>
                void printed.push(args.join(" "));
            const { error, log, warn, info } = console;
            const stderrWrite = process.stderr.write;
            const stdoutWrite = process.stdout.write;
            try {
                writeFileSync(
                    join(dir, ".env"),
                    'DOTENV_PUBLIC_KEY="03abc"\nSECRET="encrypted:BAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA"\n',
                );
                writeFileSync(
                    join(dir, ".env.keys"),
                    'DOTENV_PRIVATE_KEY="0123456789abcdef0123456789abcdef"\n',
                );
                Object.assign(console, {
                    error: spy,
                    log: spy,
                    warn: spy,
                    info: spy,
                });
                const capture = ((text: unknown) => {
                    printed.push(String(text));
                    return true;
                }) as typeof process.stderr.write;
                process.stderr.write = capture;
                process.stdout.write = capture;
                const code = await runHook(
                    { kind: "hook" },
                    {
                        env,
                        root: dir,
                        agent: async () => ({
                            call: async () => ({
                                ok: false,
                                reason: "x",
                                costUsd: 0,
                            }),
                            persona: "",
                        }),
                        run: async () => 0,
                    },
                );
                expect(code).toBe(0);
            } finally {
                Object.assign(console, { error, log, warn, info });
                process.stderr.write = stderrWrite;
                process.stdout.write = stdoutWrite;
                rmSync(dir, { recursive: true, force: true });
            }
            expect(printed).toEqual([]);
            const text = logOf(cache);
            expect(text).toContain(
                "Dorothy's .env could not be loaded (DECRYPTION_FAILED)",
            );
            expect(text).not.toContain("0123456");
            expect(console.error).toBe(error);
        });
    });
});

describe("loadDotenv", () => {
    it("reads a .env by its path into the environment given, keeping what is set", () => {
        const dir = mkdtempSync(join(tmpdir(), "dorothy-dotenv-"));
        try {
            writeFileSync(
                join(dir, ".env"),
                "DOROTHY_PROBE=from-checkout\nDOROTHY_KEPT=from-checkout\n",
            );
            const into: Env = { DOROTHY_KEPT: "already" };
            loadDotenv(join(dir, ".env"), join(dir, ".env.keys"), into);
            expect(into).toMatchObject({
                DOROTHY_PROBE: "from-checkout",
                DOROTHY_KEPT: "already",
            });
            expect(process.env.DOROTHY_PROBE).toBeUndefined();
            // A checkout without a .env loads nothing, and says nothing.
            loadDotenv(join(dir, "none.env"), join(dir, ".env.keys"), into);
        } finally {
            rmSync(dir, { recursive: true, force: true });
        }
    });

    it("knows this checkout", () => {
        expect(
            existsSync(
                join(checkoutRoot, "packages", "cli", "src", "claude-hook.ts"),
            ),
        ).toBe(true);
    });
});
