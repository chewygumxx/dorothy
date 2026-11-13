// vim:set expandtab shiftwidth=4 filetype=typescript:
// SPDX-License-Identifier: GPL-3.0-only

//
//
// ~xxdorothy/dorothy.git
// ::: :/packages/cli/src/dump.ts
//
//

import { dumpRequest, type PersonaMode } from "@dorothy/agent";
import type { Env, Routing } from "@dorothy/core";
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
        routing,
        env = process.env,
        dump = dumpRequest,
        write = {
            out: (text: string) => {
                process.stdout.write(text);
            },
            err: (text: string) => {
                process.stderr.write(text);
            },
        },
    }: {
        // config.toml's, whose chat route the dump shows.
        routing: Routing;
        env?: Env;
        dump?: typeof dumpRequest;
        write?: { out: (text: string) => void; err: (text: string) => void };
    },
): Promise<number> {
    const preview = await previewStart({
        resume: request.resume,
        recallLaunch: (phrase) => recallLaunch(phrase, null),
        env,
    });
    if (!preview.ok) {
        write.err(`dorothy: ${preview.message}\n`);
        return 1;
    }
    const notes: string[] = [];
    let failure: string | null = null;
    const body = await dump({
        setup: { ...preview.start, persona: request.persona },
        message: request.message,
        route: routing.routes.chat,
        keys: routing.keys,
        env,
        report: (kind, message) => {
            if (kind === "error") {
                failure = message;
            } else {
                notes.push(message);
            }
        },
    });
    for (const warning of [...preview.warnings, ...notes]) {
        write.err(`dorothy: ${warning}\n`);
    }
    if (body === null) {
        write.err(
            `dorothy: the chat sent no request to dump${failure === null ? "" : `: ${failure}`}\n`,
        );
        return 1;
    }
    write.out(`${JSON.stringify(body, null, 2)}\n`);
    return 0;
}
