// vim:set expandtab shiftwidth=4 filetype=typescript:
// SPDX-License-Identifier: GPL-3.0-only

//
//
// ~chewygumxx/dorothy.git
// ::: :/packages/eval/src/editor.test.ts
//
//

import { describe, expect, it } from "bun:test";
import type { spawnSync } from "node:child_process";
import { openEditor } from "./editor.js";

type Spawned = ReturnType<typeof spawnSync>;
const spawned = (result: Partial<Spawned>) =>
    (() => result as Spawned) as typeof spawnSync;

describe("the editor", () => {
    it("runs $VISUAL, then $EDITOR, then vi, in a shell", () => {
        const seen: string[] = [];
        const spawn = ((command: string, args: string[]) => {
            seen.push(`${command} ${args[1]}`);
            return {};
        }) as unknown as typeof spawnSync;
        openEditor("f", { VISUAL: "code -w", EDITOR: "nano" }, spawn);
        openEditor("f", { EDITOR: "nano" }, spawn);
        openEditor("f", {}, spawn);
        expect(seen).toEqual(['sh code -w "$1"', 'sh nano "$1"', 'sh vi "$1"']);
    });

    it("says a spawn that failed, instead of returning as if edited", () => {
        const failed = spawned({
            error: new Error("spawn sh ENOENT"),
        });
        expect(() => openEditor("f", {}, failed)).toThrow(
            "could not start the editor: spawn sh ENOENT",
        );
    });

    it("runs a real editor on the file", () => {
        expect(() => openEditor("f", { EDITOR: "true" })).not.toThrow();
    });
});
