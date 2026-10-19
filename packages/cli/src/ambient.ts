// vim:set expandtab shiftwidth=4 filetype=typescript:
// SPDX-License-Identifier: GPL-3.0-only

//
//
// ~chewygumxx/dorothy.git
// ::: :/packages/cli/src/ambient.ts
//
//

// What memory's history commands run on, taken from the process here, by
// the CLI that wires them, rather than read by memory itself: the
// environment, the streams, and the interpreter and entry script the data
// repository's pre-commit hook runs.

import { resolve } from "node:path";

type Written = { write(text: string): unknown };

export type Ambient = {
    env: NodeJS.ProcessEnv;
    out: Written;
    err: Written;
    hook: { exec: string; script: string } | null;
};

export const ambient = ({
    env,
    stdout,
    stderr,
    execPath,
    argv,
}: {
    env: NodeJS.ProcessEnv;
    stdout: Written;
    stderr: Written;
    execPath: string;
    argv: string[];
} = process): Ambient => {
    const script = argv[1];
    return {
        env,
        out: stdout,
        err: stderr,
        hook:
            script === undefined
                ? null
                : { exec: execPath, script: resolve(script) },
    };
};
