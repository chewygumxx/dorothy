// vim:set expandtab shiftwidth=4 filetype=typescript:
// SPDX-License-Identifier: GPL-3.0-only

//
//
// ~chewygumxx/dorothy.git
// ::: :/src/config.ts
//
//

import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { type Env, xdgDir } from "./xdg.js";

export const MODULE_NAMES = [
    "in",
    "cache-read",
    "cache-write",
    "out",
    "ttft",
    "duration",
    "cost",
    "chat-cost",
    "memory-cost",
] as const;
export type ModuleName = (typeof MODULE_NAMES)[number];
export type LineConfig = { modules: ModuleName[]; maxLines: number };
export type MemoryConfig = {
    enabled: boolean;
    // Estimated tokens of notes in a new session's prompt.
    budget: number;
    idleSeconds: number;
    halfLifeDays: number;
    // Stale conversations reviewed per launch.
    catchUp: number;
};
export type Config = {
    statusline: LineConfig;
    replyStats: LineConfig;
    memory: MemoryConfig;
};

// More would let a statusline crowd out the reply; five keeps the smallest
// window at 24 lines.
export const MAX_LINES = 5;

export const DEFAULT_CONFIG: Config = {
    statusline: {
        modules: [
            "chat-cost",
            "memory-cost",
            "cost",
            "in",
            "out",
            "ttft",
            "duration",
        ],
        maxLines: 1,
    },
    replyStats: {
        modules: [
            "in",
            "cache-read",
            "cache-write",
            "out",
            "ttft",
            "duration",
            "cost",
            "chat-cost",
        ],
        maxLines: 1,
    },
    memory: {
        enabled: true,
        budget: 2000,
        idleSeconds: 60,
        halfLifeDays: 30,
        catchUp: 5,
    },
};

// Tables as the file names them, and the field of Config each fills.
const TABLES = {
    statusline: "statusline",
    "reply-stats": "replyStats",
} as const;

const describeError = (error: unknown) =>
    error instanceof Error ? error.message : String(error);
const isRecord = (value: unknown): value is Record<string, unknown> =>
    typeof value === "object" && value !== null && !Array.isArray(value);
const isModule = (name: string): name is ModuleName =>
    (MODULE_NAMES as readonly string[]).includes(name);

function parseLine(
    table: string,
    value: unknown,
    fallback: LineConfig,
    warnings: string[],
): LineConfig {
    if (!isRecord(value)) {
        warnings.push(`config.toml: ${table} is not a table`);
        return fallback;
    }
    const line = { ...fallback };
    for (const [key, field] of Object.entries(value)) {
        if (key === "modules") {
            if (
                !Array.isArray(field) ||
                !field.every((name) => typeof name === "string")
            ) {
                warnings.push(
                    `config.toml: ${table}.modules is not a list of module names`,
                );
                continue;
            }
            const modules: ModuleName[] = [];
            for (const name of field as string[]) {
                if (!isModule(name)) {
                    warnings.push(
                        `config.toml: unknown module ${name} in ${table}`,
                    );
                } else if (modules.includes(name)) {
                    warnings.push(`config.toml: ${name} repeated in ${table}`);
                } else {
                    modules.push(name);
                }
            }
            line.modules = modules;
        } else if (key === "max-lines") {
            const valid =
                typeof field === "number" &&
                Number.isInteger(field) &&
                field >= 1 &&
                field <= MAX_LINES;
            if (!valid) {
                warnings.push(
                    `config.toml: ${table}.max-lines must be a whole number from 1 to ${MAX_LINES}`,
                );
            }
            line.maxLines = valid ? field : 1;
        } else {
            warnings.push(`config.toml: unknown key ${table}.${key}`);
        }
    }
    return line;
}

// The whole-number keys of [memory]: the key, the field, the range.
const MEMORY_NUMBERS = [
    ["budget", "budget", 200, 20000],
    ["idle-seconds", "idleSeconds", 10, 3600],
    ["half-life-days", "halfLifeDays", 1, 3650],
    ["catch-up", "catchUp", 0, 50],
] as const;

function parseMemory(value: unknown, warnings: string[]): MemoryConfig {
    if (!isRecord(value)) {
        warnings.push("config.toml: memory is not a table");
        return DEFAULT_CONFIG.memory;
    }
    const memory = { ...DEFAULT_CONFIG.memory };
    for (const [key, field] of Object.entries(value)) {
        const number = MEMORY_NUMBERS.find(([name]) => name === key);
        if (key === "enabled") {
            if (typeof field === "boolean") {
                memory.enabled = field;
            } else {
                warnings.push(
                    "config.toml: memory.enabled must be true or false",
                );
            }
        } else if (number !== undefined) {
            const [, name, min, max] = number;
            if (
                typeof field === "number" &&
                Number.isInteger(field) &&
                field >= min &&
                field <= max
            ) {
                memory[name] = field;
            } else {
                warnings.push(
                    `config.toml: memory.${key} must be a whole number from ${min} to ${max}`,
                );
            }
        } else {
            warnings.push(`config.toml: unknown key memory.${key}`);
        }
    }
    return memory;
}

// Bun's TOML errors carry no position. The mistake is on the line after the
// longest run of whole lines that parses: a shorter run can fail only
// because it cuts a list or string that spans lines.
function errorLine(text: string): number {
    const lines = text.split("\n");
    for (let count = lines.length - 1; count > 0; count--) {
        try {
            Bun.TOML.parse(lines.slice(0, count).join("\n"));
            return count + 1;
        } catch {}
    }
    return 1;
}

// A broken file never stops Dorothy: each problem is a warning, and whatever
// it spoils falls back to the default.
export function parseConfig(text: string): {
    config: Config;
    warnings: string[];
} {
    let data: unknown;
    try {
        data = Bun.TOML.parse(text);
    } catch (error) {
        const reason = describeError(error).replace(/^TOML Parse error: /, "");
        return {
            config: DEFAULT_CONFIG,
            warnings: [`config.toml line ${errorLine(text)}: ${reason}`],
        };
    }
    const config = { ...DEFAULT_CONFIG };
    const warnings: string[] = [];
    for (const [key, value] of Object.entries(
        data as Record<string, unknown>,
    )) {
        if (Object.hasOwn(TABLES, key)) {
            const field = TABLES[key as keyof typeof TABLES];
            config[field] = parseLine(
                key,
                value,
                DEFAULT_CONFIG[field],
                warnings,
            );
        } else if (key === "memory") {
            config.memory = parseMemory(value, warnings);
        } else {
            warnings.push(`config.toml: unknown key ${key}`);
        }
    }
    return { config, warnings };
}

export function configPath(env: Env = process.env): string {
    return join(
        xdgDir(env, "XDG_CONFIG_HOME", ".config"),
        "dorothy",
        "config.toml",
    );
}

// No file is the defaults, quietly; a file that cannot be read is a warning.
export async function readConfig(
    env: Env = process.env,
): Promise<{ config: Config; warnings: string[] }> {
    let text: string;
    try {
        text = await readFile(configPath(env), "utf8");
    } catch (error) {
        if ((error as { code?: unknown }).code === "ENOENT") {
            return { config: DEFAULT_CONFIG, warnings: [] };
        }
        return {
            config: DEFAULT_CONFIG,
            warnings: [`config.toml: ${describeError(error)}`],
        };
    }
    return parseConfig(text);
}
