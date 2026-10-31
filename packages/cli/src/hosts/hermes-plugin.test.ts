// vim:set expandtab shiftwidth=4 filetype=typescript:
// SPDX-License-Identifier: GPL-3.0-only

//
//
// ~chewygumxx/dorothy.git
// ::: :/packages/cli/src/hosts/hermes-plugin.test.ts
//
//

import { expect, it } from "bun:test";
import { join } from "node:path";

const DIR = join(import.meta.dir, "../../assets/hermes");

it("passes the Hermes provider's own tests", () => {
    const run = Bun.spawnSync(
        ["python3", "-m", "unittest", "-q", "test_dorothy"],
        {
            cwd: DIR,
            env: { PATH: process.env.PATH ?? "", PYTHONDONTWRITEBYTECODE: "1" },
        },
    );
    expect(run.stderr.toString()).toContain("OK");
    expect(run.exitCode).toBe(0);
}, 60_000);
