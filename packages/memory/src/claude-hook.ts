// vim:set expandtab shiftwidth=4 filetype=typescript:
// SPDX-License-Identifier: GPL-3.0-only

//
//
// ~chewygumxx/dorothy.git
// ::: :/packages/memory/src/claude-hook.ts
//
//

// @dorothy/memory/claude-hook: dorothy --claude-hook, which Claude
// Code's hooks run after each reply, loading the reader, the store and
// reviews alone.

export {
    type HookDeps,
    type HookMode,
    runClaudeHook,
} from "./bodies/hook.js";
export { type HookLog, hookLog } from "./bodies/log.js";
