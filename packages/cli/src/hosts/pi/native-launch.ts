// vim:set expandtab shiftwidth=4 filetype=typescript:
// SPDX-License-Identifier: GPL-3.0-only

//
//
// ~xxdorothy/dorothy.git
// ::: :/packages/cli/src/hosts/pi/native-launch.ts
//
//

// `dorothy --pi` as a test or probe runs it in a terminal of its own:
// `bun --no-env-file native-launch.ts <plan.json>`. The plan injects what
// index.ts would load (the routing, one entry at the plan's base URL, and
// a synthetic key in place of secrets.json), so nothing real is read or
// decrypted; Pi inherits the terminal, as `spawnInherited` gives it. The
// plan holds roots and the base URL, never a credential.

import { writeFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import type { Env } from "@dorothy/core";
import { type Spawned, spawnInherited } from "../../self.js";
import { runPi } from "./launch.js";
import { entry, KEY_NAME, SYNTHETIC_KEY } from "./testing.js";

export type NativePlan = {
    env: Env;
    cwd: string;
    // `dorothy` as the extension runs it: a stand-in, or this checkout.
    self: string[];
    baseUrl: string;
    args: string[];
    // `--steward <registry>`, where the plan gives one.
    steward?: string;
    // Owner trial wall. Ordinary plans leave it absent.
    stewardDeadlineAt?: string;
    // Private record of the exact native child this plan spawned.
    launchRecord?: string;
};

export function nativeSpawn(
    plan: Pick<NativePlan, "launchRecord">,
    spawn: typeof spawnInherited = spawnInherited,
): typeof spawnInherited {
    return (command, env, cwd) => {
        const child = spawn(command, env, cwd) as Spawned & { pid?: number };
        if (plan.launchRecord) {
            if (
                !Number.isSafeInteger(child.pid) ||
                (child.pid as number) <= 0
            ) {
                child.kill("SIGKILL");
                throw new Error("native Pi has no recorded process id");
            }
            writeFileSync(
                plan.launchRecord,
                JSON.stringify({
                    launcherPid: process.pid,
                    piPid: child.pid,
                }),
                { mode: 0o600 },
            );
        }
        return child;
    };
}

if (import.meta.main) {
    const plan: NativePlan = JSON.parse(
        await readFile(process.argv[2] ?? "", "utf8"),
    );
    const code = await runPi(
        {
            args: plan.args,
            model: null,
            dump: false,
            steward: plan.steward ?? null,
            stewardDeadlineAt: plan.stewardDeadlineAt,
        },
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
            spawn: nativeSpawn(plan),
            write: (text) => process.stderr.write(text),
        },
    );
    process.exit(code);
}
