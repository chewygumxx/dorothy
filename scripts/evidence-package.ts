// vim:set expandtab shiftwidth=4 filetype=typescript:
// SPDX-License-Identifier: GPL-3.0-only

//
//
// ~chewygumxx/dorothy.git
// ::: :/scripts/evidence-package.ts
//
//

import { constants } from "node:fs";
import { lstat, mkdir, open, writeFile } from "node:fs/promises";
import { dirname, join, parse, resolve, sep } from "node:path";
import {
    type EvidenceCatalogue,
    type EvidenceObject,
    parseCatalogue,
    validBucketName,
} from "./evidence-catalogue.js";
import { hashFile, verifyManifest } from "./evidence-manifest.js";

export interface PackageOptions {
    root: string;
    expectedSha256: string;
    out: string;
    id: string;
    bucket: string;
    prefix: string;
    recipient: string;
    partBytes?: number;
    maxBytes?: number;
}
export interface PipelineChild {
    stdout: ReadableStream<Uint8Array>;
    exited: Promise<number>;
    kill(): void;
}
export interface PackageDeps {
    spawn?: (
        argv: string[],
        stdin?: ReadableStream<Uint8Array>,
    ) => PipelineChild;
}
const DEFAULT_PART_BYTES = 128 * 1024 ** 2;
const DEFAULT_MAX_BYTES = 4 * 1024 ** 3;
const FORMAT =
    "Concatenate ordered age parts, age decrypt, then zstd decompress and tar extract";
function fail(code: string): never {
    throw new Error(code);
}
function positive(value: number): boolean {
    return Number.isSafeInteger(value) && value > 0;
}

// Native age X25519 recipients are 32 bytes encoded with the Bech32 checksum.
// SSH and plugin recipient formats are deliberately outside this tool's scope.
function nativeRecipient(value: string): boolean {
    if (value.length !== 62 || !value.startsWith("age1")) return false;
    const alphabet = "qpzry9x8gf2tvdw0s3jn54khce6mua7l";
    const words = Array.from(value.slice(4), (character) =>
        alphabet.indexOf(character),
    );
    if (words.some((word) => word < 0) || ((words[51] as number) & 15) !== 0)
        return false;
    const generators = [
        0x3b6a57b2, 0x26508e6d, 0x1ea119fa, 0x3d4233dd, 0x2a1462b3,
    ];
    let checksum = 1;
    for (const word of [3, 3, 3, 0, 1, 7, 5, ...words]) {
        const top = checksum >>> 25;
        checksum = ((checksum & 0x1ffffff) << 5) ^ word;
        for (const [bit, generator] of generators.entries()) {
            if ((top >>> bit) & 1) checksum ^= generator;
        }
    }
    return checksum === 1;
}

async function directoryPath(path: string) {
    let current = parse(path).root;
    for (const component of path
        .slice(current.length)
        .split(sep)
        .filter(Boolean)) {
        current = join(current, component);
        const stats = await lstat(current);
        if (!stats.isDirectory() || stats.isSymbolicLink())
            fail("EVIDENCE_UNSAFE_PATH");
    }
}
function overlaps(left: string, right: string): boolean {
    return (
        left === right ||
        left.startsWith(right.endsWith(sep) ? right : right + sep)
    );
}
const spawnPipeline: NonNullable<PackageDeps["spawn"]> = (argv, stdin) => {
    // Do not inherit tar/zstd option variables, credentials, or user configuration.
    const child = Bun.spawn(argv, {
        stdin: stdin ?? "ignore",
        stdout: "pipe",
        stderr: "ignore",
        env: { PATH: process.env.PATH ?? "/usr/bin:/bin", LC_ALL: "C" },
    });
    return {
        stdout: child.stdout,
        exited: child.exited,
        kill: () => child.kill("SIGKILL"),
    };
};

async function encrypt(
    root: string,
    recipient: string,
    destination: string,
    maxBytes: number,
    spawn: NonNullable<PackageDeps["spawn"]>,
) {
    const file = await open(
        destination,
        constants.O_WRONLY |
            constants.O_CREAT |
            constants.O_EXCL |
            constants.O_NOFOLLOW,
        0o600,
    );
    const children: PipelineChild[] = [];
    const live = new Set<PipelineChild>();
    const exits: Promise<void>[] = [];
    let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
    let writing: Promise<void> | undefined;
    try {
        const start = (argv: string[], stdin?: ReadableStream<Uint8Array>) => {
            const child = spawn(argv, stdin);
            children.push(child);
            live.add(child);
            const exited = child.exited.then((code) => {
                live.delete(child);
                if (code !== 0) fail("EVIDENCE_PIPELINE");
            });
            // A following spawn can throw before Promise.all attaches its handler.
            void exited.catch(() => {});
            exits.push(exited);
            return child;
        };
        // GNU tar on Linux is a system prerequisite. No -h: archive links as links.
        const tar = start([
            "tar",
            "--create",
            "--file=-",
            "--directory",
            root,
            "--",
            ".",
        ]);
        const zstd = start(
            ["zstd", "--compress", "--stdout", "--quiet"],
            tar.stdout,
        );
        const age = start(
            ["age", "--encrypt", "--recipient", recipient],
            zstd.stdout,
        );
        reader = age.stdout.getReader();
        const output = reader;
        writing = (async () => {
            let bytes = 0;
            while (true) {
                const { done, value } = await output.read();
                if (done) break;
                bytes += value.byteLength;
                if (!Number.isSafeInteger(bytes) || bytes > maxBytes)
                    fail("EVIDENCE_LIMIT");
                await file.writeFile(value);
            }
            if (!bytes) fail("EVIDENCE_PIPELINE");
        })();
        await Promise.all([writing, ...exits]);
    } catch (error) {
        for (const child of live) {
            try {
                child.kill();
            } catch {
                /* Still reap the other owned children. */
            }
        }
        await reader?.cancel().catch(() => {});
        await Promise.allSettled([
            ...children.map((child) => child.exited),
            ...(writing ? [writing] : []),
        ]);
        throw error;
    } finally {
        reader?.releaseLock();
        await file.close();
    }
}

async function splitCipher(
    path: string,
    directory: string,
    prefix: string,
    partBytes: number,
): Promise<EvidenceObject[]> {
    const file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
    const buffer = Buffer.alloc(64 * 1024);
    const objects: EvidenceObject[] = [];
    try {
        let done = false;
        while (!done) {
            const name = `part-${String(objects.length).padStart(3, "0")}.agepart`;
            const destination = join(directory, name);
            let part: Awaited<ReturnType<typeof open>> | undefined;
            let bytes = 0;
            try {
                while (bytes < partBytes) {
                    const read = await file.read(
                        buffer,
                        0,
                        Math.min(buffer.length, partBytes - bytes),
                        null,
                    );
                    if (!read.bytesRead) {
                        done = true;
                        break;
                    }
                    part ??= await open(
                        destination,
                        constants.O_WRONLY |
                            constants.O_CREAT |
                            constants.O_EXCL |
                            constants.O_NOFOLLOW,
                        0o600,
                    );
                    await part.writeFile(buffer.subarray(0, read.bytesRead));
                    bytes += read.bytesRead;
                }
            } finally {
                await part?.close();
            }
            if (bytes)
                objects.push({
                    key: prefix + name,
                    bytes,
                    sha256: await hashFile(destination),
                });
        }
    } finally {
        await file.close();
    }
    return objects;
}

export async function packageEvidence(
    options: PackageOptions,
    deps: PackageDeps = {},
): Promise<EvidenceCatalogue> {
    const partBytes = options.partBytes ?? DEFAULT_PART_BYTES;
    const maxBytes = options.maxBytes ?? DEFAULT_MAX_BYTES;
    if (
        !positive(partBytes) ||
        !positive(maxBytes) ||
        !options.root ||
        !options.out ||
        !validBucketName(options.bucket) ||
        !/^[a-f0-9]{64}$/i.test(options.expectedSha256) ||
        !nativeRecipient(options.recipient)
    )
        fail("EVIDENCE_USAGE");
    // Validate catalogue fields before claiming any output directory.
    parseCatalogue(
        {
            schemaVersion: 1,
            archiveId: options.id,
            bucket: options.bucket,
            prefix: options.prefix,
            format: FORMAT,
            cipherSha256: options.expectedSha256,
            cipherBytes: 1,
            payloadManifestSha256: options.expectedSha256,
            objects: [
                {
                    key: `${options.prefix}part-000.agepart`,
                    bytes: 1,
                    sha256: options.expectedSha256,
                },
            ],
        },
        { maxBytes },
    );
    const root = resolve(options.root);
    const out = resolve(options.out);
    if (overlaps(out, root) || overlaps(root, out))
        fail("EVIDENCE_UNSAFE_PATH");
    await directoryPath(dirname(out));
    await verifyManifest(root, options.expectedSha256);
    // Non-recursive creation rejects every existing output, including dangling links.
    await mkdir(out, { mode: 0o700 });
    await mkdir(join(out, "parts"), { mode: 0o700 });
    const cipherPath = join(out, "archive.tar.zst.age");
    await encrypt(
        root,
        options.recipient,
        cipherPath,
        maxBytes,
        deps.spawn ?? spawnPipeline,
    );
    const cipherSha256 = await hashFile(cipherPath);
    const cipherBytes = (await lstat(cipherPath)).size;
    const prefix = `${options.prefix}${cipherSha256}/`;
    const objects = await splitCipher(
        cipherPath,
        join(out, "parts"),
        prefix,
        partBytes,
    );
    await verifyManifest(root, options.expectedSha256);
    const catalogue = parseCatalogue(
        {
            schemaVersion: 1,
            archiveId: options.id,
            bucket: options.bucket,
            prefix,
            format: FORMAT,
            cipherSha256,
            cipherBytes,
            payloadManifestSha256: options.expectedSha256.toLowerCase(),
            objects,
            catalogueKey: `${prefix}archive.json`,
            status: "packaged",
        },
        { maxBytes },
    );
    await writeFile(
        join(out, "archive.json"),
        `${JSON.stringify(catalogue, null, 2)}\n`,
        { mode: 0o600, flag: "wx" },
    );
    return catalogue;
}

async function main(args: string[]) {
    const usage =
        "--root <path> --expected-sha256 <hash> --out <new-directory> --id <id> --bucket <bucket> --prefix <relative-prefix/> --recipient <native-age1-public-recipient> [--part-bytes <bytes>] [--max-bytes <bytes>]";
    if (args.length === 1 && args[0] === "--help") {
        console.log(
            `${usage}\nNative X25519 recipients only; SSH and plugin forms are unsupported.`,
        );
        return;
    }
    const names = new Set([
        "--root",
        "--expected-sha256",
        "--out",
        "--id",
        "--bucket",
        "--prefix",
        "--recipient",
        "--part-bytes",
        "--max-bytes",
    ]);
    const values = new Map<string, string>();
    for (let index = 0; index < args.length; index += 2) {
        const key = args[index];
        const value = args[index + 1];
        if (
            !key ||
            !names.has(key) ||
            value === undefined ||
            !value ||
            values.has(key)
        )
            fail("EVIDENCE_USAGE");
        values.set(key, value);
    }
    for (const key of [
        "--root",
        "--expected-sha256",
        "--out",
        "--id",
        "--bucket",
        "--prefix",
        "--recipient",
    ])
        if (!values.has(key)) fail("EVIDENCE_USAGE");
    for (const key of ["--part-bytes", "--max-bytes"])
        if (values.has(key) && !/^[1-9][0-9]*$/.test(values.get(key) as string))
            fail("EVIDENCE_USAGE");
    const result = await packageEvidence({
        root: values.get("--root") as string,
        expectedSha256: values.get("--expected-sha256") as string,
        out: values.get("--out") as string,
        id: values.get("--id") as string,
        bucket: values.get("--bucket") as string,
        prefix: values.get("--prefix") as string,
        recipient: values.get("--recipient") as string,
        ...(values.has("--part-bytes")
            ? { partBytes: Number(values.get("--part-bytes")) }
            : {}),
        ...(values.has("--max-bytes")
            ? { maxBytes: Number(values.get("--max-bytes")) }
            : {}),
    });
    console.log(
        JSON.stringify({
            status: "packaged",
            cipherSha256: result.cipherSha256,
            cipherBytes: result.cipherBytes,
        }),
    );
}
if (import.meta.main) {
    main(process.argv.slice(2)).catch(() => {
        console.error("EVIDENCE_INCOMPLETE");
        process.exitCode = 1;
    });
}
