// vim:set expandtab shiftwidth=4 filetype=typescript:
// SPDX-License-Identifier: GPL-3.0-only

//
//
// ~xxdorothy/dorothy.git
// ::: :/packages/cli/src/recall-launch.ts
//
//

// Dorothy's memory tools: this program again, as an MCP server, leaving
// out the conversation it serves, in the project chat started in. The
// flags are the CLI's, parsed in index.ts. Bun reads no .env of the
// directory it starts in; the recall server runs in one of Dorothy's
// anyway (`recallCwd`).

import { resolve } from "node:path";
import type { RecallLaunch } from "@dorothy/core";

export function recallLaunch(
    phrase: string,
    project: string | null,
): RecallLaunch {
    return {
        command: process.execPath,
        args: [
            "--no-env-file",
            resolve(process.argv[1] ?? ""),
            "--recall-server",
            "--exclude",
            phrase,
            ...(project === null ? [] : ["--project", project]),
        ],
    };
}
