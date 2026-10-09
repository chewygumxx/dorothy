// vim:set expandtab shiftwidth=4 filetype=typescript:
// SPDX-License-Identifier: GPL-3.0-only

//
//
// ~chewygumxx/dorothy.git
// ::: :/packages/tui/src/external-editor.ts
//
//

import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { EditResult } from "@dorothy/core";

export function editorCommand(env: NodeJS.ProcessEnv = process.env): string {
    return env.VISUAL || env.EDITOR || "vi";
}

const describeError = (error: unknown) =>
    error instanceof Error ? error.message : String(error);

// The command runs through sh so an EDITOR with arguments ("code --wait")
// works; the file is its "$1". mkdtemp makes a private directory.
export async function editInEditor(
    text: string,
    command: string = editorCommand(),
): Promise<EditResult> {
    const dir = await mkdtemp(join(tmpdir(), "dorothy-"));
    const file = join(dir, "draft.md");
    try {
        await writeFile(file, text, { mode: 0o600 });
        const status = await new Promise<number | null>((resolve, reject) => {
            const child = spawn("sh", ["-c", `${command} "$1"`, "sh", file], {
                stdio: "inherit",
            });
            child.on("error", reject);
            child.on("exit", resolve);
        });
        if (status !== 0) {
            return {
                ok: false,
                message: `editor exited with ${status ?? "a signal"}`,
            };
        }
        return {
            ok: true,
            text: (await readFile(file, "utf8")).replace(/\n$/, ""),
        };
    } catch (error) {
        return { ok: false, message: `editor failed: ${describeError(error)}` };
    } finally {
        await rm(dir, { recursive: true, force: true });
    }
}
