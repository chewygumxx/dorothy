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
