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
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
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

const isTokenFile = (value: unknown): value is TokenFile => {
    if (typeof value !== "object" || value === null) {
        return false;
    }
    const { v, devices } = value as { v?: unknown; devices?: unknown };
    return (
        v === 1 &&
        typeof devices === "object" &&
        devices !== null &&
        Object.values(devices).every(
            (entry) =>
                typeof entry === "object" &&
                entry !== null &&
                typeof (entry as { hash?: unknown }).hash === "string",
        )
    );
};

export function tokenStore(
    path: string,
    now: () => Date = () => new Date(),
): TokenStore {
    const read = async (): Promise<TokenFile> => {
        try {
            const data: unknown = JSON.parse(await readFile(path, "utf8"));
            return isTokenFile(data) ? data : { v: 1, devices: {} };
        } catch {
            return { v: 1, devices: {} };
        }
    };
    const write = async (file: TokenFile) => {
        await mkdir(dirname(path), { recursive: true, mode: 0o700 });
        const temp = `${path}.${randomBytes(4).toString("hex")}.tmp`;
        await writeFile(temp, `${JSON.stringify(file, null, 4)}\n`, {
            mode: 0o600,
        });
        await rename(temp, path);
    };
    return {
        async add(device) {
            if (!DEVICE.test(device)) {
                throw new Error(
                    `${device} is not a device's name: lower case letters, digits and hyphens`,
                );
            }
            const token = `dmt_${randomBytes(32).toString("base64url")}`;
            const file = await read();
            file.devices[device] = {
                hash: hashOf(token),
                at: now().toISOString(),
            };
            await write(file);
            return token;
        },
        async revoke(device) {
            const file = await read();
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
        },
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
