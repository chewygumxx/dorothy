// vim:set expandtab shiftwidth=4 filetype=typescript:
// SPDX-License-Identifier: GPL-3.0-only

//
//
// ~chewygumxx/dorothy.git
// ::: :/packages/cli/src/ambient.test.ts
//
//

import { describe, expect, it } from "bun:test";
import { resolve } from "node:path";
import { ambient } from "./ambient.js";

const stream = { write: () => true };

describe("ambient", () => {
    it("hands memory's commands the process's own environment, streams and entry script", () => {
        const env = { HOME: "/home/someone" };
        const out = { ...stream };
        const err = { ...stream };
        const got = ambient({
            env,
            stdout: out,
            stderr: err,
            execPath: "/usr/bin/bun",
            argv: ["/usr/bin/bun", "src/index.ts", "--history"],
        });
        expect(got.env).toBe(env);
        expect(got.out).toBe(out);
        expect(got.err).toBe(err);
        expect(got.hook).toEqual({
            exec: "/usr/bin/bun",
            script: resolve("src/index.ts"),
        });
    });

    it("names no hook where there is no entry script", () => {
        expect(
            ambient({
                env: {},
                stdout: stream,
                stderr: stream,
                execPath: "/usr/bin/bun",
                argv: ["/usr/bin/bun"],
            }).hook,
        ).toBeNull();
    });
});
