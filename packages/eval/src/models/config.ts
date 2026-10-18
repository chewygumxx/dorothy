// vim:set expandtab shiftwidth=4 filetype=typescript:
// SPDX-License-Identifier: GPL-3.0-only

//
//
// ~chewygumxx/dorothy.git
// ::: :/packages/eval/src/models/config.ts
//
//

// <work>/eval.toml: a base URL and a model for each role, and the name of
// the variable that holds its key. A key itself never goes in the file.

import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { UsageError } from "../errors.js";

export const ROLES = ["generate", "answer", "judge"] as const;
export type Role = (typeof ROLES)[number];
export type RoleConfig = { baseUrl: string; model: string; key: string | null };
export type EvalConfig = Record<Role, RoleConfig | null>;

const SETTINGS = ["base-url", "model", "key"];
const KEY_NAME = /^[A-Z_][A-Z0-9_]*$/;

export const configPath = (work: string) => join(work, "eval.toml");

const isTable = (value: unknown): value is Record<string, unknown> =>
    typeof value === "object" && value !== null && !Array.isArray(value);

function roleOf(role: Role, table: unknown): RoleConfig {
    const where = `eval.toml: [models.${role}]`;
    if (!isTable(table)) {
        throw new UsageError(`${where} must be a table`);
    }
    const extra = Object.keys(table).filter((key) => !SETTINGS.includes(key));
    if (extra.length > 0) {
        throw new UsageError(`${where} has no setting ${extra.join(", ")}`);
    }
    const baseUrl = table["base-url"];
    const model = table.model;
    const key = table.key;
    if (typeof baseUrl !== "string" || !/^https?:\/\/\S+$/.test(baseUrl)) {
        throw new UsageError(`${where} needs base-url, an http or https URL`);
    }
    if (typeof model !== "string" || model.trim() === "") {
        throw new UsageError(`${where} needs model`);
    }
    // The message never repeats what was written, which may be a key.
    if (key !== undefined && (typeof key !== "string" || !KEY_NAME.test(key))) {
        throw new UsageError(
            `${where}: key names a variable, such as "OPENROUTER_API_KEY", never the key itself`,
        );
    }
    return { baseUrl, model, key: key ?? null };
}

export async function readEvalConfig(work: string): Promise<EvalConfig> {
    const config: EvalConfig = { generate: null, answer: null, judge: null };
    let text: string;
    try {
        text = await readFile(configPath(work), "utf8");
    } catch {
        return config;
    }
    let parsed: unknown;
    try {
        parsed = Bun.TOML.parse(text);
    } catch (error) {
        throw new UsageError(`eval.toml: ${(error as Error).message}`);
    }
    const models = isTable(parsed) ? (parsed.models ?? {}) : {};
    if (!isTable(models)) {
        throw new UsageError("eval.toml: [models] must be a table");
    }
    const unknown = Object.keys(models).filter(
        (name) => !(ROLES as readonly string[]).includes(name),
    );
    if (unknown.length > 0) {
        throw new UsageError(
            `eval.toml: no role ${unknown.join(", ")}; the roles are ${ROLES.join(", ")}`,
        );
    }
    for (const role of ROLES) {
        if (models[role] !== undefined) {
            config[role] = roleOf(role, models[role]);
        }
    }
    return config;
}

export function requireRole(config: EvalConfig, role: Role): RoleConfig {
    const found = config[role];
    if (found === null) {
        throw new UsageError(
            `eval.toml has no [models.${role}]: the README's evaluation section shows one`,
        );
    }
    return found;
}

// openai/gpt-oss-120b is openai's; gpt-4o, with no prefix, gpt's.
export const vendorOf = (model: string) =>
    model.includes("/")
        ? model.slice(0, model.indexOf("/"))
        : (model.split(/[-:]/)[0] ?? model);
