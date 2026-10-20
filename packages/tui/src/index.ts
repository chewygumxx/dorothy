// vim:set expandtab shiftwidth=4 filetype=typescript:
// SPDX-License-Identifier: GPL-3.0-only

//
//
// ~chewygumxx/dorothy.git
// ::: :/packages/tui/src/index.ts
//
//

// @dorothy/tui: the chat on the terminal. The editor it opens is the
// separate entry point `./editor`, so a command that only edits need not
// load the chat.

export { type RunAppOptions, runApp } from "./run-app.js";
