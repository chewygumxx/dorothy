// vim:set expandtab shiftwidth=4 filetype=typescript:
// SPDX-License-Identifier: GPL-3.0-only

//
//
// ~chewygumxx/dorothy.git
// ::: :/packages/orchestra/src/net/key-gateway.test.ts
//
//

import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { connect } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
    type GatewayEntry,
    type GatewayOptions,
    PLACEHOLDER_KEY,
    startKeyGateway,
} from "./key-gateway.js";

const KEY = "sk-real-0123456789";

type Seen = {
    method: string;
    path: string;
    headers: Record<string, string>;
    body: string;
};

describe("the key gateway", () => {
    let dir: string;
    let upstream: ReturnType<typeof Bun.serve>;
    let seen: Seen[];
    let log: GatewayEntry[];
    let close: () => Promise<void>;
    let reply: (request: Request) => Response;

    const start = async (options: Partial<GatewayOptions> = {}) => {
        const gateway = await startKeyGateway({
            socket: join(dir, "key.sock"),
            provider: "anthropic",
            key: KEY,
            upstream: `http://127.0.0.1:${upstream.port}`,
            log: (entry) => log.push(entry),
            ...options,
        });
        close = gateway.close;
        return join(dir, "key.sock");
    };

    const send = (path: string, url: string, init: RequestInit = {}) =>
        fetch(`http://box${url}`, { ...init, unix: path } as RequestInit);

    beforeEach(async () => {
        dir = await mkdtemp(join(tmpdir(), "key-gateway-"));
        seen = [];
        log = [];
        reply = () =>
            Response.json({
                id: "msg",
                usage: { input_tokens: 3, output_tokens: 5 },
            });
        upstream = Bun.serve({
            port: 0,
            hostname: "127.0.0.1",
            fetch: async (request) => {
                const url = new URL(request.url);
                seen.push({
                    method: request.method,
                    path: `${url.pathname}${url.search}`,
                    headers: Object.fromEntries(request.headers),
                    body: await request.text(),
                });
                return reply(request);
            },
        });
        close = async () => {};
    });

    afterEach(async () => {
        await close();
        upstream.stop(true);
        await rm(dir, { recursive: true, force: true });
    });

    it("puts the real key in the placeholder's place, and sends the rest on", async () => {
        const path = await start();
        const response = await send(path, "/v1/messages?beta=true", {
            method: "POST",
            headers: {
                "x-api-key": PLACEHOLDER_KEY,
                authorization: `Bearer ${PLACEHOLDER_KEY}`,
                cookie: "session=1",
                "proxy-authorization": "Basic x",
                "anthropic-version": "2023-06-01",
                "content-type": "application/json",
                "accept-encoding": "gzip",
            },
            body: '{"model":"m"}',
        });
        expect(response.status).toBe(200);
        expect(await response.json()).toMatchObject({ id: "msg" });
        const [request] = seen;
        expect(request?.method).toBe("POST");
        expect(request?.path).toBe("/v1/messages?beta=true");
        expect(request?.body).toBe('{"model":"m"}');
        expect(request?.headers["x-api-key"]).toBe(KEY);
        expect(request?.headers["anthropic-version"]).toBe("2023-06-01");
        // The gateway reads usage from the stream, so asks for it plain.
        expect(request?.headers["accept-encoding"]).toBe("identity");
        for (const name of ["authorization", "cookie", "proxy-authorization"]) {
            expect(request?.headers[name]).toBeUndefined();
        }
    });

    it("gives OpenAI its key as a bearer token", async () => {
        const path = await start({ provider: "openai" });
        await send(path, "/v1/responses", {
            method: "POST",
            headers: { authorization: `Bearer ${PLACEHOLDER_KEY}` },
            body: "{}",
        });
        expect(seen[0]?.headers.authorization).toBe(`Bearer ${KEY}`);
        expect(seen[0]?.headers["x-api-key"]).toBeUndefined();
    });

    it("streams a response back whole and in order, and logs its usage", async () => {
        const events = [
            'event: message_start\ndata: {"type":"message_start","message":{"usage":{"input_tokens":10,"output_tokens":1}}}\n\n',
            'event: content_block_delta\ndata: {"type":"content_block_delta","delta":{"text":"hi"}}\n\n',
            'event: message_delta\ndata: {"type":"message_delta","usage":{"output_tokens":7}}\n\n',
        ];
        reply = () =>
            new Response(
                new ReadableStream({
                    async start(controller) {
                        for (const event of events) {
                            controller.enqueue(new TextEncoder().encode(event));
                            await Bun.sleep(10);
                        }
                        controller.close();
                    },
                }),
                { headers: { "content-type": "text/event-stream" } },
            );
        const path = await start();
        const response = await send(path, "/v1/messages", {
            method: "POST",
            body: "{}",
        });
        expect(response.headers.get("content-type")).toBe("text/event-stream");
        expect(await response.text()).toBe(events.join(""));
        await Bun.sleep(20);
        expect(log).toEqual([
            expect.objectContaining({
                method: "POST",
                path: "/v1/messages",
                status: 200,
                usage: { input_tokens: 10, output_tokens: 7 },
            }),
        ]);
    });

    it.each([
        ["a path outside the provider's", "GET", "/v1/files"],
        ["a known path by another method", "GET", "/v1/messages"],
        ["OpenAI's path on Anthropic", "POST", "/v1/responses"],
        ["a path that climbs out", "POST", "/v1/messages/../../admin"],
    ])("refuses %s", async (_, method, url) => {
        const path = await start();
        const response = await send(path, url, {
            method,
            ...(method === "POST" ? { body: "{}" } : {}),
        });
        expect(response.status).toBe(403);
        expect(seen).toEqual([]);
    });

    it("sends an absolute-form request naming another host to the fixed upstream", async () => {
        const path = await start();
        const status = await new Promise<string>((resolve) => {
            const socket = connect({ path });
            socket.on("data", (data) => {
                resolve(data.toString().split("\r\n")[0] ?? "");
                socket.destroy();
            });
            socket.write(
                "GET http://evil.test/v1/models HTTP/1.1\r\nHost: box\r\n\r\n",
            );
        });
        expect(status).toBe("HTTP/1.1 200 OK");
        expect(seen.map(({ path }) => path)).toEqual(["/v1/models"]);
        expect(seen[0]?.headers.host).toBe(`127.0.0.1:${upstream.port}`);
    });

    it("refuses headers past their limit and a body past its", async () => {
        const path = await start({ headerBytes: 1024, bodyBytes: 1024 });
        const big = await send(path, "/v1/models", {
            headers: { "x-pad": "a".repeat(2000) },
        });
        expect(big.status).toBe(431);
        const heavy = await send(path, "/v1/messages", {
            method: "POST",
            body: "a".repeat(4096),
        });
        expect(heavy.status).toBe(413);
        expect(seen).toEqual([]);
    });

    it("answers 502 for a redirect, never following it", async () => {
        reply = () =>
            new Response(null, {
                status: 307,
                headers: { location: "http://elsewhere.test/" },
            });
        const path = await start();
        const response = await send(path, "/v1/models");
        expect(response.status).toBe(502);
        expect(seen).toHaveLength(1);
    });

    it("answers 502 when the upstream cannot be reached", async () => {
        const path = await start({ upstream: "http://127.0.0.1:1" });
        expect((await send(path, "/v1/models")).status).toBe(502);
    });

    it("never logs the key", async () => {
        const path = await start();
        await send(path, "/v1/messages", { method: "POST", body: KEY });
        await send(path, "/v1/files");
        expect(log).toHaveLength(2);
        expect(JSON.stringify(log)).not.toContain(KEY);
    });
});
