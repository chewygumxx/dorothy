// vim:set expandtab shiftwidth=4 filetype=typescript:
// SPDX-License-Identifier: GPL-3.0-only

//
//
// ~chewygumxx/dorothy.git
// ::: :/packages/memory/src/service/tokens.test.ts
//
//

import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import {
    mkdirSync,
    mkdtempSync,
    readFileSync,
    rmSync,
    statSync,
    writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { type TokenStore, tokenStore } from "./tokens.js";

let dir: string;
let path: string;
let tokens: TokenStore;

beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "dorothy-tokens-"));
    path = join(dir, "state", "tokens.json");
    tokens = tokenStore(path);
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe("tokenStore", () => {
    it("makes a token, keeps only its hash, and knows its device", async () => {
        const token = await tokens.add("laptop");
        expect(token).toStartWith("dmt_");
        expect(readFileSync(path, "utf8")).not.toContain(token);
        expect(statSync(path).mode & 0o777).toBe(0o600);
        expect(await tokens.verify(token)).toBe("laptop");
        expect(await tokens.verify(`${token}x`)).toBeNull();
        expect(await tokens.devices()).toEqual(["laptop"]);
    });

    it("withdraws a device's token", async () => {
        const token = await tokens.add("laptop");
        expect(await tokens.revoke("laptop")).toBe(true);
        expect(await tokens.verify(token)).toBeNull();
        expect(await tokens.revoke("laptop")).toBe(false);
    });

    it("replaces a device's token when made again", async () => {
        const first = await tokens.add("laptop");
        const second = await tokens.add("laptop");
        expect(await tokens.verify(first)).toBeNull();
        expect(await tokens.verify(second)).toBe("laptop");
    });

    it("refuses a device name it cannot keep", async () => {
        await expect(tokens.add("My Laptop")).rejects.toThrow(
            "not a device's name",
        );
    });

    it("trusts nothing when there is no file", async () => {
        expect(await tokens.verify("dmt_anything")).toBeNull();
    });

    it("creates the store when there is no file", async () => {
        const token = await tokens.add("phone");
        expect(await tokens.verify(token)).toBe("phone");
        expect(await tokens.revoke("phone")).toBe(true);
    });

    it("will not overwrite a file it cannot read as tokens", async () => {
        mkdirSync(dirname(path), { recursive: true });
        writeFileSync(path, "{ not json");
        await expect(tokens.add("phone")).rejects.toThrow(path);
        expect(readFileSync(path, "utf8")).toBe("{ not json");
        expect(await tokens.verify("dmt_anything")).toBeNull();
        expect(await tokens.devices()).toEqual([]);
    });

    it("will not revoke from a file of another shape", async () => {
        const other = '{"v":2,"devices":[]}';
        mkdirSync(dirname(path), { recursive: true });
        writeFileSync(path, other);
        await expect(tokens.revoke("laptop")).rejects.toThrow(path);
        expect(readFileSync(path, "utf8")).toBe(other);
    });
});
