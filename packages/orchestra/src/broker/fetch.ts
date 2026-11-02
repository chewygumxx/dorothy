// vim:set expandtab shiftwidth=4 filetype=typescript:
// SPDX-License-Identifier: GPL-3.0-only

//
//
// ~chewygumxx/dorothy.git
// ::: :/packages/orchestra/src/broker/fetch.ts
//
//

// Bringing a worker's work back: its branch fetched from its clone into a
// ref of the worker's own in the broker repository. A fetch from a path
// runs git-upload-pack in the source, so the broker's upload-pack is a
// box of its own: the clone and the broker's objects read-only, no
// network, nothing written, and what it reads of the clone read there.

import { realpath } from "node:fs/promises";
import { join } from "node:path";
import { BOX_HOME, boxArgs, systemLayout } from "../box/box.js";
import type { Broker } from "./repository.js";

export type FetchInput = {
    // resolveGit's; it runs in the box, from the system's /usr.
    git: string;
    server: string;
    worker: string;
    // makeClone's canonical path.
    clone: string;
    branch: string;
};

export type Work = { ref: string; oid: string };

const quoted = (arg: string) => `'${arg.replaceAll("'", "'\\''")}'`;

// The command git runs through the shell, the clone's path appended.
// The objects are mounted where the clone's alternates name them, as
// written or canonical, from the broker's own store alone.
async function uploadPack(broker: Broker, input: FetchInput) {
    const objects = join(broker.repo, "objects");
    const canonical = await realpath(objects);
    const args = boxArgs(
        {
            clone: null,
            readOnly: [input.clone, canonical],
            files:
                canonical === objects
                    ? []
                    : [{ source: canonical, target: objects }],
            sockets: null,
            env: { PATH: "/usr/bin:/bin", HOME: BOX_HOME },
            command: [input.git, "upload-pack"],
        },
        await systemLayout(),
    );
    return args.map(quoted).join(" ");
}

// The branch is the broker's to replace in its own ref, so a rewritten
// branch is brought back too; the push decides what may follow it.
export async function fetchWork(
    broker: Broker,
    input: FetchInput,
): Promise<Work> {
    const ref = `refs/orchestra/${input.server}/${input.worker}/${input.branch}`;
    await broker.git.out([
        "fetch",
        "--no-tags",
        "--no-recurse-submodules",
        "--no-write-fetch-head",
        `--upload-pack=${await uploadPack(broker, input)}`,
        "--",
        input.clone,
        `+refs/heads/${input.branch}:${ref}`,
    ]);
    const oid = await broker.git.out([
        "rev-parse",
        "--verify",
        `${ref}^{commit}`,
    ]);
    return { ref, oid };
}
