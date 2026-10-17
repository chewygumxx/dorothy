// vim:set expandtab shiftwidth=4 filetype=typescript:
// SPDX-License-Identifier: GPL-3.0-only

//
//
// ~chewygumxx/dorothy.git
// ::: :/packages/memory/src/memory/open-testing.ts
//
//

// The directory openMemory's tests run in, its XDG directories with it.

import { afterEach, beforeEach } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

// openMemory reads the config and opens the transcript and the index from
// these, so every one points into the test's directory, made before each
// test and removed after.
const XDG = [
    "XDG_CONFIG_HOME",
    "XDG_DATA_HOME",
    "XDG_CACHE_HOME",
    "XDG_STATE_HOME",
] as const;
export let dir = "";
export function useXdgDir(): void {
    let saved: Partial<Record<(typeof XDG)[number], string>> = {};
    beforeEach(async () => {
        dir = await mkdtemp(join(tmpdir(), "dorothy-run-"));
        saved = {};
        for (const variable of XDG) {
            saved[variable] = process.env[variable];
            process.env[variable] = dir;
        }
    });
    afterEach(async () => {
        for (const variable of XDG) {
            const value = saved[variable];
            if (value === undefined) {
                delete process.env[variable];
            } else {
                process.env[variable] = value;
            }
        }
        await rm(dir, { recursive: true, force: true });
    });
}
