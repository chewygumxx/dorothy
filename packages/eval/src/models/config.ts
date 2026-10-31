// vim:set expandtab shiftwidth=4 filetype=typescript:
// SPDX-License-Identifier: GPL-3.0-only

//
//
// ~chewygumxx/dorothy.git
// ::: :/packages/eval/src/models/config.ts
//
//

// <work>/eval.toml, or the file --models names: each role names its route
// and model. API keys are named by their variable, never written in the
// file.

import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { codeOf, UsageError } from "../errors.js";

export const ROLES = ["generate", "answer", "judge"] as const;
export type Role = (typeof ROLES)[number];
export type ApiConfig = {
    via?: "api";
    baseUrl: string;
    model: string;
    key: string | null;
    timeoutSeconds?: number;
};
export const EFFORTS = [
    "none",
    "minimal",
    "low",
    "medium",
    "high",
    "xhigh",
] as const;
export type CliConfig = { timeoutSeconds?: number } & (
    | { via: "claude"; model: string }
    | { via: "codex"; model: string; effort: (typeof EFFORTS)[number] }
);
export type RoleConfig = ApiConfig | CliConfig;
export type EvalConfig = Record<Role, RoleConfig | null>;

const SETTINGS = [
    "via",
    "base-url",
    "model",
    "key",
    "effort",
    "timeout-seconds",
];
const KEY_NAME = /^[A-Z_][A-Z0-9_]*$/;

export const configPath = (work: string) => join(work, "eval.toml");

const isTable = (value: unknown): value is Record<string, unknown> =>
    typeof value === "object" && value !== null && !Array.isArray(value);

function roleOf(file: string, role: Role, table: unknown): RoleConfig {
    const where = `${file}: [models.${role}]`;
    if (!isTable(table)) {
        throw new UsageError(`${where} must be a table`);
    }
    const extra = Object.keys(table).filter((key) => !SETTINGS.includes(key));
    if (extra.length > 0) {
        throw new UsageError(`${where} has no setting ${extra.join(", ")}`);
    }
    const via = table.via ?? "api";
    if (via !== "api" && via !== "claude" && via !== "codex") {
        throw new UsageError(`${where}: via must be api, claude or codex`);
    }
    const model = table.model;
    if (typeof model !== "string" || model.trim() === "") {
        throw new UsageError(`${where} needs model`);
    }
    // How long one attempt may take; 120 seconds where unset.
    const seconds = table["timeout-seconds"];
    if (
        seconds !== undefined &&
        (typeof seconds !== "number" ||
            !Number.isInteger(seconds) ||
            seconds < 1 ||
            seconds > 3600)
    ) {
        throw new UsageError(
            `${where}: timeout-seconds must be a whole number from 1 to 3600`,
        );
    }
    const timeout = seconds === undefined ? {} : { timeoutSeconds: seconds };
    if (via !== "codex" && table.effort !== undefined) {
        throw new UsageError(`${where}: effort is only for codex`);
    }
    if (via !== "api") {
        for (const setting of ["base-url", "key"]) {
            if (table[setting] !== undefined) {
                throw new UsageError(`${where}: ${setting} is only for api`);
            }
        }
        if (via === "claude") {
            return { via, model, ...timeout };
        }
        const effort = table.effort ?? "medium";
        if (!EFFORTS.some((value) => value === effort)) {
            throw new UsageError(
                `${where}: effort must be ${EFFORTS.join(", ")}`,
            );
        }
        return {
            via,
            model,
            effort: effort as (typeof EFFORTS)[number],
            ...timeout,
        };
    }
    const baseUrl = table["base-url"];
    const key = table.key;
    if (
        typeof baseUrl !== "string" ||
        !/^https?:\/\/\S+$/.test(baseUrl) ||
        !URL.canParse(baseUrl)
    ) {
        throw new UsageError(`${where} needs base-url, an http or https URL`);
    }
    // The message never repeats what was written, which may be a key.
    if (key !== undefined && (typeof key !== "string" || !KEY_NAME.test(key))) {
        throw new UsageError(
            `${where}: key names a variable, in capitals, digits and underscores, such as "OPENROUTER_API_KEY", never the key itself`,
        );
    }
    return { via, baseUrl, model, key: key ?? null, ...timeout };
}

// The models of `path` as given, which must exist, else of the work
// directory's eval.toml, which need not: no role is then named.
export async function readEvalConfig(
    work: string,
    path?: string,
): Promise<EvalConfig> {
    const config: EvalConfig = { generate: null, answer: null, judge: null };
    const file = path ?? configPath(work);
    const label = path ?? "eval.toml";
    let text: string;
    try {
        text = await readFile(file, "utf8");
    } catch (error) {
        const code = codeOf(error);
        if (code === "ENOENT") {
            if (path === undefined) {
                return config;
            }
            throw new UsageError(
                `cannot read ${file}: ENOENT; name a models file that exists`,
            );
        }
        throw new UsageError(
            `cannot read ${file}: ${code ?? "failed"}; mend it, or ${path === undefined ? "remove it to start again" : "name another"}`,
        );
    }
    let parsed: unknown;
    try {
        parsed = Bun.TOML.parse(text);
    } catch {
        // The parser quotes the line it dislikes, which may hold a key.
        throw new UsageError(
            `${label} does not parse as TOML: check its quoting`,
        );
    }
    const models = isTable(parsed) ? (parsed.models ?? {}) : {};
    if (!isTable(models)) {
        throw new UsageError(`${label}: [models] must be a table`);
    }
    const unknown = Object.keys(models).filter(
        (name) => !(ROLES as readonly string[]).includes(name),
    );
    if (unknown.length > 0) {
        throw new UsageError(
            `${label}: no role ${unknown.join(", ")}; the roles are ${ROLES.join(", ")}`,
        );
    }
    for (const role of ROLES) {
        if (models[role] !== undefined) {
            config[role] = roleOf(label, role, models[role]);
        }
    }
    return config;
}

// `path` is the --models file the config was read from, if any.
export function requireRole(
    config: EvalConfig,
    role: Role,
    path?: string,
): RoleConfig {
    const found = config[role];
    if (found === null) {
        throw new UsageError(
            `${path ?? "eval.toml"} has no [models.${role}]: the README's evaluation section shows one`,
        );
    }
    return found;
}

// openai/gpt-oss-120b is openai's; gpt-4o, with no prefix, gpt's.
export const vendorOf = (model: string) =>
    model.includes("/")
        ? model.slice(0, model.indexOf("/"))
        : (model.split(/[-:]/)[0] ?? model);

export const vendorOfRole = (role: RoleConfig) =>
    role.via === "claude"
        ? "anthropic"
        : role.via === "codex"
          ? "openai"
          : vendorOf(role.model);
