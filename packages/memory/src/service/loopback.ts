// vim:set expandtab shiftwidth=4 filetype=typescript:
// SPDX-License-Identifier: GPL-3.0-only

//
//
// ~chewygumxx/dorothy.git
// ::: :/packages/memory/src/service/loopback.ts
//
//

// Whether an address is this machine's own: what needs no token.

const LOOPBACK = new Set(["::1", "::ffff:127.0.0.1"]);

export const isLoopback = (address: string) =>
    LOOPBACK.has(address) || address.startsWith("127.");
