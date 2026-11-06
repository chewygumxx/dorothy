// vim:set expandtab shiftwidth=4 filetype=typescript:
// SPDX-License-Identifier: GPL-3.0-only

//
//
// ~chewygumxx/dorothy.git
// ::: :/scripts/evidence-transfer.test.ts
//
//

import { afterAll, describe, expect, it } from "bun:test";
import { createHash } from "node:crypto";
import {
    lstat,
    mkdir,
    mkdtemp,
    readdir,
    readFile,
    rm,
    symlink,
    writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { loadSecrets } from "../packages/core/src/secrets.js";
import {
    downloadEvidence,
    type TransferDeps,
    uploadEvidence,
} from "./evidence-transfer.js";

const roots: string[] = [];
const sha = (text: string) => createHash("sha256").update(text).digest("hex");
const accountId = "a".repeat(32);
async function fixture() {
    const root = await mkdtemp(join(tmpdir(), "dorothy-transfer-"));
    roots.push(root);
    const directory = join(root, "parts");
    await mkdir(directory);
    await writeFile(join(directory, "part-000.agepart"), "cipher");
    await writeFile(join(directory, "part-001.agepart"), "bytes");
    const catalogue = {
        schemaVersion: 1,
        archiveId: "synthetic-pi",
        bucket: "test-evidence",
        prefix: "pi/evidence/",
        format: "age+zstd+tar",
        cipherSha256: sha("cipherbytes").toUpperCase(),
        cipherBytes: 11,
        payloadManifestSha256: "a".repeat(64),
        storageClass: "Standard",
        payloadSummary: {
            files: 2,
            symlinks: 0,
            directories: 1,
            bytes: 11,
            sqliteCandidates: 0,
            sqliteSuccessfulBackups: 0,
            sqliteFailures: [],
            manifestSha256: "a".repeat(64),
            knownSecretMatches: 0,
            placeholderMatchFiles: 0,
            originalsRetained: true,
        },
        productCommit: "b".repeat(40),
        access: "Private synthetic fixture",
        originalsRetained: true,
        independentBackup: "Outstanding synthetic fixture",
        budget: {
            monthlyTargetUsd: 5,
            providerHardCap: false,
            alerts: { thresholdsUsd: [2, 5], status: "synthetic" },
            captureMaxCipherBytes: 4294967296,
            captureMaxLogicalObjectCommands: 100,
        },
        restoreVerification: {
            source: "synthetic ciphertext only",
            ownershipAndPrivilegeRestoration: false,
        },
        storageProtection: {
            r2DevPublicAccess: false,
            customDomains: [],
            completedObjectExpiration: false,
            prefixLock: "synthetic",
            location: "OC",
        },
        originalArchive: { retained: true },
        objects: [
            {
                key: "pi/evidence/part-000.agepart",
                bytes: 6,
                sha256: sha("cipher").toUpperCase(),
            },
            {
                key: "pi/evidence/part-001.agepart",
                bytes: 5,
                sha256: sha("bytes"),
            },
        ],
    };
    const cataloguePath = join(root, "trusted.json");
    const text = `${JSON.stringify(catalogue, null, 3)}\n`;
    await writeFile(cataloguePath, text);
    const calls: string[] = [];
    const stored = new Map<string, string>();
    let loaded = 0;
    const deps: TransferDeps = {
        env: {},
        load: async (_path, env) => {
            loaded++;
            env.CLOUDFLARE_R2_ACCESS_KEY_ID = "dummy-id";
            env.CLOUDFLARE_R2_SECRET_ACCESS_KEY = "dummy-secret";
            return null;
        },
        store: () => ({
            async exists(key) {
                calls.push(`exists:${key}`);
                return stored.has(key);
            },
            async put(key, path) {
                calls.push(`put:${key}`);
                stored.set(key, await readFile(path, "utf8"));
            },
            async get(key, path) {
                calls.push(`get:${key}`);
                await writeFile(path, stored.get(key) ?? "wrong");
            },
        }),
    };
    return {
        root,
        directory,
        catalogue,
        cataloguePath,
        text,
        calls,
        stored,
        deps,
        makeStore: deps.store as NonNullable<TransferDeps["store"]>,
        loaded: () => loaded,
        options: {
            catalogue: cataloguePath,
            directory,
            accountId,
            bucket: "test-evidence",
        },
        download: {
            catalogue: cataloguePath,
            out: join(root, "download"),
            accountId,
            bucket: "test-evidence",
        },
    };
}
afterAll(async () => {
    await Promise.all(
        roots.map((root) => rm(root, { recursive: true, force: true })),
    );
});

describe("scoped evidence transfer", () => {
    it("preflights every key before uploading ordered parts and exact catalogue bytes", async () => {
        const f = await fixture();
        const result = await uploadEvidence(f.options, f.deps);
        expect(result).toEqual({ status: "uploaded", operations: 6 });
        expect(f.calls).toEqual([
            "exists:pi/evidence/part-000.agepart",
            "exists:pi/evidence/part-001.agepart",
            "exists:pi/evidence/archive.json",
            "put:pi/evidence/part-000.agepart",
            "put:pi/evidence/part-001.agepart",
            "put:pi/evidence/archive.json",
        ]);
        expect(f.stored.get("pi/evidence/archive.json")).toBe(f.text);
    });
    it("rejects account, bucket and limits before loading keys", async () => {
        for (const change of [
            { accountId: "bad" },
            { bucket: "other" },
            { bucket: "" },
            { maxOperations: 5 },
            { maxOperations: 0 },
            { maxBytes: 10 },
        ]) {
            const f = await fixture();
            await expect(
                uploadEvidence({ ...f.options, ...change }, f.deps),
            ).rejects.toThrow();
            expect(f.loaded()).toBe(0);
            expect(f.calls).toEqual([]);
        }
    });
    it("rejects malformed catalogue, wrong part size/hash and wrong joined cipher before keys", async () => {
        for (const change of ["json", "size", "part", "joined", "collision"]) {
            const f = await fixture();
            if (change === "json") await writeFile(f.cataloguePath, "{}");
            if (change === "size")
                await writeFile(
                    join(f.directory, "part-001.agepart"),
                    "changed",
                );
            if (change === "part")
                await writeFile(join(f.directory, "part-001.agepart"), "WRONG");
            if (change === "joined") {
                f.catalogue.cipherSha256 = "0".repeat(64);
                await writeFile(f.cataloguePath, JSON.stringify(f.catalogue));
            }
            if (change === "collision") {
                const object = f.catalogue.objects[0];
                if (!object) throw new Error("missing fixture object");
                object.key = "pi/evidence/archive.json";
                await writeFile(f.cataloguePath, JSON.stringify(f.catalogue));
            }
            await expect(uploadEvidence(f.options, f.deps)).rejects.toThrow();
            expect(f.loaded()).toBe(0);
            expect(f.calls).toEqual([]);
        }
    });
    it("rejects symlinked catalogue, part and parent before keys", async () => {
        for (const kind of ["catalogue", "part", "parent"]) {
            const f = await fixture();
            if (kind === "catalogue") {
                const alias = join(f.root, "alias");
                await symlink(f.cataloguePath, alias);
                f.options.catalogue = alias;
            }
            if (kind === "part") {
                await rm(join(f.directory, "part-001.agepart"));
                await symlink(
                    f.cataloguePath,
                    join(f.directory, "part-001.agepart"),
                );
            }
            if (kind === "parent") {
                const alias = join(f.root, "alias");
                await symlink(f.directory, alias);
                f.options.directory = alias;
            }
            await expect(uploadEvidence(f.options, f.deps)).rejects.toThrow();
            expect(f.loaded()).toBe(0);
        }
    });
    it("stops missing and failed secrets before all store calls and redacts thrown messages", async () => {
        for (const load of [
            async () => null,
            async () => "SOPS_FAILED" as const,
            async () => {
                throw new Error("dummy-secret SDK details");
            },
        ]) {
            const f = await fixture();
            let constructed = false;
            await expect(
                uploadEvidence(f.options, {
                    ...f.deps,
                    load,
                    store: () => {
                        constructed = true;
                        throw new Error("unsafe");
                    },
                }),
            ).rejects.toThrow("EVIDENCE_CREDENTIALS");
            expect(constructed).toBe(false);
            expect(f.calls).toEqual([]);
        }
    });
    it("uses a fresh map, core precedence and only selected R2 credentials in client configuration", async () => {
        const f = await fixture();
        const secrets = join(f.root, "synthetic-secrets.json");
        await writeFile(secrets, "synthetic ciphertext");
        const env = {
            CLOUDFLARE_R2_ACCESS_KEY_ID: "environment-id",
            CLOUDFLARE_R2_SECRET_ACCESS_KEY: "",
            UNRELATED: "unrelated environment",
        };
        let config: unknown;
        await uploadEvidence(
            { ...f.options, secrets },
            {
                ...f.deps,
                env,
                load: (path, into) =>
                    loadSecrets(path, into, async () => ({
                        exitCode: 0,
                        stdout: JSON.stringify({
                            CLOUDFLARE_R2_ACCESS_KEY_ID: "file-id",
                            CLOUDFLARE_R2_SECRET_ACCESS_KEY: "file-secret",
                            OAUTH_TOKEN: "not selected",
                        }),
                    })),
                store: (value) => {
                    config = value;
                    return f.makeStore(value);
                },
            },
        );
        expect(config).toEqual({
            accountId,
            bucket: "test-evidence",
            accessKeyId: "environment-id",
            secretAccessKey: "file-secret",
            maxBytes: 4 * 1024 ** 3,
        });
        expect(env).toEqual({
            CLOUDFLARE_R2_ACCESS_KEY_ID: "environment-id",
            CLOUDFLARE_R2_SECRET_ACCESS_KEY: "",
            UNRELATED: "unrelated environment",
        });
    });
    it("refuses an existing remote key without performing any put", async () => {
        const f = await fixture();
        f.stored.set("pi/evidence/archive.json", "retained");
        await expect(uploadEvidence(f.options, f.deps)).rejects.toThrow(
            "EVIDENCE_REMOTE_EXISTS",
        );
        expect(f.calls.filter((call) => call.startsWith("put:"))).toEqual([]);
        expect(f.stored.get("pi/evidence/archive.json")).toBe("retained");
    });
    it("never retries a failed put and withholds the catalogue after partial upload", async () => {
        const f = await fixture();
        const store = f.makeStore({
            accountId,
            bucket: "test-evidence",
            accessKeyId: "dummy",
            secretAccessKey: "dummy",
            maxBytes: 100,
        });
        const put = store.put;
        store.put = async (key, path) => {
            await put(key, path);
            if (key.endsWith("001.agepart")) throw new Error("dummy-secret");
        };
        await expect(
            uploadEvidence(f.options, { ...f.deps, store: () => store }),
        ).rejects.toThrow("EVIDENCE_UPLOAD_INCOMPLETE");
        expect(f.calls.filter((call) => call.startsWith("put:"))).toHaveLength(
            2,
        );
        expect(f.stored.has("pi/evidence/archive.json")).toBe(false);
    });
    it("downloads only listed parts into private fresh output and verifies joined cipher", async () => {
        const f = await fixture();
        f.stored.set("pi/evidence/part-000.agepart", "cipher");
        f.stored.set("pi/evidence/part-001.agepart", "bytes");
        expect(
            await downloadEvidence(
                { ...f.download, maxOperations: 2, maxBytes: 11 },
                f.deps,
            ),
        ).toEqual({ status: "downloaded", operations: 2 });
        expect(f.calls).toEqual([
            "get:pi/evidence/part-000.agepart",
            "get:pi/evidence/part-001.agepart",
        ]);
        expect((await lstat(f.download.out)).mode & 0o777).toBe(0o700);
        expect(
            await readFile(join(f.download.out, "archive.json"), "utf8"),
        ).toBe(f.text);
        expect(
            await readFile(join(f.download.out, "archive.tar.zst.age"), "utf8"),
        ).toBe("cipherbytes");
        for (const name of await readdir(f.download.out))
            expect((await lstat(join(f.download.out, name))).mode & 0o777).toBe(
                0o600,
            );
    });
    it("rejects existing download output and bad selection/limits before keys", async () => {
        for (const change of [
            { maxOperations: 1 },
            { accountId: "bad" },
            { bucket: "other" },
            { out: "existing" },
        ]) {
            const f = await fixture();
            const options = { ...f.download, ...change };
            if (change.out) {
                options.out = join(f.root, "existing");
                await mkdir(options.out);
            }
            await expect(downloadEvidence(options, f.deps)).rejects.toThrow();
            expect(f.loaded()).toBe(0);
            expect(f.calls).toEqual([]);
        }
    });
    it("retains partial output without success catalogue after failed get, wrong bytes or joined hash", async () => {
        for (const mode of ["get", "bytes", "joined"]) {
            const f = await fixture();
            f.stored.set("pi/evidence/part-000.agepart", "cipher");
            f.stored.set(
                "pi/evidence/part-001.agepart",
                mode === "bytes" ? "WRONG" : "bytes",
            );
            if (mode === "joined") {
                f.catalogue.cipherSha256 = "0".repeat(64);
                await writeFile(f.cataloguePath, JSON.stringify(f.catalogue));
            }
            const store = f.makeStore({
                accountId,
                bucket: "test-evidence",
                accessKeyId: "dummy",
                secretAccessKey: "dummy",
                maxBytes: 100,
            });
            const get = store.get;
            if (mode === "get")
                store.get = async (key, path) => {
                    if (basename(key).includes("001"))
                        throw new Error("dummy-secret");
                    await get(key, path);
                };
            await expect(
                downloadEvidence(f.download, { ...f.deps, store: () => store }),
            ).rejects.toThrow("EVIDENCE_DOWNLOAD_INCOMPLETE");
            expect(await readdir(f.download.out)).not.toContain("archive.json");
        }
    });
});

it("CLI requires explicit account/bucket, rejects malformed arguments and reports only safe codes", async () => {
    const f = await fixture();
    const script = new URL("./evidence-transfer.ts", import.meta.url).pathname;
    const help = Bun.spawnSync([process.execPath, script, "--help"], {
        env: {},
        stdout: "pipe",
        stderr: "pipe",
    });
    expect(help.exitCode).toBe(0);
    expect(help.stdout.toString()).toContain("--bucket <bucket>");
    for (const mode of ["upload", "download"]) {
        const specific =
            mode === "upload"
                ? ["--directory", f.directory]
                : ["--out", f.download.out];
        const required = [mode, "--catalogue", f.cataloguePath, ...specific];
        for (const suffix of [
            [],
            ["--bucket", "test-evidence"],
            ["--account-id", accountId],
            [
                "--account-id",
                accountId,
                "--bucket",
                "test-evidence",
                "--max-operations",
                "1e3",
            ],
            ["--unknown", "x"],
            ["--secrets"],
        ]) {
            const result = Bun.spawnSync(
                [process.execPath, script, ...required, ...suffix],
                { env: {}, stdout: "pipe", stderr: "pipe" },
            );
            expect(result.exitCode).toBe(1);
            expect(result.stdout.byteLength).toBe(0);
            expect(JSON.parse(result.stderr.toString())).toEqual({
                code: "EVIDENCE_USAGE",
                operations: 0,
            });
        }
    }
    const missing = Bun.spawnSync(
        [
            process.execPath,
            script,
            "upload",
            "--catalogue",
            f.cataloguePath,
            "--directory",
            f.directory,
            "--account-id",
            accountId,
            "--bucket",
            "test-evidence",
            "--secrets",
            join(f.root, "missing-secrets.json"),
        ],
        { env: {}, stdout: "pipe", stderr: "pipe" },
    );
    expect(missing.exitCode).toBe(1);
    expect(JSON.parse(missing.stderr.toString())).toEqual({
        code: "EVIDENCE_CREDENTIALS",
        operations: 0,
    });
});
it("default operation ceiling rejects a whole large plan before file lookup or credentials", async () => {
    const f = await fixture();
    const catalogue = {
        ...f.catalogue,
        cipherBytes: 50,
        objects: Array.from({ length: 50 }, (_, i) => ({
            key: `pi/evidence/part-${i}.agepart`,
            bytes: 1,
            sha256: "a".repeat(64),
        })),
    };
    await writeFile(f.cataloguePath, JSON.stringify(catalogue));
    await expect(uploadEvidence(f.options, f.deps)).rejects.toThrow(
        "EVIDENCE_LIMIT",
    );
    expect(f.loaded()).toBe(0);
    expect(f.calls).toEqual([]);
});
it("rejects oversized catalogue metadata and alias download parents before credentials", async () => {
    const f = await fixture();
    await writeFile(f.cataloguePath, " ".repeat(1024 ** 2 + 1));
    await expect(uploadEvidence(f.options, f.deps)).rejects.toThrow(
        "EVIDENCE_INVALID_CATALOGUE",
    );
    await writeFile(f.cataloguePath, f.text);
    const alias = join(f.root, "alias");
    await symlink(f.root, alias);
    await expect(
        downloadEvidence({ ...f.download, out: join(alias, "out") }, f.deps),
    ).rejects.toThrow("EVIDENCE_UNSAFE_PATH");
    expect(f.loaded()).toBe(0);
    expect(f.calls).toEqual([]);
});
it("stops before upload when a secret loader changes validated input", async () => {
    const f = await fixture();
    const load = f.deps.load;
    await expect(
        uploadEvidence(f.options, {
            ...f.deps,
            load: async (path, into) => {
                await writeFile(join(f.directory, "part-001.agepart"), "WRONG");
                return load ? load(path, into) : null;
            },
        }),
    ).rejects.toThrow("EVIDENCE_HASH_MISMATCH");
    expect(f.calls.filter((call) => call.startsWith("put:"))).toEqual([]);
});
it("withholds catalogue or changed part if local input mutates during an earlier upload", async () => {
    for (const kind of ["catalogue", "part"]) {
        const f = await fixture();
        const store = f.makeStore({
            accountId,
            bucket: "test-evidence",
            accessKeyId: "dummy",
            secretAccessKey: "dummy",
            maxBytes: 100,
        });
        const put = store.put;
        store.put = async (key, path) => {
            await put(key, path);
            if (key.endsWith("000.agepart"))
                await writeFile(
                    kind === "catalogue"
                        ? f.cataloguePath
                        : join(f.directory, "part-001.agepart"),
                    kind === "catalogue" ? "changed catalogue" : "WRONG",
                );
        };
        await expect(
            uploadEvidence(f.options, { ...f.deps, store: () => store }),
        ).rejects.toThrow();
        expect(f.stored.has("pi/evidence/archive.json")).toBe(false);
        if (kind === "part")
            expect(f.stored.has("pi/evidence/part-001.agepart")).toBe(false);
    }
});
