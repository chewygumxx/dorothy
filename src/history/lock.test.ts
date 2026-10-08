// vim:set expandtab shiftwidth=4 filetype=typescript:
// SPDX-License-Identifier: GPL-3.0-only

//
//
// ~chewygumxx/dorothy.git
// ::: :/src/history/lock.test.ts
//
//

import { afterAll, describe, expect, it } from "bun:test";
import { join } from "node:path";
import { FileLock } from "./lock.js";
import { removeRoots, tempRoot } from "./testing.js";

afterAll(removeRoots);

describe("FileLock", () => {
    it("holds another connection off until the work is done", async () => {
        const path = join(tempRoot(), ".git", "dorothy.lock");
        const a = FileLock.open(path);
        const b = FileLock.open(path, 50);
        let release = () => {};
        const held = new Promise<void>((resolve) => {
            release = resolve;
        });
        const first = a.lock(async () => {
            await held;
            return "a";
        });
        await new Promise((resolve) => setTimeout(resolve, 10));
        await expect(b.lock(async () => "b")).rejects.toThrow();
        release();
        expect(await first).toBe("a");
        expect(await b.lock(async () => "b")).toBe("b");
        a.close();
        b.close();
    });

    it("takes turns within one process, and lets go after a failure", async () => {
        const lock = FileLock.open(join(tempRoot(), "lock"));
        const order: string[] = [];
        await Promise.all([
            lock.lock(async () => {
                await new Promise((resolve) => setTimeout(resolve, 10));
                order.push("first");
            }),
            lock.lock(async () => {
                order.push("second");
            }),
        ]);
        expect(order).toEqual(["first", "second"]);
        await expect(
            lock.lock(async () => {
                throw new Error("no");
            }),
        ).rejects.toThrow("no");
        expect(await lock.lock(async () => 1)).toBe(1);
        lock.close();
    });
});
