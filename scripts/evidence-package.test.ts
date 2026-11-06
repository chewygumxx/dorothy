// vim:set expandtab shiftwidth=4 filetype=typescript:
// SPDX-License-Identifier: GPL-3.0-only

//
//
// ~chewygumxx/dorothy.git
// ::: :/scripts/evidence-package.test.ts
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
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { createManifest, verifyManifest } from "./evidence-manifest.js";
import {
    type PackageDeps,
    type PipelineChild,
    packageEvidence,
} from "./evidence-package.js";

const roots: string[] = [];
const digest = (bytes: Buffer | string) =>
    createHash("sha256").update(bytes).digest("hex");
async function fixture() {
    const scratch = await mkdtemp(join(tmpdir(), "dorothy-evidence-package-"));
    roots.push(scratch);
    const root = join(scratch, "stage");
    await mkdir(root);
    await writeFile(join(root, "source ; $(touch nope)"), "source bytes");
    const manifest = await createManifest(root);
    return {
        scratch,
        root,
        options: {
            root,
            expectedSha256: manifest.manifestSha256,
            out: join(scratch, "out"),
            id: "fixture",
            bucket: "fixture-bucket",
            prefix: "evidence/fixture/",
            recipient:
                "age1xtxqx8w5uqkwj830xycgvd7d4qn5lx37d2r5re00mcawqcc5sfjqen28jv",
            partBytes: 4,
        },
    };
}
function processFixture(
    bytes = Buffer.from("cipher-bytes"),
    after?: () => Promise<void>,
): PackageDeps {
    return {
        spawn(argv, stdin) {
            if (argv[0] === "tar") {
                expect(argv).toEqual([
                    "tar",
                    "--create",
                    "--file=-",
                    "--directory",
                    expect.any(String),
                    "--",
                    ".",
                ]);
                expect(stdin).toBeUndefined();
            } else if (argv[0] === "zstd") {
                expect(argv).toEqual([
                    "zstd",
                    "--compress",
                    "--stdout",
                    "--quiet",
                ]);
                expect(stdin).toBeDefined();
            } else {
                expect(argv).toEqual([
                    "age",
                    "--encrypt",
                    "--recipient",
                    "age1xtxqx8w5uqkwj830xycgvd7d4qn5lx37d2r5re00mcawqcc5sfjqen28jv",
                ]);
                expect(stdin).toBeDefined();
            }
            const final = argv[0] === "age";
            return {
                stdout: new ReadableStream({
                    async start(controller) {
                        if (final) {
                            await after?.();
                            controller.enqueue(bytes.subarray(0, 3));
                            controller.enqueue(bytes.subarray(3));
                        }
                        controller.close();
                    },
                }),
                exited: Promise.resolve(0),
                kill() {},
            };
        },
    };
}
afterAll(async () => {
    await Promise.all(
        roots.map((root) => rm(root, { recursive: true, force: true })),
    );
});

describe("evidence packaging", () => {
    it("CLI help is side effect free and rejects malformed options before creating output", async () => {
        const { options, scratch } = await fixture();
        const script = fileURLToPath(
            new URL("./evidence-package.ts", import.meta.url),
        );
        const help = Bun.spawnSync([process.execPath, script, "--help"], {
            stdout: "pipe",
            stderr: "pipe",
        });
        expect(help.exitCode).toBe(0);
        expect(help.stdout.toString()).toContain(
            "Native X25519 recipients only",
        );
        const args = [
            "--root",
            options.root,
            "--expected-sha256",
            options.expectedSha256,
            "--out",
            options.out,
            "--id",
            options.id,
            "--bucket",
            options.bucket,
            "--prefix",
            options.prefix,
            "--recipient",
            options.recipient,
        ];
        for (const suffix of [
            ["--part-bytes", "1e3"],
            ["--max-bytes", "0"],
            ["--unknown", "x"],
            ["--root", options.root],
            ["--part-bytes"],
        ]) {
            const result = Bun.spawnSync(
                [process.execPath, script, ...args, ...suffix],
                { stdout: "pipe", stderr: "pipe" },
            );
            expect(result.exitCode).toBe(1);
            expect(result.stderr.toString().trim()).toBe("EVIDENCE_INCOMPLETE");
            expect(result.stdout.byteLength).toBe(0);
        }
        expect(await readdir(scratch)).toEqual(["stage"]);
    });

    it("packages one ciphertext then splits ordered parts in private fresh output", async () => {
        const { options, root } = await fixture();
        const result = await packageEvidence(options, processFixture());
        const hash = digest("cipher-bytes");
        expect(result.status).toBe("packaged");
        expect(result.cipherSha256).toBe(hash);
        expect(result.cipherBytes).toBe(12);
        expect(result.prefix).toBe(`evidence/fixture/${hash}/`);
        expect(result.catalogueKey).toBe(`${result.prefix}archive.json`);
        expect(result.payloadManifestSha256).toBe(options.expectedSha256);
        expect((await lstat(options.out)).mode & 0o777).toBe(0o700);
        expect((await lstat(join(options.out, "parts"))).mode & 0o777).toBe(
            0o700,
        );
        expect(
            (await lstat(join(options.out, "archive.tar.zst.age"))).mode &
                0o777,
        ).toBe(0o600);
        const parts = await readdir(join(options.out, "parts"));
        expect(parts.sort()).toEqual([
            "part-000.agepart",
            "part-001.agepart",
            "part-002.agepart",
        ]);
        expect(
            Buffer.concat(
                await Promise.all(
                    parts.map((name) =>
                        readFile(join(options.out, "parts", name)),
                    ),
                ),
            ).toString(),
        ).toBe("cipher-bytes");
        expect(
            result.objects.map((object: { bytes: number }) => object.bytes),
        ).toEqual([4, 4, 4]);
        expect(
            JSON.parse(
                await readFile(join(options.out, "archive.json"), "utf8"),
            ),
        ).toEqual(result);
        expect(
            await verifyManifest(root, options.expectedSha256),
        ).toBeDefined();
    });
    it("does not create an empty trailing part at a split boundary", async () => {
        const { options } = await fixture();
        const result = await packageEvidence(
            { ...options, partBytes: 12 },
            processFixture(),
        );
        expect(result.objects.length).toBe(1);
    });
    it("rejects existing output, symlink output and symlinked parents without overwriting", async () => {
        const { options, scratch } = await fixture();
        await writeFile(options.out, "retained");
        await expect(
            packageEvidence(options, processFixture()),
        ).rejects.toThrow();
        expect(await readFile(options.out, "utf8")).toBe("retained");
        const link = join(scratch, "link");
        await symlink(options.out, link);
        await expect(
            packageEvidence({ ...options, out: link }, processFixture()),
        ).rejects.toThrow();
        const alias = join(scratch, "alias");
        await symlink(scratch, alias);
        await expect(
            packageEvidence(
                { ...options, out: join(alias, "new") },
                processFixture(),
            ),
        ).rejects.toThrow();
        expect(await readdir(scratch)).not.toContain("new");
    });
    it("rejects output overlapping staging in either direction before creating output", async () => {
        const { options, root, scratch } = await fixture();
        await expect(
            packageEvidence(
                { ...options, out: join(root, "out") },
                processFixture(),
            ),
        ).rejects.toThrow();
        await expect(
            packageEvidence({ ...options, out: root }, processFixture()),
        ).rejects.toThrow();
        await expect(
            packageEvidence({ ...options, out: scratch }, processFixture()),
        ).rejects.toThrow();
        expect((await readdir(root)).sort()).toEqual([
            "MANIFEST.json",
            "source ; $(touch nope)",
        ]);
    });
    it("validates limits and required options before creating output", async () => {
        const { options, scratch } = await fixture();
        for (const value of [
            0,
            -1,
            1.5,
            Infinity,
            Number.MAX_SAFE_INTEGER + 1,
        ]) {
            await expect(
                packageEvidence({ ...options, partBytes: value }),
            ).rejects.toThrow();
            await expect(
                packageEvidence({ ...options, maxBytes: value }),
            ).rejects.toThrow();
        }
        for (const changed of [
            { recipient: "" },
            { recipient: "AGE-SECRET-KEY-never-accepted" },
            { id: "" },
            { bucket: "" },
            { prefix: "../outside/" },
            { expectedSha256: "bad" },
        ]) {
            await expect(
                packageEvidence({ ...options, ...changed }),
            ).rejects.toThrow();
        }
        expect(await readdir(scratch)).toEqual(["stage"]);
    });
    it("rejects an invalid destination bucket before creating output or invoking processes", async () => {
        const { options, scratch } = await fixture();
        let spawned = 0;
        const deps = processFixture();
        const spawn = deps.spawn as NonNullable<PackageDeps["spawn"]>;
        deps.spawn = (argv, stdin) => {
            spawned++;
            return spawn(argv, stdin);
        };
        await expect(
            packageEvidence({ ...options, bucket: "Archive" }, deps),
        ).rejects.toThrow("EVIDENCE_USAGE");
        expect(spawned).toBe(0);
        expect(await readdir(scratch)).toEqual(["stage"]);
    });
    it("rejects malformed and checksum-invalid native age recipients before creating output", async () => {
        const { options, scratch } = await fixture();
        for (const recipient of [
            "age1syntheticpublic",
            "age1xtxqx8w5uqkwj830xycgvd7d4qn5lx37d2r5re00mcawqcc5sfjqen28jq",
            "ssh-ed25519 AAAA",
        ]) {
            await expect(
                packageEvidence({ ...options, recipient }, processFixture()),
            ).rejects.toThrow("EVIDENCE_USAGE");
        }
        expect(await readdir(scratch)).toEqual(["stage"]);
    });
    it("rejects initial manifest mismatch without creating output", async () => {
        const { options, root, scratch } = await fixture();
        await writeFile(join(root, "source ; $(touch nope)"), "changed");
        await expect(
            packageEvidence(options, processFixture()),
        ).rejects.toThrow("EVIDENCE_MISMATCH");
        expect(await readdir(scratch)).toEqual(["stage"]);
    });
    it("detects stage mutation at second verification and retains source and incomplete output", async () => {
        const { options, root } = await fixture();
        await expect(
            packageEvidence(
                options,
                processFixture(undefined, () =>
                    writeFile(
                        join(root, "source ; $(touch nope)"),
                        "mutated source",
                    ),
                ),
            ),
        ).rejects.toThrow("EVIDENCE_MISMATCH");
        expect(
            await readFile(join(root, "source ; $(touch nope)"), "utf8"),
        ).toBe("mutated source");
        expect(await readdir(options.out)).toContain("archive.tar.zst.age");
        expect(await readdir(options.out)).not.toContain("archive.json");
    });
    it("bounds bytes on disk and leaves partial output when ciphertext exceeds the ceiling", async () => {
        const { options, root } = await fixture();
        await expect(
            packageEvidence({ ...options, maxBytes: 5 }, processFixture()),
        ).rejects.toThrow("EVIDENCE_LIMIT");
        expect(
            (await lstat(join(options.out, "archive.tar.zst.age"))).size,
        ).toBeLessThanOrEqual(5);
        expect(await readdir(options.out)).not.toContain("archive.json");
        expect(
            await verifyManifest(root, options.expectedSha256),
        ).toBeDefined();
    });
    it("accepts ciphertext exactly at the byte ceiling", async () => {
        const { options } = await fixture();
        expect(
            (
                await packageEvidence(
                    { ...options, maxBytes: 12 },
                    processFixture(),
                )
            ).cipherBytes,
        ).toBe(12);
    });
    for (const failing of ["tar", "zstd", "age"]) {
        it(`propagates ${failing} failure even when another process succeeds`, async () => {
            const { options, root } = await fixture();
            const deps = processFixture();
            const spawn = deps.spawn as NonNullable<PackageDeps["spawn"]>;
            deps.spawn = (argv, stdin) => ({
                ...spawn(argv, stdin),
                exited: Promise.resolve(argv[0] === failing ? 7 : 0),
            });
            await expect(packageEvidence(options, deps)).rejects.toThrow(
                "EVIDENCE_PIPELINE",
            );
            expect(await readdir(options.out)).not.toContain("archive.json");
            expect(
                await verifyManifest(root, options.expectedSha256),
            ).toBeDefined();
        });
    }
    it("terminates remaining owned children when an early process fails", async () => {
        const { options } = await fixture();
        let stopped = 0;
        const deps: PackageDeps = {
            spawn(argv): PipelineChild {
                if (argv[0] === "tar")
                    return {
                        stdout: new ReadableStream({
                            start(c) {
                                c.close();
                            },
                        }),
                        exited: Promise.resolve(4),
                        kill() {},
                    };
                let exit!: (code: number) => void;
                return {
                    stdout: new ReadableStream(),
                    exited: new Promise((resolve) => {
                        exit = resolve;
                    }),
                    kill() {
                        stopped++;
                        exit(137);
                    },
                };
            },
        };
        await expect(packageEvidence(options, deps)).rejects.toThrow(
            "EVIDENCE_PIPELINE",
        );
        expect(stopped).toBe(2);
    });
    it("propagates spawn failure and retains source bytes", async () => {
        const { options, root } = await fixture();
        await expect(
            packageEvidence(options, {
                spawn() {
                    throw new Error("EVIDENCE_PIPELINE");
                },
            }),
        ).rejects.toThrow("EVIDENCE_PIPELINE");
        expect(
            await readFile(join(root, "source ; $(touch nope)"), "utf8"),
        ).toBe("source bytes");
        expect(await readdir(options.out)).not.toContain("archive.json");
    });
});
