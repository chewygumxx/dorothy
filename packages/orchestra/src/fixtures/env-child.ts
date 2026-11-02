// vim:set expandtab shiftwidth=4 filetype=typescript:
// SPDX-License-Identifier: GPL-3.0-only

//
//
// ~chewygumxx/dorothy.git
// ::: :/packages/orchestra/src/fixtures/env-child.ts
//
//

// For environment.test.ts: re-executes itself clean as the server does,
// then prints its variables' names and the arguments it was given.

import { reexecClean } from "../environment.js";

const code = await reexecClean({
    argv: process.argv.slice(1),
    env: process.env,
    execPath: process.execPath,
});
if (code !== null) {
    process.exit(code);
}
console.log(
    JSON.stringify({
        names: Object.keys(process.env).sort(),
        args: process.argv.slice(2),
    }),
);
