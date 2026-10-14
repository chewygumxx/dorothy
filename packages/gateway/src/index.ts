// vim:set expandtab shiftwidth=4 filetype=typescript:
// SPDX-License-Identifier: GPL-3.0-only

//
//
// ~chewygumxx/dorothy.git
// ::: :/packages/gateway/src/index.ts
//
//

// @dorothy/gateway: a local stand-in for the API that adds Dorothy's
// identity to an agentic client's main thread and forwards the rest.

export {
    injectIdentity,
    MARKER,
    type Rewritten,
    rewriteRequest,
} from "./anthropic.js";
