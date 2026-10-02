// vim:set expandtab shiftwidth=4 filetype=typescript:
// SPDX-License-Identifier: GPL-3.0-only

//
//
// ~chewygumxx/dorothy.git
// ::: :/src/types/niceware.d.ts
//
//

// niceware ships CommonJS without type declarations.
declare module "niceware" {
    const niceware: {
        bytesToPassphrase(bytes: Uint8Array): string[];
        passphraseToBytes(words: string[]): Uint8Array;
    };
    export = niceware;
}
