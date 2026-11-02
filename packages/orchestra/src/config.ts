// vim:set expandtab shiftwidth=4 filetype=typescript:
// SPDX-License-Identifier: GPL-3.0-only

//
//
// ~chewygumxx/dorothy.git
// ::: :/packages/orchestra/src/config.ts
//
//

// [orchestra] in config.toml. Unlike core's tables, a fault here is no
// warning: a pattern dropped or a timeout defaulted could loosen the
// gate, so the server prints every fault and exits.

import { readFile } from "node:fs/promises";
import { isAbsolute, join } from "node:path";
import { configPath, type Env, errorLine, xdgDir } from "@dorothy/core";

export const AGENTS = ["claude", "codex"] as const;
export type Agent = (typeof AGENTS)[number];

export const LOGINS = ["subscription", "api-key"] as const;
export type Login = (typeof LOGINS)[number];

export type OrchestraConfig = {
    enabled: boolean;
    // Absolute; each server's workers go in <worktreeRoot>/<server id>.
    worktreeRoot: string;
    agents: Agent[];
    maxWorkers: number;
    claudeLogin: Login;
    codexLogin: Login;
    // Host names, lowercased, without a trailing dot.
    networkAllow: string[];
    askTimeoutSeconds: number;
    judgeTimeoutSeconds: number;
    // Each pattern is plain words, matched as a command's first words.
    allow: string[];
    ask: string[];
    deny: string[];
};

export type OrchestraResult =
    | { ok: true; config: OrchestraConfig }
    | { ok: false; faults: string[] };

// worktreeRoot is filled in from the environment.
export const DEFAULT_ORCHESTRA: OrchestraConfig = {
    enabled: false,
    worktreeRoot: "",
    agents: ["claude", "codex"],
    maxWorkers: 4,
    claudeLogin: "subscription",
    codexLogin: "subscription",
    networkAllow: ["registry.npmjs.org"],
    askTimeoutSeconds: 600,
    judgeTimeoutSeconds: 30,
    allow: [],
    ask: [],
    deny: [],
};

// A word of a pattern: no quoting, expansion, operator or glob.
const PLAIN_WORD = /^[A-Za-z0-9_@%+=:,./-]+$/;

export const isPlainWords = (text: string): boolean => {
    const words = text.split(" ");
    return words.length > 0 && words.every((word) => PLAIN_WORD.test(word));
};

// A DNS name of two labels or more, none all digits at the end, so that
// no address passes for a name.
const LABEL = /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$/;

export function hostName(text: string): string | null {
    const host = text.toLowerCase().replace(/\.$/, "");
    const labels = host.split(".");
    if (
        host.length > 253 ||
        labels.length < 2 ||
        !labels.every((label) => LABEL.test(label)) ||
        /^[0-9]+$/.test(labels.at(-1) ?? "")
    ) {
        return null;
    }
    return host;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
    typeof value === "object" && value !== null && !Array.isArray(value);

type Reader = (
    value: unknown,
    at: string,
    faults: string[],
    env: Env,
) => Partial<OrchestraConfig> | null;

const whole =
    (field: keyof OrchestraConfig, min: number, max: number): Reader =>
    (value, at, faults) => {
        if (
            typeof value === "number" &&
            Number.isInteger(value) &&
            value >= min &&
            value <= max
        ) {
            return { [field]: value };
        }
        faults.push(`${at} must be a whole number from ${min} to ${max}`);
        return null;
    };

const login =
    (field: "claudeLogin" | "codexLogin"): Reader =>
    (value, at, faults) => {
        if ((LOGINS as readonly unknown[]).includes(value)) {
            return { [field]: value as Login };
        }
        faults.push(`${at} must be "subscription" or "api-key"`);
        return null;
    };

const patterns =
    (field: "allow" | "ask" | "deny"): Reader =>
    (value, at, faults) => {
        if (!Array.isArray(value)) {
            faults.push(`${at} must be a list of patterns`);
            return null;
        }
        const before = faults.length;
        for (const item of value) {
            if (typeof item !== "string" || !isPlainWords(item)) {
                faults.push(
                    `${at}: ${JSON.stringify(item)} must be plain words`,
                );
            }
        }
        return faults.length > before ? null : { [field]: value as string[] };
    };

const READERS: Record<string, Reader> = {
    enabled: (value, at, faults) => {
        if (typeof value === "boolean") {
            return { enabled: value };
        }
        faults.push(`${at} must be true or false`);
        return null;
    },
    "worktree-root": (value, at, faults, env) => {
        if (typeof value === "string" && value.startsWith("~/")) {
            return { worktreeRoot: join(env.HOME ?? "/", value.slice(2)) };
        }
        if (typeof value === "string" && isAbsolute(value)) {
            return { worktreeRoot: value };
        }
        faults.push(`${at} must be an absolute path or start with ~/`);
        return null;
    },
    agents: (value, at, faults) => {
        if (
            Array.isArray(value) &&
            value.length > 0 &&
            new Set(value).size === value.length &&
            value.every((item) => (AGENTS as readonly unknown[]).includes(item))
        ) {
            return { agents: value as Agent[] };
        }
        faults.push(`${at} must be a list of claude and codex, each once`);
        return null;
    },
    "max-workers": whole("maxWorkers", 1, 16),
    "claude-login": login("claudeLogin"),
    "codex-login": login("codexLogin"),
    "network-allow": (value, at, faults) => {
        if (!Array.isArray(value)) {
            faults.push(`${at} must be a list of host names`);
            return null;
        }
        const hosts: string[] = [];
        for (const item of value) {
            const host = typeof item === "string" ? hostName(item) : null;
            if (host === null) {
                faults.push(
                    `${at}: ${JSON.stringify(item)} is not a host name`,
                );
            } else {
                hosts.push(host);
            }
        }
        return hosts.length === value.length ? { networkAllow: hosts } : null;
    },
    "ask-timeout-seconds": whole("askTimeoutSeconds", 10, 3600),
    "judge-timeout-seconds": whole("judgeTimeoutSeconds", 5, 300),
    allow: patterns("allow"),
    ask: patterns("ask"),
    deny: patterns("deny"),
};

export function parseOrchestra(
    data: Record<string, unknown>,
    env: Env,
): OrchestraResult {
    const config: OrchestraConfig = {
        ...DEFAULT_ORCHESTRA,
        worktreeRoot: join(
            xdgDir(env, "XDG_DATA_HOME", ".local/share"),
            "dorothy",
            "workers",
        ),
    };
    const table = data.orchestra;
    if (table === undefined) {
        return { ok: true, config };
    }
    if (!isRecord(table)) {
        return { ok: false, faults: ["config.toml: orchestra is not a table"] };
    }
    const faults: string[] = [];
    for (const [key, value] of Object.entries(table)) {
        const at = `config.toml: orchestra.${key}`;
        const read = Object.hasOwn(READERS, key) ? READERS[key] : undefined;
        if (read === undefined) {
            faults.push(`config.toml: unknown key orchestra.${key}`);
            continue;
        }
        Object.assign(config, read(value, at, faults, env) ?? {});
    }
    return faults.length > 0 ? { ok: false, faults } : { ok: true, config };
}

// A line that opens or sets [orchestra], in any of TOML's forms.
const ORCHESTRA_LINE = /^\s*\[*\s*["']?orchestra["']?\s*[\].=]/m;

// No file, or one that names no [orchestra], is the defaults: off. A
// file that cannot be read or parsed is a fault only if it names the
// table, whose settings cannot then be known.
export async function readOrchestra(env: Env): Promise<OrchestraResult> {
    let text: string;
    try {
        text = await readFile(configPath(env), "utf8");
    } catch (error) {
        if ((error as { code?: unknown }).code === "ENOENT") {
            return parseOrchestra({}, env);
        }
        return {
            ok: false,
            faults: [
                `config.toml: ${String(error)}; its [orchestra] cannot be read`,
            ],
        };
    }
    let data: unknown;
    try {
        data = Bun.TOML.parse(text);
    } catch (error) {
        if (!ORCHESTRA_LINE.test(text)) {
            return parseOrchestra({}, env);
        }
        const reason = String(
            error instanceof Error ? error.message : error,
        ).replace(/^TOML Parse error: /, "");
        return {
            ok: false,
            faults: [
                `config.toml line ${errorLine(text)}: ${reason}; its [orchestra] cannot be read`,
            ],
        };
    }
    return parseOrchestra(data as Record<string, unknown>, env);
}
