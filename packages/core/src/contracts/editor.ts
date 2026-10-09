// vim:set expandtab shiftwidth=4 filetype=typescript:
// SPDX-License-Identifier: GPL-3.0-only

//
//
// ~chewygumxx/dorothy.git
// ::: :/packages/core/src/contracts/editor.ts
//
//

// What editing text in $EDITOR comes back with.
export type EditResult =
    | { ok: true; text: string }
    | { ok: false; message: string };

// Edits text in the user's editor; the screen supplies the real one.
export type Editor = (text: string) => Promise<EditResult>;
