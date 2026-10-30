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
    loadCheckoutSecrets,
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

describe("the account Claude spends", () => {
    // A fake secrets.json holding two accounts' tokens, as loadSecrets
    // would set them: a name already set is kept.
    const load = async (_path: string, into: Env) => {
        into.CLAUDE_CODE_OAUTH_TOKEN ||= "reserve-token";
        into.CLAUDE_CODE_OAUTH_TOKEN_CLAUDE2 ||= "primary-token";
        return null;
    };

    it("is secrets.json's own token when none is chosen", async () => {
        const env: Env = {};
        expect(await loadCheckoutSecrets(env, { load })).toBeNull();
        expect(env.CLAUDE_CODE_OAUTH_TOKEN).toBe("reserve-token");
    });

    it("is the entry DOROTHY_CLAUDE_TOKEN_VAR names", async () => {
        const env: Env = {
            DOROTHY_CLAUDE_TOKEN_VAR: "CLAUDE_CODE_OAUTH_TOKEN_CLAUDE2",
        };
        // As a review's environment is: claude's variables stripped.
        const review = reviewEnv(env);
        expect(await loadCheckoutSecrets(review, { load })).toBeNull();
        expect(review.CLAUDE_CODE_OAUTH_TOKEN).toBe("primary-token");
    });

    it.each([
        "CLAUDE_CODE_OAUTH_TOKEN_ABSENT",
        "OPENROUTER_API_KEY",
        "lower case",
    ])("refuses a choice of %s rather than spend another", async (name) => {
        const env: Env = { DOROTHY_CLAUDE_TOKEN_VAR: name };
        expect(await loadCheckoutSecrets(env, { load })).toBe(
            "SECRETS_INVALID",
        );
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
            // A variable already set is kept.
            load: async (path, into) => {
                await Bun.sleep(5);
                seen.loaded.push(path);
                into.CLAUDE_CODE_OAUTH_TOKEN ??= "dorothy's";
                return null;
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

    it("awaits Dorothy's secrets by checkout path once claude's variables are gone", async () => {
        const { env, seen, deps } = harness();
        expect(await runHook({ kind: "hook" }, deps)).toBe(0);
        expect(seen.loaded).toEqual(["/d/secrets.json"]);
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

    it("keeps the launch's age key path despite another config directory", async () => {
        const { env, seen, deps } = harness();
        const key = "/launch/sops/keys.txt";
        env.XDG_CONFIG_HOME = "/claude/config";
        env.SOPS_AGE_KEY_FILE = key;
        const where: (string | undefined)[] = [];
        deps.load = async (_path, into) => {
            where.push(into.SOPS_AGE_KEY_FILE);
            return null;
        };
        await runHook({ kind: "hook" }, deps);
        expect(where).toEqual([key]);
        expect(seen.deps?.env?.SOPS_AGE_KEY_FILE).toBe(key);
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
                    load: async () => null,
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
                    load: async () => null,
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
                    load: async () => null,
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
                load: async () => null,
                run: async () => {
                    throw new Error("boom");
                },
            },
        );
        await expect(run).rejects.toThrow("boom");
    });

    it("logs an async secrets failure by code without printing diagnostics", async () => {
        await withCache(async (env, cache) => {
            const code = await runHook(
                { kind: "hook" },
                {
                    env,
                    root: cache,
                    load: async () => {
                        await Bun.sleep(5);
                        return "SOPS_FAILED";
                    },
                    run: async () => 0,
                },
            );
            expect(code).toBe(0);
            expect(logOf(cache)).toMatch(
                / warn \d+ Dorothy's secrets.json could not be loaded \(SOPS_FAILED\)/,
            );
        });
    });

    it("turns a thrown loader diagnostic into a safe code", async () => {
        await withCache(async (env, cache) => {
            await runHook(
                { kind: "hook" },
                {
                    env,
                    root: cache,
                    load: async () => {
                        throw new Error("untrusted diagnostic");
                    },
                    run: async () => 0,
                },
            );
            const text = logOf(cache);
            expect(text.includes("untrusted diagnostic")).toBe(false);
            expect(text).toContain(
                "Dorothy's secrets.json could not be loaded (SOPS_FAILED)",
            );
        });
    });
});

describe("the hook entry", () => {
    it("knows this checkout", () => {
        expect(
            existsSync(
                join(checkoutRoot, "packages", "cli", "src", "claude-hook.ts"),
            ),
        ).toBe(true);
    });
});
