// vim:set expandtab shiftwidth=4 filetype=typescript:
// SPDX-License-Identifier: GPL-3.0-only

//
//
// ~chewygumxx/dorothy.git
// ::: :/packages/memory/src/scrub.test.ts
//
//

import { describe, expect, it } from "bun:test";
import { scrub } from "./scrub.js";

const CASES: [string, string][] = [
    ["export API_KEY=abc123", "export API_KEY=[secret]"],
    ['{"password": "hunter2"}', '{"password": "[secret]"}'],
    [
        "curl -H 'Authorization: Bearer abcdefgh12345678'",
        "curl -H 'Authorization: Bearer [secret]'",
    ],
    [
        "curl -H 'Authorization: token abc123xyz'",
        "curl -H 'Authorization: token [secret]'",
    ],
    ["token: ghp_abcdefghijklmnopqrstuvwxyz0123", "token: [secret]"],
    ["key sk-ant-api03-abcdefghij", "key [secret]"],
    ["AKIAABCDEFGHIJKLMNOP", "[secret]"],
    [
        "-----BEGIN OPENSSH PRIVATE KEY-----\nabc\n-----END OPENSSH PRIVATE KEY-----",
        "[secret]",
    ],
    ['password: "correct horse battery"', 'password: "[secret]"'],
    ['GITHUB_TOKEN="abc def"', 'GITHUB_TOKEN="[secret]"'],
    ["secret='two words' && ls", "secret='[secret]' && ls"],
    [
        "$ head -3 id_rsa\n-----BEGIN RSA PRIVATE KEY-----\nMIIEow\nAAAA",
        "$ head -3 id_rsa\n[secret]",
    ],
];

describe("scrub", () => {
    it.each(CASES)("replaces the secret in %p", (input, expected) => {
        expect(scrub(input)).toBe(expected);
    });

    it("leaves text with no secret's shape alone", () => {
        const text = "git status --short\n M docs/roadmap.md\n";
        expect(scrub(text)).toBe(text);
    });

    it("takes linear time on long runs that name no secret", () => {
        for (const text of ["a-".repeat(50000), "pkg.sub.mod.".repeat(10000)]) {
            const start = performance.now();
            expect(scrub(text)).toBe(text);
            expect(performance.now() - start).toBeLessThan(200);
        }
    });

    it("crosses repeated key headers with no end in linear time", () => {
        const line = `-----BEGIN OPENSSH PRIVATE KEY-----${"A".repeat(35)}\n`;
        const text = line.repeat(20000);
        expect(text.length).toBeGreaterThan(1_400_000);
        const start = performance.now();
        expect(scrub(text)).toBe("[secret]");
        expect(performance.now() - start).toBeLessThan(200);
    });

    it("bounds a quoted value with no closing quote", () => {
        const text = `password: "${"a ".repeat(1000)}`;
        const start = performance.now();
        const scrubbed = scrub(text);
        expect(performance.now() - start).toBeLessThan(200);
        expect(scrubbed.startsWith('password: "[secret]')).toBe(true);
        expect(scrubbed.length).toBe(text.length - 512 + "[secret]".length);
    });

    it("gives the same text when run twice", () => {
        for (const [input] of CASES) {
            expect(scrub(scrub(input))).toBe(scrub(input));
        }
    });
});
