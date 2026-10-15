// vim:set expandtab shiftwidth=4 filetype=typescript:
// SPDX-License-Identifier: GPL-3.0-only

//
//
// ~chewygumxx/dorothy.git
// ::: :/packages/cli/src/claude-hook.ts
//
//

// dorothy --claude-hook: memory's hook process, given what its reviews
// need. Claude Code runs it with claude's environment: the gateway's
// URL, the launch, and claude's own variables and sign-in. Memory keeps
// that environment, to find the launch in it. Reviews run in
// process.env, which the Agent SDK reads at each call: it loses those
// variables before Dorothy's own .env is loaded by path from this
// checkout, never the working directory's. A review is then billed to
// her credentials, as chat's are, and never reaches the stopped gateway
// or the live session.

import { join, resolve } from "node:path";
import type { Env, StructuredCall } from "@dorothy/core";
import type { HookDeps, HookMode } from "@dorothy/memory/claude-hook";
import { config } from "@dotenvx/dotenvx";

// What a review must not inherit from claude, beside every CLAUDE_CODE_
// variable.
export const REVIEW_DROPPED: readonly string[] = [
    "ANTHROPIC_BASE_URL",
    "ENABLE_TOOL_SEARCH",
    "DOROTHY_LAUNCH",
    "CLAUDECODE",
];

const dropped = (name: string) =>
    REVIEW_DROPPED.includes(name) || name.startsWith("CLAUDE_CODE_");

export function reviewEnv(env: Env): Env {
    return Object.fromEntries(
        Object.entries(env).filter(([name]) => !dropped(name)),
    );
}

// The checkout this program runs from: three up from packages/cli/src.
export const checkoutRoot = resolve(import.meta.dir, "..", "..", "..");

// A .env, by its path and its keys file's, into an environment. A
// variable already set is kept, as the entry guard's config() keeps it.
export function loadDotenv(path: string, keys: string, into: Env): void {
    config({
        path,
        envKeysFile: keys,
        processEnv: into as Record<string, string>,
        quiet: true,
        ignore: ["MISSING_ENV_FILE"],
    });
}

type Agent = { call: StructuredCall; persona: string };

export type HookCliDeps = {
    // process.env: claude's environment, which reviews read at each call.
    env?: Env;
    // The checkout whose .env is loaded.
    root?: string;
    // This program as a command, for the detached catch-up.
    self?: readonly string[];
    load?: (path: string, keys: string, into: Env) => void;
    agent?: () => Promise<Agent>;
    run?: (mode: HookMode, deps: HookDeps) => Promise<number>;
};

const describeError = (error: unknown) =>
    error instanceof Error ? error.message : String(error);

async function loadAgent(): Promise<Agent> {
    const { prepareCliHome, structuredCall, systemPrompt } = await import(
        "@dorothy/agent"
    );
    prepareCliHome();
    return { call: structuredCall(), persona: systemPrompt };
}

// For the modes that never review, and for a hook whose agent cannot
// load: the call fails, and the reviewer logs why.
const refusing =
    (reason: string): StructuredCall =>
    async () => ({ ok: false, reason, costUsd: 0 });

export async function runHook(
    mode: HookMode,
    deps: HookCliDeps = {},
): Promise<number> {
    const env = deps.env ?? process.env;
    const given: Env = { ...env };
    for (const name of Object.keys(env)) {
        if (dropped(name)) {
            delete env[name];
        }
    }
    const root = deps.root ?? checkoutRoot;
    try {
        (deps.load ?? loadDotenv)(
            join(root, ".env"),
            join(root, ".env.keys"),
            env,
        );
    } catch {
        // Without her credentials a review fails, and says so in the log.
    }
    let agent: Agent = {
        call: refusing("reviews are not run here"),
        persona: "",
    };
    if (mode.kind === "hook" || mode.kind === "catch-up") {
        try {
            agent = await (deps.agent ?? loadAgent)();
        } catch (error) {
            agent = {
                call: refusing(
                    `the agent could not load (${describeError(error)})`,
                ),
                persona: "",
            };
        }
    }
    const run =
        deps.run ?? (await import("@dorothy/memory/claude-hook")).runClaudeHook;
    return run(mode, {
        env: given,
        call: agent.call,
        persona: agent.persona,
        // As --claude passes it: Bun would otherwise load the .env of the
        // directory the catch-up starts in, the user's project.
        self: deps.self ?? [
            process.execPath,
            "--no-env-file",
            resolve(process.argv[1] ?? ""),
        ],
    });
}
