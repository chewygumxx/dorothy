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
    // The recall server and Dorothy's memory tools.
    recall: boolean;
    // Estimated tokens of notes in a new session's prompt.
    budget: number;
    idleSeconds: number;
    halfLifeDays: number;
    // Stale conversations reviewed per launch.
    catchUp: number;
};
export type CompactionConfig = {
    enabled: boolean;
    // Context tokens past which compaction runs at the next idle.
    soft: number;
    // Context tokens past which the next message waits for it.
    hard: number;
    // Estimated tokens of the newest turns kept word for word.
    tail: number;
};
export type HistoryConfig = {
    enabled: boolean;
    // Seconds between pushes to the mirror, at most.
    pushSeconds: number;
};
export type Config = {
    statusline: LineConfig;
    replyStats: LineConfig;
    memory: MemoryConfig;
    compaction: CompactionConfig;
    history: HistoryConfig;
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
        recall: true,
        budget: 4000,
        idleSeconds: 60,
        halfLifeDays: 30,
        catchUp: 5,
    },
    compaction: {
        enabled: true,
        soft: 64000,
        hard: 128000,
        tail: 16000,
    },
    history: {
        enabled: true,
        pushSeconds: 60,
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

// How a field of a table is written in the file: its key there, and a
// reader that gives its value, or undefined with what it must be instead.
type FieldSpec<V> = {
    key: string;
    read: (field: unknown) => V | undefined;
    expected: string;
};

const toggle = (key: string): FieldSpec<boolean> => ({
    key,
    read: (field) => (typeof field === "boolean" ? field : undefined),
    expected: "true or false",
});

const whole = (key: string, min: number, max: number): FieldSpec<number> => ({
    key,
    read: (field) =>
        typeof field === "number" &&
        Number.isInteger(field) &&
        field >= min &&
        field <= max
            ? field
            : undefined,
    expected: `a whole number from ${min} to ${max}`,
});

// A table of switches and whole numbers, a spec for each field: each bad
// value warns and keeps its default.
function parseTable<T extends object>(
    table: string,
    value: unknown,
    defaults: T,
    specs: { [K in keyof T]: FieldSpec<T[K]> },
    warnings: string[],
): T {
    if (!isRecord(value)) {
        warnings.push(`config.toml: ${table} is not a table`);
        return defaults;
    }
    const parsed = { ...defaults };
    for (const [key, field] of Object.entries(value)) {
        let known = false;
        for (const name in specs) {
            const spec = specs[name];
            if (spec.key !== key) {
                continue;
            }
            known = true;
            const read = spec.read(field);
            if (read === undefined) {
                warnings.push(
                    `config.toml: ${table}.${key} must be ${spec.expected}`,
                );
            } else {
                parsed[name] = read;
            }
        }
        if (!known) {
            warnings.push(`config.toml: unknown key ${table}.${key}`);
        }
    }
    return parsed;
}

const parseMemory = (value: unknown, warnings: string[]): MemoryConfig =>
    parseTable(
        "memory",
        value,
        DEFAULT_CONFIG.memory,
        {
            enabled: toggle("enabled"),
            recall: toggle("recall"),
            budget: whole("budget", 200, 20000),
            idleSeconds: whole("idle-seconds", 10, 3600),
            halfLifeDays: whole("half-life-days", 1, 3650),
            catchUp: whole("catch-up", 0, 50),
        },
        warnings,
    );

const parseHistory = (value: unknown, warnings: string[]): HistoryConfig =>
    parseTable(
        "history",
        value,
        DEFAULT_CONFIG.history,
        {
            enabled: toggle("enabled"),
            pushSeconds: whole("push-seconds", 10, 86400),
        },
        warnings,
    );

// The thresholds only make sense together: compacting must leave a tail
// smaller than what set it off, below the point that holds a message.
function parseCompaction(value: unknown, warnings: string[]): CompactionConfig {
    const parsed = parseTable(
        "compaction",
        value,
        DEFAULT_CONFIG.compaction,
        {
            enabled: toggle("enabled"),
            soft: whole("soft", 2000, 900000),
            hard: whole("hard", 4000, 950000),
            tail: whole("tail", 500, 200000),
        },
        warnings,
    );
    if (parsed.tail < parsed.soft && parsed.soft < parsed.hard) {
        return parsed;
    }
    warnings.push(
        "config.toml: compaction needs tail < soft < hard; using the defaults for all three",
    );
    const { soft, hard, tail } = DEFAULT_CONFIG.compaction;
    return { ...parsed, soft, hard, tail };
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
        } else if (key === "compaction") {
            config.compaction = parseCompaction(value, warnings);
        } else if (key === "history") {
            config.history = parseHistory(value, warnings);
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
