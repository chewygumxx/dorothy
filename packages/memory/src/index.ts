// vim:set expandtab shiftwidth=4 filetype=typescript:
// SPDX-License-Identifier: GPL-3.0-only

//
//
// ~chewygumxx/dorothy.git
// ::: :/packages/memory/src/index.ts
//
//

// @dorothy/memory: her memory database. A chat opens it with
// openMemory; --dump-context previews a chat's start with previewStart.
// The recall server and the commands have entry points of their own, so
// that each process loads only what it runs. dorothy --claude renders the
// block and syncs its project with claudeBlock and syncDirectory; it
// notes its launch, catches up those left behind and tells what the
// hooks left with noteLaunch, staleLaunches and startNotices.

export { claudeBlock, syncDirectory } from "./bodies/launch.js";
export {
    type LaunchNote,
    noteLaunch,
    staleLaunches,
} from "./bodies/launches.js";
export { startNotices } from "./bodies/unread.js";
export {
    type Memory,
    type MemoryPrompts,
    type OpenedMemory,
    type OpenMemoryOptions,
    openMemory,
} from "./memory/open.js";
export { type Preview, previewStart } from "./memory/preview.js";
export {
    type ReviewBackfillCounts,
    type ReviewBackfillOptions,
    type ReviewBackfillOutcome,
    runReviewBackfill,
} from "./memory/review-backfill.js";
