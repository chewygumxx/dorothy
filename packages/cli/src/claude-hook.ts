// vim:set expandtab shiftwidth=4 filetype=typescript:
// SPDX-License-Identifier: GPL-3.0-only

//
//
// ~xxdorothy/dorothy.git
// ::: :/packages/cli/src/claude-hook.ts
//
//

// dorothy --claude-hook: memory's hook process, given what its reviews
// need. Claude Code runs it with claude's environment: the gateway's
// URL, the launch, and claude's own variables and sign-in. Memory keeps
// that environment, to find the launch in it. Reviews name their own
// base URL and key, so none of it reaches them; Dorothy's secrets are
// loaded by path from this checkout, never the working directory's.
// The launch passes SOPS_AGE_KEY_FILE so another config directory cannot
// hide it. A review is billed to her API key, as chat is, and never
// reaches the stopped gateway or the live session.

import { appendFileSync, mkdirSync, renameSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import {
    type Env,
    loadSecrets,
    type SecretsCode,
    type StructuredCall,
    xdgDir,
} from "@dorothy/core";
import type { HookDeps, HookLog, HookMode } from "@dorothy/memory/claude-hook";
import { COOLDOWNS, loadRouting, type RoutingDeps } from "./models.js";

// The checkout this program runs from: three up from packages/cli/src.
export const checkoutRoot = resolve(import.meta.dir, "..", "..", "..");

export type CheckoutSecretsDeps = {
    root?: string;
    load?: (path: string, into: Env) => Promise<SecretsCode | null>;
};

// One policy for checkout selection and code-only failures at every entry.
export async function loadCheckoutSecrets(
    env: Env,
    deps: CheckoutSecretsDeps = {},
): Promise<SecretsCode | null> {
    try {
        return await (deps.load ?? loadSecrets)(
            join(deps.root ?? checkoutRoot, "secrets.json"),
            env,
        );
    } catch {
        return "SOPS_FAILED";
    }
}

type Agent = { call: StructuredCall; persona: string };

export type HookCliDeps = CheckoutSecretsDeps &
    RoutingDeps & {
        // process.env: claude's environment, into which her secrets load, and
        // which reviews read their keys from.
        env?: Env;
        // This program as a command, for the detached catch-up.
        self?: readonly string[];
        agent?: () => Promise<Agent>;
        run?: (mode: HookMode, deps: HookDeps) => Promise<number>;
        // Memory's hook entry point, imported once it is needed.
        memory?: () => Promise<typeof import("@dorothy/memory/claude-hook")>;
    };

const describeError = (error: unknown) =>
    error instanceof Error ? error.message : String(error);

// config.toml's review route, then the agent; a routing fault fails it,
// so each review fails, saying the fault in the log, and the hook goes on.
async function loadAgent(env: Env, deps: HookCliDeps): Promise<Agent> {
    const routing = await loadRouting({ ...deps, env });
    const { structuredCall, systemPrompt } = await import("@dorothy/agent");
    return {
        call: structuredCall({
            route: routing.routes.review,
            cooldowns: COOLDOWNS,
            env,
        }),
        persona: systemPrompt,
    };
}

// For the modes that never review, and for a hook whose agent cannot
// load: the call fails, and the reviewer logs why.
const refusing =
    (reason: string): StructuredCall =>
    async () => ({ ok: false, reason, costUsd: 0 });

const FALLBACK_LOG_LIMIT = 1_000_000;

// The hook's log, from memory; if memory cannot load, a bare append to
// the same file, so that the failure still has somewhere to be said.
// The fallback follows memory's bodies/log.ts: `rotate` for the limit and
// the .1 file, `oneLine` for a message that is one line however it breaks.
// Change them together.
async function openLog(env: Env, deps: HookCliDeps): Promise<HookLog> {
    try {
        return (await (deps.memory ?? loadMemory)()).hookLog(env);
    } catch {
        const path = join(
            xdgDir(env, "XDG_CACHE_HOME", ".cache"),
            "dorothy",
            "claude-hook.log",
        );
        const write = (level: string) => (message: string) => {
            try {
                mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
                // As memory's log rotates: past a megabyte to one .1 file.
                try {
                    if (statSync(path).size > FALLBACK_LOG_LIMIT) {
                        renameSync(path, `${path}.1`);
                    }
                } catch {
                    // No log yet.
                }
                appendFileSync(
                    path,
                    `${new Date().toISOString()} ${level} ${process.pid} ${message.replaceAll(/\s*[\n\r\u2028\u2029]\s*/g, " ")}\n`,
                    { mode: 0o600 },
                );
            } catch {
                // Unwritable: said nowhere.
            }
        };
        return {
            info: write("info"),
            warn: write("warn"),
            error: write("error"),
        };
    }
}

const loadMemory = () => import("@dorothy/memory/claude-hook");

// A hook and a catch-up exit 0 whatever goes wrong, and write nothing to
// the terminal: what went wrong is in the hook's log.
export async function runHook(
    mode: HookMode,
    deps: HookCliDeps = {},
): Promise<number> {
    const env = deps.env ?? process.env;
    if (mode.kind !== "hook" && mode.kind !== "catch-up") {
        return runOnce(mode, deps, env);
    }
    try {
        return await runOnce(mode, deps, env);
    } catch (error) {
        (await openLog(env, deps)).error(
            `the hook could not run (${describeError(error)})`,
        );
        return 0;
    }
}

async function runOnce(
    mode: HookMode,
    deps: HookCliDeps,
    env: Env,
): Promise<number> {
    const given: Env = { ...env };
    await loadDorothyEnv(env, deps);
    const run = deps.run ?? (await (deps.memory ?? loadMemory)()).runClaudeHook;
    return run(mode, {
        env: given,
        agent: reviewingAgent(mode, deps, env),
        // As --claude passes it: Bun would otherwise load the .env of the
        // directory the catch-up starts in, the user's project.
        self: deps.self ?? [
            process.execPath,
            "--no-env-file",
            resolve(process.argv[1] ?? ""),
        ],
    });
}

// Dorothy's secrets, by path from this checkout. Without her credentials a
// review fails, and says so in the log.
async function loadDorothyEnv(env: Env, deps: HookCliDeps): Promise<void> {
    const failure = await loadCheckoutSecrets(env, deps);
    if (failure) {
        (await openLog(env, deps)).warn(
            `Dorothy's secrets.json could not be loaded (${failure})`,
        );
    }
}

// The agent for a hook or a catch-up, which review, loaded when the
// first review asks and not before: a SessionEnd, which only hands its
// session on, never does. The other modes never review.
function reviewingAgent(
    mode: HookMode,
    deps: HookCliDeps,
    env: Env,
): () => Promise<Agent> {
    if (mode.kind !== "hook" && mode.kind !== "catch-up") {
        return async () => ({
            call: refusing("reviews are not run here"),
            persona: "",
        });
    }
    let loading: Promise<Agent> | undefined;
    return () => {
        loading ??= (deps.agent ?? (() => loadAgent(env, deps)))().catch(
            (error: unknown) => ({
                call: refusing(
                    `the agent could not load (${describeError(error)})`,
                ),
                persona: "",
            }),
        );
        return loading;
    };
}
