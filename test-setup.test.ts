// vim:set expandtab shiftwidth=4 filetype=typescript:
// SPDX-License-Identifier: GPL-3.0-only

//
//
// ~chewygumxx/dorothy.git
// ::: :/test-setup.test.ts
//
//

// A pre-commit hook runs the tests with git's variables set, and a test
// that runs git in a scratch repository would otherwise write the real
// index. test-setup.ts drops them.

import { describe, expect, it } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const gitVariables = (env: Record<string, unknown>): string[] =>
    Object.keys(env).filter((name) => name.startsWith("GIT_"));

const lines = (output: Uint8Array): Record<string, string> =>
    Object.fromEntries(
        new TextDecoder()
            .decode(output)
            .split("\n")
            .filter((line) => line.includes("="))
            .map((line) => {
                const at = line.indexOf("=");
                return [line.slice(0, at), line.slice(at + 1)];
            }),
    );

describe("the test environment", () => {
    it("carries none of git's hook variables", () => {
        expect(gitVariables(process.env)).toEqual([]);
    });
    it("passes none to a child", () => {
        const child = Bun.spawnSync(["env"]);
        expect(gitVariables(lines(child.stdout))).toEqual([]);
    });
});

// The cases above pass vacuously where no hook set a variable, as in CI.
// This one starts a Bun with GIT_INDEX_FILE set and the preload loaded,
// then reads what the children of that Bun see.
const PROBE = `
import { expect, it } from "bun:test";
const names = (text) =>
    text.split("\\n").filter((l) => l.startsWith("GIT_"));
it("probe", async () => {
    const sync = Bun.spawnSync(["env"]).stdout.toString();
    const object = Bun.spawn({ cmd: ["env"], stdout: "pipe" });
    const explicit = Bun.spawnSync(["env"], { env: { GIT_KEPT: "yes" } });
    console.log("RESULT " + JSON.stringify({
        own: Object.keys(process.env).filter((n) => n.startsWith("GIT_")),
        sync: names(sync),
        object: names(await new Response(object.stdout).text()),
        explicit: names(explicit.stdout.toString()),
    }));
});
`;

describe("the preload", () => {
    it("strips a hook's variables before any child sees them", () => {
        const scratch = mkdtempSync(join(tmpdir(), "dorothy-setup-"));
        try {
            writeFileSync(join(scratch, "probe.test.ts"), PROBE);
            const run = Bun.spawnSync(
                [
                    process.execPath,
                    "test",
                    "--preload",
                    join(import.meta.dir, "test-setup.ts"),
                    "probe.test.ts",
                ],
                {
                    cwd: scratch,
                    env: { ...process.env, GIT_INDEX_FILE: "/nonexistent" },
                },
            );
            const result = run.stdout.toString() + run.stderr.toString();
            const line = result
                .split("\n")
                .find((l) => l.startsWith("RESULT "));
            expect(line, result).toBeDefined();
            expect(JSON.parse((line ?? "").slice("RESULT ".length))).toEqual({
                own: [],
                sync: [],
                object: [],
                explicit: ["GIT_KEPT=yes"],
            });
        } finally {
            rmSync(scratch, { recursive: true, force: true });
        }
    });
});
