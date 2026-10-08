// vim:set expandtab shiftwidth=4 filetype=typescript:
// SPDX-License-Identifier: GPL-3.0-only

//
//
// ~chewygumxx/dorothy.git
// ::: :/packages/memory/src/history/seal.test.ts
//
//

import { describe, expect, it } from "bun:test";
import {
    newKey,
    parseKey,
    SEALED_README,
    seal,
    sealedName,
    unseal,
} from "./seal.js";

const KEY = new Uint8Array(32).fill(7);
const OTHER = new Uint8Array(32).fill(8);
const BUNDLE = new TextEncoder().encode(
    "# v2 git bundle\nabc refs/heads/main\n\nPACK",
);
const text = (bytes: Uint8Array) => new TextDecoder().decode(bytes);

describe("keys", () => {
    it("makes 32 random bytes as base64, and reads them back", () => {
        const key = newKey();
        expect(parseKey(key)).toHaveLength(32);
        expect(newKey()).not.toBe(key);
    });

    it("refuses a key that is missing or not 32 bytes of base64", () => {
        expect(parseKey(undefined)).toBeNull();
        expect(parseKey("")).toBeNull();
        expect(parseKey(Buffer.alloc(16).toString("base64"))).toBeNull();
        expect(parseKey("not base64 at all!")).toBeNull();
    });
});

describe("seal", () => {
    it("opens what it sealed, with the same key", async () => {
        const sealed = await seal(BUNDLE, KEY);
        expect(text(sealed.subarray(0, 17))).toBe("dorothy-sealed 1\n");
        expect(await unseal(sealed, KEY)).toEqual({ ok: true, bundle: BUNDLE });
    });

    it("draws a fresh nonce each time", async () => {
        const a = await seal(BUNDLE, KEY);
        const b = await seal(BUNDLE, KEY);
        expect(Buffer.compare(a, b)).not.toBe(0);
    });

    it("never opens with another key", async () => {
        expect(await unseal(await seal(BUNDLE, KEY), OTHER)).toEqual({
            ok: false,
            reason: "it does not open with this key, or it was changed",
        });
    });

    it("never opens once a byte is changed, the header's included", async () => {
        const sealed = await seal(BUNDLE, KEY);
        const body = sealed.slice();
        body[body.length - 1] = (body.at(-1) ?? 0) ^ 1;
        expect((await unseal(body, KEY)).ok).toBe(false);
        // The nonce line is authenticated with the ciphertext.
        const nonce = new Uint8Array(12).fill(1);
        const other = await seal(BUNDLE, KEY, nonce);
        const swapped = new TextEncoder().encode(
            text(other).replace(
                Buffer.from(nonce).toString("base64"),
                Buffer.from(new Uint8Array(12).fill(2)).toString("base64"),
            ),
        );
        expect((await unseal(swapped, KEY)).ok).toBe(false);
    });

    it("never opens when cut short", async () => {
        const sealed = await seal(BUNDLE, KEY);
        expect(
            (await unseal(sealed.subarray(0, sealed.length - 4), KEY)).ok,
        ).toBe(false);
        expect(await unseal(sealed.subarray(0, 10), KEY)).toEqual({
            ok: false,
            reason: "it is not a sealed bundle",
        });
    });

    it("names a version it does not know", async () => {
        const sealed = await seal(BUNDLE, KEY);
        const later = new Uint8Array(sealed);
        later[15] = "2".charCodeAt(0);
        expect(await unseal(later, KEY)).toEqual({
            ok: false,
            reason: "it is sealed as version 2, not 1",
        });
        expect(
            await unseal(new TextEncoder().encode("hello\nthere\nyou"), KEY),
        ).toEqual({ ok: false, reason: "it is not a sealed bundle" });
    });
});

describe("the sealed branch", () => {
    it("names bundles by sequence", () => {
        expect(sealedName(1)).toBe("bundles/000001.enc");
        expect(sealedName(42)).toBe("bundles/000042.enc");
    });

    it("says how to recover", () => {
        expect(SEALED_README).toContain("dorothy --recover");
    });
});
