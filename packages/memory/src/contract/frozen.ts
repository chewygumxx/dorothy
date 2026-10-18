// vim:set expandtab shiftwidth=4 filetype=typescript:
// SPDX-License-Identifier: GPL-3.0-only

//
//
// ~chewygumxx/dorothy.git
// ::: :/packages/memory/src/contract/frozen.ts
//
//

// The block each session was given, so that resume gives it again byte
// for byte and the host's prompt cache holds. In memory only: a service
// that restarts renders the next one anew.

import type { BlockResponse } from "@dorothy/core";

type Key = { host: string; session: string };
const keyOf = ({ host, session }: Key) => `${host}\u0000${session}`;

export class FrozenBlocks {
    readonly #blocks = new Map<string, BlockResponse>();

    constructor(readonly limit = 1000) {}

    get(key: Key): BlockResponse | undefined {
        const name = keyOf(key);
        const kept = this.#blocks.get(name);
        if (kept !== undefined) {
            this.#blocks.delete(name);
            this.#blocks.set(name, kept);
        }
        return kept;
    }

    set(key: Key, block: BlockResponse): void {
        const name = keyOf(key);
        this.#blocks.delete(name);
        this.#blocks.set(name, block);
        while (this.#blocks.size > this.limit) {
            const oldest = this.#blocks.keys().next().value;
            if (oldest === undefined) {
                break;
            }
            this.#blocks.delete(oldest);
        }
    }
}
