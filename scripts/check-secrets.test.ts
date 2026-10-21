// vim:set expandtab shiftwidth=4 filetype=typescript:
// SPDX-License-Identifier: GPL-3.0-only

//
//
// ~chewygumxx/dorothy.git
// ::: :/scripts/check-secrets.test.ts
//
//

import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

const script = join(import.meta.dir, "check-secrets.sh");
const privateShape = `AGE-SECRET-KEY-1${"A".repeat(58)}`;
const clean = JSON.stringify({ KEY: "ENC[synthetic ciphertext]", sops: {} });
let root: string;
let env: Record<string, string>;

beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "dorothy-secret-guard-"));
    env = {
        PATH: process.env.PATH ?? "",
        HOME: root,
        XDG_CONFIG_HOME: join(root, "config"),
        XDG_DATA_HOME: join(root, "data"),
        XDG_STATE_HOME: join(root, "state"),
        XDG_CACHE_HOME: join(root, "cache"),
        GIT_CONFIG_NOSYSTEM: "1",
        GIT_CONFIG_GLOBAL: "/dev/null",
    };
    expect((await run(["git", "init", "--quiet"])).code).toBe(0);
});
afterEach(async () => {
    await rm(root, { recursive: true, force: true });
});

async function run(cmd: string[]) {
    const child = Bun.spawn(cmd, {
        cwd: root,
        env,
        stdout: "pipe",
        stderr: "pipe",
        stdin: "ignore",
    });
    const [code, out, err] = await Promise.all([
        child.exited,
        new Response(child.stdout).text(),
        new Response(child.stderr).text(),
    ]);
    return { code, out, err };
}

async function put(file: string, contents: string) {
    await mkdir(dirname(join(root, file)), { recursive: true });
    await writeFile(join(root, file), contents);
}
async function stage(file: string, contents: string) {
    await put(file, contents);
    expect((await run(["git", "add", "--", file])).code).toBe(0);
}
const check = (mode: string) => run(["sh", script, mode]);

for (const mode of ["--tracked", "--staged"]) {
    describe(mode, () => {
        it("accepts encrypted values, sops metadata and prose naming the key prefix", async () => {
            await stage("secrets.json", clean);
            await stage(
                "notes.md",
                "The age private key prefix is AGE-SECRET-KEY-.\n",
            );
            const result = await check(mode);
            expect(result.code).toBe(0);
            expect(result.out).toBe("");
            expect(result.err).toBe("");
        });

        it.each(
            [
                { KEY: "ENC[synthetic]" },
                { KEY: "ENC[synthetic]", sops: null },
                { KEY: "ENC[synthetic]", sops: [] },
                { KEY: "ENC[synthetic]", sops: "wrong" },
                { KEY: "synthetic-plaintext", sops: {} },
                { KEY: 42, sops: {} },
                { KEY: { nested: "ENC[synthetic]" }, sops: {} },
                { KEY: null, sops: {} },
            ].map((value) => ({ value })),
        )(
            "rejects missing metadata or unencrypted top-level values (case %#)",
            async ({ value }) => {
                await stage("nested/secrets.json", JSON.stringify(value));
                const result = await check(mode);
                expect(result.code).not.toBe(0);
                expect(result.err).toContain("nested/secrets.json");
                expect(result.err).toContain("encrypted JSON");
                expect(result.err.includes("synthetic-plaintext")).toBe(false);
                expect(result.out).toBe("");
            },
        );

        it.each(["", "not JSON", "{} {}", "[]"])(
            "rejects an invalid JSON document (case %#)",
            async (contents) => {
                await stage("secrets.json", contents);
                const result = await check(mode);
                expect(result.code).not.toBe(0);
                expect(result.err).toContain("secrets.json");
                expect(result.err).toContain("encrypted JSON");
                expect(result.out).toBe("");
            },
        );

        it.each([
            ".env",
            ".env.example",
            "nested/.env.keys",
            "folder with spaces/name.env",
        ])("rejects an env filename (case %#)", async (file) => {
            await stage(file, "synthetic-plaintext");
            const result = await check(mode);
            expect(result.code).not.toBe(0);
            expect(result.err).toContain(file);
            expect(result.err).toContain("env file");
            expect(result.err.includes("synthetic-plaintext")).toBe(false);
            expect(result.out).toBe("");
        });

        it("rejects a synthetic age key shape without printing it", async () => {
            await stage(
                "notes with spaces\nand newline.txt",
                `prefix\u0000${privateShape}\n`,
            );
            const result = await check(mode);
            expect(result.code).not.toBe(0);
            expect(result.err).toContain("notes with spaces\nand newline.txt");
            expect(result.err).toContain("age private key");
            expect((result.out + result.err).includes(privateShape)).toBe(
                false,
            );
        });

        it("reads a symlink blob without following its private target", async () => {
            await put("untracked-key.txt", privateShape);
            await symlink("untracked-key.txt", join(root, "link.txt"));
            expect((await run(["git", "add", "--", "link.txt"])).code).toBe(0);
            expect((await check(mode)).code).toBe(0);
        });

        it("ignores untracked files", async () => {
            await put(".env", "synthetic-plaintext");
            await put("keys.txt", privateShape);
            expect((await check(mode)).code).toBe(0);
        });
    });
}

it("checks staged blobs even when the working tree has been repaired", async () => {
    await stage(
        "secrets.json",
        JSON.stringify({ KEY: "synthetic-plaintext", sops: {} }),
    );
    await put("secrets.json", clean);
    expect((await check("--staged")).code).not.toBe(0);
    expect((await check("--tracked")).code).toBe(0);
});

it("checks tracked working bytes while keeping a clean staged version", async () => {
    await stage("secrets.json", clean);
    await put(
        "secrets.json",
        JSON.stringify({ KEY: "synthetic-plaintext", sops: {} }),
    );
    expect((await check("--staged")).code).toBe(0);
    expect((await check("--tracked")).code).not.toBe(0);
});

it("ignores staged deletions", async () => {
    await stage(".env", "synthetic-plaintext");
    expect((await run(["git", "rm", "--quiet", "-f", "--", ".env"])).code).toBe(
        0,
    );
    expect((await check("--staged")).code).toBe(0);
});
