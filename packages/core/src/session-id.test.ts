// vim:set expandtab shiftwidth=4 filetype=typescript:
// SPDX-License-Identifier: GPL-3.0-only

//
//
// ~chewygumxx/dorothy.git
// ::: :/packages/core/src/session-id.test.ts
//
//

import { describe, expect, it } from "bun:test";
import niceware from "niceware";
import { isPhrase, isUuid, newPhrase } from "./session-id.js";

const BYTES = [0x12, 0x34, 0x56, 0x78, 0x9a, 0xbc, 0xde, 0xf0];
const fixed = () => Uint8Array.from(BYTES);

describe("newPhrase", () => {
    it("makes four lowercase words joined by hyphens", () => {
        expect(newPhrase(fixed)).toMatch(/^[a-z]+(-[a-z]+){3}$/);
    });

    it("draws exactly 8 random bytes", () => {
        let asked = 0;
        newPhrase((size) => {
            asked = size;
            return new Uint8Array(size);
        });
        expect(asked).toBe(8);
    });

    it("encodes the bytes it was given", () => {
        const phrase = newPhrase(fixed);
        expect(newPhrase(fixed)).toBe(phrase);
        expect([...niceware.passphraseToBytes(phrase.split("-"))]).toEqual(
            BYTES,
        );
    });

    it("differs between calls by default", () => {
        expect(newPhrase()).not.toBe(newPhrase());
    });
});

describe("isPhrase", () => {
    it("accepts a generated phrase", () => {
        expect(isPhrase(newPhrase(fixed))).toBe(true);
    });

    it.each([
        "",
        "../../etc/passwd",
        "tumble-orchid-vapor",
        "a--b-c",
        "zzzzzz-zzzzzz-zzzzzz-zzzzzz",
    ])("rejects %p", (value) => {
        expect(isPhrase(value)).toBe(false);
    });

    it("rejects five words and uppercase", () => {
        const phrase = newPhrase(fixed);
        expect(isPhrase(`${phrase}-${phrase.split("-")[0]}`)).toBe(false);
        expect(isPhrase(phrase.toUpperCase())).toBe(false);
    });
});

describe("isUuid", () => {
    it("takes a uuid in either case and nothing path-like", () => {
        expect(isUuid("0f8fad5b-d9cb-469f-a165-70867728950e")).toBe(true);
        expect(isUuid("0F8FAD5B-D9CB-469F-A165-70867728950E")).toBe(true);
        expect(isUuid("../0f8fad5b-d9cb-469f-a165-70867728950e")).toBe(false);
        expect(isUuid("0f8fad5b-d9cb-469f-a165-70867728950")).toBe(false);
        expect(isUuid("")).toBe(false);
    });
});
