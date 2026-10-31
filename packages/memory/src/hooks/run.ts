// vim:set expandtab shiftwidth=4 filetype=typescript:
// SPDX-License-Identifier: GPL-3.0-only

//
//
// ~chewygumxx/dorothy.git
// ::: :/packages/memory/src/hooks/run.ts
//
//

// dorothy --hook <host> <event>: a host's hook, Codex's or her Hermes
// provider's, answered from her service. The block for a session's
// start, recall for a prompt, each as Codex's hook output; "" whenever
// there is nothing to say or the service cannot say it.

import { type HookLog, hookLog } from "../bodies/log.js";
import { identify as identifyProject } from "../projects/identify.js";
import {
    type ClientOptions,
    ensureService,
    requestBlock,
    requestRecall,
} from "../service/client.js";
import { type HookEvent, parseHookInput } from "./payload.js";

export type HostHookDeps = {
    client?: ClientOptions;
    // How to start the service when it is down; [] starts none.
    serve?: readonly string[];
    identify?: (cwd: string) => Promise<{ id: string } | null>;
    // Her hook log by default, where her Claude Code hooks write too.
    log?: HookLog;
};

const EVENT_NAMES: Record<HookEvent, string> = {
    "session-start": "SessionStart",
    prompt: "UserPromptSubmit",
};

const reply = (event: HookEvent, text: string): string =>
    text === ""
        ? ""
        : JSON.stringify({
              hookSpecificOutput: {
                  hookEventName: EVENT_NAMES[event],
                  additionalContext: text,
              },
          });

export async function runHostHook(
    host: string,
    event: HookEvent,
    stdin: string,
    deps: HostHookDeps = {},
): Promise<string> {
    let json: unknown;
    try {
        json = JSON.parse(stdin);
    } catch {
        return "";
    }
    const input = parseHookInput(event, json);
    if (input === null) {
        return "";
    }
    const client = deps.client ?? {};
    const log = deps.log ?? hookLog(client.env ?? process.env);
    const failed = (what: string) =>
        log.warn(`${host} ${event}: ${what}; answered nothing`);
    try {
        await ensureService(deps.serve ?? [], client);
        const found = await (deps.identify ?? identifyProject)(input.cwd).catch(
            () => null,
        );
        const project = found?.id;
        const scope = project === undefined ? {} : { project };
        if (event === "session-start") {
            const block = await requestBlock(
                {
                    host,
                    session: input.session,
                    reason: input.reason,
                    ...scope,
                },
                client,
            );
            if (block === null) {
                failed("no block from the service");
            }
            return reply(event, block?.text ?? "");
        }
        const recall = await requestRecall(
            {
                host,
                session: input.session,
                prompt: input.prompt ?? "",
                ...scope,
            },
            client,
        );
        if (recall === null) {
            failed("no recall from the service");
        }
        return reply(event, recall?.text ?? "");
    } catch (error) {
        failed(error instanceof Error ? error.message : String(error));
        return "";
    }
}
