// vim:set expandtab shiftwidth=4 filetype=typescript:
// SPDX-License-Identifier: GPL-3.0-only

//
//
// ~chewygumxx/dorothy.git
// ::: :/packages/eval/src/models/testing.ts
//
//

import type { CliFiles, CliRequest, CliResult, CliRunner } from "./cli.js";

// An in-memory process boundary: no CLI or file is opened by these tests.
export function fakeCli(
    reply: (
        request: CliRequest,
        count: number,
    ) => Partial<CliResult> | Promise<Partial<CliResult>>,
) {
    const requests: CliRequest[] = [];
    const contents = new Map<string, string>();
    const writes: { path: string; text: string; mode: number }[] = [];
    const removed: string[] = [];
    let count = 0;
    const cliFiles: CliFiles = {
        async temp() {
            return `/private/eval-${++count}`;
        },
        async write(path, text, mode) {
            contents.set(path, text);
            writes.push({ path, text, mode });
        },
        async read(path) {
            const text = contents.get(path);
            if (text === undefined) throw new Error("missing reply file");
            return text;
        },
        async remove(path) {
            removed.push(path);
        },
    };
    const runner: CliRunner = async (request) => {
        requests.push(request);
        return {
            exitCode: 0,
            stdout: "",
            ...(await reply(request, requests.length)),
        };
    };
    const findCli = (command: string) => `/fixture/bin/${command}`;
    return { runner, cliFiles, findCli, requests, contents, writes, removed };
}

// What each CLI printed when its plan's usage limit was reached.
export const planLimitReply = (
    via: "claude" | "codex",
): Partial<CliResult> => ({
    exitCode: 1,
    stdout:
        via === "claude"
            ? JSON.stringify({
                  is_error: true,
                  api_error_status: 429,
                  result: "Fable 5.1 requires usage credits. Switch to another model to continue.",
              })
            : `${JSON.stringify({
                  type: "error",
                  message: "You've hit your usage limit.",
              })}\n${JSON.stringify({
                  type: "turn.failed",
                  error: { message: "You've hit your usage limit." },
              })}`,
});
