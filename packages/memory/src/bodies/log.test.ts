// vim:set expandtab shiftwidth=4 filetype=typescript:
// SPDX-License-Identifier: GPL-3.0-only

//
//
// ~chewygumxx/dorothy.git
// ::: :/packages/memory/src/bodies/log.test.ts
//
//

import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { hookLog, hookLogPath, logHasErrors } from "./log.js";

let home = "";
let env: Record<string, string>;
beforeEach(async () => {
    home = await mkdtemp(join(tmpdir(), "dorothy-log-"));
    env = { HOME: home, XDG_CACHE_HOME: join(home, "cache") };
});
afterEach(async () => {
    await rm(home, { recursive: true, force: true });
});

describe("the hook's log", () => {
    it("writes a line per message, privately, one line however it is worded", async () => {
        const log = hookLog(env, {
            now: () => new Date("2026-10-15T09:00:00.000Z"),
        });
        log.info("recorded 3 events");
        log.warn("two\nlines");
        const text = await readFile(hookLogPath(env), "utf8");
        expect(text).toBe(
            `2026-10-15T09:00:00.000Z info ${process.pid} recorded 3 events\n` +
                `2026-10-15T09:00:00.000Z warn ${process.pid} two lines\n`,
        );
        expect((await stat(hookLogPath(env))).mode & 0o777).toBe(0o600);
        expect(await logHasErrors(env)).toBe(false);
        log.error("broke");
        expect(await logHasErrors(env)).toBe(true);
    });

    it("rotates past its limit to one .1 file", async () => {
        const log = hookLog(env, { limit: 100 });
        for (let n = 0; n < 5; n += 1) {
            log.info("x".repeat(40));
        }
        expect((await stat(`${hookLogPath(env)}.1`)).size).toBeGreaterThan(100);
        expect((await stat(hookLogPath(env))).size).toBeLessThanOrEqual(150);
    });

    it("never throws when it cannot write", () => {
        const log = hookLog({
            HOME: "/nonexistent/x",
            XDG_CACHE_HOME: "/proc/no",
        });
        expect(() => log.error("lost")).not.toThrow();
    });
});
