// vim:set expandtab shiftwidth=4 filetype=typescript:
// SPDX-License-Identifier: GPL-3.0-only

//
//
// ~chewygumxx/dorothy.git
// ::: :/src/dump.ts
//
//

import { type CaptureQueryFn, dumpRequest } from "./capture.js";
import { conversationOptions } from "./conversation.js";
import { previewStart } from "./memory/preview.js";
import type { PersonaMode } from "./persona.js";
import { recallLaunch } from "./recall-launch.js";
import type { Env } from "./xdg.js";

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
