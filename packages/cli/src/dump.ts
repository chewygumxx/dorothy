// vim:set expandtab shiftwidth=4 filetype=typescript:
// SPDX-License-Identifier: GPL-3.0-only

//
//
// ~chewygumxx/dorothy.git
// ::: :/packages/cli/src/dump.ts
//
//

import {
    type CaptureQueryFn,
    conversationOptions,
    dumpRequest,
    type PersonaMode,
} from "@dorothy/agent";
import type { Env } from "@dorothy/core";
import { previewStart } from "@dorothy/memory";
import { recallLaunch } from "./recall-launch.js";

export type DumpRequest = {
    resume: string | null;
    message: string;
    persona: PersonaMode;
};

// What a chat would send first, built as the TUI builds it: the same
// config, history, memory block and recall server. Like a chat's start it
// syncs the index; unlike one, it writes no transcript and starts no review.
export async function runDump(
    request: DumpRequest,
    {
        env = process.env,
        queryFn,
        write = {
            out: (text: string) => {
                process.stdout.write(text);
            },
            err: (text: string) => {
                process.stderr.write(text);
            },
        },
    }: {
        env?: Env;
        queryFn?: CaptureQueryFn;
        write?: { out: (text: string) => void; err: (text: string) => void };
    } = {},
): Promise<number> {
    const preview = await previewStart({
        resume: request.resume,
        recallLaunch,
        env,
    });
    if (!preview.ok) {
        write.err(`dorothy: ${preview.message}\n`);
        return 1;
    }
    const body = await dumpRequest({
        prompt: request.message,
        options: conversationOptions({
            ...preview.start,
            persona: request.persona,
        }),
        ...(queryFn === undefined ? {} : { queryFn }),
    });
    for (const warning of preview.warnings) {
        write.err(`dorothy: ${warning}\n`);
    }
    if (body === null) {
        write.err("dorothy: the CLI sent no request to dump\n");
        return 1;
    }
    write.out(`${JSON.stringify(body, null, 2)}\n`);
    return 0;
}
