// vim:set expandtab shiftwidth=4 filetype=typescript:
// SPDX-License-Identifier: GPL-3.0-only

//
//
// ~chewygumxx/dorothy.git
// ::: :/packages/orchestra/src/fixtures/time.ts
//
//

import type { Clock, Timers } from "@dorothy/core";

export class ManualTime implements Clock, Timers {
    private at = 1000;
    private next = 0;
    private pending = new Map<number, { at: number; fn: () => void }>();
    now() {
        return this.at;
    }
    set(fn: () => void, ms: number) {
        const id = ++this.next;
        this.pending.set(id, { at: this.at + ms, fn });
        return id;
    }
    clear(handle: unknown) {
        this.pending.delete(handle as number);
    }
    get size() {
        return this.pending.size;
    }
    advance(ms: number) {
        const end = this.at + ms;
        for (;;) {
            const next = [...this.pending].sort((a, b) => a[1].at - b[1].at)[0];
            if (!next || next[1].at > end) break;
            this.at = next[1].at;
            this.pending.delete(next[0]);
            next[1].fn();
        }
        this.at = end;
    }
}
