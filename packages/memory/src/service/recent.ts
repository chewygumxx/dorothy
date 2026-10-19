// vim:set expandtab shiftwidth=4 filetype=typescript:
// SPDX-License-Identifier: GPL-3.0-only

//
//
// ~chewygumxx/dorothy.git
// ::: :/packages/memory/src/service/recent.ts
//
//

// A map that keeps its limit most recently set keys, for the service's
// caches, whose keys a client chooses: a long-running service must not
// grow with them.

export class Recent<K, V> extends Map<K, V> {
    constructor(readonly limit: number) {
        super();
    }

    override set(key: K, value: V): this {
        this.delete(key);
        super.set(key, value);
        for (const oldest of this.keys()) {
            if (this.size <= this.limit) {
                break;
            }
            this.delete(oldest);
        }
        return this;
    }
}
