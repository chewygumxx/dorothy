// vim:set expandtab shiftwidth=4 filetype=typescript:
// SPDX-License-Identifier: GPL-3.0-only

//
//
// ~chewygumxx/dorothy.git
// ::: :/src/contracts/start.ts
//
//

// A system prompt with a section after it, a blank line between; an
// empty section leaves the prompt as it is. The memory block and the
// earlier turns' abstracts are both added this way.
export function withSection(prompt: string, section: string): string {
    return section === "" ? prompt : `${prompt}\n\n${section}`;
}
