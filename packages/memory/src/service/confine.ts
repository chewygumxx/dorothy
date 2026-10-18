// vim:set expandtab shiftwidth=4 filetype=typescript:
// SPDX-License-Identifier: GPL-3.0-only

//
//
// ~chewygumxx/dorothy.git
// ::: :/packages/memory/src/service/confine.ts
//
//

// Which transcript a request may name. A path in a record names a file on
// the service's machine, and a sandboxed harness may reach the service
// without reaching the disk, so only Claude Code's own transcripts are
// read: regular .jsonl files, of bounded size, under its projects
// directory once symlinks are resolved.

import { realpath, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { join, sep } from "node:path";
import type { Env } from "@dorothy/core";
import { ContractError } from "../contract/errors.js";

export const MAX_TRANSCRIPT = 64 * 1024 * 1024;

// Claude Code's configuration directory, as dorothy --claude finds it.
export const claudeConfigDir = (env: Env) =>
    env.CLAUDE_CONFIG_DIR || join(env.HOME || homedir(), ".claude");

// The refusal says nothing of the path or the cause, so that it does not
// reveal which paths exist.
const refusal = () => new ContractError(403, "that transcript cannot be read");

// The real path of a transcript under claude's projects directory, or a
// 403. Called before anything is read or locked.
export async function confineTranscript(
    path: string,
    claude: string,
    max: number = MAX_TRANSCRIPT,
): Promise<string> {
    try {
        const projects = await realpath(join(claude, "projects"));
        const real = await realpath(path);
        if (!real.startsWith(projects + sep) || !real.endsWith(".jsonl")) {
            throw refusal();
        }
        const found = await stat(real);
        if (!found.isFile() || found.size > max) {
            throw refusal();
        }
        return real;
    } catch {
        throw refusal();
    }
}
