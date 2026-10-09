// vim:set expandtab shiftwidth=4 filetype=typescript:
// SPDX-License-Identifier: GPL-3.0-only

//
//
// ~chewygumxx/dorothy.git
// ::: :/packages/agent/src/capture.ts
//
//

import { type Options, query } from "@anthropic-ai/claude-agent-sdk";

export type CaptureQueryFn = (params: {
    prompt: string;
    options: Options;
}) => AsyncIterable<unknown>;

// A stand-in for the Messages API on a loopback port: it records each
// request body and answers every call with an error, so nothing reaches the
// API and no tokens are spent. Headers, which carry the credentials, are
// never read.
export function captureServer(): {
    url: string;
    bodies: unknown[];
    stop: () => void;
} {
    const bodies: unknown[] = [];
    const server = Bun.serve({
        hostname: "127.0.0.1",
        port: 0,
        async fetch(request) {
            if (
                request.method === "POST" &&
                new URL(request.url).pathname.endsWith("/messages")
            ) {
                bodies.push(await request.json().catch(() => null));
            }
            return Response.json(
                {
                    type: "error",
                    error: {
                        type: "invalid_request_error",
                        message: "dorothy --dump-context",
                    },
                },
                { status: 400 },
            );
        },
    });
    return {
        url: `http://127.0.0.1:${server.port}`,
        bodies,
        stop: () => {
            server.stop(true);
        },
    };
}

// The first request the CLI makes for these options, as it would send it.
export async function dumpRequest({
    prompt,
    options,
    queryFn = query,
}: {
    prompt: string;
    options: Options;
    queryFn?: CaptureQueryFn;
}): Promise<unknown | null> {
    const server = captureServer();
    try {
        const handle = queryFn({
            prompt,
            options: {
                ...options,
                env: {
                    ...(options.env ?? process.env),
                    ANTHROPIC_BASE_URL: server.url,
                },
            },
        });
        try {
            for await (const _ of handle) {
                if (server.bodies.length > 0) {
                    break;
                }
            }
        } catch {
            // The stand-in's error ends the query; the request is captured.
        }
        return server.bodies[0] ?? null;
    } finally {
        server.stop();
    }
}
