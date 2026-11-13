// vim:set expandtab shiftwidth=4 filetype=typescript:
// SPDX-License-Identifier: GPL-3.0-only

//
//
// ~xxdorothy/dorothy.git
// ::: :/packages/cli/assets/pi/stewardship/fixture/repo/src/slug.ts
//
//

// The stewardship trial's fixture library: a URL slug from a title. It
// carries one deterministic bug; CONTRACT.md says what it must do.

export function slugify(text: string): string {
    return text.toLowerCase().replace(/[^a-z0-9]+/g, "-");
}
