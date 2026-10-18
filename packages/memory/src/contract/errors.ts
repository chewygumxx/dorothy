// vim:set expandtab shiftwidth=4 filetype=typescript:
// SPDX-License-Identifier: GPL-3.0-only

//
//
// ~chewygumxx/dorothy.git
// ::: :/packages/memory/src/contract/errors.ts
//
//

// A failure the contract answers with: its HTTP status, and a message
// safe to show, which names no token, transcript text or file body.
export class ContractError extends Error {
    constructor(
        readonly status: number,
        message: string,
    ) {
        super(message);
    }
}
