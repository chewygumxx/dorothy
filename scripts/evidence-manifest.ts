// vim:set expandtab shiftwidth=4 filetype=typescript:
// SPDX-License-Identifier: GPL-3.0-only

//
//
// ~chewygumxx/dorothy.git
// ::: :/scripts/evidence-manifest.ts
//
//

import { createHash } from "node:crypto";
import { type BigIntStats, constants } from "node:fs";
import { lstat, open, readdir, readlink } from "node:fs/promises";
import { dirname, isAbsolute, join, parse, resolve, sep } from "node:path";

export interface ManifestSummary {
    files: number;
    symlinks: number;
    directories: number;
    bytes: number;
    manifestSha256: string;
}

type Metadata = { mode: number; mtimeNs: string | number };
type Entry = Metadata &
    (
        | { type: "file"; size: number; sha256: string }
        | { type: "directory" }
        | { type: "symlink"; target: string }
    );
type Manifest = Record<string, Entry>;
// File opening is injectable so callers can exercise changes during reads.
export type ManifestIO = { open: typeof open };
const defaultIO: ManifestIO = { open };
const MANIFEST = "MANIFEST.json";
const SHA256 = /^[a-f0-9]{64}$/i;

class EvidenceError extends Error {}
function fail(code: string): never {
    throw new EvidenceError(code);
}

function same(before: BigIntStats, after: BigIntStats): void {
    if (
        before.dev !== after.dev ||
        before.ino !== after.ino ||
        before.mode !== after.mode ||
        before.size !== after.size ||
        before.mtimeNs !== after.mtimeNs ||
        before.ctimeNs !== after.ctimeNs
    ) {
        fail("EVIDENCE_CHANGED");
    }
}

// Reject aliases at every parent, including ancestors of an explicit root.
async function directoryPath(path: string): Promise<void> {
    const absolute = resolve(path);
    let current = parse(absolute).root;
    for (const part of absolute
        .slice(current.length)
        .split(sep)
        .filter(Boolean)) {
        current = join(current, part);
        const stats = await lstat(current, { bigint: true });
        if (!stats.isDirectory() || stats.isSymbolicLink()) {
            fail("EVIDENCE_UNSAFE_PATH");
        }
    }
}

async function checkedRead(path: string, io: ManifestIO, collect = false) {
    await directoryPath(dirname(path));
    const before = await lstat(path, { bigint: true });
    if (before.isSymbolicLink()) fail("EVIDENCE_UNSAFE_PATH");
    if (!before.isFile()) fail("EVIDENCE_SPECIAL_FILE");
    const file = await io.open(
        path,
        constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
    );
    try {
        same(before, await file.stat({ bigint: true }));
        const hash = createHash("sha256");
        const chunks: Buffer[] = [];
        const buffer = Buffer.alloc(64 * 1024);
        let bytes = 0n;
        while (true) {
            const { bytesRead } = await file.read(
                buffer,
                0,
                buffer.length,
                null,
            );
            if (!bytesRead) break;
            bytes += BigInt(bytesRead);
            if (bytes > before.size) fail("EVIDENCE_CHANGED");
            const chunk = buffer.subarray(0, bytesRead);
            hash.update(chunk);
            if (collect) chunks.push(Buffer.from(chunk));
        }
        if (bytes !== before.size) fail("EVIDENCE_CHANGED");
        same(before, await file.stat({ bigint: true }));
        await directoryPath(dirname(path));
        same(before, await lstat(path, { bigint: true }));
        return {
            sha256: hash.digest("hex"),
            stats: before,
            data: Buffer.concat(chunks),
        };
    } finally {
        await file.close();
    }
}

export async function hashFile(
    path: string,
    io: ManifestIO = defaultIO,
): Promise<string> {
    return (await checkedRead(resolve(path), io)).sha256;
}

function safeSize(size: bigint): number {
    if (size < 0n || size > BigInt(Number.MAX_SAFE_INTEGER))
        fail("EVIDENCE_LIMIT");
    return Number(size);
}

async function snapshot(root: string, io: ManifestIO) {
    const manifest: Manifest = Object.create(null);
    const observed = new Map<string, BigIntStats>();
    const walk = async (path: string, relative: string): Promise<void> => {
        await directoryPath(dirname(path));
        const stats = await lstat(path, { bigint: true });
        observed.set(path, stats);
        const metadata: Metadata = {
            mode: Number(stats.mode),
            mtimeNs: stats.mtimeNs.toString(),
        };
        if (stats.isSymbolicLink()) {
            manifest[relative] = {
                ...metadata,
                type: "symlink",
                target: await readlink(path),
            };
        } else if (stats.isDirectory()) {
            if (relative)
                manifest[relative] = { ...metadata, type: "directory" };
            const names = (await readdir(path)).sort();
            for (const name of names) {
                if (!relative && name === MANIFEST) continue;
                await walk(
                    join(path, name),
                    relative ? `${relative}/${name}` : name,
                );
            }
        } else if (stats.isFile()) {
            const file = await checkedRead(path, io);
            same(stats, file.stats);
            manifest[relative] = {
                ...metadata,
                type: "file",
                size: safeSize(stats.size),
                sha256: file.sha256,
            };
        } else {
            fail("EVIDENCE_SPECIAL_FILE");
        }
        same(stats, await lstat(path, { bigint: true }));
    };
    await directoryPath(root);
    await walk(root, "");
    await checkSnapshot(observed);
    return { manifest, observed };
}

async function checkSnapshot(observed: Map<string, BigIntStats>) {
    for (const [path, stats] of observed) {
        await directoryPath(dirname(path));
        same(stats, await lstat(path, { bigint: true }));
    }
}

function summary(manifest: Manifest, manifestSha256: string): ManifestSummary {
    const result: ManifestSummary = {
        files: 0,
        symlinks: 0,
        directories: 0,
        bytes: 0,
        manifestSha256,
    };
    for (const entry of Object.values(manifest)) {
        if (entry.type === "file") {
            result.files++;
            result.bytes += entry.size;
            if (!Number.isSafeInteger(result.bytes)) fail("EVIDENCE_LIMIT");
        } else if (entry.type === "directory") result.directories++;
        else result.symlinks++;
    }
    return result;
}

export async function createManifest(
    root: string,
    io: ManifestIO = defaultIO,
): Promise<ManifestSummary> {
    root = resolve(root);
    await directoryPath(root);
    const destination = join(root, MANIFEST);
    try {
        await lstat(destination);
        fail("EVIDENCE_EXISTS");
    } catch (error) {
        if (
            !(
                error instanceof Error &&
                "code" in error &&
                error.code === "ENOENT"
            )
        )
            throw error;
    }
    const { manifest, observed } = await snapshot(root, io);
    const text = `${JSON.stringify(manifest, null, 2)}\n`;
    const manifestSha256 = createHash("sha256").update(text).digest("hex");
    const result = summary(manifest, manifestSha256);
    await checkSnapshot(observed);
    // Exclusive creation also rejects a dangling link or a concurrent creator.
    const file = await open(
        destination,
        constants.O_WRONLY |
            constants.O_CREAT |
            constants.O_EXCL |
            constants.O_NOFOLLOW,
        0o600,
    );
    try {
        await file.writeFile(text);
    } finally {
        await file.close();
    }
    return result;
}

function validate(value: unknown): Manifest {
    const invalid = () => fail("EVIDENCE_INVALID_MANIFEST");
    if (value === null || typeof value !== "object" || Array.isArray(value))
        invalid();
    const entries = value as Record<string, unknown>;
    for (const [name, raw] of Object.entries(entries)) {
        if (
            !name ||
            isAbsolute(name) ||
            name.includes("\0") ||
            name
                .split("/")
                .some((part) => !part || part === "." || part === "..") ||
            name === MANIFEST
        )
            invalid();
        if (!raw || typeof raw !== "object" || Array.isArray(raw)) invalid();
        const entry = raw as Record<string, unknown>;
        if (
            typeof entry.mode !== "number" ||
            !Number.isSafeInteger(entry.mode) ||
            entry.mode < 0
        )
            invalid();
        if (
            !(
                typeof entry.mtimeNs === "string" &&
                /^-?\d+$/.test(entry.mtimeNs)
            ) &&
            !(
                typeof entry.mtimeNs === "number" &&
                Number.isInteger(entry.mtimeNs)
            )
        )
            invalid();
        if (entry.type === "file") {
            if (
                typeof entry.size !== "number" ||
                !Number.isSafeInteger(entry.size) ||
                entry.size < 0 ||
                typeof entry.sha256 !== "string" ||
                !SHA256.test(entry.sha256)
            )
                invalid();
        } else if (entry.type === "symlink") {
            if (typeof entry.target !== "string" || entry.target.includes("\0"))
                invalid();
        } else if (entry.type !== "directory") invalid();
        const parts = name.split("/");
        parts.pop();
        while (parts.length) {
            const parent = entries[parts.join("/")] as
                | { type?: unknown }
                | undefined;
            if (parent?.type !== "directory") invalid();
            parts.pop();
        }
    }
    return entries as Manifest;
}

export async function verifyManifest(
    root: string,
    expectedSha256: string,
    io: ManifestIO = defaultIO,
): Promise<ManifestSummary> {
    if (!SHA256.test(expectedSha256)) fail("EVIDENCE_HASH_MISMATCH");
    root = resolve(root);
    await directoryPath(root);
    const path = join(root, MANIFEST);
    const file = await checkedRead(path, io, true);
    if (file.sha256 !== expectedSha256.toLowerCase())
        fail("EVIDENCE_HASH_MISMATCH");
    let parsed: unknown;
    try {
        parsed = JSON.parse(file.data.toString("utf8"));
    } catch {
        fail("EVIDENCE_INVALID_MANIFEST");
    }
    const manifest = validate(parsed);
    const { manifest: actual, observed } = await snapshot(root, io);
    const names = Object.keys(manifest);
    if (names.length !== Object.keys(actual).length) fail("EVIDENCE_MISMATCH");
    for (const name of names) {
        const wanted = manifest[name] as Entry;
        const found = actual[name];
        if (!found || wanted.type !== found.type) fail("EVIDENCE_MISMATCH");
        if (
            wanted.type === "file" &&
            found.type === "file" &&
            (wanted.size !== found.size ||
                wanted.sha256.toLowerCase() !== found.sha256)
        )
            fail("EVIDENCE_MISMATCH");
        if (
            wanted.type === "symlink" &&
            found.type === "symlink" &&
            wanted.target !== found.target
        )
            fail("EVIDENCE_MISMATCH");
    }
    await checkSnapshot(observed);
    same(file.stats, await lstat(path, { bigint: true }));
    return summary(manifest, file.sha256);
}

async function main(args: string[]) {
    if (args.length === 1 && args[0] === "--help") {
        console.log(
            "create --root <path>\nverify --root <path> --expected-sha256 <hash>",
        );
        return;
    }
    const [command, ...rest] = args;
    const options = new Map<string, string>();
    for (let i = 0; i < rest.length; i += 2) {
        const key = rest[i];
        const value = rest[i + 1];
        if (
            (key !== "--root" && key !== "--expected-sha256") ||
            !value ||
            options.has(key)
        )
            fail("EVIDENCE_USAGE");
        options.set(key, value);
    }
    const root = options.get("--root");
    if (!root) fail("EVIDENCE_USAGE");
    if (command === "create" && options.size === 1)
        console.log(JSON.stringify(await createManifest(root)));
    else if (
        command === "verify" &&
        options.size === 2 &&
        options.has("--expected-sha256")
    ) {
        console.log(
            JSON.stringify(
                await verifyManifest(
                    root,
                    options.get("--expected-sha256") as string,
                ),
            ),
        );
    } else fail("EVIDENCE_USAGE");
}

if (import.meta.main) {
    main(process.argv.slice(2)).catch((error: unknown) => {
        console.error(
            error instanceof EvidenceError ? error.message : "EVIDENCE_IO",
        );
        process.exitCode = 1;
    });
}
