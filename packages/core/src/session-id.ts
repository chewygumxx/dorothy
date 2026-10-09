// vim:set expandtab shiftwidth=4 filetype=typescript:
// SPDX-License-Identifier: GPL-3.0-only

//
//
// ~chewygumxx/dorothy.git
// ::: :/packages/core/src/session-id.ts
//
//

import { randomBytes } from "node:crypto";
import niceware from "niceware";

export type RandomBytes = (size: number) => Uint8Array;

const WORDS = 4;

// Dorothy's own session id: niceware spends 2 bytes per word, so four words
// carry 64 random bits. The SDK keeps its own UUID separately. Outside a
// browser niceware only accepts a Buffer, so plain Uint8Arrays are wrapped.
export function newPhrase(random: RandomBytes = randomBytes): string {
    const bytes = Buffer.from(random(WORDS * 2));
    return niceware.bytesToPassphrase(bytes).join("-");
}

// Guards --resume, whose phrase becomes a file name: only exact, lowercase
// niceware words pass, so nothing path-like can reach the filesystem.
export function isPhrase(value: string): boolean {
    const words = value.split("-");
    if (words.length !== WORDS || value !== value.toLowerCase()) {
        return false;
    }
    try {
        niceware.passphraseToBytes(words);
        return true;
    } catch {
        return false;
    }
}
