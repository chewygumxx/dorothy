// vim:set expandtab shiftwidth=4 filetype=typescript:
// SPDX-License-Identifier: GPL-3.0-only

//
//
// ~chewygumxx/dorothy.git
// ::: :/packages/gateway/src/server.test.ts
//
//

import { afterEach, describe, expect, it } from "bun:test";
import { identityPrompt } from "@dorothy/identity";
import { MARKER } from "./anthropic.js";
import {
    DEFAULT_UPSTREAM,
    type Gateway,
    startGateway,
    upstreamFrom,
} from "./server.js";

type Seen = {
    method: string;
    path: string;
    headers: Headers;
    body: string;
};

// The API's stand-in: records what reaches it and answers as told.
function standIn(
    reply: (seen: Seen) => Response | Promise<Response> = () =>
        Response.json({ ok: true }),
) {
    const seen: Seen[] = [];
    const server = Bun.serve({
        hostname: "127.0.0.1",
        port: 0,
        idleTimeout: 0,
        async fetch(request) {
            const url = new URL(request.url);
            const entry = {
                method: request.method,
                path: url.pathname + url.search,
                headers: request.headers,
                body: await request.text(),
            };
            seen.push(entry);
            return reply(entry);
        },
    });
    return {
        url: `http://127.0.0.1:${server.port}`,
        seen,
        stop: () => server.stop(true),
    };
}

const marked = JSON.stringify({
    system: [
        { type: "text", text: "You are Claude Code." },
        {
            type: "text",
            text: `Rules.\n\n${MARKER}`,
        },
    ],
    messages: [{ role: "user", content: "hi" }],
});

let upstream: ReturnType<typeof standIn> | undefined;
let gateway: Gateway | undefined;

afterEach(() => {
    gateway?.stop();
    upstream?.stop();
});

describe("upstreamFrom", () => {
    it("takes the user's base URL, or Anthropic's", () => {
        expect(upstreamFrom({})).toBe(DEFAULT_UPSTREAM);
        expect(upstreamFrom({ ANTHROPIC_BASE_URL: "" })).toBe(
            "https://api.anthropic.com",
        );
        expect(upstreamFrom({ ANTHROPIC_BASE_URL: "http://proxy/x" })).toBe(
            "http://proxy/x",
        );
    });
});

describe("startGateway", () => {
    it("listens on loopback", () => {
        upstream = standIn();
        gateway = startGateway({ upstream: upstream.url });
        expect(gateway.url).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/);
    });

    it("injects the identity, headers untouched but for the hop", async () => {
        upstream = standIn();
        gateway = startGateway({ upstream: upstream.url });
        const reply = await fetch(`${gateway.url}/v1/messages?beta=true`, {
            method: "POST",
            headers: {
                authorization: "Bearer test-token",
                "anthropic-beta": "oauth-2025-04-20",
                "content-type": "application/json",
                "accept-encoding": "gzip",
            },
            body: marked,
        });
        expect(await reply.json()).toEqual({ ok: true });
        const [request] = upstream.seen;
        expect(request?.path).toBe("/v1/messages?beta=true");
        expect(request?.headers.get("authorization")).toBe("Bearer test-token");
        expect(request?.headers.get("anthropic-beta")).toBe("oauth-2025-04-20");
        expect(JSON.parse(request?.body ?? "").system).toEqual([
            { type: "text", text: "You are Claude Code." },
            { type: "text", text: identityPrompt() },
            { type: "text", text: "Rules." },
        ]);
        expect(gateway.stats).toEqual({ injected: 1, drift: 0 });
    });

    it("forwards an unmarked request byte for byte", async () => {
        upstream = standIn();
        gateway = startGateway({ upstream: upstream.url });
        const body = '{ "system": "Rules.",  "messages": [] }';
        await fetch(`${gateway.url}/v1/messages`, { method: "POST", body });
        expect(upstream.seen[0]?.body).toBe(body);
        expect(gateway.stats).toEqual({ injected: 0, drift: 0 });
    });

    it("rewrites a gzipped request and sends it plain", async () => {
        upstream = standIn();
        gateway = startGateway({ upstream: upstream.url });
        await fetch(`${gateway.url}/v1/messages`, {
            method: "POST",
            headers: { "content-encoding": "gzip" },
            body: Bun.gzipSync(new TextEncoder().encode(marked)),
        });
        const [request] = upstream.seen;
        expect(request?.headers.get("content-encoding")).toBeNull();
        expect(JSON.parse(request?.body ?? "").system[1].text).toBe(
            identityPrompt(),
        );
    });

    it("rewrites count_tokens, and passes other paths through", async () => {
        upstream = standIn();
        gateway = startGateway({ upstream: upstream.url });
        await fetch(`${gateway.url}/v1/messages/count_tokens`, {
            method: "POST",
            body: marked,
        });
        await fetch(`${gateway.url}/v1/models?limit=1`);
        await fetch(`${gateway.url}/v1/other`, {
            method: "POST",
            body: marked,
        });
        expect(upstream.seen.map((s) => [s.method, s.path])).toEqual([
            ["POST", "/v1/messages/count_tokens"],
            ["GET", "/v1/models?limit=1"],
            ["POST", "/v1/other"],
        ]);
        expect(upstream.seen[0]?.body).toContain(identityPrompt());
        expect(upstream.seen[2]?.body).toBe(marked);
    });

    it("keeps the upstream's path prefix", async () => {
        upstream = standIn();
        gateway = startGateway({ upstream: `${upstream.url}/proxy/` });
        await fetch(`${gateway.url}/v1/messages`, {
            method: "POST",
            body: "{}",
        });
        expect(upstream.seen[0]?.path).toBe("/proxy/v1/messages");
    });

    it("streams a reply as it comes, through a long pause", async () => {
        let release = () => {};
        const held = new Promise<void>((resolve) => {
            release = resolve;
        });
        upstream = standIn(
            () =>
                new Response(
                    new ReadableStream({
                        async start(controller) {
                            controller.enqueue(
                                new TextEncoder().encode("event: a\n\n"),
                            );
                            await held;
                            await Bun.sleep(11_000);
                            controller.enqueue(
                                new TextEncoder().encode("event: b\n\n"),
                            );
                            controller.close();
                        },
                    }),
                    { headers: { "content-type": "text/event-stream" } },
                ),
        );
        gateway = startGateway({ upstream: upstream.url });
        const reply = await fetch(`${gateway.url}/v1/messages`, {
            method: "POST",
            body: "{}",
        });
        const reader = reply.body?.getReader();
        const decode = (chunk?: Uint8Array) => new TextDecoder().decode(chunk);
        expect(decode((await reader?.read())?.value)).toBe("event: a\n\n");
        release();
        expect(decode((await reader?.read())?.value)).toBe("event: b\n\n");
    }, 20_000);

    it("hands the client a compressed reply it can read", async () => {
        upstream = standIn(
            () =>
                new Response(
                    Bun.gzipSync(new TextEncoder().encode('{"ok":true}')),
                    {
                        headers: {
                            "content-encoding": "gzip",
                            "content-type": "application/json",
                        },
                    },
                ),
        );
        gateway = startGateway({ upstream: upstream.url });
        const reply = await fetch(`${gateway.url}/v1/messages`, {
            method: "POST",
            body: "{}",
        });
        expect(await reply.json()).toEqual({ ok: true });
    });

    it("passes the upstream's errors through as they are", async () => {
        upstream = standIn(() =>
            Response.json({ type: "error" }, { status: 429 }),
        );
        gateway = startGateway({ upstream: upstream.url });
        const reply = await fetch(`${gateway.url}/v1/messages`, {
            method: "POST",
            body: "{}",
        });
        expect(reply.status).toBe(429);
    });

    it("answers 502 in the API's shape when the upstream is gone", async () => {
        upstream = standIn();
        const gone = upstream.url;
        upstream.stop();
        gateway = startGateway({ upstream: gone });
        const reply = await fetch(`${gateway.url}/v1/messages`, {
            method: "POST",
            body: marked,
        });
        expect(reply.status).toBe(502);
        expect(await reply.json()).toMatchObject({
            type: "error",
            error: { type: "api_error" },
        });
    });

    it("counts what it could not rewrite", async () => {
        upstream = standIn();
        gateway = startGateway({ upstream: upstream.url });
        await fetch(`${gateway.url}/v1/messages`, {
            method: "POST",
            body: `{"system":"${MARKER}`,
        });
        expect(gateway.stats).toEqual({ injected: 0, drift: 1 });
        expect(upstream.seen[0]?.body).toBe(`{"system":"${MARKER}`);
    });
});
