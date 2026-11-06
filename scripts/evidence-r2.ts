// vim:set expandtab shiftwidth=4 filetype=typescript:
// SPDX-License-Identifier: GPL-3.0-only

//
//
// ~chewygumxx/dorothy.git
// ::: :/scripts/evidence-r2.ts
//
//

import { constants } from "node:fs";
import { open } from "node:fs/promises";
import { S3Client, type S3Options } from "bun";
import type { EvidenceStore } from "./evidence-transfer.js";

export interface R2Config {
    accountId: string;
    bucket: string;
    accessKeyId: string;
    secretAccessKey: string;
    maxBytes: number;
}
export interface R2Deps {
    client?: (options: S3Options) => S3Client;
}

/** Only explicitly selected R2 credentials configure the SDK. */
export function createR2Store(
    config: R2Config,
    deps: R2Deps = {},
): EvidenceStore {
    if (
        !/^[a-f0-9]{32}$/i.test(config.accountId) ||
        !config.bucket ||
        !config.accessKeyId ||
        !config.secretAccessKey ||
        !Number.isSafeInteger(config.maxBytes) ||
        config.maxBytes <= 0
    )
        throw new Error("EVIDENCE_STORE_FAILED");
    let client: S3Client;
    try {
        client = (deps.client ?? ((options) => new S3Client(options)))({
            bucket: config.bucket,
            accessKeyId: config.accessKeyId,
            secretAccessKey: config.secretAccessKey,
            sessionToken: "",
            endpoint: `https://${config.accountId}.r2.cloudflarestorage.com`,
            region: "auto",
            retry: 0,
            virtualHostedStyle: false,
        });
    } catch {
        throw new Error("EVIDENCE_STORE_FAILED");
    }
    let downloaded = 0;
    return {
        async exists(key) {
            try {
                return await client.exists(key);
            } catch {
                throw new Error("EVIDENCE_STORE_FAILED");
            }
        },
        async put(key, path) {
            try {
                const file = await open(
                    path,
                    constants.O_RDONLY |
                        constants.O_NOFOLLOW |
                        constants.O_NONBLOCK,
                );
                try {
                    const info = await file.stat();
                    const limit = key.endsWith("/archive.json")
                        ? 1024 ** 2
                        : config.maxBytes;
                    if (!info.isFile() || info.size > limit) throw new Error();
                    // File-backed input streams without an archive-sized buffer.
                    await client.write(key, Bun.file(file.fd), { retry: 0 });
                } finally {
                    await file.close();
                }
            } catch {
                throw new Error("EVIDENCE_STORE_FAILED");
            }
        },
        async get(key, path) {
            try {
                // The transfer owns an exclusively created private destination.
                const file = await open(
                    path,
                    constants.O_WRONLY |
                        constants.O_NOFOLLOW |
                        constants.O_NONBLOCK |
                        constants.O_TRUNC,
                );
                try {
                    if (!(await file.stat()).isFile()) throw new Error();
                    const reader = client.file(key).stream().getReader();
                    try {
                        while (true) {
                            const { done, value } = await reader.read();
                            if (done) break;
                            if (value.length > config.maxBytes - downloaded)
                                throw new Error();
                            downloaded += value.length;
                            await file.writeFile(value);
                        }
                    } finally {
                        await reader.cancel().catch(() => {});
                        reader.releaseLock();
                    }
                } finally {
                    await file.close();
                }
            } catch {
                throw new Error("EVIDENCE_STORE_FAILED");
            }
        },
    };
}
