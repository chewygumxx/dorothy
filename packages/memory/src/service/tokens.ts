// vim:set expandtab shiftwidth=4 filetype=typescript:
// SPDX-License-Identifier: GPL-3.0-only

//
//
// ~chewygumxx/dorothy.git
// ::: :/packages/memory/src/service/tokens.ts
//
//

// Device tokens for requests from beyond loopback: made once and shown
// once, kept only as SHA-256 hashes in the state directory, mode 0600. A
// file that cannot be read trusts no device.

import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { mkdir, open, readFile, rename, rm } from "node:fs/promises";
import { dirname, join } from "node:path";
import { type Env, xdgDir } from "@dorothy/core";

export const DEVICE = /^[a-z0-9][a-z0-9-]{0,39}$/;

type TokenFile = {
    v: 1;
    devices: Record<string, { hash: string; at: string }>;
};

export type TokenStore = {
    add(device: string): Promise<string>;
    revoke(device: string): Promise<boolean>;
    verify(token: string): Promise<string | null>;
    devices(): Promise<string[]>;
};

export const tokensPath = (env: Env) =>
    join(
        xdgDir(env, "XDG_STATE_HOME", ".local/state"),
        "dorothy",
        "tokens.json",
    );

const hashOf = (token: string) =>
    createHash("sha256").update(token).digest("hex");

const isRecord = (value: unknown): value is Record<string, unknown> =>
    typeof value === "object" && value !== null && !Array.isArray(value);

// Exactly the file this store writes: a mapping of device names to a
// SHA-256 hash and a time.
const isTokenFile = (value: unknown): value is TokenFile =>
    isRecord(value) &&
    value.v === 1 &&
    isRecord(value.devices) &&
    Object.entries(value.devices).every(
        ([device, entry]) =>
            DEVICE.test(device) &&
            isRecord(entry) &&
            typeof entry.hash === "string" &&
            /^[0-9a-f]{64}$/.test(entry.hash) &&
            typeof entry.at === "string",
    );

// Changes to one file take turns, whichever store makes them.
const queues = new Map<string, Promise<unknown>>();
function inTurn<T>(path: string, work: () => Promise<T>): Promise<T> {
    const result = (queues.get(path) ?? Promise.resolve()).then(work);
    const tail = result.catch(() => {});
    queues.set(path, tail);
    void tail.then(() => {
        if (queues.get(path) === tail) {
            queues.delete(path);
        }
    });
    return result;
}

export function tokenStore(
    path: string,
    now: () => Date = () => new Date(),
    // The swap into place; for tests.
    fs: { rename?: typeof rename } = {},
): TokenStore {
    const empty = (): TokenFile => ({ v: 1, devices: {} });
    // Only a missing file is an empty store; anything else is an error, so
    // that a change never overwrites tokens it could not read.
    const load = async (): Promise<TokenFile> => {
        let text: string;
        try {
            text = await readFile(path, "utf8");
        } catch (error) {
            const { code } = error as NodeJS.ErrnoException;
            if (code === "ENOENT") {
                return empty();
            }
            throw new Error(`${path} cannot be read (${code ?? "error"})`);
        }
        let data: unknown;
        try {
            data = JSON.parse(text);
        } catch {
            throw new Error(`${path} is not valid JSON`);
        }
        if (!isTokenFile(data)) {
            throw new Error(`${path} is not a version 1 token file`);
        }
        return data;
    };
    // Verifying fails closed: a file that cannot be read trusts no one.
    const read = () => load().catch(empty);
    const write = async (file: TokenFile) => {
        await mkdir(dirname(path), { recursive: true, mode: 0o700 });
        const temp = `${path}.${randomBytes(4).toString("hex")}.tmp`;
        try {
            // Synced before the swap, so a power loss leaves the old file
            // or the new, never an empty one.
            const handle = await open(temp, "wx", 0o600);
            try {
                await handle.writeFile(`${JSON.stringify(file, null, 4)}\n`);
                await handle.sync();
            } finally {
                await handle.close();
            }
            await (fs.rename ?? rename)(temp, path);
        } catch (error) {
            await rm(temp, { force: true });
            throw error;
        }
    };
    return {
        async add(device) {
            if (!DEVICE.test(device)) {
                throw new Error(
                    `${device} is not a device's name: lower case letters, digits and hyphens`,
                );
            }
            const token = `dmt_${randomBytes(32).toString("base64url")}`;
            await inTurn(path, async () => {
                const file = await load();
                file.devices[device] = {
                    hash: hashOf(token),
                    at: now().toISOString(),
                };
                await write(file);
            });
            return token;
        },
        revoke: (device) =>
            inTurn(path, async () => {
                const file = await load();
                if (!Object.hasOwn(file.devices, device)) {
                    return false;
                }
                file.devices = Object.fromEntries(
                    Object.entries(file.devices).filter(
                        ([name]) => name !== device,
                    ),
                );
                await write(file);
                return true;
            }),
        async verify(token) {
            const hash = Buffer.from(hashOf(token), "hex");
            for (const [device, entry] of Object.entries(
                (await read()).devices,
            )) {
                const known = Buffer.from(entry.hash, "hex");
                if (
                    known.length === hash.length &&
                    timingSafeEqual(known, hash)
                ) {
                    return device;
                }
            }
            return null;
        },
        async devices() {
            return Object.keys((await read()).devices).sort();
        },
    };
}
