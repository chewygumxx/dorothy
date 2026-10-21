// vim:set expandtab shiftwidth=4 filetype=typescript:
// SPDX-License-Identifier: GPL-3.0-only

//
//
// ~chewygumxx/dorothy.git
// ::: :/packages/core/src/secrets.ts
//
//

import { stat } from "node:fs/promises";
import { resolve } from "node:path";
import type { Env } from "./xdg.js";

export type SecretsCode = "SOPS_MISSING" | "SOPS_FAILED" | "SECRETS_INVALID";

// Arguments exclude the executable; undefined input means closed stdin.
// A caller can inject a runner with its own process environment.
export type SecretsRun = (
    args: string[],
    input?: string,
) => Promise<{ exitCode: number; stdout: string }>;

async function runSops(args: string[], input?: string) {
    const child = Bun.spawn(["sops", ...args], {
        stdin: input === undefined ? "ignore" : new Blob([input]),
        stdout: "pipe",
        stderr: "ignore",
    });
    const [exitCode, stdout] = await Promise.all([
        child.exited,
        new Response(child.stdout).text(),
    ]);
    return { exitCode, stdout };
}

function hasCode(error: unknown, code: string): boolean {
    return (
        typeof error === "object" &&
        error !== null &&
        "code" in error &&
        error.code === code
    );
}

async function exists(path: string): Promise<boolean> {
    try {
        await stat(path);
        return true;
    } catch (error) {
        if (hasCode(error, "ENOENT")) return false;
        throw error;
    }
}

function failureCode(error: unknown): SecretsCode {
    return hasCode(error, "ENOENT") ? "SOPS_MISSING" : "SOPS_FAILED";
}

export async function loadSecrets(
    path: string,
    into: Env,
    run: SecretsRun = runSops,
): Promise<SecretsCode | null> {
    try {
        if (!(await exists(path))) return null;
    } catch {
        return "SOPS_FAILED";
    }

    let result: Awaited<ReturnType<SecretsRun>>;
    try {
        result = await run(["decrypt", "--output-type", "json", resolve(path)]);
    } catch (error) {
        return failureCode(error);
    }
    if (result.exitCode !== 0) return "SOPS_FAILED";

    let values: unknown;
    try {
        values = JSON.parse(result.stdout);
    } catch {
        return "SECRETS_INVALID";
    }
    if (
        typeof values !== "object" ||
        values === null ||
        Array.isArray(values)
    ) {
        return "SECRETS_INVALID";
    }
    const entries = Object.entries(values);
    if (entries.some(([, value]) => typeof value !== "string")) {
        return "SECRETS_INVALID";
    }
    try {
        for (const [name, value] of entries) {
            if (
                !Object.hasOwn(into, name) ||
                into[name] === undefined ||
                into[name] === ""
            ) {
                // Defining a property also handles names such as __proto__ safely.
                Object.defineProperty(into, name, {
                    value,
                    enumerable: true,
                    writable: true,
                    configurable: true,
                });
            }
        }
    } catch {
        return "SOPS_FAILED";
    }
    return null;
}
