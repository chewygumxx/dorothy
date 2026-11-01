// vim:set expandtab shiftwidth=4 filetype=typescript:
// SPDX-License-Identifier: GPL-3.0-only

//
//
// ~chewygumxx/dorothy.git
// ::: :/packages/cli/src/models.ts
//
//

// The routes Dorothy's calls take, from config.toml, and the refusals
// this process has met: one record, shared by every call, so that a
// refusal one call meets is skipped by the next.

import {
    Cooldowns,
    type Env,
    type Routing,
    type RoutingResult,
    readRouting,
} from "@dorothy/core";

export const COOLDOWNS = new Cooldowns();

export type RoutingDeps = {
    env?: Env;
    readRouting?: (env: Env) => Promise<RoutingResult>;
};

// The routes, or an error naming every fault, for the entry points that
// go on without reviews: the service, the backfill and the hook.
export async function loadRouting({
    env = process.env,
    readRouting: read = readRouting,
}: RoutingDeps = {}): Promise<Routing> {
    const result = await read(env);
    if (!result.ok) {
        throw new Error(result.faults.join("; "));
    }
    return result.routing;
}

// The routes, or null once each fault is said: chat, the one-shot reply
// and the dump stop there.
export async function chatRouting(
    write: (text: string) => void,
    { env = process.env, readRouting: read = readRouting }: RoutingDeps = {},
): Promise<Routing | null> {
    const result = await read(env);
    if (result.ok) {
        return result.routing;
    }
    for (const fault of result.faults) {
        write(`dorothy: ${fault}\n`);
    }
    return null;
}
