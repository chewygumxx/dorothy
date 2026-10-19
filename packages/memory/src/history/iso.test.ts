// vim:set expandtab shiftwidth=4 filetype=typescript:
// SPDX-License-Identifier: GPL-3.0-only

//
//
// ~chewygumxx/dorothy.git
// ::: :/packages/memory/src/history/iso.test.ts
//
//

import { afterAll, expect, it, spyOn } from "bun:test";
import { generateKeyPairSync } from "node:crypto";
import { Agent } from "node:https";
import { dirname, join } from "node:path";
import http from "isomorphic-git/http/node";
import { isoRepo } from "./iso.js";
import { Mirror, recover } from "./mirror.js";
import { MAIN } from "./repo.js";
import { bareRepo, put, removeRoots, TEST_ENV, tempRoot } from "./testing.js";

afterAll(removeRoots);

// A throwaway certificate stays in memory. Only this client's CA is changed.
async function certificate() {
    const { privateKey: key } = generateKeyPairSync("rsa", {
        modulusLength: 2048,
        privateKeyEncoding: { type: "pkcs8", format: "pem" },
        publicKeyEncoding: { type: "spki", format: "pem" },
    });
    const process = Bun.spawn(
        [
            "openssl",
            "req",
            "-x509",
            "-new",
            "-key",
            "/dev/stdin",
            "-subj",
            "/CN=127.0.0.1",
            "-addext",
            "subjectAltName=IP:127.0.0.1",
            "-days",
            "1",
        ],
        {
            env: TEST_ENV,
            stdin: new TextEncoder().encode(key),
            stdout: "pipe",
            stderr: "ignore",
        },
    );
    const cert = await new Response(process.stdout).text();
    if ((await process.exited) !== 0)
        throw new Error("fixture certificate failed");
    return { key, cert };
}

it.each([false, true])(
    "pushes and recovers over local HTTPS (authentication: %s)",
    async (authenticated) => {
        const bare = await bareRepo();
        expect(
            Bun.spawnSync(
                [
                    "git",
                    "--git-dir",
                    bare,
                    "config",
                    "http.receivepack",
                    "true",
                ],
                { env: TEST_ENV },
            ).exitCode,
        ).toBe(0);
        const tls = await certificate();
        const seen: string[] = [];
        const server = Bun.serve({
            hostname: "127.0.0.1",
            port: 0,
            tls,
            fetch: async (request) => {
                const url = new URL(request.url);
                seen.push(`${request.method} ${url.pathname}${url.search}`);
                if (
                    authenticated &&
                    request.headers.get("authorization") !==
                        `Basic ${btoa("dorothy:fixture")}`
                ) {
                    return new Response("authentication required", {
                        status: 401,
                        headers: {
                            "WWW-Authenticate": 'Basic realm="fixture"',
                        },
                    });
                }
                const child = Bun.spawn(["git", "http-backend"], {
                    env: {
                        ...TEST_ENV,
                        GIT_PROJECT_ROOT: dirname(bare),
                        GIT_HTTP_EXPORT_ALL: "1",
                        REQUEST_METHOD: request.method,
                        PATH_INFO: url.pathname,
                        QUERY_STRING: url.search.slice(1),
                        CONTENT_TYPE: request.headers.get("content-type") ?? "",
                        REMOTE_USER: "fixture",
                    },
                    stdin: new Uint8Array(await request.arrayBuffer()),
                    stdout: "pipe",
                    stderr: "ignore",
                });
                const bytes = Buffer.from(
                    await new Response(child.stdout).bytes(),
                );
                if ((await child.exited) !== 0)
                    return new Response("backend failed", { status: 500 });
                const split = bytes.indexOf("\r\n\r\n");
                if (split < 0)
                    return new Response("bad CGI response", { status: 500 });
                const headers = new Headers();
                let status = 200;
                for (const line of bytes
                    .subarray(0, split)
                    .toString()
                    .split("\r\n")) {
                    const colon = line.indexOf(":");
                    if (colon < 0) continue;
                    const name = line.slice(0, colon);
                    const value = line.slice(colon + 1).trim();
                    if (name.toLowerCase() === "status")
                        status = Number.parseInt(value, 10);
                    else headers.append(name, value);
                }
                return new Response(bytes.subarray(split + 4), {
                    status,
                    headers,
                });
            },
        });
        const agent = new Agent({ ca: tls.cert });
        const original = http.request;
        const transport = spyOn(http, "request").mockImplementation((request) =>
            original({ ...request, agent }),
        );
        const repo = isoRepo(join(tempRoot(), "source"));
        const key = new Uint8Array(32).fill(9);
        const token = authenticated ? "fixture" : null;
        const url = `https://127.0.0.1:${server.port}/mirror.git`;
        const mirror = new Mirror({
            repo,
            lock: (work) => work(),
            key: () => key,
            token: () => token,
            warn: () => {},
            pushMs: 60000,
        });
        try {
            await repo.init();
            put(repo.root, "note.txt", "one\n");
            await repo.commit(["note.txt"], "one");
            await repo.setRemote("mirror", url);
            expect((await mirror.push()).kind).toBe("pushed");
            put(repo.root, "note.txt", "two\n");
            await repo.commit(["note.txt"], "two");
            expect((await mirror.push()).kind).toBe("pushed");
            const fresh = isoRepo(join(tempRoot(), "recovered"));
            const result = await recover({ repo: fresh, url, key, token });
            expect(result.stopped).toBeNull();
            expect(result.applied).toBe(2);
            expect(result.tip).toBe(await repo.resolve(MAIN));
            expect(
                new TextDecoder().decode(
                    (await fresh.show("note.txt", "HEAD")) ?? undefined,
                ),
            ).toBe("two\n");
            expect(await fresh.resolve(MAIN)).not.toBeNull();
            if (authenticated) {
                await expect(
                    fresh.fetch(url, "sealed", null),
                ).rejects.toThrow();
            }
            const rival = isoRepo(join(tempRoot(), "rival"));
            await rival.init();
            put(rival.root, "other.txt", "another history");
            await rival.commit(["other.txt"], "unrelated");
            await rival.setRemote("mirror", url);
            const rivalMirror = new Mirror({
                repo: rival,
                lock: (work) => work(),
                key: () => key,
                token: () => token,
                warn: () => {},
                pushMs: 60000,
            });
            try {
                expect((await rivalMirror.push()).kind).toBe("failed");
            } finally {
                await rivalMirror.stop();
            }
            expect(seen).toContain("POST /mirror.git/git-receive-pack");
            expect(seen).toContain("POST /mirror.git/git-upload-pack");
            // A bare mirror holds ciphertext only.
            const main = Bun.spawnSync(
                [
                    "git",
                    "--git-dir",
                    bare,
                    "show-ref",
                    "--verify",
                    "refs/heads/main",
                ],
                { env: TEST_ENV, stdout: "ignore", stderr: "ignore" },
            );
            expect(main.exitCode).not.toBe(0);
        } finally {
            await mirror.stop();
            transport.mockRestore();
            agent.destroy();
            await server.stop(true);
        }
    },
);
