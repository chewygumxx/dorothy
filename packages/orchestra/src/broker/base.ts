// vim:set expandtab shiftwidth=4 filetype=typescript:
// SPDX-License-Identifier: GPL-3.0-only

//
//
// ~chewygumxx/dorothy.git
// ::: :/packages/orchestra/src/broker/base.ts
//
//

// A worker's base: the remote's default branch as it is at the worker's
// start, never the main checkout's local branch, fetched into a ref of
// the worker's own under its server's id, which keeps its objects.

import type { Broker } from "./repository.js";

export type Base = { ref: string; oid: string };

export async function fetchBase(
    broker: Broker,
    server: string,
    worker: string,
): Promise<Base> {
    const head = await broker.git.out([
        "ls-remote",
        "--symref",
        "--",
        broker.url,
        "HEAD",
    ]);
    const branch = /^ref: (refs\/heads\/\S+)\tHEAD$/m.exec(head)?.[1];
    if (branch === undefined) {
        throw new Error(`${broker.identity}'s remote names no default branch`);
    }
    const ref = `refs/orchestra/${server}/${worker}/base`;
    await broker.git.out([
        "fetch",
        "--no-tags",
        "--no-recurse-submodules",
        "--no-write-fetch-head",
        "--",
        broker.url,
        `${branch}:${ref}`,
    ]);
    const oid = await broker.git.out([
        "rev-parse",
        "--verify",
        `${ref}^{commit}`,
    ]);
    return { ref, oid };
}
