// vim:set expandtab shiftwidth=4 filetype=typescript:
// SPDX-License-Identifier: GPL-3.0-only

//
//
// ~chewygumxx/dorothy.git
// ::: :/packages/core/src/contracts/start.ts
//
//

import type { Turn } from "./session.js";

// How the CLI starts the recall server: dorothy --recall-server.
export type RecallLaunch = { command: string; args: string[] };

// What a session starts with, as plain values: memory renders them, the
// agent puts them into its system prompt and its tools.
export type SessionStart = {
    // The turns after the clusters, in full.
    history: readonly Turn[];
    // The memory block, frozen for the session; "" for none.
    memory: string;
    // The earlier turns' abstracts as a section; "" for none.
    earlier: string;
    // How to launch the recall server; null leaves recall off.
    recall: RecallLaunch | null;
    // Whether the session offers recollect, which needs recall and
    // clusters.
    recollect: boolean;
};

// A system prompt with a section after it, a blank line between; an
// empty section leaves the prompt as it is. The memory block and the
// earlier turns' abstracts are both added this way.
export function withSection(prompt: string, section: string): string {
    return section === "" ? prompt : `${prompt}\n\n${section}`;
}
