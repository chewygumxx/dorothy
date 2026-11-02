// vim:set expandtab shiftwidth=4 filetype=typescript:
// SPDX-License-Identifier: GPL-3.0-only

//
//
// ~chewygumxx/dorothy.git
// ::: :/packages/orchestra/src/environment.test.ts
//
//

import { describe, expect, it } from "bun:test";
import { join } from "node:path";
import { isServerEnvironment, serverEnvironment } from "./environment.js";

const HOSTILE = {
    ACPX_AUTH_OPENAI_API_KEY: "sk-acpx",
    ANTHROPIC_API_KEY: "sk-ant",
    OPENAI_API_KEY: "sk-openai",
    FEATHERLESS_API_KEY: "fl",
    SOPS_AGE_KEY: "AGE-SECRET-KEY-1",
    CLAUDE_CODE_OAUTH_TOKEN: "oauth",
    GH_TOKEN: "ghp",
    AWS_SECRET_ACCESS_KEY: "aws",
    GIT_DIR: "/elsewhere",
    GIT_CONFIG_GLOBAL: "/evil",
};

// Those a process would act on at its own start, so never given to one.
const PRELOADS = {
    NODE_OPTIONS: "--require /evil.js",
    BUN_OPTIONS: "--preload /evil.ts",
    LD_PRELOAD: "/evil.so",
};

const KEPT = {
    PATH: "/usr/bin",
    HOME: "/home/u",
    XDG_CONFIG_HOME: "/home/u/.config",
    XDG_DATA_HOME: "/home/u/.local/share",
    XDG_STATE_HOME: "/home/u/.local/state",
    XDG_CACHE_HOME: "/home/u/.cache",
    XDG_RUNTIME_DIR: "/run/user/1000",
    DBUS_SESSION_BUS_ADDRESS: "unix:path=/run/user/1000/bus",
    SSH_AUTH_SOCK: "/run/user/1000/ssh-agent",
    LANG: "en_GB.UTF-8",
    LC_ALL: "en_GB.UTF-8",
    TERM: "xterm-256color",
    TZ: "Europe/London",
};

describe("serverEnvironment", () => {
    it("keeps the allowlist and nothing else", () => {
        expect(serverEnvironment({ ...HOSTILE, ...PRELOADS, ...KEPT })).toEqual(
            KEPT,
        );
    });

    it("drops an empty or missing value", () => {
        expect(
            serverEnvironment({ PATH: "/usr/bin", HOME: "", TERM: undefined }),
        ).toEqual({
            PATH: "/usr/bin",
        });
    });

    it("knows a clean environment from one that is not", () => {
        expect(isServerEnvironment(KEPT)).toBe(true);
        expect(isServerEnvironment({ ...KEPT, GH_TOKEN: "ghp" })).toBe(false);
        expect(isServerEnvironment({ ...KEPT, HOME: "" })).toBe(false);
    });
});

describe("reexecClean", () => {
    const child = join(import.meta.dir, "fixtures", "env-child.ts");

    it("runs the process again with the allowlist alone, arguments intact", async () => {
        const proc = Bun.spawn(
            [process.execPath, child, "--orchestra-server", "a b"],
            {
                env: {
                    ...HOSTILE,
                    PATH: process.env.PATH ?? "",
                    HOME: "/home/u",
                },
                stdout: "pipe",
                stderr: "pipe",
            },
        );
        const out = await new Response(proc.stdout).text();
        expect(await proc.exited).toBe(0);
        expect(JSON.parse(out)).toEqual({
            names: ["HOME", "PATH"],
            args: ["--orchestra-server", "a b"],
        });
    });

    it("runs once, without a second process, where the environment is clean", async () => {
        const proc = Bun.spawn([process.execPath, child], {
            env: { PATH: process.env.PATH ?? "", HOME: "/home/u" },
            stdout: "pipe",
        });
        const out = await new Response(proc.stdout).text();
        expect(await proc.exited).toBe(0);
        expect(out.trim().split("\n")).toHaveLength(1);
    });

    it("passes the clean process's exit code on", async () => {
        const proc = Bun.spawn(
            [
                process.execPath,
                "-e",
                `
                const { reexecClean } = await import(${JSON.stringify(join(import.meta.dir, "environment.ts"))});
                const code = await reexecClean({ argv: ["-e", "process.exit(7)"], env: process.env, execPath: process.execPath });
                process.exit(code ?? 0);
            `,
            ],
            { env: { PATH: process.env.PATH ?? "", GH_TOKEN: "ghp" } },
        );
        expect(await proc.exited).toBe(7);
    });
});
