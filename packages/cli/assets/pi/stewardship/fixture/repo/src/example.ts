// vim:set expandtab shiftwidth=4 filetype=typescript:
// SPDX-License-Identifier: GPL-3.0-only

//
//
// ~xxdorothy/dorothy.git
// ::: :/packages/cli/assets/pi/stewardship/fixture/repo/src/example.ts
//
//

// The examples CONTRACT.md lists, as a script an implementer may run. It
// is a convenience, not the acceptance test, which the owner holds.

import { slugify } from "./slug.js";

const examples: [string, string][] = [
    ["Hello, World!", "hello-world"],
    ["  spaced   out  ", "spaced-out"],
];

let failed = 0;
for (const [input, expected] of examples) {
    const got = slugify(input);
    if (got !== expected) {
        failed++;
        console.log(`FAIL ${JSON.stringify(input)}: ${JSON.stringify(got)}`);
    }
}
console.log(failed === 0 ? "examples pass" : `${failed} example(s) fail`);
process.exit(failed === 0 ? 0 : 1);
