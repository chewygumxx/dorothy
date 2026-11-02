// vim:set expandtab shiftwidth=4 filetype=typescript:
// SPDX-License-Identifier: GPL-3.0-only

//
//
// ~chewygumxx/dorothy.git
// ::: :/packages/orchestra/src/engine/session.test.ts
//
//

// A worker's one box: acpx's spawns and exits as the engine sees them.
// Its sessions in real boxes are the engine's tests.

import { describe, expect, it } from "bun:test";
import { oneBox } from "./session.js";

describe("oneBox", () => {
    const launch = {
        launchId: "l",
        scope: { kind: "runtime-session", sessionKey: "codex-1" },
        command: "bwrap",
        args: [],
        cwd: "/w",
    } as const;
    const started = { ...launch, pid: 7, startedAt: "" };

    it("refuses a second spawn, as its session is lost", async () => {
        const lost: string[] = [];
        const box = oneBox((reason) => lost.push(reason));
        await box.onBeforeSpawn?.(launch);
        await box.onSpawned?.(started);
        expect(lost).toEqual([]);
        expect(() => box.onBeforeSpawn?.(launch)).toThrow(
            "its agent started again",
        );
        expect(lost).toEqual(["its agent started again"]);
    });

    it("reports its agent's exit, and no other process's", async () => {
        const lost: string[] = [];
        const box = oneBox((reason) => lost.push(reason));
        await box.onBeforeSpawn?.(launch);
        await box.onSpawned?.(started);
        const exit = { exitCode: 1, signal: null, exitedAt: "" };
        await box.onExit?.({ ...started, pid: 8, ...exit });
        expect(lost).toEqual([]);
        await box.onExit?.({ ...started, ...exit });
        expect(lost).toEqual(["its agent exited with 1"]);
    });
});
