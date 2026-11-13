// vim:set expandtab shiftwidth=4 filetype=typescript:
// SPDX-License-Identifier: GPL-3.0-only

//
//
// ~xxdorothy/dorothy.git
// ::: :/packages/skills/src/index.ts
//
//

//
// @dorothy/skills: the repository's own agent skills
//

import { join } from "node:path";

const STEWARDSHIP = join(
    import.meta.dir,
    "..",
    "skills",
    "agent-stewardship",
    "scripts",
);

// The stewardship skill's labelled sender, under its pane lock.
export const sendPrompt = join(STEWARDSHIP, "send-prompt.sh");
// Its interrupt: one Escape, under the same pane lock.
export const sendInterrupt = join(STEWARDSHIP, "send-interrupt.sh");
