// vim:set expandtab shiftwidth=4 filetype=typescript:
// SPDX-License-Identifier: GPL-3.0-only

//
//
// ~chewygumxx/dorothy.git
// ::: :/packages/cli/src/claude-hook.test.ts
//
//

import { describe, expect, it } from "bun:test";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
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
        expect(seen.agents).toBe(1);
        expect(seen.deps?.persona).toBe("You are Dorothy.");
        expect(seen.deps?.self).toEqual([
            "/bin/bun",
            "/d/packages/cli/src/index.ts",
        ]);
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
        expect(seen.agents).toBe(1);
    });

    it("loads no agent to reread or dismiss, and refuses a review there", async () => {
        const { seen, deps } = harness();
        await runHook({ kind: "reread" }, deps);
        await runHook({ kind: "dismiss", session: SESSION }, deps);
        expect(seen.agents).toBe(0);
        const outcome = await seen.deps?.call({
            what: "a review",
            system: "",
            prompt: "",
            schema: {},
            timeoutMs: 1,
        });
        expect(outcome?.ok).toBe(false);
    });

    it("still runs the hook when the agent cannot load, its reviews failing", async () => {
        const { seen, deps } = harness();
        deps.agent = async () => {
            throw new Error("no sdk");
        };
        expect(await runHook({ kind: "hook" }, deps)).toBe(0);
        const outcome = await seen.deps?.call({
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
