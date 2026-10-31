// vim:set expandtab shiftwidth=4 filetype=typescript:
// SPDX-License-Identifier: GPL-3.0-only

//
//
// ~chewygumxx/dorothy.git
// ::: :/packages/core/src/secrets.test.ts
//
//

import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import {
    mkdir,
    mkdtemp,
    readFile,
    rm,
    stat,
    writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
    CLAUDE_TOKEN_VAR,
    chooseClaudeToken,
    loadSecrets,
    type SecretsRun,
    saveSecret,
} from "./index.js";
import type { Env } from "./xdg.js";

async function capture(
    args: string[],
    env: Env,
    input?: string,
    cwd?: string,
): Promise<{ exitCode: number; stdout: string }> {
    const child = Bun.spawn(args, {
        env,
        cwd,
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
async function loadInChild(childEnv: Env, cwd?: string, file = path) {
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
                SECRETS_PATH: file,
            },
            cwd,
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

// Model a project-scoped PATH shim, then delegate to the real sops binary.
async function projectShim(): Promise<Env> {
    const bin = join(dir, "bin");
    await mkdir(bin);
    await writeFile(
        join(bin, "sops"),
        '#!/bin/sh\n[ "$PWD" = "$SOPS_CHECKOUT_CWD" ] || exit 7\nexec "$SOPS_BINARY" "$@"\n',
        { mode: 0o700 },
    );
    return {
        ...env,
        PATH: `${bin}:${env.PATH}`,
        SOPS_BINARY: Bun.which("sops") ?? "",
        SOPS_CHECKOUT_CWD: import.meta.dir,
    };
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

    it("declares JSON input to sops regardless of the filename extension", async () => {
        await seed({ FIRST: "synthetic-first" });
        const binaryName = join(dir, "encrypted.bin");
        await writeFile(binaryName, await readFile(path));
        const into: Env = {};
        expect(
            await loadSecrets(binaryName, into, (args, input) => {
                expect(args[args.indexOf("--input-type") + 1]).toBe("json");
                return run(args, input);
            }),
        ).toBeNull();
        expect(into.FIRST === "synthetic-first").toBe(true);
    });

    it("loads with the default PATH runner in an isolated process", async () => {
        await seed({ FIRST: "synthetic-first" });
        expect(await loadInChild(env)).toEqual({
            code: null,
            names: ["FIRST"],
        });
    });

    it("loads a caller-relative file outside the checkout through a project shim", async () => {
        await seed({ FIRST: "synthetic-first" });
        expect(
            await loadInChild(await projectShim(), dir, "secrets.json"),
        ).toEqual({
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

describe("saveSecret", () => {
    it.each(
        ['quote"name', "slash\\name", "nested[branch]", "line\nname"].map(
            (name) => ({ name }),
        ),
    )(
        "rejects ambiguous sops key names before any write (case %#)",
        async ({ name }) => {
            await expect(
                saveSecret(path, name, "synthetic-first", run),
            ).rejects.toThrow(/^SECRETS_INVALID$/);
            expect(await Bun.file(path).exists()).toBe(false);
            await seed({ KEEP: "synthetic-kept" });
            const before = await readFile(path, "utf8");
            await expect(
                saveSecret(path, name, "synthetic-first", run),
            ).rejects.toThrow(/^SECRETS_INVALID$/);
            expect((await readFile(path, "utf8")) === before).toBe(true);
        },
    );

    it("creates encrypted JSON privately using the adjacent recipient rule", async () => {
        await saveSecret(path, "FIRST", "synthetic-first", run);
        expect((await stat(path)).mode & 0o777).toBe(0o600);
        const encrypted = await readFile(path, "utf8");
        expect(encrypted.includes("synthetic-first")).toBe(false);
        expect(JSON.parse(encrypted).FIRST.startsWith("ENC[")).toBe(true);
        const into: Env = {};
        expect(await loadSecrets(path, into, run)).toBeNull();
        expect(into.FIRST === "synthetic-first").toBe(true);
    });

    it("changes one value and adds another while keeping the rest", async () => {
        await seed({ FIRST: "synthetic-first", SECOND: "synthetic-second" });
        let inputs = 0;
        const guardedRun: SecretsRun = (args, input) => {
            // The payload travels only through stdin, never the process list.
            expect(args.some((arg) => arg.includes("synthetic-"))).toBe(false);
            if (input !== undefined) inputs++;
            return run(args, input);
        };
        await saveSecret(path, "FIRST", "synthetic-replacement", guardedRun);
        await saveSecret(path, "THIRD", "synthetic-third", guardedRun);
        expect(inputs).toBe(2);
        const into: Env = {};
        expect(await loadSecrets(path, into, run)).toBeNull();
        expect(into.FIRST === "synthetic-replacement").toBe(true);
        expect(into.SECOND === "synthetic-second").toBe(true);
        expect(into.THIRD === "synthetic-third").toBe(true);
        expect((await stat(path)).mode & 0o777).toBe(0o600);
    });

    it("JSON-encodes a multiline value on stdin", async () => {
        await seed({ KEEP: "synthetic-kept" });
        const name = "MULTILINE";
        const value = 'synthetic-"value"\nwith\\slashes';
        await saveSecret(path, name, value, run);
        const into: Env = {};
        expect(await loadSecrets(path, into, run)).toBeNull();
        expect(into[name] === value).toBe(true);
        expect(into.KEEP === "synthetic-kept").toBe(true);
        expect(Object.keys(into).sort()).toEqual(["KEEP", name].sort());
    });

    it("passes a new map through stdin with no value on argv", async () => {
        await saveSecret(path, "FIRST", "synthetic-first", (args, input) => {
            expect(args.some((arg) => arg.includes("synthetic-first"))).toBe(
                false,
            );
            expect(input === '{"FIRST":"synthetic-first"}').toBe(true);
            return run(args, input);
        });
        const into: Env = {};
        expect(await loadSecrets(path, into, run)).toBeNull();
        expect(into.FIRST === "synthetic-first").toBe(true);
    });

    it("uses the default runner to create and update with an isolated env", async () => {
        const child = await capture(
            [
                process.execPath,
                "--eval",
                `
                const { saveSecret, loadSecrets } = await import(process.env.SECRETS_MODULE);
                const path = process.env.SECRETS_PATH;
                await saveSecret(path, "FIRST", process.env.SYNTHETIC_VALUE);
                await saveSecret(path, "FIRST", process.env.SYNTHETIC_REPLACEMENT);
                const into = {};
                const code = await loadSecrets(path, into);
                process.stdout.write(JSON.stringify({
                    code, matches: into.FIRST === process.env.SYNTHETIC_REPLACEMENT,
                }));
            `,
            ],
            {
                ...env,
                SECRETS_MODULE: new URL("./index.ts", import.meta.url).href,
                SECRETS_PATH: path,
                SYNTHETIC_VALUE: "synthetic-first",
                SYNTHETIC_REPLACEMENT: "synthetic-replacement",
            },
        );
        expect(child.exitCode).toBe(0);
        expect(JSON.parse(child.stdout)).toEqual({ code: null, matches: true });
    });

    it("creates and updates a caller-relative file outside the checkout", async () => {
        const child = await capture(
            [
                process.execPath,
                "--eval",
                `
                const { saveSecret, loadSecrets } = await import(process.env.SECRETS_MODULE);
                await saveSecret("secrets.json", "FIRST", process.env.SYNTHETIC_VALUE);
                await saveSecret("secrets.json", "FIRST", process.env.SYNTHETIC_REPLACEMENT);
                const into = {};
                const code = await loadSecrets("secrets.json", into);
                process.stdout.write(JSON.stringify({
                    code, matches: into.FIRST === process.env.SYNTHETIC_REPLACEMENT,
                }));
            `,
            ],
            {
                ...(await projectShim()),
                SECRETS_MODULE: new URL("./index.ts", import.meta.url).href,
                SYNTHETIC_VALUE: "synthetic-first",
                SYNTHETIC_REPLACEMENT: "synthetic-replacement",
            },
            undefined,
            dir,
        );
        expect(child.exitCode).toBe(0);
        expect(JSON.parse(child.stdout)).toEqual({ code: null, matches: true });
        expect((await stat(path)).mode & 0o777).toBe(0o600);
    });

    it("refuses to overwrite a file created while encryption was running", async () => {
        const competing = "another writer's encrypted file";
        await expect(
            saveSecret(
                path,
                "FIRST",
                "synthetic-first",
                async (args, input) => {
                    const result = await run(args, input);
                    await writeFile(path, competing, { mode: 0o600 });
                    return result;
                },
            ),
        ).rejects.toThrow(/^SOPS_FAILED$/);
        expect((await readFile(path, "utf8")) === competing).toBe(true);
    });

    it("throws only SOPS_MISSING for a missing binary and creates nothing", async () => {
        await expect(
            saveSecret(path, "FIRST", "synthetic-first", async () => {
                throw Object.assign(new Error("untrusted diagnostic"), {
                    code: "ENOENT",
                });
            }),
        ).rejects.toThrow(/^SOPS_MISSING$/);
        expect(await Bun.file(path).exists()).toBe(false);
    });

    it("throws only SOPS_FAILED for a wrong key, keeping the existing file", async () => {
        await seed({ FIRST: "synthetic-first" });
        const before = await readFile(path, "utf8");
        const otherKey = join(dir, "other-key.txt");
        expect(
            (await capture(["age-keygen", "-o", otherKey], env)).exitCode,
        ).toBe(0);
        await expect(
            saveSecret(path, "FIRST", "synthetic-replacement", (args, input) =>
                capture(
                    ["sops", ...args],
                    { ...env, SOPS_AGE_KEY_FILE: otherKey },
                    input,
                ),
            ),
        ).rejects.toThrow(/^SOPS_FAILED$/);
        expect((await readFile(path, "utf8")) === before).toBe(true);
    });

    it("does not create a file if encryption fails", async () => {
        await rm(join(dir, ".sops.yaml"));
        await expect(
            saveSecret(path, "FIRST", "synthetic-first", run),
        ).rejects.toThrow(/^SOPS_FAILED$/);
        expect(await Bun.file(path).exists()).toBe(false);
    });

    it("does not expose a runner's thrown diagnostic", async () => {
        await expect(
            saveSecret(path, "FIRST", "synthetic-first", async () => {
                throw new Error("untrusted diagnostic");
            }),
        ).rejects.toThrow(/^SOPS_FAILED$/);
    });
});

describe("chooseClaudeToken", () => {
    it("names its variable", () => {
        expect(CLAUDE_TOKEN_VAR).toBe("DOROTHY_CLAUDE_TOKEN_VAR");
    });

    it.each([undefined, ""])("chooses nothing for a name of %p", (name) => {
        const env: Env = { CLAUDE_CODE_OAUTH_TOKEN: "own" };
        if (name !== undefined) env[CLAUDE_TOKEN_VAR] = name;
        expect(chooseClaudeToken(env)).toBeNull();
        expect(env.CLAUDE_CODE_OAUTH_TOKEN).toBe("own");
    });

    it("sets the token the name selects", () => {
        const env: Env = {
            [CLAUDE_TOKEN_VAR]: "CLAUDE_CODE_OAUTH_TOKEN_CLAUDE2",
            CLAUDE_CODE_OAUTH_TOKEN_CLAUDE2: "synthetic-two",
        };
        expect(chooseClaudeToken(env)).toBeNull();
        expect(env.CLAUDE_CODE_OAUTH_TOKEN).toBe("synthetic-two");
    });

    it("overrides an existing CLAUDE_CODE_OAUTH_TOKEN", () => {
        const env: Env = {
            [CLAUDE_TOKEN_VAR]: "CLAUDE_CODE_OAUTH_TOKEN_CLAUDE2",
            CLAUDE_CODE_OAUTH_TOKEN: "synthetic-other",
            CLAUDE_CODE_OAUTH_TOKEN_CLAUDE2: "synthetic-two",
        };
        expect(chooseClaudeToken(env)).toBeNull();
        expect(env.CLAUDE_CODE_OAUTH_TOKEN).toBe("synthetic-two");
    });

    it.each([
        ["a name matching no token pattern", "OPENROUTER_API_KEY"],
        ["a lower case name", "lower case"],
        ["a missing value", "CLAUDE_CODE_OAUTH_TOKEN_ABSENT"],
        ["an empty value", "CLAUDE_CODE_OAUTH_TOKEN_EMPTY"],
    ])("is SECRETS_INVALID for %s, leaving the token", (_, name) => {
        const env: Env = {
            [CLAUDE_TOKEN_VAR]: name,
            CLAUDE_CODE_OAUTH_TOKEN: "synthetic-other",
            CLAUDE_CODE_OAUTH_TOKEN_EMPTY: "",
            OPENROUTER_API_KEY: "synthetic-key",
        };
        expect(chooseClaudeToken(env)).toBe("SECRETS_INVALID");
        expect(env.CLAUDE_CODE_OAUTH_TOKEN).toBe("synthetic-other");
    });
});
