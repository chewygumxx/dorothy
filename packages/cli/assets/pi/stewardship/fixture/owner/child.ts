// vim:set expandtab shiftwidth=4 filetype=typescript:
// SPDX-License-Identifier: GPL-3.0-only

//
//
// ~chewygumxx/dorothy.git
// ::: :/packages/cli/assets/pi/stewardship/fixture/owner/child.ts
//
//

// The child of the owner's acceptance test, the only process that imports
// the submitted code. It reads the request from stdin first, imports the
// submitted `slugify`, applies it to each input and prints one reply line:
// the nonce, a space and a JSON array of outputs (null for anything that
// is not a string). It knows no expected output. The nonce stops a reply
// printed ahead of this one; code that wraps `process.stdout.write` can
// still see it. This is a guard against accident and in-band forgery, not
// a sandbox: the code runs as the runner's user.

import { join, resolve } from "node:path";

const { nonce, dir, inputs } = JSON.parse(await Bun.stdin.text()) as {
    nonce: string;
    dir: string;
    inputs: string[];
};

const { slugify } = (await import(join(resolve(dir), "src", "slug.ts"))) as {
    slugify: (text: string) => unknown;
};

const outputs = inputs.map((input) => {
    try {
        const output = slugify(input);
        return typeof output === "string" ? output : null;
    } catch {
        return null;
    }
});
process.stdout.write(`\n${nonce} ${JSON.stringify(outputs)}\n`);
