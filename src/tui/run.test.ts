// vim:set expandtab shiftwidth=4 filetype=typescript:
// SPDX-License-Identifier: GPL-3.0-only

//
//
// ~chewygumxx/dorothy.git
// ::: :/src/tui/run.test.ts
//
//

import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { newPhrase } from "../session-id.js";
import { runTui } from "./run.js";

let dir = "";
let saved: string | undefined;
beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "dorothy-run-"));
    saved = process.env.XDG_DATA_HOME;
    process.env.XDG_DATA_HOME = dir;
});
afterEach(async () => {
    if (saved === undefined) {
        delete process.env.XDG_DATA_HOME;
    } else {
        process.env.XDG_DATA_HOME = saved;
    }
    await rm(dir, { recursive: true, force: true });
});

describe("runTui", () => {
    it("exits 1 before rendering when the transcript to resume is missing", async () => {
        expect(await runTui(newPhrase())).toBe(1);
    });
});
