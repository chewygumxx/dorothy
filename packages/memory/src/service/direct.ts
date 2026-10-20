// vim:set expandtab shiftwidth=4 filetype=typescript:
// SPDX-License-Identifier: GPL-3.0-only

//
//
// ~chewygumxx/dorothy.git
// ::: :/packages/memory/src/service/direct.ts
//
//

// Requests to Dorothy's own service, made directly. Bun's fetch sends
// even a loopback request through the user's HTTP_PROXY unless NO_PROXY
// lists its host, and offers no way to refuse the proxy for one request;
// node:http heeds neither variable. Conversation text and the device
// token must not reach a proxy on their way to this machine's service.

import { request as httpRequest, type IncomingMessage } from "node:http";
import { request as httpsRequest } from "node:https";
import { Readable } from "node:stream";
import { isLoopback } from "./loopback.js";

export type FetchLike = (
    url: string | URL,
    init?: RequestInit,
) => Promise<Response>;

// Statuses whose response has no body, which Response refuses one for.
const BODILESS = [101, 204, 205, 304];

function headersOf(response: IncomingMessage): Headers {
    const headers = new Headers();
    for (const [name, value] of Object.entries(response.headers)) {
        for (const each of Array.isArray(value) ? value : [value ?? ""]) {
            headers.append(name, each);
        }
    }
    return headers;
}

// fetch over node:http and node:https, never through a proxy: method,
// headers, a body and a signal, the response's body streamed.
export async function directFetch(
    url: string | URL,
    init: RequestInit = {},
): Promise<Response> {
    const { signal } = init;
    signal?.throwIfAborted();
    const method = (init.method ?? "GET").toUpperCase();
    const body =
        init.body === undefined || init.body === null
            ? null
            : Buffer.from(await new Response(init.body).arrayBuffer());
    const headers = Object.fromEntries(new Headers(init.headers).entries());
    if (body !== null) {
        headers["content-length"] = String(body.length);
    }
    const target = new URL(url);
    const request = (target.protocol === "https:" ? httpsRequest : httpRequest)(
        target,
        { method, headers },
    );
    return new Promise<Response>((resolve, reject) => {
        const abort = () => request.destroy(signal?.reason);
        signal?.addEventListener("abort", abort, { once: true });
        request.on("error", (error) => {
            signal?.removeEventListener("abort", abort);
            reject(error);
        });
        request.on("response", (response) => {
            response.on("close", () =>
                signal?.removeEventListener("abort", abort),
            );
            const status = response.statusCode ?? 0;
            const empty = method === "HEAD" || BODILESS.includes(status);
            if (empty) {
                response.resume();
            }
            resolve(
                new Response(
                    empty
                        ? null
                        : (Readable.toWeb(
                              response,
                          ) as unknown as ReadableStream),
                    {
                        status,
                        statusText: response.statusMessage ?? "",
                        headers: headersOf(response),
                    },
                ),
            );
        });
        request.end(body ?? undefined);
    });
}

const hostOf = (url: string) =>
    new URL(url).hostname.replace(/^\[(.*)\]$/, "$1");

// The fetch for the service at url: direct to loopback, localhost or an
// address the service listens on ([service] listen), which a proxy has
// no business seeing; the global fetch, and the user's proxy, elsewhere.
export function fetchFor(url: string, listen: readonly string[]): FetchLike {
    if (!URL.canParse(url)) {
        return fetch;
    }
    const host = hostOf(url);
    const listed = listen
        .map((address) =>
            address.includes(":") ? `http://[${address}]` : `http://${address}`,
        )
        .some((at) => URL.canParse(at) && hostOf(at) === host);
    return isLoopback(host) || host === "localhost" || listed
        ? directFetch
        : fetch;
}
