// vim:set expandtab shiftwidth=4 filetype=typescript:
// SPDX-License-Identifier: GPL-3.0-only

//
//
// ~chewygumxx/dorothy.git
// ::: :/packages/orchestra/src/broker/clone.ts
//
//

// A worker's clone: a shared clone of the broker repository, borrowing
// its objects by alternates and copying none, on a new branch at the
// base. These are the last host git processes to run in it: from then on
// the worker owns it, .git and all.

import { mkdir, realpath } from "node:fs/promises";
import { join, sep } from "node:path";
import type { Broker } from "./repository.js";

// A server id or a worker's name: one path component, one ref component.
const NAME = /^[A-Za-z0-9][A-Za-z0-9_-]*$/;

export type CloneInput = {
    // The worktree root; the clone goes in <root>/<server>/<worker>.
    root: string;
    server: string;
    worker: string;
    branch: string;
    base: string;
};

// The clone's canonical path.
export async function makeClone(
    broker: Broker,
    { root, server, worker, branch, base }: CloneInput,
): Promise<string> {
    if (!NAME.test(server) || !NAME.test(worker)) {
        throw new Error(`no clone for ${server}/${worker}: not plain names`);
    }
    await mkdir(join(root, server), { recursive: true });
    const clone = join(await realpath(join(root, server)), worker);
    if (!clone.startsWith(`${await realpath(root)}${sep}`)) {
        throw new Error(`${clone} lies outside the worktree root`);
    }
    await broker.git.out([
        "clone",
        "--shared",
        "--no-checkout",
        "--",
        broker.repo,
        clone,
    ]);
    await broker.git.out(["switch", "--create", branch, base], clone);
    return clone;
}
