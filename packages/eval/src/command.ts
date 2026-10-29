// vim:set expandtab shiftwidth=4 filetype=typescript:
// SPDX-License-Identifier: GPL-3.0-only

//
//
// ~chewygumxx/dorothy.git
// ::: :/packages/eval/src/command.ts
//
//

// What every command meets: the terminal, passed in so tests can play
// it, and the options' readers.

import { resolve } from "node:path";
import type { Env, SecretsCode } from "@dorothy/core";
import { UsageError } from "./errors.js";
import type { ModelsOptions } from "./models/client.js";

export type Io = {
    env: Env;
    // Inject model process/file operations without changing env or caps.
    modelOptions?: Omit<ModelsOptions, "env" | "maxCalls">;
    // Required even in tests, so a fake terminal cannot read real secrets.
    loadSecrets(path: string, into: Env): Promise<SecretsCode | null>;
    out(text: string): void;
    err(text: string): void;
    // A line typed at the terminal; null at the end of its input.
    ask(prompt: string): Promise<string | null>;
    // Opens the editor on a file and waits for it to close.
    edit(path: string): Promise<void>;
};
// Each option as parseArgs takes it, with a line for --help.
export type Options = Record<
    string,
    { type: "string" | "boolean"; multiple?: boolean; description: string }
>;
export type Values = Record<string, string | boolean | string[] | undefined>;
export type Command = {
    summary: string;
    // What follows the options in its usage, such as "<run> <run>".
    args?: string;
    options: Options;
    run(values: Values, positionals: string[], io: Io): Promise<number>;
};

export function stringOf(values: Values, name: string): string | null {
    const value = values[name];
    return typeof value === "string" && value !== "" ? value : null;
}

// The work directory, which every command needs, made absolute.
export function workOf(values: Values): string {
    const work = stringOf(values, "work");
    if (work === null) {
        throw new UsageError("give --work, the evaluation's directory");
    }
    return resolve(work);
}

export function intOf(
    values: Values,
    name: string,
    fallback: number,
    min: number,
    max: number,
): number {
    const text = stringOf(values, name);
    if (text === null) {
        return fallback;
    }
    const value = Number(text);
    if (!Number.isInteger(value) || value < min || value > max) {
        throw new UsageError(
            `--${name} must be a whole number from ${min} to ${max}`,
        );
    }
    return value;
}
