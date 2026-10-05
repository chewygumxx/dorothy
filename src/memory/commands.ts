// vim:set expandtab shiftwidth=4 filetype=typescript:
// SPDX-License-Identifier: GPL-3.0-only

//
//
// ~chewygumxx/dorothy.git
// ::: :/src/memory/commands.ts
//
//

import { readConfig } from "../config.js";
import { transcriptDir } from "../transcript.js";
import type { Env } from "../xdg.js";
import { scanCatalogue } from "./catalogue.js";
import { formatList, listRows } from "./list.js";
import { rank, tier } from "./rank.js";

export type Output = { write(text: string): unknown };

// What Dorothy remembers, as a new session would see it. It works whether
// memory is on or not: it is the user's view, not hers.
export async function runList({
    env = process.env,
    out = process.stdout,
    err = process.stderr,
    now = Date.now(),
}: {
    env?: Env;
    out?: Output;
    err?: Output;
    now?: number;
} = {}): Promise<number> {
    const { config, warnings } = await readConfig(env);
    const loaded = await scanCatalogue(transcriptDir(env)).load();
    for (const warning of [...warnings, ...loaded.warnings]) {
        err.write(`dorothy: ${warning}\n`);
    }
    const tiered = tier(
        rank(loaded.entries, { now, halfLifeDays: config.memory.halfLifeDays }),
        config.memory.budget,
    );
    out.write(`${formatList(listRows(loaded.entries, tiered))}\n`);
    return 0;
}
