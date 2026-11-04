// vim:set expandtab shiftwidth=4 filetype=typescript:
// SPDX-License-Identifier: GPL-3.0-only

//
//
// ~chewygumxx/dorothy.git
// ::: :/packages/cli/src/hosts/pi/native-launch.ts
//
//

// `dorothy --pi` as a test or probe runs it in a terminal of its own:
// `bun --no-env-file native-launch.ts <plan.json>`. The plan injects what
// index.ts would load (the routing, one entry at the plan's base URL, and
// a synthetic key in place of secrets.json), so nothing real is read or
// decrypted; Pi inherits the terminal, as `spawnInherited` gives it. The
// plan holds roots and the base URL, never a credential.

import { readFile } from "node:fs/promises";
import type { Env } from "@dorothy/core";
import { spawnInherited } from "../../self.js";
import { runPi } from "./launch.js";
import { entry, KEY_NAME, SYNTHETIC_KEY } from "./testing.js";

export type NativePlan = {
    env: Env;
    cwd: string;
    // `dorothy` as the extension runs it: a stand-in, or this checkout.
    self: string[];
    baseUrl: string;
    args: string[];
};

if (import.meta.main) {
    const plan: NativePlan = JSON.parse(
        await readFile(process.argv[2] ?? "", "utf8"),
    );
    const code = await runPi(
        { args: plan.args, model: null, dump: false },
        {
            env: plan.env,
            cwd: plan.cwd,
            self: plan.self,
            loadRouting: async () => ({
                routes: {
                    chat: [entry(plan.baseUrl)],
                    review: [],
                    compaction: [],
                    maintenance: [],
                },
                keys: [],
            }),
            loadSecrets: async (target) => {
                target[KEY_NAME] = SYNTHETIC_KEY;
            },
            spawn: spawnInherited,
            write: (text) => process.stderr.write(text),
        },
    );
    process.exit(code);
}
