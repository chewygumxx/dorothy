// vim:set expandtab shiftwidth=4 filetype=typescript:
// SPDX-License-Identifier: GPL-3.0-only

//
//
// ~chewygumxx/dorothy.git
// ::: :/packages/cli/src/claude.ts
//
//

import type { Env } from "@dorothy/core";
import {
    type Gateway,
    MARKER,
    startGateway,
    upstreamFrom,
} from "@dorothy/gateway";

export type Spawned = {
    exited: Promise<number>;
    kill: (signal?: NodeJS.Signals) => void;
};

export type ClaudeDeps = {
    env?: Env;
    which?: (command: string, options: { PATH: string }) => string | null;
    startGateway?: (options: { upstream: string }) => Gateway;
    spawn?: (cmd: string[], env: Env) => Spawned;
    write?: (text: string) => void;
    signals?: Pick<NodeJS.EventEmitter, "on" | "off">;
};

// The terminal sends SIGINT to the whole foreground group, claude
// included: forwarding it would send claude a second, which it reads as
// a request to quit. These reach dorothy alone, so claude is told.
const FORWARDED = ["SIGTERM", "SIGHUP"] as const;

const APPEND = "--append-system-prompt";

// The arguments claude is run with: the marker appended to its system
// prompt, then the user's. Claude Code keeps only the last
// --append-system-prompt it is given, so the user's own, if any, goes in
// the same one, before the marker; anything after -- is the user's alone.
export function claudeArgs(args: readonly string[]): string[] {
    let appended: string | undefined;
    const rest: string[] = [];
    for (let index = 0; index < args.length; index += 1) {
        const arg = args[index] as string;
        const value = args[index + 1];
        if (arg === "--") {
            rest.push(...args.slice(index));
            break;
        }
        if (arg === APPEND && value !== undefined) {
            appended = value;
            index += 1;
        } else if (arg.startsWith(`${APPEND}=`)) {
            appended = arg.slice(APPEND.length + 1);
        } else {
            rest.push(arg);
        }
    }
    const text = appended === undefined ? MARKER : `${appended}\n\n${MARKER}`;
    return [APPEND, text, ...rest];
}

const spawnInherited = (cmd: string[], env: Env): Spawned =>
    Bun.spawn(cmd, {
        env,
        stdin: "inherit",
        stdout: "inherit",
        stderr: "inherit",
    });

// The user's own Claude Code, with Dorothy as its main agent: the gateway
// replaces the marker appended to its system prompt with her identity.
// Dorothy's .env is not loaded; claude signs in as it always does.
export async function runClaude(
    args: readonly string[],
    {
        env = process.env,
        which = (command, options) => Bun.which(command, options),
        startGateway: start = startGateway,
        spawn = spawnInherited,
        write = (text) => {
            process.stderr.write(text);
        },
        signals = process,
    }: ClaudeDeps = {},
): Promise<number> {
    const claude = which("claude", { PATH: env.PATH ?? "" });
    if (claude === null) {
        write("dorothy: claude is not on PATH\n");
        return 127;
    }
    let gateway: Gateway;
    try {
        gateway = start({ upstream: upstreamFrom(env) });
    } catch (error) {
        const reason = error instanceof Error ? error.message : String(error);
        write(`dorothy: the gateway could not start: ${reason}\n`);
        return 1;
    }
    const child = spawn([claude, ...claudeArgs(args)], {
        ...env,
        ANTHROPIC_BASE_URL: gateway.url,
        ENABLE_TOOL_SEARCH: "1",
    });
    const ignore = () => {};
    const handlers = FORWARDED.map(
        (signal) => [signal, () => child.kill(signal)] as const,
    );
    signals.on("SIGINT", ignore);
    for (const [signal, handler] of handlers) {
        signals.on(signal, handler);
    }
    try {
        return await child.exited;
    } finally {
        signals.off("SIGINT", ignore);
        for (const [signal, handler] of handlers) {
            signals.off(signal, handler);
        }
        gateway.stop();
        const { drift } = gateway.stats;
        if (drift > 0) {
            write(
                `dorothy: ${drift} ${drift === 1 ? "request" : "requests"} carried the identity marker but could not be rewritten; Claude Code may have changed how it sends its prompt\n`,
            );
        }
    }
}
