// vim:set expandtab shiftwidth=4 filetype=typescript:
// SPDX-License-Identifier: GPL-3.0-only

//
//
// ~chewygumxx/dorothy.git
// ::: :/packages/core/src/secrets.test.ts
//
//

import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadSecrets, type SecretsRun } from "./index.js";
import type { Env } from "./xdg.js";

async function capture(
    args: string[],
    env: Env,
    input?: string,
): Promise<{ exitCode: number; stdout: string }> {
    const child = Bun.spawn(args, {
        env,
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

let dir: string;
let path: string;
let env: Env;
let run: SecretsRun;

beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "dorothy-secrets-"));
    path = join(dir, "secrets.json");
    const keyPath = join(dir, "key.txt");
    env = {
        PATH: process.env.PATH,
        HOME: dir,
        XDG_CONFIG_HOME: join(dir, "config"),
        XDG_DATA_HOME: join(dir, "data"),
        XDG_STATE_HOME: join(dir, "state"),
        XDG_CACHE_HOME: join(dir, "cache"),
        SOPS_AGE_KEY_FILE: keyPath,
    };
    const key = await capture(["age-keygen", "-o", keyPath], env);
    expect(key.exitCode).toBe(0);
    const recipient = await capture(["age-keygen", "-y", keyPath], env);
    expect(recipient.exitCode).toBe(0);
    await writeFile(
        join(dir, ".sops.yaml"),
        `creation_rules:\n  - path_regex: secrets\\.json$\n    age: ${recipient.stdout.trim()}\n`,
    );
    run = (args, input) => capture(["sops", ...args], env, input);
});

afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
});

async function seed(value: unknown): Promise<void> {
    const result = await run(
        [
            "--config",
            join(dir, ".sops.yaml"),
            "encrypt",
            "--input-type",
            "json",
            "--output-type",
            "json",
            "--filename-override",
            path,
        ],
        JSON.stringify(value),
    );
    expect(result.exitCode).toBe(0);
    await writeFile(path, result.stdout, { mode: 0o600 });
}

// Only safe status and key names leave this process, never decrypted values.
async function loadInChild(childEnv: Env) {
    const child = Bun.spawn(
        [
            process.execPath,
            "--eval",
            `
            const { loadSecrets } = await import(process.env.SECRETS_MODULE);
            const into = {};
            const code = await loadSecrets(process.env.SECRETS_PATH, into);
            process.stdout.write(JSON.stringify({code, names: Object.keys(into)}));
        `,
        ],
        {
            env: {
                ...childEnv,
                SECRETS_MODULE: new URL("./index.ts", import.meta.url).href,
                SECRETS_PATH: path,
            },
            stdin: "ignore",
            stdout: "pipe",
            stderr: "pipe",
        },
    );
    const [exitCode, stdout, stderr] = await Promise.all([
        child.exited,
        new Response(child.stdout).text(),
        new Response(child.stderr).text(),
    ]);
    expect(exitCode).toBe(0);
    expect(stderr.length).toBe(0);
    return JSON.parse(stdout) as { code: string | null; names: string[] };
}

describe("loadSecrets", () => {
    it("loads missing and empty names, preserving nonempty overrides", async () => {
        await seed({
            FIRST: "synthetic-first",
            SECOND: "synthetic-second",
            EMPTY: "",
        });
        const into: Env = { SECOND: "exported-override", FIRST: "" };
        expect(await loadSecrets(path, into, run)).toBeNull();
        expect(into.FIRST === "synthetic-first").toBe(true);
        expect(into.SECOND === "exported-override").toBe(true);
        expect(into.EMPTY === "").toBe(true);
    });

    it("loads with the default PATH runner in an isolated process", async () => {
        await seed({ FIRST: "synthetic-first" });
        expect(await loadInChild(env)).toEqual({
            code: null,
            names: ["FIRST"],
        });
    });

    it("the default runner closes stdin and discards sops stderr", async () => {
        await writeFile(path, "unused");
        const bin = join(dir, "bin");
        await mkdir(bin);
        await writeFile(
            join(bin, "sops"),
            [
                "#!/bin/sh",
                "if read -r value; then exit 1; fi",
                "printf '%s\\n' 'untrusted diagnostic' >&2",
                "exit 7",
                "",
            ].join("\n"),
            { mode: 0o700 },
        );
        expect(await loadInChild({ ...env, PATH: bin })).toEqual({
            code: "SOPS_FAILED",
            names: [],
        });
    });

    it("does not invoke sops for a missing file", async () => {
        let calls = 0;
        const into: Env = {};
        expect(
            await loadSecrets(path, into, async () => {
                calls++;
                throw new Error("unexpected sops invocation");
            }),
        ).toBeNull();
        expect(calls).toBe(0);
        expect(Object.keys(into)).toEqual([]);
    });

    it("returns only SOPS_FAILED for a wrong age key", async () => {
        await seed({ FIRST: "synthetic-first" });
        const otherKey = join(dir, "other-key.txt");
        expect(
            (await capture(["age-keygen", "-o", otherKey], env)).exitCode,
        ).toBe(0);
        const into: Env = {};
        expect(
            await loadSecrets(path, into, (args, input) =>
                capture(
                    ["sops", ...args],
                    { ...env, SOPS_AGE_KEY_FILE: otherKey },
                    input,
                ),
            ),
        ).toBe("SOPS_FAILED");
        expect(Object.keys(into)).toEqual([]);
    });

    it("returns only SOPS_MISSING when the binary cannot be found", async () => {
        await writeFile(path, "unused");
        const missing: SecretsRun = async () => {
            throw Object.assign(new Error("untrusted diagnostic"), {
                code: "ENOENT",
            });
        };
        expect(await loadSecrets(path, {}, missing)).toBe("SOPS_MISSING");
    });

    it("does not expose a runner's thrown diagnostic", async () => {
        await writeFile(path, "unused");
        expect(
            await loadSecrets(path, {}, async () => {
                throw new Error("untrusted diagnostic");
            }),
        ).toBe("SOPS_FAILED");
    });

    it("rejects invalid decrypted JSON without copying parse fragments", async () => {
        await writeFile(path, "unused");
        expect(
            await loadSecrets(path, {}, async () => ({
                exitCode: 0,
                stdout: '{"FIRST": "synthetic-first",',
            })),
        ).toBe("SECRETS_INVALID");
    });

    it.each(
        [
            null,
            [],
            "text",
            42,
            { FIRST: "synthetic-first", BAD: 7 },
            { NESTED: {} },
        ].map((value) => ({ value })),
    )("rejects a non-string map atomically (case %#)", async ({ value }) => {
        await writeFile(path, "unused");
        const into: Env = {};
        expect(
            await loadSecrets(path, into, async () => ({
                exitCode: 0,
                stdout: JSON.stringify(value),
            })),
        ).toBe("SECRETS_INVALID");
        expect(Object.keys(into)).toEqual([]);
    });

    it("treats inherited names as missing without changing the prototype", async () => {
        await seed(
            JSON.parse(
                '{"__proto__":"synthetic-proto","toString":"synthetic-string"}',
            ),
        );
        const into: Env = {};
        expect(await loadSecrets(path, into, run)).toBeNull();
        expect(Object.hasOwn(into, "__proto__")).toBe(true);
        expect(
            Object.getOwnPropertyDescriptor(into, "__proto__")?.value ===
                "synthetic-proto",
        ).toBe(true);
        expect(
            Object.getOwnPropertyDescriptor(into, "toString")?.value ===
                "synthetic-string",
        ).toBe(true);
        expect(Object.getPrototypeOf(into)).toBe(Object.prototype);
    });
});
