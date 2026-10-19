// vim:set expandtab shiftwidth=4 filetype=typescript:
// SPDX-License-Identifier: GPL-3.0-only

//
//
// ~chewygumxx/dorothy.git
// ::: :/packages/eval/src/editor.ts
//
//

// The owner's editor on a file, waiting for it to close. $VISUAL or
// $EDITOR may carry arguments, so a shell runs it. A shell or editor
// that cannot start is an error for the caller to say, not a silent no-op.

import { spawnSync } from "node:child_process";
import type { Env } from "@dorothy/core";

export function openEditor(
    path: string,
    env: Env,
    spawn: typeof spawnSync = spawnSync,
): void {
    const editor = env.VISUAL || env.EDITOR || "vi";
    const result = spawn("sh", ["-c", `${editor} "$1"`, "sh", path], {
        stdio: "inherit",
        env,
    });
    if (result.error !== undefined) {
        throw new Error(`could not start the editor: ${result.error.message}`);
    }
    // A typo in $EDITOR is a shell's 127, not a spawn failure.
    if (result.signal !== null && result.signal !== undefined) {
        throw new Error(
            `the editor (${editor}) was stopped by ${result.signal}`,
        );
    }
    if (typeof result.status === "number" && result.status !== 0) {
        throw new Error(
            `the editor (${editor}) exited with status ${result.status}`,
        );
    }
}
