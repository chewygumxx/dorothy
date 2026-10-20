// vim:set expandtab shiftwidth=4 filetype=typescript:
// SPDX-License-Identifier: GPL-3.0-only

//
//
// ~chewygumxx/dorothy.git
// ::: :/packages/memory/src/service.ts
//
//

// The memory service and what the CLI runs of it: --serve and its
// device tokens, and --sweep. The --mcp bridge has an entry point of its
// own, so a process a host launches each session loads none of this.

export { runService, runTokenAdd, runTokenRevoke } from "./service/run.js";
export { runSweep, runSweepDismiss } from "./service/sweep-command.js";
