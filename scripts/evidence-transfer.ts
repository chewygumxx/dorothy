// vim:set expandtab shiftwidth=4 filetype=typescript:
// SPDX-License-Identifier: GPL-3.0-only

//
//
// ~chewygumxx/dorothy.git
// ::: :/scripts/evidence-transfer.ts
//
//

import { createHash } from "node:crypto";
import { constants } from "node:fs";
import { lstat, mkdir, open, writeFile } from "node:fs/promises";
import { basename, dirname, join, parse, resolve, sep } from "node:path";
import {
    type CheckoutSecretsDeps,
    loadCheckoutSecrets,
} from "../packages/cli/src/claude-hook.js";
import { type Env, loadSecrets } from "../packages/core/src/index.js";
import {
    type EvidenceCatalogue,
    parseCatalogue,
    validBucketName,
} from "./evidence-catalogue.js";
import { hashFile } from "./evidence-manifest.js";
import { createR2Store, type R2Config } from "./evidence-r2.js";

export interface EvidenceStore {
    exists(key: string): Promise<boolean>;
    put(key: string, path: string): Promise<void>;
    get(key: string, path: string): Promise<void>;
}
interface Selection {
    catalogue: string;
    accountId: string;
    bucket: string;
    secrets?: string;
    maxOperations?: number;
    maxBytes?: number;
}
export interface UploadOptions extends Selection {
    directory: string;
}
export interface DownloadOptions extends Selection {
    out: string;
}
export interface TransferDeps extends CheckoutSecretsDeps {
    env?: Env;
    store?: (config: R2Config) => EvidenceStore;
}
class TransferError extends Error {
    constructor(
        code: string,
        readonly operations = 0,
    ) {
        super(code);
    }
}
function fail(code: string): never {
    throw new TransferError(code);
}
function positive(value: number) {
    return Number.isSafeInteger(value) && value > 0;
}
async function directoryPath(path: string) {
    let current = parse(path).root;
    for (const part of path.slice(current.length).split(sep).filter(Boolean)) {
        current = join(current, part);
        const info = await lstat(current);
        if (!info.isDirectory() || info.isSymbolicLink())
            fail("EVIDENCE_UNSAFE_PATH");
    }
}
async function absent(path: string) {
    try {
        await lstat(path);
    } catch (error) {
        if (
            error &&
            typeof error === "object" &&
            "code" in error &&
            error.code === "ENOENT"
        )
            return;
        throw error;
    }
    fail("EVIDENCE_EXISTS");
}
async function readCatalogue(path: string) {
    await directoryPath(dirname(path));
    const info = await lstat(path);
    if (!info.isFile() || info.isSymbolicLink() || info.size > 1024 ** 2)
        fail("EVIDENCE_INVALID_CATALOGUE");
    const file = await open(
        path,
        constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
    );
    try {
        const opened = await file.stat();
        if (!opened.isFile() || opened.size > 1024 ** 2)
            fail("EVIDENCE_INVALID_CATALOGUE");
        // Bound catalogue metadata independently of archive size.
        const data = Buffer.alloc(1024 ** 2 + 1);
        let bytes = 0;
        while (bytes < data.length) {
            const read = await file.read(
                data,
                bytes,
                data.length - bytes,
                null,
            );
            if (!read.bytesRead) break;
            bytes += read.bytesRead;
        }
        if (bytes > 1024 ** 2) fail("EVIDENCE_INVALID_CATALOGUE");
        return data.subarray(0, bytes);
    } finally {
        await file.close();
    }
}
async function selection(options: Selection, upload: boolean) {
    const maxBytes = options.maxBytes ?? 4 * 1024 ** 3;
    const maxOperations = options.maxOperations ?? 100;
    if (
        !/^[a-f0-9]{32}$/i.test(options.accountId) ||
        !validBucketName(options.bucket) ||
        !options.catalogue ||
        !positive(maxBytes) ||
        !positive(maxOperations)
    )
        fail("EVIDENCE_USAGE");
    const cataloguePath = resolve(options.catalogue);
    const bytes = await readCatalogue(cataloguePath);
    let catalogue: EvidenceCatalogue;
    try {
        catalogue = parseCatalogue(JSON.parse(bytes.toString("utf8")), {
            maxBytes,
        });
    } catch {
        fail("EVIDENCE_INVALID_CATALOGUE");
    }
    if (catalogue.bucket !== options.bucket) fail("EVIDENCE_DESTINATION");
    const catalogueKey = `${catalogue.prefix}archive.json`;
    if (
        catalogue.objects.some((object) =>
            ["archive.json", "archive.tar.zst.age"].includes(
                basename(object.key),
            ),
        )
    )
        fail("EVIDENCE_INVALID_CATALOGUE");
    const operations = upload
        ? 2 * (catalogue.objects.length + 1)
        : catalogue.objects.length;
    if (!Number.isSafeInteger(operations) || operations > maxOperations)
        fail("EVIDENCE_LIMIT");
    return { catalogue, cataloguePath, bytes, catalogueKey, maxBytes };
}
async function storeFor(
    options: Selection,
    deps: TransferDeps,
    maxBytes: number,
) {
    // The loader may fill unrelated keys, but only this fresh map sees them.
    const given = deps.env ?? process.env;
    const env: Env = {
        CLOUDFLARE_R2_ACCESS_KEY_ID: given.CLOUDFLARE_R2_ACCESS_KEY_ID,
        CLOUDFLARE_R2_SECRET_ACCESS_KEY: given.CLOUDFLARE_R2_SECRET_ACCESS_KEY,
    };
    const load = deps.load ?? loadSecrets;
    const failure = await loadCheckoutSecrets(env, {
        root: deps.root,
        load: (path, into) =>
            load(options.secrets ? resolve(options.secrets) : path, into),
    });
    if (
        failure ||
        !env.CLOUDFLARE_R2_ACCESS_KEY_ID ||
        !env.CLOUDFLARE_R2_SECRET_ACCESS_KEY
    )
        fail("EVIDENCE_CREDENTIALS");
    try {
        return (deps.store ?? createR2Store)({
            accountId: options.accountId,
            bucket: options.bucket,
            accessKeyId: env.CLOUDFLARE_R2_ACCESS_KEY_ID,
            secretAccessKey: env.CLOUDFLARE_R2_SECRET_ACCESS_KEY,
            maxBytes,
        });
    } catch {
        fail("EVIDENCE_CREDENTIALS");
    }
}
async function verifyParts(
    catalogue: EvidenceCatalogue,
    directory: string,
    joined?: string,
) {
    const cipherHash = createHash("sha256");
    const output = joined
        ? await open(
              joined,
              constants.O_WRONLY |
                  constants.O_CREAT |
                  constants.O_EXCL |
                  constants.O_NOFOLLOW,
              0o600,
          )
        : undefined;
    try {
        for (const object of catalogue.objects) {
            const path = join(directory, basename(object.key));
            if (
                (await hashFile(path)) !== object.sha256.toLowerCase() ||
                (await lstat(path)).size !== object.bytes
            )
                fail("EVIDENCE_HASH_MISMATCH");
            const file = await open(
                path,
                constants.O_RDONLY |
                    constants.O_NOFOLLOW |
                    constants.O_NONBLOCK,
            );
            try {
                const buffer = Buffer.alloc(64 * 1024);
                let bytes = 0;
                while (true) {
                    const read = await file.read(
                        buffer,
                        0,
                        buffer.length,
                        null,
                    );
                    if (!read.bytesRead) break;
                    bytes += read.bytesRead;
                    if (bytes > object.bytes) fail("EVIDENCE_HASH_MISMATCH");
                    const chunk = buffer.subarray(0, read.bytesRead);
                    cipherHash.update(chunk);
                    await output?.writeFile(chunk);
                }
                if (bytes !== object.bytes) fail("EVIDENCE_HASH_MISMATCH");
            } finally {
                await file.close();
            }
        }
        if (cipherHash.digest("hex") !== catalogue.cipherSha256.toLowerCase())
            fail("EVIDENCE_HASH_MISMATCH");
    } finally {
        await output?.close();
    }
}

export async function uploadEvidence(
    options: UploadOptions,
    deps: TransferDeps = {},
) {
    let operations = 0;
    let remote = false;
    try {
        if (!options.directory) fail("EVIDENCE_USAGE");
        const selected = await selection(options, true);
        const directory = resolve(options.directory);
        await directoryPath(directory);
        await verifyParts(selected.catalogue, directory);
        const store = await storeFor(options, deps, selected.maxBytes);
        const keys = [
            ...selected.catalogue.objects.map((object) => object.key),
            selected.catalogueKey,
        ];
        remote = true;
        for (const key of keys) {
            operations++;
            if (await store.exists(key))
                throw new TransferError("EVIDENCE_REMOTE_EXISTS", operations);
        }
        // A loader or preflight must not silently change the validated source.
        if (
            !(await readCatalogue(selected.cataloguePath)).equals(
                selected.bytes,
            )
        )
            fail("EVIDENCE_CHANGED");
        await verifyParts(selected.catalogue, directory);
        for (const object of selected.catalogue.objects) {
            const path = join(directory, basename(object.key));
            if (
                (await hashFile(path)) !== object.sha256.toLowerCase() ||
                (await lstat(path)).size !== object.bytes
            )
                fail("EVIDENCE_CHANGED");
            operations++;
            await store.put(object.key, path);
        }
        if (
            !(await readCatalogue(selected.cataloguePath)).equals(
                selected.bytes,
            )
        )
            fail("EVIDENCE_CHANGED");
        await verifyParts(selected.catalogue, directory);
        operations++;
        await store.put(selected.catalogueKey, selected.cataloguePath);
        return { status: "uploaded" as const, operations };
    } catch (error) {
        if (error instanceof TransferError)
            throw new TransferError(error.message, operations);
        throw new TransferError(
            remote ? "EVIDENCE_UPLOAD_INCOMPLETE" : "EVIDENCE_LOCAL_INVALID",
            operations,
        );
    }
}
export async function downloadEvidence(
    options: DownloadOptions,
    deps: TransferDeps = {},
) {
    let operations = 0;
    let remote = false;
    try {
        if (!options.out) fail("EVIDENCE_USAGE");
        const selected = await selection(options, false);
        const out = resolve(options.out);
        await directoryPath(dirname(out));
        await absent(out);
        const store = await storeFor(options, deps, selected.maxBytes);
        await mkdir(out, { mode: 0o700 });
        remote = true;
        for (const object of selected.catalogue.objects) {
            const path = join(out, basename(object.key));
            await writeFile(path, "", { mode: 0o600, flag: "wx" });
            operations++;
            await store.get(object.key, path);
            if (
                (await hashFile(path)) !== object.sha256.toLowerCase() ||
                (await lstat(path)).size !== object.bytes
            )
                throw new TransferError(
                    "EVIDENCE_DOWNLOAD_INCOMPLETE",
                    operations,
                );
        }
        await verifyParts(
            selected.catalogue,
            out,
            join(out, "archive.tar.zst.age"),
        );
        await writeFile(join(out, "archive.json"), selected.bytes, {
            mode: 0o600,
            flag: "wx",
        });
        return { status: "downloaded" as const, operations };
    } catch (error) {
        if (remote)
            throw new TransferError("EVIDENCE_DOWNLOAD_INCOMPLETE", operations);
        if (error instanceof TransferError)
            throw new TransferError(error.message, operations);
        throw new TransferError("EVIDENCE_LOCAL_INVALID", operations);
    }
}
async function main(args: string[]) {
    const usage =
        "upload --catalogue <path> --directory <parts> --account-id <id> --bucket <bucket>\ndownload --catalogue <trusted-path> --out <new-path> --account-id <id> --bucket <bucket>\n[--secrets <path>] [--max-operations <count>] [--max-bytes <bytes>]\nLimits count logical exists/put/get calls, not SDK multipart requests or provider charges.\nPreflight cannot prevent a concurrent writer between HEAD and PUT.\nDownloads retain encrypted files only; no extraction or full recovery.";
    if (args.length === 1 && args[0] === "--help") {
        console.log(usage);
        return;
    }
    const [command, ...rest] = args;
    if (command !== "upload" && command !== "download") fail("EVIDENCE_USAGE");
    const names = new Set([
        "--catalogue",
        "--account-id",
        "--bucket",
        "--secrets",
        "--max-operations",
        "--max-bytes",
        command === "upload" ? "--directory" : "--out",
    ]);
    const values = new Map<string, string>();
    for (let index = 0; index < rest.length; index += 2) {
        const key = rest[index];
        const value = rest[index + 1];
        if (!key || !names.has(key) || !value || values.has(key))
            fail("EVIDENCE_USAGE");
        values.set(key, value);
    }
    for (const key of [
        "--catalogue",
        "--account-id",
        "--bucket",
        command === "upload" ? "--directory" : "--out",
    ])
        if (!values.has(key)) fail("EVIDENCE_USAGE");
    for (const key of ["--max-operations", "--max-bytes"])
        if (values.has(key) && !/^[1-9][0-9]*$/.test(values.get(key) as string))
            fail("EVIDENCE_USAGE");
    const common = {
        catalogue: values.get("--catalogue") as string,
        accountId: values.get("--account-id") as string,
        bucket: values.get("--bucket") as string,
        secrets: values.get("--secrets"),
        ...(values.has("--max-operations")
            ? { maxOperations: Number(values.get("--max-operations")) }
            : {}),
        ...(values.has("--max-bytes")
            ? { maxBytes: Number(values.get("--max-bytes")) }
            : {}),
    };
    console.log(
        JSON.stringify(
            command === "upload"
                ? await uploadEvidence({
                      ...common,
                      directory: values.get("--directory") as string,
                  })
                : await downloadEvidence({
                      ...common,
                      out: values.get("--out") as string,
                  }),
        ),
    );
}
if (import.meta.main) {
    main(process.argv.slice(2)).catch((error: unknown) => {
        console.error(
            error instanceof TransferError
                ? JSON.stringify({
                      code: error.message,
                      operations: error.operations,
                  })
                : "EVIDENCE_INCOMPLETE",
        );
        process.exitCode = 1;
    });
}
