// vim:set expandtab shiftwidth=4 filetype=typescript:
// SPDX-License-Identifier: GPL-3.0-only

//
//
// ~xxdorothy/dorothy.git
// ::: :/scripts/evidence-manifest.test.ts
//
//

import { afterAll, describe, expect, it } from "bun:test";
import { createHash } from "node:crypto";
import {
    chmod,
    mkdir,
    mkdtemp,
    open,
    readFile,
    rm,
    symlink,
    unlink,
    writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
    createManifest,
    hashFile,
    verifyManifest,
} from "./evidence-manifest.js";

const roots: string[] = [];
const scratch = async () => {
    const root = await mkdtemp(join(tmpdir(), "dorothy-evidence-manifest-"));
    roots.push(root);
    return root;
};
const digest = (value: string | Buffer) =>
    createHash("sha256").update(value).digest("hex");
const manifestAt = (root: string) => join(root, "MANIFEST.json");
const manualManifest = async (root: string, value: unknown) => {
    const text = JSON.stringify(value);
    await writeFile(manifestAt(root), text);
    return digest(text);
};
const oldFile = {
    type: "file",
    size: 3,
    sha256: "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
    mode: 33152,
    mtimeNs: 1793923200000000000,
};

afterAll(async () => {
    await Promise.all(
        roots.map((root) => rm(root, { recursive: true, force: true })),
    );
});

describe("evidence manifests", () => {
    it("hashes content using SHA-256", async () => {
        const root = await scratch();
        await writeFile(join(root, "file"), "abc");
        expect(await hashFile(join(root, "file"))).toBe(oldFile.sha256);
    });

    it("hashes files larger than a read buffer and counts their exact bytes", async () => {
        const root = await scratch();
        const bytes = Buffer.alloc(131073, 97);
        await writeFile(join(root, "large"), bytes);
        expect(await hashFile(join(root, "large"))).toBe(digest(bytes));
        const created = await createManifest(root);
        expect(created.bytes).toBe(131073);
        expect(await verifyManifest(root, created.manifestSha256)).toEqual(
            created,
        );
    });

    it("counts nested files, directories and links without following targets", async () => {
        const root = await scratch();
        const outside = await scratch();
        await writeFile(join(outside, "private"), "never indexed");
        await mkdir(join(root, "nested", "empty"), { recursive: true });
        await writeFile(join(root, "nested", "雪 ; $(touch nope)"), "abc");
        await writeFile(join(root, "__proto__"), "de");
        await symlink("missing", join(root, "broken"));
        await symlink(outside, join(root, "outward"));
        const summary = await createManifest(root);
        expect(summary).toEqual({
            files: 2,
            directories: 2,
            symlinks: 2,
            bytes: 5,
            manifestSha256: digest(await readFile(manifestAt(root))),
        });
        const manifest = JSON.parse(await readFile(manifestAt(root), "utf8"));
        expect(Object.keys(manifest).sort()).toEqual([
            "__proto__",
            "broken",
            "nested",
            "nested/empty",
            "nested/雪 ; $(touch nope)",
            "outward",
        ]);
        expect(manifest.broken).toMatchObject({
            type: "symlink",
            target: "missing",
        });
        expect(manifest.outward.target).toBe(outside);
        expect(manifest["nested/雪 ; $(touch nope)"]).toMatchObject(
            oldFileWithoutMetadata(),
        );
        expect(manifest["nested/雪 ; $(touch nope)"].mtimeNs).toMatch(/^\d+$/);
        expect(await verifyManifest(root, summary.manifestSha256)).toEqual(
            summary,
        );
    });

    it("accepts old numeric timestamps and ignores restored permission changes", async () => {
        const root = await scratch();
        await writeFile(join(root, "file"), "abc");
        const hash = await manualManifest(root, { file: oldFile });
        await chmod(join(root, "file"), 0o644);
        expect(await verifyManifest(root, hash)).toEqual({
            files: 1,
            directories: 0,
            symlinks: 0,
            bytes: 3,
            manifestSha256: hash,
        });
    });

    it("accepts old directory and link metadata with numeric timestamps", async () => {
        const root = await scratch();
        await mkdir(join(root, "dir"));
        await writeFile(join(root, "dir", "file"), "abc");
        await symlink("dir/file", join(root, "link"));
        const hash = await manualManifest(root, {
            dir: {
                type: "directory",
                mode: 16832,
                mtimeNs: 1793923200000000000,
            },
            "dir/file": oldFile,
            link: {
                type: "symlink",
                mode: 41471,
                mtimeNs: 1793923200000000000,
                target: "dir/file",
            },
        });
        expect(await verifyManifest(root, hash)).toEqual({
            files: 1,
            directories: 1,
            symlinks: 1,
            bytes: 3,
            manifestSha256: hash,
        });
    });

    it("handles empty roots", async () => {
        const root = await scratch();
        const summary = await createManifest(root);
        expect(summary).toMatchObject({
            files: 0,
            directories: 0,
            symlinks: 0,
            bytes: 0,
        });
        expect(await verifyManifest(root, summary.manifestSha256)).toEqual(
            summary,
        );
    });

    for (const change of [
        "content",
        "extra",
        "missing",
        "type",
        "link",
    ] as const) {
        it(`rejects ${change} mutation`, async () => {
            const root = await scratch();
            await writeFile(join(root, "file"), "abc");
            await symlink("file", join(root, "link"));
            const summary = await createManifest(root);
            if (change === "content")
                await writeFile(join(root, "file"), "def");
            if (change === "extra")
                await writeFile(join(root, "extra"), "extra");
            if (change === "missing" || change === "type")
                await unlink(join(root, "file"));
            if (change === "type") await mkdir(join(root, "file"));
            if (change === "link") {
                await unlink(join(root, "link"));
                await symlink("elsewhere", join(root, "link"));
            }
            await expect(
                verifyManifest(root, summary.manifestSha256),
            ).rejects.toThrow("EVIDENCE_MISMATCH");
        });
    }

    it("rejects a wrong manifest hash", async () => {
        const root = await scratch();
        await createManifest(root);
        await expect(verifyManifest(root, "0".repeat(64))).rejects.toThrow(
            "EVIDENCE_HASH_MISMATCH",
        );
    });

    for (const name of [
        "/absolute",
        "../escape",
        "dir/../escape",
        "dir//file",
        "./file",
        "MANIFEST.json",
    ]) {
        it(`rejects unsafe manifest entry ${name}`, async () => {
            const root = await scratch();
            const hash = await manualManifest(root, { [name]: oldFile });
            await expect(verifyManifest(root, hash)).rejects.toThrow(
                "EVIDENCE_INVALID_MANIFEST",
            );
        });
    }

    it("rejects file entries under symlink parents", async () => {
        const root = await scratch();
        const outside = await scratch();
        await writeFile(join(outside, "file"), "abc");
        await symlink(outside, join(root, "parent"));
        const hash = await manualManifest(root, {
            parent: {
                type: "symlink",
                target: outside,
                mode: 41471,
                mtimeNs: 0,
            },
            "parent/file": oldFile,
        });
        await expect(verifyManifest(root, hash)).rejects.toThrow(
            "EVIDENCE_INVALID_MANIFEST",
        );
    });

    it("does not hash a final symlink or a file under a symlink parent", async () => {
        const root = await scratch();
        const outside = await scratch();
        await writeFile(join(outside, "file"), "abc");
        await symlink(outside, join(root, "parent"));
        await symlink(join(outside, "file"), join(root, "link"));
        await expect(hashFile(join(root, "link"))).rejects.toThrow(
            "EVIDENCE_UNSAFE_PATH",
        );
        await expect(hashFile(join(root, "parent", "file"))).rejects.toThrow(
            "EVIDENCE_UNSAFE_PATH",
        );
    });

    it("refuses symlink roots and ancestors", async () => {
        const root = await scratch();
        const target = await scratch();
        await mkdir(join(target, "nested"));
        await symlink(target, join(root, "alias"));
        await expect(createManifest(join(root, "alias"))).rejects.toThrow(
            "EVIDENCE_UNSAFE_PATH",
        );
        await expect(
            createManifest(join(root, "alias", "nested")),
        ).rejects.toThrow("EVIDENCE_UNSAFE_PATH");
    });

    for (const kind of ["file", "symlink", "directory"]) {
        it(`does not overwrite an existing ${kind} manifest`, async () => {
            const root = await scratch();
            const marker = join(root, "marker");
            await writeFile(marker, "keep");
            if (kind === "file") await writeFile(manifestAt(root), "keep");
            if (kind === "directory") await mkdir(manifestAt(root));
            if (kind === "symlink") await symlink(marker, manifestAt(root));
            await expect(createManifest(root)).rejects.toThrow(
                "EVIDENCE_EXISTS",
            );
            expect(await readFile(marker, "utf8")).toBe("keep");
            if (kind === "file")
                expect(await readFile(manifestAt(root), "utf8")).toBe("keep");
        });
    }

    it("refuses a symlink manifest on verification", async () => {
        const root = await scratch();
        const outside = await scratch();
        await writeFile(join(outside, "manifest"), "{}");
        await symlink(join(outside, "manifest"), manifestAt(root));
        await expect(verifyManifest(root, digest("{}"))).rejects.toThrow(
            "EVIDENCE_UNSAFE_PATH",
        );
    });

    it("rejects special files before opening them", async () => {
        const root = await scratch();
        expect(Bun.spawnSync(["mkfifo", join(root, "pipe")]).exitCode).toBe(0);
        await expect(createManifest(root)).rejects.toThrow(
            "EVIDENCE_SPECIAL_FILE",
        );
        const hash = await manualManifest(root, { pipe: oldFile });
        await expect(verifyManifest(root, hash)).rejects.toThrow(
            "EVIDENCE_SPECIAL_FILE",
        );
    });

    it("detects file changes between stat and opening, without creating a manifest", async () => {
        const root = await scratch();
        const file = join(root, "file");
        await writeFile(file, "abc");
        const io = {
            open: (async (...args: Parameters<typeof open>) => {
                await writeFile(file, "abcdef");
                return open(...args);
            }) as typeof open,
        };
        await expect(createManifest(root, io)).rejects.toThrow(
            "EVIDENCE_CHANGED",
        );
        expect(await Bun.file(manifestAt(root)).exists()).toBe(false);
    });

    it("detects changes after reading through the same open handle", async () => {
        const root = await scratch();
        const file = join(root, "file");
        await writeFile(file, "abc");
        const io = {
            open: (async (...args: Parameters<typeof open>) => {
                const handle = await open(...args);
                const read = handle.read.bind(handle);
                handle.read = (async (...readArgs: Parameters<typeof read>) => {
                    const result = await read(...readArgs);
                    await writeFile(file, "def");
                    return result;
                }) as typeof handle.read;
                return handle;
            }) as typeof open,
        };
        await expect(hashFile(file, io)).rejects.toThrow("EVIDENCE_CHANGED");
    });

    it("rechecks earlier files after walking later files", async () => {
        const root = await scratch();
        const first = join(root, "a");
        const second = join(root, "b");
        await writeFile(first, "abc");
        await writeFile(second, "abc");
        const io = {
            open: (async (...args: Parameters<typeof open>) => {
                if (args[0] === second) await writeFile(first, "def");
                return open(...args);
            }) as typeof open,
        };
        await expect(createManifest(root, io)).rejects.toThrow(
            "EVIDENCE_CHANGED",
        );
        expect(await Bun.file(manifestAt(root)).exists()).toBe(false);
    });

    it("prints JSON success and code-only failures; help creates nothing", async () => {
        const root = await scratch();
        const run = (...args: string[]) =>
            Bun.spawnSync(
                [
                    process.execPath,
                    join(import.meta.dir, "evidence-manifest.ts"),
                    ...args,
                ],
                { cwd: root },
            );
        expect(run("--help").exitCode).toBe(0);
        expect(await Bun.file(manifestAt(root)).exists()).toBe(false);
        const created = run("create", "--root", root);
        expect(created.exitCode).toBe(0);
        const summary = JSON.parse(created.stdout.toString());
        expect(
            run(
                "verify",
                "--root",
                root,
                "--expected-sha256",
                summary.manifestSha256,
            ).exitCode,
        ).toBe(0);
        const failed = run(
            "verify",
            "--root",
            root,
            "--expected-sha256",
            "0".repeat(64),
        );
        expect(failed.exitCode).not.toBe(0);
        expect(failed.stdout.toString()).toBe("");
        expect(failed.stderr.toString()).toMatch(/^EVIDENCE_[A-Z_]+\n$/);
        expect(run("create", "--root", root, "--unknown").exitCode).not.toBe(0);
    });
});

function oldFileWithoutMetadata() {
    return { type: oldFile.type, size: oldFile.size, sha256: oldFile.sha256 };
}
