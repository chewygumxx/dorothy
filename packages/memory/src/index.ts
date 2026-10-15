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
// block and syncs its project with claudeBlock and syncDirectory.

export { claudeBlock, syncDirectory } from "./bodies/launch.js";
export {
    type Memory,
    type MemoryPrompts,
    type OpenedMemory,
    type OpenMemoryOptions,
    openMemory,
} from "./memory/open.js";
export { type Preview, previewStart } from "./memory/preview.js";
