// vim:set expandtab shiftwidth=4 filetype=typescript:
// SPDX-License-Identifier: GPL-3.0-only

//
//
// ~chewygumxx/dorothy.git
// ::: :/packages/memory/src/commands.ts
//
//

// @dorothy/memory/commands: the commands that read and edit memory and
// its history, each run once by a process of its own.

export {
    commandHistory,
    runCheck,
    runHistory,
    runMirror,
    runRecover,
    runRestore,
    runRollback,
} from "./history/commands.js";
export {
    runList,
    runMemoryEdit,
    runTags,
    runTagsEdit,
} from "./memory/commands.js";
