// vim:set expandtab shiftwidth=4 filetype=typescript:
// SPDX-License-Identifier: GPL-3.0-only

//
//
// ~chewygumxx/dorothy.git
// ::: :/scripts/evidence-catalogue.test.ts
//
//

import { describe, expect, it } from "bun:test";
import { parseCatalogue } from "./evidence-catalogue.js";

const hash = "a".repeat(64);
const catalogue = () => ({
    schemaVersion: 1 as const,
    archiveId: "synthetic-fixture",
    bucket: "synthetic-bucket",
    prefix: `evidence/${hash}/`,
    format: "Concatenate ordered age parts, age decrypt, then zstd decompress and tar extract",
    cipherSha256: hash,
    cipherBytes: 3,
    payloadManifestSha256: "b".repeat(64),
    objects: [
        { key: `evidence/${hash}/part-000.agepart`, bytes: 3, sha256: hash },
    ] as [{ key: string; bytes: number; sha256: string }],
    catalogueKey: `evidence/${hash}/archive.json`,
    payloadSummary: { originalsRetained: true },
});

describe("evidence catalogue", () => {
    it("preserves existing metadata and ordered parts", () => {
        const value = catalogue();
        expect(parseCatalogue(value)).toEqual(value);
    });
    it("accepts digest case without changing existing metadata", () => {
        const value = catalogue();
        value.cipherSha256 = hash.toUpperCase();
        value.objects[0].sha256 = hash.toUpperCase();
        expect(parseCatalogue(value)).toEqual(value);
    });
    for (const value of [null, [], {}, { ...catalogue(), schemaVersion: 2 }]) {
        it(`rejects malformed schema ${JSON.stringify(value)?.slice(0, 40)}`, () => {
            expect(() => parseCatalogue(value)).toThrow(
                "EVIDENCE_INVALID_CATALOGUE",
            );
        });
    }
    for (const field of [
        "archiveId",
        "bucket",
        "format",
        "cipherSha256",
        "payloadManifestSha256",
    ] as const) {
        it(`rejects invalid ${field}`, () => {
            expect(() =>
                parseCatalogue({ ...catalogue(), [field]: "" }),
            ).toThrow("EVIDENCE_INVALID_CATALOGUE");
        });
    }
    for (const prefix of [
        "/root/",
        "a/../b/",
        "a//b/",
        "a/./b/",
        "a\\b/",
        "a",
        "",
        "a/\0/",
    ]) {
        it(`rejects non-normalized prefix ${JSON.stringify(prefix)}`, () => {
            expect(() => parseCatalogue({ ...catalogue(), prefix })).toThrow(
                "EVIDENCE_INVALID_CATALOGUE",
            );
        });
    }
    for (const key of [
        "outside/part",
        `evidence/${hash}/../part`,
        `evidence/${hash}/.`,
        `evidence/${hash}/bad name`,
        `evidence/${hash}/-option`,
        `evidence/${hash}/sub//part`,
    ]) {
        it(`rejects unsafe key ${JSON.stringify(key)}`, () => {
            const value = catalogue();
            value.objects[0].key = key;
            expect(() => parseCatalogue(value)).toThrow(
                "EVIDENCE_INVALID_CATALOGUE",
            );
        });
    }
    it("rejects duplicate keys and colliding local basenames", () => {
        const value = catalogue();
        value.cipherBytes = 6;
        value.objects.push({ ...value.objects[0] });
        expect(() => parseCatalogue(value)).toThrow(
            "EVIDENCE_INVALID_CATALOGUE",
        );
        (value.objects.at(-1) as (typeof value.objects)[0]).key =
            `${value.prefix}nested/part-000.agepart`;
        expect(() => parseCatalogue(value)).toThrow(
            "EVIDENCE_INVALID_CATALOGUE",
        );
    });
    it("rejects mismatched sizes, empty parts and invalid part digests", () => {
        expect(() =>
            parseCatalogue({ ...catalogue(), cipherBytes: 4 }),
        ).toThrow("EVIDENCE_INVALID_CATALOGUE");
        expect(() => parseCatalogue({ ...catalogue(), objects: [] })).toThrow(
            "EVIDENCE_INVALID_CATALOGUE",
        );
        const value = catalogue();
        value.objects[0].sha256 = "no";
        expect(() => parseCatalogue(value)).toThrow(
            "EVIDENCE_INVALID_CATALOGUE",
        );
    });
    for (const bytes of [
        0,
        -1,
        1.5,
        NaN,
        Infinity,
        Number.MAX_SAFE_INTEGER + 1,
    ]) {
        it(`rejects invalid byte size ${bytes}`, () => {
            expect(() =>
                parseCatalogue({ ...catalogue(), cipherBytes: bytes }),
            ).toThrow("EVIDENCE_INVALID_CATALOGUE");
            const value = catalogue();
            value.objects[0].bytes = bytes;
            expect(() => parseCatalogue(value)).toThrow(
                "EVIDENCE_INVALID_CATALOGUE",
            );
        });
    }
    it("rejects overflowed sums", () => {
        const value = catalogue();
        value.cipherBytes = Number.MAX_SAFE_INTEGER;
        value.objects[0].bytes = Number.MAX_SAFE_INTEGER;
        value.objects.push({
            key: `${value.prefix}second`,
            bytes: 1,
            sha256: hash,
        });
        expect(() =>
            parseCatalogue(value, { maxBytes: Number.MAX_SAFE_INTEGER }),
        ).toThrow("EVIDENCE_INVALID_CATALOGUE");
    });
    it("validates optional catalogue key and part collision", () => {
        expect(() =>
            parseCatalogue({
                ...catalogue(),
                catalogueKey: "wrong/archive.json",
            }),
        ).toThrow("EVIDENCE_INVALID_CATALOGUE");
        const value = catalogue();
        value.objects[0].key = value.catalogueKey;
        expect(() => parseCatalogue(value)).toThrow(
            "EVIDENCE_INVALID_CATALOGUE",
        );
        const { catalogueKey: _, ...withoutKey } = catalogue();
        expect(parseCatalogue(withoutKey).archiveId).toBe("synthetic-fixture");
    });
    it("enforces byte and object ceilings with validated positive limits", () => {
        expect(() => parseCatalogue(catalogue(), { maxBytes: 2 })).toThrow(
            "EVIDENCE_INVALID_CATALOGUE",
        );
        const value = catalogue();
        value.objects.push({
            key: `${value.prefix}second`,
            bytes: 1,
            sha256: hash,
        });
        value.cipherBytes++;
        expect(() => parseCatalogue(value, { maxObjects: 1 })).toThrow(
            "EVIDENCE_INVALID_CATALOGUE",
        );
        for (const limit of [
            0,
            -1,
            1.5,
            Infinity,
            Number.MAX_SAFE_INTEGER + 1,
        ]) {
            expect(() =>
                parseCatalogue(catalogue(), { maxBytes: limit }),
            ).toThrow("EVIDENCE_INVALID_CATALOGUE");
            expect(() =>
                parseCatalogue(catalogue(), { maxObjects: limit }),
            ).toThrow("EVIDENCE_INVALID_CATALOGUE");
        }
    });
});
