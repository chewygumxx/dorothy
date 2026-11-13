// vim:set expandtab shiftwidth=4 filetype=typescript:
// SPDX-License-Identifier: GPL-3.0-only

//
//
// ~xxdorothy/dorothy.git
// ::: :/scripts/evidence-r2.test.ts
//
//

import { expect, it } from "bun:test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { S3Client, type S3Options } from "bun";
import { createR2Store } from "./evidence-r2.js";

const config = {
    accountId: "a".repeat(32),
    bucket: "test-evidence",
    accessKeyId: "dummy-id",
    secretAccessKey: "dummy-secret",
    maxBytes: 64,
};
it("real Bun S3 adapter signs selected credentials and transfers files through local PUT, HEAD and GET", async () => {
    const root = await mkdtemp(join(tmpdir(), "dorothy-r2-"));
    const objects = new Map<string, Uint8Array<ArrayBuffer>>();
    const calls: string[] = [];
    const server = Bun.serve({
        hostname: "127.0.0.1",
        port: 0,
        async fetch(request) {
            const path = new URL(request.url).pathname;
            calls.push(`${request.method}:${path}`);
            expect(request.headers.get("authorization")).toContain(
                "Credential=dummy-id/",
            );
            expect(request.headers.get("x-amz-security-token")).toBeNull();
            if (request.method === "PUT") {
                objects.set(path, new Uint8Array(await request.arrayBuffer()));
                return new Response("", { headers: { etag: '"synthetic"' } });
            }
            const object = objects.get(path);
            if (!object) return new Response(null, { status: 404 });
            return new Response(request.method === "HEAD" ? null : object, {
                headers: {
                    "content-length": String(object.length),
                    etag: '"synthetic"',
                },
            });
        },
    });
    try {
        let selected: S3Options | undefined;
        const store = createR2Store(config, {
            client(options) {
                selected = options;
                return new S3Client({ ...options, endpoint: server.url.href });
            },
        });
        const source = join(root, "source");
        const destination = join(root, "destination");
        await writeFile(source, "synthetic ciphertext");
        await writeFile(destination, "");
        expect(await store.exists("prefix/part.agepart")).toBe(false);
        await store.put("prefix/part.agepart", source);
        expect(await store.exists("prefix/part.agepart")).toBe(true);
        await store.get("prefix/part.agepart", destination);
        expect(await readFile(destination, "utf8")).toBe(
            "synthetic ciphertext",
        );
        expect(calls).toEqual([
            "HEAD:/test-evidence/prefix/part.agepart",
            "PUT:/test-evidence/prefix/part.agepart",
            "HEAD:/test-evidence/prefix/part.agepart",
            "GET:/test-evidence/prefix/part.agepart",
        ]);
        expect(selected).toEqual({
            bucket: "test-evidence",
            accessKeyId: "dummy-id",
            secretAccessKey: "dummy-secret",
            sessionToken: "",
            endpoint: `https://${config.accountId}.r2.cloudflarestorage.com`,
            region: "auto",
            retry: 0,
            virtualHostedStyle: false,
        });
    } finally {
        server.stop(true);
        await rm(root, { recursive: true, force: true });
    }
});
it("real adapter never retries failing writes and redacts server errors for PUT, HEAD and GET", async () => {
    const root = await mkdtemp(join(tmpdir(), "dorothy-r2-fail-"));
    const calls: string[] = [];
    const server = Bun.serve({
        hostname: "127.0.0.1",
        port: 0,
        fetch(request) {
            calls.push(request.method);
            return new Response(
                "<Error><Code>InternalError</Code><Message>dummy-secret server detail</Message></Error>",
                { status: 500 },
            );
        },
    });
    try {
        const store = createR2Store(config, {
            client: (options) =>
                new S3Client({ ...options, endpoint: server.url.href }),
        });
        const path = join(root, "part");
        await writeFile(path, "cipher");
        for (const action of [
            () => store.put("part", path),
            () => store.exists("part"),
            () => store.get("part", path),
        ]) {
            await expect(action()).rejects.toThrow("EVIDENCE_STORE_FAILED");
        }
        expect(calls).toEqual(["PUT", "HEAD", "GET"]);
    } finally {
        server.stop(true);
        await rm(root, { recursive: true, force: true });
    }
});
it("bounds downloaded bytes across calls and leaves the partial ciphertext", async () => {
    const root = await mkdtemp(join(tmpdir(), "dorothy-r2-bound-"));
    const server = Bun.serve({
        hostname: "127.0.0.1",
        port: 0,
        fetch() {
            return new Response("four");
        },
    });
    try {
        const store = createR2Store(
            { ...config, maxBytes: 6 },
            {
                client: (options) =>
                    new S3Client({ ...options, endpoint: server.url.href }),
            },
        );
        const first = join(root, "first");
        const second = join(root, "second");
        await writeFile(first, "");
        await writeFile(second, "");
        await store.get("first", first);
        await expect(store.get("second", second)).rejects.toThrow(
            "EVIDENCE_STORE_FAILED",
        );
        expect(await readFile(first, "utf8")).toBe("four");
        expect((await readFile(second)).length).toBeLessThanOrEqual(2);
    } finally {
        server.stop(true);
        await rm(root, { recursive: true, force: true });
    }
});
it("cipher byte ceiling allows bounded catalogue metadata larger than a tiny encrypted payload", async () => {
    const root = await mkdtemp(join(tmpdir(), "dorothy-r2-metadata-"));
    let puts = 0;
    const server = Bun.serve({
        hostname: "127.0.0.1",
        port: 0,
        async fetch(request) {
            await request.arrayBuffer();
            puts++;
            return new Response("", { headers: { etag: '"synthetic"' } });
        },
    });
    try {
        const store = createR2Store(
            { ...config, maxBytes: 3 },
            {
                client: (options) =>
                    new S3Client({ ...options, endpoint: server.url.href }),
            },
        );
        const path = join(root, "archive.json");
        await writeFile(path, '{"synthetic":true}');
        await store.put("prefix/archive.json", path);
        expect(puts).toBe(1);
    } finally {
        server.stop(true);
        await rm(root, { recursive: true, force: true });
    }
});
