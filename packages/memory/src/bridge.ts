// vim:set expandtab shiftwidth=4 filetype=typescript:
// SPDX-License-Identifier: GPL-3.0-only

//
//
// ~chewygumxx/dorothy.git
// ::: :/packages/memory/src/bridge.ts
//
//

// --mcp's bridge, its own entry point: a host launches it each session,
// so it loads the client and the SDK's transports, never the service.

export { runBridge } from "./service/bridge.js";
