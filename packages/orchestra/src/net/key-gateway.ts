// vim:set expandtab shiftwidth=4 filetype=typescript:
// SPDX-License-Identifier: GPL-3.0-only

//
//
// ~chewygumxx/dorothy.git
// ::: :/packages/orchestra/src/net/key-gateway.ts
//
//

// The key gateway: for a box signed in by API key, a reverse proxy to
// that one provider on the box's key socket. The box holds a placeholder;
// this puts the real key on each request to the provider's model paths
// and sends it to the fixed upstream, never to a host the request names.
// It keeps the key from the worker, not the worker's use of it.

import { unlink } from "node:fs/promises";

export type Provider = "anthropic" | "openai";

// What a box's agent is given in place of its key.
export const PLACEHOLDER_KEY = "dorothy-gateway";

export const UPSTREAMS: Readonly<Record<Provider, string>> = {
    anthropic: "https://api.anthropic.com",
    openai: "https://api.openai.com",
};

const PATHS: Readonly<Record<Provider, readonly string[]>> = {
    anthropic: [
        "POST /v1/messages",
        "POST /v1/messages/count_tokens",
        "GET /v1/models",
    ],
    openai: ["POST /v1/responses", "GET /v1/models"],
};

// Never sent on: the box's credentials, the client's encodings, which
// the gateway replaces with identity, and the headers of one hop alone.
const DROPPED = new Set([
    "authorization",
    "x-api-key",
    "cookie",
    "accept-encoding",
    "connection",
    "keep-alive",
    "te",
    "trailer",
    "transfer-encoding",
    "upgrade",
    "host",
    "content-length",
]);

const HOP_BY_HOP = new Set([
    "connection",
    "keep-alive",
    "transfer-encoding",
    "trailer",
    "upgrade",
]);

export type GatewayEntry = {
    at: string;
    method: string;
    path: string;
    status: number;
    requestBytes: number;
    responseBytes: number;
    // The response's own usage, its numbers merged across events.
    usage: Record<string, number> | null;
};

export type GatewayOptions = {
    socket: string;
    provider: Provider;
    key: string;
    log: (entry: GatewayEntry) => void;
    // The fixed upstream; tests name a fake's.
    upstream?: string;
    headerBytes?: number;
    bodyBytes?: number;
    idleMs?: number;
};

export type KeyGateway = { close: () => Promise<void> };

// The usage a response reports, from its JSON or each of its events.
function usageIn(value: unknown, into: Record<string, number>): void {
    if (typeof value !== "object" || value === null) {
        return;
    }
    const record = value as Record<string, unknown>;
    for (const holder of [record, record.message, record.response]) {
        const usage = (holder as Record<string, unknown> | undefined)?.usage;
        if (typeof usage === "object" && usage !== null) {
            for (const [name, count] of Object.entries(usage)) {
                if (typeof count === "number") {
                    into[name] = count;
                }
            }
        }
    }
}

function usageOf(text: string, type: string): Record<string, number> | null {
    const usage: Record<string, number> = {};
    const parse = (json: string) => {
        try {
            usageIn(JSON.parse(json), usage);
        } catch {}
    };
    if (type.startsWith("text/event-stream")) {
        for (const line of text.split("\n")) {
            if (line.startsWith("data:")) {
                parse(line.slice(5).trim());
            }
        }
    } else if (type.startsWith("application/json")) {
        parse(text);
    }
    return Object.keys(usage).length > 0 ? usage : null;
}

// How much of a response the gateway keeps to read its usage from.
const USAGE_TEXT = 4 * 1024 * 1024;

export async function startKeyGateway(
    options: GatewayOptions,
): Promise<KeyGateway> {
    const {
        socket: path,
        provider,
        key,
        log,
        upstream = UPSTREAMS[provider],
        headerBytes = 32 * 1024,
        bodyBytes = 32 * 1024 * 1024,
        idleMs = 600_000,
    } = options;
    const allowed = new Set(PATHS[provider]);

    const say = (entry: Omit<GatewayEntry, "at">) =>
        log({ at: new Date().toISOString(), ...entry });

    const refuse = (method: string, at: string, status: number) => {
        say({
            method,
            path: at,
            status,
            requestBytes: 0,
            responseBytes: 0,
            usage: null,
        });
        return new Response(null, { status });
    };

    const handle = async (request: Request, server: Bun.Server<undefined>) => {
        // Bun takes the URL's host from the Host header, even for an
        // absolute-form request; only the path is used either way.
        const url = new URL(request.url);
        const method = request.method;
        if (!allowed.has(`${method} ${url.pathname}`)) {
            return refuse(method, url.pathname, 403);
        }
        let size = 0;
        for (const [name, value] of request.headers) {
            size += name.length + value.length + 4;
        }
        if (size > headerBytes) {
            return refuse(method, url.pathname, 431);
        }
        const body = method === "POST" ? await request.arrayBuffer() : null;
        if (body !== null && body.byteLength > bodyBytes) {
            return refuse(method, url.pathname, 413);
        }
        const headers = new Headers();
        for (const [name, value] of request.headers) {
            if (!DROPPED.has(name) && !name.startsWith("proxy-")) {
                headers.set(name, value);
            }
        }
        headers.set("accept-encoding", "identity");
        if (provider === "anthropic") {
            headers.set("x-api-key", key);
        } else {
            headers.set("authorization", `Bearer ${key}`);
        }
        // A stream may be quiet a while; this request's own idle timer
        // stands in for the server's.
        server.timeout(request, 0);
        const abort = new AbortController();
        let idle = setTimeout(() => abort.abort(), idleMs);
        const touch = () => {
            clearTimeout(idle);
            idle = setTimeout(() => abort.abort(), idleMs);
        };
        let response: Response;
        try {
            response = await fetch(`${upstream}${url.pathname}${url.search}`, {
                method,
                headers,
                body,
                redirect: "manual",
                signal: abort.signal,
            });
        } catch {
            clearTimeout(idle);
            return refuse(method, url.pathname, 502);
        }
        if (response.status >= 300 && response.status < 400) {
            clearTimeout(idle);
            await response.body?.cancel();
            return refuse(method, url.pathname, 502);
        }
        const type = response.headers.get("content-type") ?? "";
        const kept: string[] = [];
        let keptBytes = 0;
        let responseBytes = 0;
        const decoder = new TextDecoder();
        const done = () => {
            clearTimeout(idle);
            say({
                method,
                path: url.pathname,
                status: response.status,
                requestBytes: body?.byteLength ?? 0,
                responseBytes,
                usage: usageOf(kept.join(""), type),
            });
        };
        const tap = new TransformStream<Uint8Array, Uint8Array>({
            transform(chunk, controller) {
                touch();
                responseBytes += chunk.byteLength;
                if (keptBytes < USAGE_TEXT) {
                    kept.push(decoder.decode(chunk, { stream: true }));
                    keptBytes += chunk.byteLength;
                }
                controller.enqueue(chunk);
            },
            flush: done,
        });
        const out = new Headers();
        for (const [name, value] of response.headers) {
            if (!HOP_BY_HOP.has(name) && name !== "content-length") {
                out.set(name, value);
            }
        }
        if (response.body === null) {
            done();
            return new Response(null, {
                status: response.status,
                headers: out,
            });
        }
        return new Response(response.body.pipeThrough(tap), {
            status: response.status,
            headers: out,
        });
    };

    await unlink(path).catch(() => {});
    const server = Bun.serve({
        // Bun's default idle timeout, ten seconds, is the headers'
        // deadline; a request in flight sets its own.
        unix: path,
        maxRequestBodySize: bodyBytes + 1,
        fetch: handle,
        error: () => new Response(null, { status: 500 }),
    });
    return {
        close: async () => {
            await server.stop(true);
        },
    };
}
