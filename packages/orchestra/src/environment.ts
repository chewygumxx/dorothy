// vim:set expandtab shiftwidth=4 filetype=typescript:
// SPDX-License-Identifier: GPL-3.0-only

//
//
// ~chewygumxx/dorothy.git
// ::: :/packages/orchestra/src/environment.ts
//
//

// The server's own environment. Whoever starts it, it runs again at once
// with variables from an allowlist alone, so that no ACPX_AUTH_*, provider
// key, SOPS_AGE_KEY, OAuth token, cloud credential, GIT_* override or
// preload reaches the server, the broker or acpx. A box's environment is
// built apart from this one (box.ts); SSH_AUTH_SOCK, DBUS_SESSION_BUS_ADDRESS
// and XDG_RUNTIME_DIR serve the broker's ssh and gh alone.

import type { Env } from "@dorothy/core";

const NAMES = new Set([
    "PATH",
    "HOME",
    "XDG_CONFIG_HOME",
    "XDG_DATA_HOME",
    "XDG_STATE_HOME",
    "XDG_CACHE_HOME",
    "XDG_RUNTIME_DIR",
    "DBUS_SESSION_BUS_ADDRESS",
    "SSH_AUTH_SOCK",
    "LANG",
    "TERM",
    "COLORTERM",
    "TZ",
]);

const kept = (name: string) => NAMES.has(name) || /^LC_[A-Z]+$/.test(name);

export function serverEnvironment(env: Env): Record<string, string> {
    return Object.fromEntries(
        Object.entries(env).filter(
            (entry): entry is [string, string] =>
                kept(entry[0]) &&
                typeof entry[1] === "string" &&
                entry[1] !== "",
        ),
    );
}

export const isServerEnvironment = (env: Env): boolean =>
    Object.entries(env).every(
        ([name, value]) =>
            kept(name) && typeof value === "string" && value !== "",
    );

export type ReexecDeps = {
    // The arguments after the executable: the script and its own.
    argv: readonly string[];
    env: Env;
    execPath: string;
};

const SIGNALS = ["SIGINT", "SIGTERM", "SIGHUP"] as const;

// null where the environment is clean already: the caller goes on to
// serve. Otherwise the clean process's exit code, once it has exited;
// the caller exits with it. The clean process shares stdin and stdout,
// so MCP flows to it untouched, and this one forwards signals.
export async function reexecClean({
    argv,
    env,
    execPath,
}: ReexecDeps): Promise<number | null> {
    if (isServerEnvironment(env)) {
        return null;
    }
    const child = Bun.spawn([execPath, ...argv], {
        env: serverEnvironment(env),
        stdin: "inherit",
        stdout: "inherit",
        stderr: "inherit",
    });
    const forward = (signal: (typeof SIGNALS)[number]) => () =>
        child.kill(signal);
    const handlers = SIGNALS.map(
        (signal) => [signal, forward(signal)] as const,
    );
    for (const [signal, handler] of handlers) {
        process.on(signal, handler);
    }
    const code = await child.exited;
    for (const [signal, handler] of handlers) {
        process.off(signal, handler);
    }
    return code;
}
