// vim:set expandtab shiftwidth=4 filetype=typescript:
// SPDX-License-Identifier: GPL-3.0-only

//
//
// ~chewygumxx/dorothy.git
// ::: :/packages/orchestra/src/broker/reservation.ts
//
//

// Branch reservations: a branch is one worker's, of any launch, from its
// start, by a file created exclusively under the broker's state, named by
// the branch in hex. A branch the remote has already is no one's to take.
// A reservation lasts as long as its clone.

import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { Broker } from "./repository.js";

export type ReservationInput = {
    server: string;
    worker: string;
    branch: string;
    base: string;
};

export type Reservation = { path: string };

export async function reserveBranch(
    broker: Broker,
    { server, worker, branch, base }: ReservationInput,
): Promise<Reservation> {
    const checked = await broker.git.run([
        "check-ref-format",
        "--branch",
        branch,
    ]);
    if (checked.code !== 0 || checked.stdout.trim() !== branch) {
        throw new Error(`${branch} is no valid branch name`);
    }
    const ref = `refs/heads/${branch}`;
    const remote = await broker.git.out(["ls-remote", "--", broker.url, ref]);
    if (remote.split("\n").some((line) => line.endsWith(`\t${ref}`))) {
        throw new Error(`${branch} is on the remote already`);
    }
    const path = join(
        broker.state,
        "branches",
        broker.identity,
        Buffer.from(branch).toString("hex"),
    );
    await mkdir(dirname(path), { recursive: true });
    try {
        await writeFile(path, `${JSON.stringify({ server, worker, base })}\n`, {
            flag: "wx",
        });
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "EEXIST") {
            throw new Error(`${branch} is reserved already`);
        }
        throw error;
    }
    return { path };
}
