// vim:set expandtab shiftwidth=4 filetype=typescript:
// SPDX-License-Identifier: GPL-3.0-only

//
//
// ~chewygumxx/dorothy.git
// ::: :/scripts/evidence-catalogue.ts
//
//

export interface EvidenceObject {
    key: string;
    bytes: number;
    sha256: string;
    [metadata: string]: unknown;
}

export interface EvidenceCatalogue {
    schemaVersion: 1;
    archiveId: string;
    bucket: string;
    prefix: string;
    format: string;
    cipherSha256: string;
    cipherBytes: number;
    payloadManifestSha256: string;
    objects: EvidenceObject[];
    catalogueKey?: string;
    [metadata: string]: unknown;
}

export interface CatalogueLimits {
    maxBytes?: number;
    maxObjects?: number;
}

const SHA256 = /^[a-f0-9]{64}$/i;
const DEFAULT_MAX_BYTES = 4 * 1024 ** 3;

/** Destination policy for new packages and transfer selection. */
export function validBucketName(bucket: string): boolean {
    return /^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$/.test(bucket);
}

function invalid(): never {
    throw new Error("EVIDENCE_INVALID_CATALOGUE");
}
function positive(value: unknown): value is number {
    return (
        typeof value === "number" && Number.isSafeInteger(value) && value > 0
    );
}
function controls(value: string): boolean {
    return Array.from(value).some(
        (char) => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127,
    );
}
function text(value: unknown): value is string {
    return (
        typeof value === "string" && value.trim().length > 0 && !controls(value)
    );
}
function relative(value: string): boolean {
    return (
        !value.includes("\\") &&
        !controls(value) &&
        value
            .split("/")
            .every((part) => part !== "" && part !== "." && part !== "..")
    );
}

/** Validate without discarding metadata from older capture catalogues. */
export function parseCatalogue(
    value: unknown,
    limits: CatalogueLimits = {},
): EvidenceCatalogue {
    const maxBytes = limits.maxBytes ?? DEFAULT_MAX_BYTES;
    const maxObjects = limits.maxObjects ?? Number.MAX_SAFE_INTEGER;
    if (!positive(maxBytes) || !positive(maxObjects)) invalid();
    if (!value || typeof value !== "object" || Array.isArray(value)) invalid();
    const item = value as Record<string, unknown>;
    if (
        item.schemaVersion !== 1 ||
        !text(item.archiveId) ||
        !text(item.bucket) ||
        !text(item.format)
    )
        invalid();
    if (
        typeof item.prefix !== "string" ||
        !item.prefix.endsWith("/") ||
        !relative(item.prefix.slice(0, -1))
    )
        invalid();
    if (
        typeof item.cipherSha256 !== "string" ||
        !SHA256.test(item.cipherSha256) ||
        typeof item.payloadManifestSha256 !== "string" ||
        !SHA256.test(item.payloadManifestSha256)
    )
        invalid();
    if (!positive(item.cipherBytes) || item.cipherBytes > maxBytes) invalid();
    if (
        !Array.isArray(item.objects) ||
        !item.objects.length ||
        item.objects.length > maxObjects
    )
        invalid();
    const keys = new Set<string>();
    const basenames = new Set<string>();
    let bytes = 0;
    for (const raw of item.objects) {
        if (!raw || typeof raw !== "object" || Array.isArray(raw)) invalid();
        const part = raw as Record<string, unknown>;
        if (
            typeof part.key !== "string" ||
            !relative(part.key) ||
            !part.key.startsWith(item.prefix)
        )
            invalid();
        const basename = part.key.slice(part.key.lastIndexOf("/") + 1);
        if (
            !/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(basename) ||
            keys.has(part.key) ||
            basenames.has(basename)
        )
            invalid();
        if (
            !positive(part.bytes) ||
            typeof part.sha256 !== "string" ||
            !SHA256.test(part.sha256)
        )
            invalid();
        keys.add(part.key);
        basenames.add(basename);
        bytes += part.bytes;
        if (!Number.isSafeInteger(bytes) || bytes > maxBytes) invalid();
    }
    if (bytes !== item.cipherBytes) invalid();
    if (
        item.catalogueKey !== undefined &&
        (item.catalogueKey !== `${item.prefix}archive.json` ||
            keys.has(item.catalogueKey as string))
    )
        invalid();
    return value as EvidenceCatalogue;
}
