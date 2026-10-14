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

// Headers that describe one hop rather than the request, besides any the
// connection header names. The client's accept-encoding goes too: Bun's
// fetch negotiates and decodes its own.
const HOP = [
    "host",
    "connection",
    "keep-alive",
    "proxy-connection",
    "proxy-authorization",
    "te",
    "trailer",
    "upgrade",
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
    const base = new URL(upstream);
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

// The upstream's path, then the request's, and both queries, kept as
// they were written.
function target(base: URL, url: URL): string {
    const path = `${base.pathname.replace(/\/+$/, "")}${url.pathname}`;
    const query = [base.search, url.search]
        .map((search) => search.slice(1))
        .filter((search) => search !== "")
        .join("&");
    const out = new URL(base);
    out.pathname = path;
    out.search = query;
    return out.href;
}

function withoutHop(received: Headers): Headers {
    const headers = new Headers(received);
    const named = (received.get("connection") ?? "")
        .split(",")
        .map((name) => name.trim())
        .filter((name) => name !== "");
    for (const name of [...HOP, ...named]) {
        headers.delete(name);
    }
    return headers;
}

const encoder = new TextEncoder();

// What a stream cut off upstream ends with: the API's own error event,
// so the client treats it as an error rather than a finished reply.
const CUT = encoder.encode(
    `event: error\ndata: ${JSON.stringify({
        type: "error",
        error: {
            type: "api_error",
            message: "dorothy's gateway lost the upstream mid-reply",
        },
    })}\n\n`,
);

// The reply's body, passed on as it comes. If the upstream drops it, the
// body ends quietly (an event stream with CUT) instead of failing, which
// Bun would report over the client's screen.
function guarded(
    body: ReadableStream<Uint8Array> | null,
    events: boolean,
): ReadableStream<Uint8Array> | null {
    if (body === null) {
        return null;
    }
    const reader = body.getReader();
    return new ReadableStream<Uint8Array>({
        async pull(controller) {
            try {
                const { done, value } = await reader.read();
                if (done) {
                    controller.close();
                } else {
                    controller.enqueue(value);
                }
            } catch {
                if (events) {
                    controller.enqueue(CUT);
                }
                controller.close();
            }
        },
        cancel: (reason) => reader.cancel(reason).catch(() => {}),
    });
}

async function forward(
    request: Request,
    base: URL,
    stats: GatewayStats,
): Promise<Response> {
    const url = new URL(request.url);
    const headers = withoutHop(request.headers);
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
        reply = await fetch(target(base, url), {
            method: request.method,
            headers,
            body,
            redirect: "manual",
            // A client that gives up stops the upstream's work too.
            signal: request.signal,
        });
    } catch (error) {
        const reason = error instanceof Error ? error.message : String(error);
        // The origin alone: a base URL's credentials stay off the screen.
        return Response.json(
            {
                type: "error",
                error: {
                    type: "api_error",
                    message: `dorothy's gateway cannot reach ${base.origin}: ${reason}`,
                },
            },
            { status: 502 },
        );
    }
    // Bun's fetch has decoded the body, so the encoding and length the
    // upstream gave no longer describe it.
    const out = withoutHop(reply.headers);
    out.delete("content-encoding");
    const events = (reply.headers.get("content-type") ?? "").startsWith(
        "text/event-stream",
    );
    return new Response(guarded(reply.body, events), {
        status: reply.status,
        statusText: reply.statusText,
        headers: out,
    });
}
