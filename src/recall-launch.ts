// vim:set expandtab shiftwidth=4 filetype=typescript:
// SPDX-License-Identifier: GPL-3.0-only

//
//
// ~chewygumxx/dorothy.git
// ::: :/src/recall-launch.ts
//
//

// Dorothy's memory tools: this program again, as an MCP server, leaving
// out the conversation it serves. The flags are the CLI's, parsed in
// index.ts.

import { resolve } from "node:path";
import type { RecallLaunch } from "@dorothy/core";

export function recallLaunch(phrase: string): RecallLaunch {
    return {
        command: process.execPath,
        args: [
            resolve(process.argv[1] ?? ""),
            "--recall-server",
            "--exclude",
            phrase,
        ],
    };
}
