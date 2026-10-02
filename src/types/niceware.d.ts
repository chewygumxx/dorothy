// vim:set expandtab shiftwidth=4 filetype=typescript:
// SPDX-License-Identifier: GPL-3.0-only

//
//
// ~chewygumxx/dorothy.git
// ::: :/src/types/niceware.d.ts
//
//

// niceware ships CommonJS without type declarations. Outside a browser it
// rejects anything but a Buffer.
declare module "niceware" {
    const niceware: {
        bytesToPassphrase(bytes: Buffer): string[];
        passphraseToBytes(words: string[]): Buffer;
    };
    export = niceware;
}
