// vim:set expandtab shiftwidth=4 filetype=typescript:
// SPDX-License-Identifier: GPL-3.0-only

//
//
// ~chewygumxx/dorothy.git
// ::: :/packages/cli/assets/pi/stewardship/fixture/owner/acceptance.ts
//
//

// The owner's acceptance test of the fixture library, held outside every
// worker's clone and run by the trial's runner on an export of the exact
// submitted revision: `bun acceptance.ts <export directory>`. It prints one
// line per case and exits nonzero if any fails.

import { join, resolve } from "node:path";

const dir = process.argv[2];
if (!dir) {
    console.log("usage: acceptance.ts <export directory>");
    process.exit(2);
}

const { slugify } = (await import(join(resolve(dir), "src", "slug.ts"))) as {
    slugify: (text: string) => string;
};

const cases: [string, string][] = [
    ["Hello, World!", "hello-world"],
    ["  spaced   out  ", "spaced-out"],
    ["already-a-slug", "already-a-slug"],
    ["Crème Brûlée", "creme-brulee"],
    ["Ünïcödé Tëst", "unicode-test"],
    ["a --- b", "a-b"],
    ["!!!", ""],
    ["", ""],
    ["日本語 text", "text"],
    ["v2.0 (final)", "v2-0-final"],
];

let failed = 0;
for (const [input, expected] of cases) {
    const got = slugify(input);
    const ok = got === expected;
    failed += ok ? 0 : 1;
    console.log(
        `${ok ? "ok" : "FAIL"} ${JSON.stringify(input)} -> ${JSON.stringify(got)}` +
            (ok ? "" : ` (want ${JSON.stringify(expected)})`),
    );
}
console.log(`${cases.length - failed}/${cases.length} cases pass`);
process.exit(failed === 0 ? 0 : 1);
