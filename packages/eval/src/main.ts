// vim:set expandtab shiftwidth=4 filetype=typescript:
// SPDX-License-Identifier: GPL-3.0-only

//
//
// ~chewygumxx/dorothy.git
// ::: :/packages/eval/src/main.ts
//
//

// bun run eval: the process around runCli, with the real terminal.

import { createInterface, type Interface } from "node:readline/promises";
import { runCli } from "./cli.js";
import { openEditor } from "./editor.js";

// Declared so, tsc does not narrow it to null at the top level.
let reader = null as Interface | null;

const ask = (prompt: string) =>
    new Promise<string | null>((done) => {
        reader ??= createInterface({
            input: process.stdin,
            output: process.stdout,
        });
        const ended = () => done(null);
        reader.once("close", ended);
        reader.question(prompt).then(
            (answer) => {
                reader?.off("close", ended);
                done(answer);
            },
            () => done(null),
        );
    });

const edit = async (path: string) => openEditor(path, process.env);

process.exitCode = await runCli(process.argv.slice(2), {
    env: process.env,
    out: (text) => process.stdout.write(text),
    err: (text) => process.stderr.write(text),
    ask,
    edit,
});
reader?.close();
