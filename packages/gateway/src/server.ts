// vim:set expandtab shiftwidth=4 filetype=typescript:
// SPDX-License-Identifier: GPL-3.0-only

//
//
// ~chewygumxx/dorothy.git
// ::: :/packages/gateway/src/server.ts
//
//

import type { Env } from "@dorothy/core";
import { rewriteRequest } from "./anthropic.js";

export const DEFAULT_UPSTREAM = "https://api.anthropic.com";

export type GatewayStats = { injected: number; drift: number };

export type Gateway = {
    url: string;
    stats: GatewayStats;
    stop: () => void;
};

// Headers that describe one hop rather than the request. The client's
// accept-encoding goes too: Bun's fetch negotiates and decodes its own.
const HOP = [
    "host",
    "connection",
    "keep-alive",
    "transfer-encoding",
    "content-length",
    "accept-encoding",
];

const CANDIDATE = /\/v1\/messages(?:\/count_tokens)?$/;

// The user's own base URL, so the gateway chains onto a proxy they
// already use, or Anthropic's.
export function upstreamFrom(env: Env): string {
    const url = env.ANTHROPIC_BASE_URL;
    return url === undefined || url === "" ? DEFAULT_UPSTREAM : url;
}

// A loopback stand-in for the API. It never records a header or a body,
// and writes nothing: the client owns the terminal.
export function startGateway({
    upstream = DEFAULT_UPSTREAM,
}: {
    upstream?: string;
} = {}): Gateway {
    const base = upstream.replace(/\/+$/, "");
    const stats: GatewayStats = { injected: 0, drift: 0 };
    const server = Bun.serve({
        hostname: "127.0.0.1",
        port: 0,
        // A streamed reply can fall silent for longer than the default
        // ten seconds while the model thinks. Bun 1.4.2 does not cut a
        // reply in flight, with this or without; it is set so that no
        // later Bun does.
        idleTimeout: 0,
        fetch: (request) => forward(request, base, stats),
    });
    return {
        url: `http://127.0.0.1:${server.port}`,
        stats,
        stop: () => {
            server.stop(true);
        },
    };
}

async function forward(
    request: Request,
    base: string,
    stats: GatewayStats,
): Promise<Response> {
    const url = new URL(request.url);
    const headers = new Headers(request.headers);
    for (const name of HOP) {
        headers.delete(name);
    }
    let body: Uint8Array<ArrayBuffer> | undefined;
    if (request.method !== "GET" && request.method !== "HEAD") {
        body = new Uint8Array(await request.arrayBuffer());
        if (request.method === "POST" && CANDIDATE.test(url.pathname)) {
            const result = rewriteRequest(
                body,
                request.headers.get("content-encoding"),
            );
            if (result.kind === "injected") {
                stats.injected += 1;
                body = result.bytes;
                headers.delete("content-encoding");
            } else if (result.kind === "drift") {
                stats.drift += 1;
            }
        }
    }
    let reply: Response;
    try {
        reply = await fetch(`${base}${url.pathname}${url.search}`, {
            method: request.method,
            headers,
            body,
            redirect: "manual",
        });
    } catch (error) {
        const reason = error instanceof Error ? error.message : String(error);
        return Response.json(
            {
                type: "error",
                error: {
                    type: "api_error",
                    message: `dorothy's gateway cannot reach ${base}: ${reason}`,
                },
            },
            { status: 502 },
        );
    }
    // Bun's fetch has decoded the body, so the encoding and length the
    // upstream gave no longer describe it.
    const out = new Headers(reply.headers);
    for (const name of [...HOP, "content-encoding"]) {
        out.delete(name);
    }
    return new Response(reply.body, {
        status: reply.status,
        statusText: reply.statusText,
        headers: out,
    });
}
