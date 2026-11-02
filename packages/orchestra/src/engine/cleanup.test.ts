// vim:set expandtab shiftwidth=4 filetype=typescript:
// SPDX-License-Identifier: GPL-3.0-only

//
//
// ~chewygumxx/dorothy.git
// ::: :/packages/orchestra/src/engine/cleanup.test.ts
//
//

// Hold cleanup and startup acquisition behind barriers in an isolated
// session fixture; close must wait for each resource's cleanup.

import { expect, it } from "bun:test";
import { join } from "node:path";

for (const phase of ["failure", "startup"]) {
    it(`awaits shared cleanup during ${phase}`, async () => {
        const child = Bun.spawn(
            [
                process.execPath,
                join(import.meta.dir, "../fixtures/engine-cleanup.ts"),
                phase,
            ],
            { env: process.env, stdout: "pipe", stderr: "pipe" },
        );
        const errors = await new Response(child.stderr).text();
        expect(errors).toBe("");
        expect(await child.exited).toBe(0);
    }, 15_000);
}
