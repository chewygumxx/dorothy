// vim:set expandtab shiftwidth=4 filetype=typescript:
// SPDX-License-Identifier: GPL-3.0-only

//
//
// ~chewygumxx/dorothy.git
// ::: :/packages/core/src/secrets.ts
//
//

import { stat, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
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
        // Project-scoped mise shims need the checkout's tool configuration.
        cwd: import.meta.dir,
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
    const file = resolve(path);
    try {
        if (!(await exists(file))) return null;
    } catch {
        return "SOPS_FAILED";
    }

    let result: Awaited<ReturnType<SecretsRun>>;
    try {
        result = await run([
            "decrypt",
            "--input-type",
            "json",
            "--output-type",
            "json",
            file,
        ]);
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

export async function saveSecret(
    path: string,
    name: string,
    value: string,
    run: SecretsRun = runSops,
): Promise<void> {
    // Sops set paths are not JSON strings: escapes are kept literally and
    // brackets split branches. Reject names that cannot round-trip there.
    if (
        JSON.stringify(name) !== `"${name}"` ||
        name.includes("[") ||
        name.includes("]")
    ) {
        throw new Error("SECRETS_INVALID");
    }
    const file = resolve(path);
    let present: boolean;
    try {
        present = await exists(file);
    } catch {
        throw new Error("SOPS_FAILED");
    }

    let result: Awaited<ReturnType<SecretsRun>>;
    try {
        result = present
            ? await run(
                  ["set", "--value-stdin", file, JSON.stringify([name])],
                  JSON.stringify(value),
              )
            : await run(
                  [
                      "--config",
                      join(dirname(file), ".sops.yaml"),
                      "encrypt",
                      "--input-type",
                      "json",
                      "--output-type",
                      "json",
                      "--filename-override",
                      file,
                  ],
                  JSON.stringify({ [name]: value }),
              );
    } catch (error) {
        throw new Error(failureCode(error));
    }
    if (result.exitCode !== 0) throw new Error("SOPS_FAILED");
    if (!present) {
        try {
            // Do not clobber a file another writer created during encryption.
            await writeFile(file, result.stdout, { mode: 0o600, flag: "wx" });
        } catch {
            throw new Error("SOPS_FAILED");
        }
    }
}

// The name of the secrets.json entry whose token Claude is to spend, for
// a user with more than one account: stripClaude drops an exported
// CLAUDE_CODE_OAUTH_TOKEN, but not this, which carries a name alone.
export const CLAUDE_TOKEN_VAR = "DOROTHY_CLAUDE_TOKEN_VAR";

// A choice naming no such token fails, rather than spend another account.
export function chooseClaudeToken(env: Env): SecretsCode | null {
    const name = env[CLAUDE_TOKEN_VAR];
    if (name === undefined || name === "") {
        return null;
    }
    const token = /^CLAUDE_CODE_OAUTH_TOKEN[A-Z0-9_]*$/.test(name)
        ? env[name]
        : undefined;
    if (token === undefined || token === "") {
        return "SECRETS_INVALID";
    }
    env.CLAUDE_CODE_OAUTH_TOKEN = token;
    return null;
}
