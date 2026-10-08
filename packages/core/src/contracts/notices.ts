// vim:set expandtab shiftwidth=4 filetype=typescript:
// SPDX-License-Identifier: GPL-3.0-only

//
//
// ~chewygumxx/dorothy.git
// ::: :/packages/core/src/contracts/notices.ts
//
//

// What memory and history tell the chat. The shapes are reducer actions,
// so a notice is dispatched as it comes.
export type Notice =
    | { type: "warning"; message: string }
    | { type: "memory-cost"; usd: number };
export type NoticeSource = {
    subscribe(listener: (notice: Notice) => void): () => void;
};
