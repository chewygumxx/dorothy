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
    existsSync,
    mkdirSync,
    mkdtempSync,
    readdirSync,
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
    it("keeps several devices apart, and across a reopened store", async () => {
        const laptop = await tokens.add("laptop");
        const phone = await tokens.add("phone");
        const again = tokenStore(path);
        expect(await again.verify(laptop)).toBe("laptop");
        expect(await again.verify(phone)).toBe("phone");
        expect(await again.devices()).toEqual(["laptop", "phone"]);
        expect(await again.revoke("laptop")).toBe(true);
        expect(await tokenStore(path).verify(laptop)).toBeNull();
        expect(await tokenStore(path).verify(phone)).toBe("phone");
    });

    it("loses no device when several are added or revoked at once", async () => {
        const names = ["a", "b", "c", "d", "e", "f"];
        const made = await Promise.all(
            names.map((name) => tokenStore(path).add(name)),
        );
        expect(await tokens.devices()).toEqual(names);
        await Promise.all(
            names.slice(0, 3).map((name) => tokenStore(path).revoke(name)),
        );
        expect(await tokens.devices()).toEqual(["d", "e", "f"]);
        expect(await tokens.verify(made[5] as string)).toBe("f");
    });

    // Hold the first writer after its read, until all other children
    // have attempted the lock (or, without it, reached their writes).
    // Startup speed never decides when the first writer is released.
    it("loses no device when separate processes change it at once", async () => {
        const names = ["a", "b", "c"];
        for (const stage of ["started", "attempted", "renaming"]) {
            mkdirSync(join(dir, stage));
        }
        const script = `const { existsSync, writeFileSync } = require("node:fs");
            const { rename } = require("node:fs/promises");
            const { Database } = require("bun:sqlite");
            const { tokenStore } = await import(process.argv[1]);
            const [, , path, name, dir] = process.argv;
            const mark = (stage) => writeFileSync(dir + "/" + stage + "/" + name, "");
            const wait = async (gate) => {
                while (!existsSync(dir + "/" + gate)) await Bun.sleep(5);
            };
            const run = Database.prototype.run;
            Database.prototype.run = function(sql, ...args) {
                if (sql === "BEGIN IMMEDIATE") mark("attempted");
                return run.call(this, sql, ...args);
            };
            const store = tokenStore(path, () => new Date(), {
                rename: async (from, to) => {
                    mark("renaming");
                    await wait("release");
                    await rename(from, to);
                },
            });
            mark("started");
            await wait("start-" + name);
            await store.add(name);`;
        const children: Bun.Subprocess[] = [];
        const allAt = (stage: string) =>
            names.every((name) => existsSync(join(dir, stage, name)));
        const waitFor = async (ready: () => boolean) => {
            while (!ready()) {
                if (children.some((child) => child.exitCode !== null)) {
                    throw new Error("a token writer exited before its barrier");
                }
                await Bun.sleep(5);
            }
        };
        try {
            for (const name of names) {
                children.push(
                    Bun.spawn(
                        [
                            process.execPath,
                            "--no-env-file",
                            "-e",
                            script,
                            join(import.meta.dir, "tokens.ts"),
                            path,
                            name,
                            dir,
                        ],
                        { stdout: "inherit", stderr: "inherit" },
                    ),
                );
            }
            await waitFor(() => allAt("started"));
            writeFileSync(join(dir, "start-a"), "");
            await waitFor(() => existsSync(join(dir, "renaming", "a")));
            for (const name of names.slice(1)) {
                writeFileSync(join(dir, `start-${name}`), "");
            }
            await waitFor(() => allAt("attempted") || allAt("renaming"));
            writeFileSync(join(dir, "release"), "");
            expect(
                await Promise.all(children.map((child) => child.exited)),
            ).toEqual([0, 0, 0]);
            expect(await tokens.devices()).toEqual(names);
        } finally {
            for (const child of children) {
                child.kill();
            }
            await Promise.all(children.map((child) => child.exited));
        }
    }, 15_000);

    it("leaves no temporary file where the swap fails", async () => {
        const failing = tokenStore(path, () => new Date(), {
            rename: async () => {
                throw new Error("rename failed");
            },
        });
        await expect(failing.add("phone")).rejects.toThrow("rename failed");
        expect(
            readdirSync(dirname(path)).filter((name) => name.endsWith(".tmp")),
        ).toEqual([]);
    });

    it("makes a token, keeps only its hash, and knows its device", async () => {
        const token = await tokens.add("laptop");
        expect(token).toStartWith("dmt_");
        expect(readFileSync(path, "utf8")).not.toContain(token);
        expect(statSync(path).mode & 0o777).toBe(0o600);
        expect(statSync(`${path}.lock`).mode & 0o777).toBe(0o600);
        expect(statSync(dirname(path)).mode & 0o777).toBe(0o700);
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

    it("takes only a file of exactly its shape for tokens", async () => {
        const hash = "a".repeat(64);
        const at = "2026-10-18T09:30:00.000Z";
        mkdirSync(dirname(path), { recursive: true });
        for (const bad of [
            { v: 1, devices: [] },
            { v: 1, devices: { phone: { hash: "xyz", at } } },
            { v: 1, devices: { phone: { hash } } },
            { v: 1, devices: { phone: { hash, at: 5 } } },
            { v: 1, devices: { phone: "x" } },
            { v: 1, devices: { "Bad Name": { hash, at } } },
        ]) {
            writeFileSync(path, JSON.stringify(bad));
            await expect(tokens.add("laptop")).rejects.toThrow(path);
            expect(await tokens.devices()).toEqual([]);
        }
        writeFileSync(
            path,
            JSON.stringify({ v: 1, devices: { phone: { hash, at } } }),
        );
        expect(await tokens.devices()).toEqual(["phone"]);
    });

    it("will not revoke from a file of another shape", async () => {
        const other = '{"v":2,"devices":[]}';
        mkdirSync(dirname(path), { recursive: true });
        writeFileSync(path, other);
        await expect(tokens.revoke("laptop")).rejects.toThrow(path);
        expect(readFileSync(path, "utf8")).toBe(other);
    });
});
