// vim:set expandtab shiftwidth=4 filetype=typescript:
// SPDX-License-Identifier: GPL-3.0-only

//
//
// ~chewygumxx/dorothy.git
// ::: :/packages/agent/src/recall-tools.ts
//
//

// Her memory tools in a chat: her recall server, this program again,
// over MCP stdio, its tools named as the model calls them,
// mcp__memory__search and so on, and only those a session may use.

import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { createMCPClient } from "@ai-sdk/mcp";
import { StdioMCPTransport } from "@ai-sdk/mcp/mcp-stdio";
import {
    ALLOWED_TOOLS,
    type Env,
    RECOLLECT_TOOL,
    type RecallLaunch,
    type Route,
    SERVER_NAME,
    xdgDir,
} from "@dorothy/core";
import type { ToolSet } from "ai";

export type RecallTools = { tools: ToolSet; close(): Promise<void> };

export type ConnectRecall = (
    launch: RecallLaunch,
    recollect: boolean,
    env: Record<string, string>,
    startMs?: number,
) => Promise<RecallTools>;

// What the recall server may see: the caller's environment, its XDG
// roots among it, less every credential: the keys a route names, those
// every provider gives, any *_API_KEY and Claude's OAuth tokens.
export function recallEnv(
    env: Env,
    route: Route,
    keys: readonly string[] = [],
): Record<string, string> {
    const named = new Set([
        ...keys,
        ...route.flatMap((entry) => (entry.key === null ? [] : [entry.key])),
    ]);
    const kept: Record<string, string> = {};
    for (const [name, value] of Object.entries(env)) {
        if (
            value === undefined ||
            named.has(name) ||
            name.endsWith("_API_KEY") ||
            name.startsWith("CLAUDE_CODE_OAUTH_TOKEN")
        ) {
            continue;
        }
        kept[name] = value;
    }
    return kept;
}

// How long the server has to start and list its tools: one that never
// answers must not hold chat, or quitting, forever.
export const RECALL_START_MS = 10_000;

// Where the server runs: a directory of Dorothy's, never the user's
// project, whose .env and bunfig.toml Bun would otherwise read.
export function recallCwd(env: Record<string, string>): string {
    const dir = join(xdgDir(env, "XDG_CACHE_HOME", ".cache"), "dorothy");
    mkdirSync(dir, { recursive: true, mode: 0o700 });
    return dir;
}

function within<T>(work: Promise<T>, ms: number, what: string): Promise<T> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    return Promise.race([
        work,
        new Promise<never>((_resolve, reject) => {
            timer = setTimeout(
                () => reject(new Error(`${what} took over ${ms / 1000}s`)),
                ms,
            );
        }),
    ]).finally(() => clearTimeout(timer));
}

// Its stderr is ignored, so that nothing it says lands on the TUI's
// screen. The transport is kept here, not only in the client, so that a
// server which never answers can be killed when the client never came up.
export const connectRecall: ConnectRecall = async (
    launch,
    recollect,
    env,
    startMs = RECALL_START_MS,
) => {
    const transport = new StdioMCPTransport({
        command: launch.command,
        args: recollect ? [...launch.args, "--recollect"] : launch.args,
        env,
        cwd: recallCwd(env),
        stderr: "ignore",
    });
    let client: Awaited<ReturnType<typeof createMCPClient>>;
    try {
        client = await createMCPClient({
            transport,
            initializationOptions: { timeout: startMs },
        });
    } catch (error) {
        await transport.close().catch(() => {});
        throw error;
    }
    try {
        const listed = await within(
            client.tools(),
            startMs,
            "listing the recall tools",
        );
        const allowed = new Set<string>(
            recollect ? [...ALLOWED_TOOLS, RECOLLECT_TOOL] : ALLOWED_TOOLS,
        );
        const tools: ToolSet = {};
        for (const [name, tool] of Object.entries(listed)) {
            const called = `mcp__${SERVER_NAME}__${name}`;
            if (allowed.has(called)) {
                tools[called] = tool;
            }
        }
        return { tools, close: () => client.close() };
    } catch (error) {
        await client.close().catch(() => {});
        throw error;
    }
};
