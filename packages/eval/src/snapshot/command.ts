// vim:set expandtab shiftwidth=4 filetype=typescript:
// SPDX-License-Identifier: GPL-3.0-only

//
//
// ~chewygumxx/dorothy.git
// ::: :/packages/eval/src/snapshot/command.ts
//
//

import { type Command, stringOf, workOf } from "../command.js";
import { UsageError } from "../errors.js";
import { takeSnapshot } from "./snapshot.js";

export const snapshotCommand: Command = {
    summary: "copy a data directory into the work directory",
    options: {
        from: {
            type: "string",
            description: "her data directory, such as ~/.local/share/dorothy",
        },
        work: {
            type: "string",
            description: "the evaluation's directory, made if missing",
        },
        replace: {
            type: "boolean",
            description: "replace a snapshot the work directory holds",
        },
    },
    async run(values, _positionals, io) {
        // Never a default: nothing reads her real data unless named.
        const from = stringOf(values, "from");
        if (from === null) {
            throw new UsageError(
                "give --from, Dorothy's data directory (such as ~/.local/share/dorothy)",
            );
        }
        const info = await takeSnapshot(from, workOf(values), {
            replace: values.replace === true,
        });
        io.out(
            `copied ${info.conversations} conversations and ${info.knowledge} knowledge files from ${info.source}\n`,
        );
        const links = info.skippedLinks ?? 0;
        if (links > 0) {
            io.out(
                `  skipped ${links} symbolic ${links === 1 ? "link" : "links"} below the top, not followed\n`,
            );
        }
        return 0;
    },
};
