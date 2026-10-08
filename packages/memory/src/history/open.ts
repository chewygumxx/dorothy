// vim:set expandtab shiftwidth=4 filetype=typescript:
// SPDX-License-Identifier: GPL-3.0-only

//
//
// ~chewygumxx/dorothy.git
// ::: :/packages/memory/src/history/open.ts
//
//

import { binaryRepo } from "./binary.js";
import { isoRepo } from "./iso.js";
import { type Engine, hasGitBinary, type MemoryRepo } from "./repo.js";

// Chosen once, for the whole process: the binary when there is one,
// isomorphic-git otherwise. Never switched, so one process never mixes
// the two engines' writes.
export async function openRepo(
    root: string,
    {
        engine,
        probe = () => hasGitBinary(),
    }: { engine?: Engine; probe?: () => Promise<boolean> } = {},
): Promise<MemoryRepo> {
    const chosen = engine ?? ((await probe()) ? "git" : "isomorphic-git");
    return chosen === "git" ? binaryRepo(root) : isoRepo(root);
}
