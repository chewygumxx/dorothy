// vim:set expandtab shiftwidth=4 filetype=typescript:
// SPDX-License-Identifier: GPL-3.0-only

//
//
// ~chewygumxx/dorothy.git
// ::: :/packages/cli/src/hosts/pi/env.ts
//
//

// The environments `dorothy --pi` gives: Pi's and its helpers', each built
// from an allowlist, never by removing what looks dangerous. Nothing a
// caller exported reaches them but terminal, PATH, home, XDG, locale,
// proxy and herdr context: no provider key, OAuth token, NODE_OPTIONS,
// BUN_OPTIONS, preload or foreign PI_* setting. Pi alone gets the selected
// key, under its route entry's name; its extension takes it out of Pi's
// environment as it loads (assets/pi/AGENTS.md).

import { realpath } from "node:fs/promises";
import type { Env } from "@dorothy/core";
import { passSopsKey } from "../../sops-key.js";

// The names passed as they are. Proxy variables may hold a proxy's own
// login, which the caller already gives every program it starts.
const PASSED = new Set([
    // Terminal, and what Pi reads to draw in it or open an editor.
    "TERM",
    "COLORTERM",
    "TERM_PROGRAM",
    "TERM_PROGRAM_VERSION",
    "TERMINFO",
    "TERMINFO_DIRS",
    "COLUMNS",
    "LINES",
    "NO_COLOR",
    "FORCE_COLOR",
    "TMUX",
    "TMUX_PANE",
    "STY",
    "WT_SESSION",
    "WEZTERM_PANE",
    "KITTY_WINDOW_ID",
    "VTE_VERSION",
    "DISPLAY",
    "WAYLAND_DISPLAY",
    "SSH_TTY",
    "SSH_CONNECTION",
    "SSH_CLIENT",
    "EDITOR",
    "VISUAL",
    "SHELL",
    // The account and its paths.
    "PATH",
    "HOME",
    "USER",
    "LOGNAME",
    "TMPDIR",
    "TZ",
    // Locale.
    "LANG",
    "LANGUAGE",
    // Proxies, and the certificates a proxy may need trusted.
    "HTTP_PROXY",
    "HTTPS_PROXY",
    "ALL_PROXY",
    "NO_PROXY",
    "http_proxy",
    "https_proxy",
    "all_proxy",
    "no_proxy",
    "SSL_CERT_FILE",
    "SSL_CERT_DIR",
    "NODE_EXTRA_CA_CERTS",
    // The herdr pane a stewardship run is in.
    "HERDR_ENV",
    "HERDR_PANE_ID",
    "HERDR_SOCKET_PATH",
]);
const PASSED_PREFIXES = ["LC_", "XDG_"];

// What the launcher itself sets in Pi's environment.
const SET = new Set(["PI_CODING_AGENT_DIR", "DOROTHY_PI_MANIFEST"]);

const isPassed = (name: string) =>
    PASSED.has(name) ||
    PASSED_PREFIXES.some((prefix) => name.startsWith(prefix));

// The caller's variables an allowlist keeps, from its user shell's
// environment.
export function passedEnv(env: Env): Env {
    const passed: Env = {};
    for (const [name, value] of Object.entries(env)) {
        if (value !== undefined && isPassed(name)) passed[name] = value;
    }
    return passed;
}

// A key variable named as one the launcher passes or sets would replace
// it, or be replaced: refused.
export const reservedKey = (name: string) => isPassed(name) || SET.has(name);

// The PATH without a directory whose `node` is the running Bun: Bun puts
// its alias first for package scripts and tests, and Pi needs a real Node.
export async function nodePath(
    path: string,
    bun: string = process.execPath,
): Promise<string> {
    const self = await realpath(bun).catch(() => bun);
    const kept: string[] = [];
    for (const directory of path.split(":")) {
        const node = Bun.which("node", { PATH: directory });
        if (node && (await realpath(node).catch(() => node)) === self) {
            continue;
        }
        kept.push(directory);
    }
    return kept.join(":");
}

// Pi's environment: the passed variables, its profile, its manifest and
// the selected key alone, where one is given.
export function piEnvOf(
    passed: Env,
    set: {
        agentDir: string;
        manifestPath: string;
        key: [string, string] | null;
    },
): Env {
    const env: Env = {
        ...passed,
        PI_CODING_AGENT_DIR: set.agentDir,
        DOROTHY_PI_MANIFEST: set.manifestPath,
    };
    if (set.key !== null) env[set.key[0]] = set.key[1];
    return env;
}

// What `--pi-hook` and `--mcp --host pi` run with: the passed variables,
// the memory service's address and the age key's path, never a key.
export function helperEnvOf(passed: Env, env: Env): Env {
    const helper: Env = { ...passed };
    if (env.DOROTHY_MEMORY_URL)
        helper.DOROTHY_MEMORY_URL = env.DOROTHY_MEMORY_URL;
    return passSopsKey(helper, env);
}

// A redacted environment: its names, sorted.
export const names = (env: Env): string[] => Object.keys(env).sort();
