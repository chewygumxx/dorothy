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
    spawn?: (cmd: string[], env: Env, cwd?: string) => Spawned;
    write?: (text: string) => void;
    signals?: Pick<NodeJS.EventEmitter, "on" | "off">;
};

// The terminal sends SIGINT to the whole foreground group, claude
// included: forwarding it would send claude a second, which it reads as
// a request to quit. TERM, and HUP from anything but a hangup, can reach
// dorothy alone, so claude is told; after a hangup it gets HUP twice,
// which does no harm.
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

// Where claude runs and with what environment. A package script, such as
// `bun run dev -- --claude`, starts in this checkout with the script's
// variables set and node_modules/.bin first on PATH, for the directory
// it was run from and each above it down to /node_modules/.bin, behind
// Bun's node shim or the project's root. claude gets the directory and
// the PATH the user ran it from.
export function userShell(env: Env): { env: Env; cwd?: string } {
    if (env.npm_lifecycle_event === undefined) {
        return { env };
    }
    const shell: Env = {};
    for (const [name, value] of Object.entries(env)) {
        if (!name.startsWith("npm_")) {
            shell[name] = value;
        }
    }
    const path = (env.PATH ?? "").split(":");
    const end = path.indexOf("/node_modules/.bin");
    if (end !== -1) {
        shell.PATH = path.slice(end + 1).join(":");
    }
    const cwd = env.npm_config_local_prefix;
    return cwd === undefined ? { env: shell } : { env: shell, cwd };
}

const spawnInherited = (cmd: string[], env: Env, cwd?: string): Spawned =>
    Bun.spawn(cmd, {
        env,
        cwd,
        stdin: "inherit",
        stdout: "inherit",
        stderr: "inherit",
    });

// The user's own Claude Code, with Dorothy as its main agent: the gateway
// replaces the marker appended to its system prompt with her identity.
// Dorothy's .env is not loaded; claude signs in as it always does.
export type Launch = {
    cmd: string[];
    env: Env;
    cwd?: string;
    gateway: Gateway;
};

// What running claude through the gateway needs, for --claude and its
// dump alike: claude from the user's PATH, the marker in its arguments,
// and a gateway in front of the upstream. A number is the exit code of a
// failure already reported.
export function launchClaude(
    args: readonly string[],
    upstream: string,
    {
        env = process.env,
        which = (command, options) => Bun.which(command, options),
        startGateway: start = startGateway,
        write = (text) => {
            process.stderr.write(text);
        },
    }: ClaudeDeps = {},
): Launch | number {
    const shell = userShell(env);
    const claude = which("claude", { PATH: shell.env.PATH ?? "" });
    if (claude === null) {
        write("dorothy: claude is not on PATH\n");
        return 127;
    }
    let gateway: Gateway;
    try {
        gateway = start({ upstream });
    } catch (error) {
        const reason = error instanceof Error ? error.message : String(error);
        write(`dorothy: the gateway could not start: ${reason}\n`);
        return 1;
    }
    const launch: Launch = {
        cmd: [claude, ...claudeArgs(args)],
        env: {
            ...shell.env,
            ANTHROPIC_BASE_URL: gateway.url,
            // Claude Code turns tool search off for a base URL not
            // Anthropic's; a user's own choice stands.
            ENABLE_TOOL_SEARCH: env.ENABLE_TOOL_SEARCH ?? "1",
        },
        gateway,
    };
    return shell.cwd === undefined ? launch : { ...launch, cwd: shell.cwd };
}

export function warnDrift(
    { drift }: Gateway["stats"],
    write: (text: string) => void,
): void {
    if (drift > 0) {
        write(
            `dorothy: ${drift} ${drift === 1 ? "request" : "requests"} carried the identity marker but could not be rewritten; Claude Code may have changed how it sends its prompt\n`,
        );
    }
}

export async function runClaude(
    args: readonly string[],
    deps: ClaudeDeps = {},
): Promise<number> {
    const {
        env = process.env,
        spawn = spawnInherited,
        write = (text) => {
            process.stderr.write(text);
        },
        signals = process,
    } = deps;
    const launch = launchClaude(args, upstreamFrom(env), { ...deps, write });
    if (typeof launch === "number") {
        return launch;
    }
    const child = spawn(launch.cmd, launch.env, launch.cwd);
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
        launch.gateway.stop();
        warnDrift(launch.gateway.stats, write);
    }
}
