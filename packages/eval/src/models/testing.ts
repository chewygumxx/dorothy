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
