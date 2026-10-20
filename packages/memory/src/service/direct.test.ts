// vim:set expandtab shiftwidth=4 filetype=typescript:
// SPDX-License-Identifier: GPL-3.0-only

//
//
// ~chewygumxx/dorothy.git
// ::: :/packages/memory/src/service/direct.test.ts
//
//

import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { clientOf } from "./client.js";
import { directFetch, fetchFor } from "./direct.js";

let server: ReturnType<typeof Bun.serve>;
let asked: { method: string; type: string | null; body: string }[] = [];

beforeEach(() => {
    asked = [];
    server = Bun.serve({
        port: 0,
        hostname: "127.0.0.1",
        fetch: async (request) => {
            const path = new URL(request.url).pathname;
            asked.push({
                method: request.method,
                type: request.headers.get("content-type"),
                body: await request.text(),
            });
            if (path === "/empty") {
                return new Response(null, { status: 204 });
            }
            if (path === "/slow") {
                await Bun.sleep(1000);
            }
            if (path === "/stream") {
                return new Response(
                    new ReadableStream({
                        async start(controller) {
                            controller.enqueue(new TextEncoder().encode("a"));
                            await Bun.sleep(20);
                            controller.enqueue(new TextEncoder().encode("b"));
                            controller.close();
                        },
                    }),
                    { headers: { "x-kind": "stream" } },
                );
            }
            return Response.json({ ok: true }, { status: 201 });
        },
    });
});
afterEach(() => server.stop(true));

const at = (path: string) => `http://127.0.0.1:${server.port}${path}`;

describe("directFetch", () => {
    it("sends the method, headers and body, and gives the answer", async () => {
        const response = await directFetch(new URL(at("/")), {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ a: 1 }),
        });
        expect(response.status).toBe(201);
        expect(await response.json()).toEqual({ ok: true });
        expect(asked).toEqual([
            { method: "POST", type: "application/json", body: '{"a":1}' },
        ]);
    });

    it("streams a body, with its headers", async () => {
        const response = await directFetch(at("/stream"));
        expect(response.headers.get("x-kind")).toBe("stream");
        expect(await response.text()).toBe("ab");
    });

    it("gives no body for a 204", async () => {
        const response = await directFetch(at("/empty"));
        expect(response.status).toBe(204);
        expect(response.body).toBeNull();
    });

    it("stops at its signal", async () => {
        const started = Date.now();
        await expect(
            directFetch(at("/slow"), { signal: AbortSignal.timeout(50) }),
        ).rejects.toThrow();
        expect(Date.now() - started).toBeLessThan(900);
        const aborted = new AbortController();
        aborted.abort();
        await expect(
            directFetch(at("/"), { signal: aborted.signal }),
        ).rejects.toThrow();
    });
});

describe("fetchFor", () => {
    it("goes direct to loopback, localhost and an address listed", () => {
        for (const url of [
            "http://127.0.0.1:5000",
            "http://[::1]:5000",
            "http://localhost:5000",
            "http://100.64.0.1:5000",
            "http://[fd7a::1]:5000",
            "http://memory.lan:5000",
        ]) {
            expect(
                fetchFor(url, ["100.64.0.1", "FD7A:0::1", "memory.lan"]),
            ).toBe(directFetch);
        }
    });

    it("leaves another host, and what is no URL, to fetch and its proxy", () => {
        expect(fetchFor("http://100.64.0.2:5000", ["100.64.0.1"])).toBe(fetch);
        expect(fetchFor("https://memory.example", [])).toBe(fetch);
        expect(fetchFor("nope", [])).toBe(fetch);
    });

    it("takes the addresses the service listens on from its configuration", async () => {
        const home = mkdtempSync(join(tmpdir(), "dorothy-direct-"));
        try {
            mkdirSync(join(home, "config", "dorothy"), { recursive: true });
            writeFileSync(
                join(home, "config", "dorothy", "config.toml"),
                '[service]\nlisten = ["100.64.0.1"]\n',
            );
            const env = { HOME: home, XDG_CONFIG_HOME: join(home, "config") };
            const listed = await clientOf({
                env,
                url: "http://100.64.0.1:5000",
                token: null,
            });
            expect(listed.fetch).toBe(directFetch);
            const other = await clientOf({
                env,
                url: "http://100.64.0.2:5000",
                token: null,
            });
            expect(other.fetch).toBe(fetch);
        } finally {
            rmSync(home, { recursive: true, force: true });
        }
    });
});
