// vim:set expandtab shiftwidth=4 filetype=typescript:
// SPDX-License-Identifier: GPL-3.0-only

//
//
// ~chewygumxx/dorothy.git
// ::: :/packages/orchestra/src/box/processes.ts
//
//

// A box's processes, from /proc: the tree under bubblewrap's pid while it
// runs, and which of it is left after a stop, so that a check can say its
// whole tree is gone.

import { readdir, readFile } from "node:fs/promises";

export type Proc = { pid: number; start: string };

// A process's state, parent and start time, from /proc; null once gone.
async function stat(pid: number) {
    const text = await readFile(`/proc/${pid}/stat`, "utf8").catch(() => null);
    // The fields after the command's name, which may hold spaces.
    const fields = text?.slice(text.lastIndexOf(")") + 2).split(" ");
    return fields === undefined
        ? null
        : {
              state: fields[0],
              ppid: Number(fields[1]),
              start: fields[19] ?? "",
          };
}

// The process and every descendant it has now.
export async function processTree(root: number): Promise<Proc[]> {
    const all = new Map<number, { ppid: number; start: string }>();
    for (const name of await readdir("/proc")) {
        const found = /^\d+$/.test(name) ? await stat(Number(name)) : null;
        if (found !== null) {
            all.set(Number(name), found);
        }
    }
    const tree: Proc[] = [];
    const queue = [root];
    for (let pid = queue.shift(); pid !== undefined; pid = queue.shift()) {
        const found = all.get(pid);
        if (found !== undefined) {
            tree.push({ pid, start: found.start });
            for (const [child, { ppid }] of all) {
                if (ppid === pid) {
                    queue.push(child);
                }
            }
        }
    }
    return tree;
}

// Those of a tree still running, waiting up to ms for them to go; a pid
// reused by another process, or a zombie, is gone.
export async function survivors(tree: Proc[], ms = 15_000): Promise<Proc[]> {
    const deadline = Date.now() + ms;
    for (;;) {
        const left: Proc[] = [];
        for (const proc of tree) {
            const found = await stat(proc.pid);
            if (found?.start === proc.start && found.state !== "Z") {
                left.push(proc);
            }
        }
        if (left.length === 0 || Date.now() >= deadline) {
            return left;
        }
        await Bun.sleep(200);
    }
}
