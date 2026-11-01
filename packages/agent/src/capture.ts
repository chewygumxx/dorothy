// vim:set expandtab shiftwidth=4 filetype=typescript:
// SPDX-License-Identifier: GPL-3.0-only

//
//
// ~chewygumxx/dorothy.git
// ::: :/packages/agent/src/capture.ts
//
//

import type { Env, RouteEntry } from "@dorothy/core";
import { Conversation, type SessionSetup } from "./conversation.js";
import type { ConnectRecall } from "./recall-tools.js";

// The stand-in key the dump's entry names: the capture server never
// reads it, and no real key is ever sent there.
export const DUMP_KEY = "DOROTHY_DUMP_KEY";

// A stand-in for the Messages API and Chat Completions on a loopback
// port: it records each request body and answers every call with an
// error, so nothing reaches the API and no tokens are spent. Headers,
// which carry the credentials, are never read. first resolves with the
// first body, for a caller that stops its client there.
export function captureServer(): {
    url: string;
    bodies: unknown[];
    first: Promise<unknown>;
    stop: () => void;
} {
    const bodies: unknown[] = [];
    const first = Promise.withResolvers<unknown>();
    const server = Bun.serve({
        hostname: "127.0.0.1",
        port: 0,
        async fetch(request) {
            const path = new URL(request.url).pathname;
            const completions = path.endsWith("/chat/completions");
            if (
                request.method === "POST" &&
                (completions || path.endsWith("/messages"))
            ) {
                const body = await request.json().catch(() => null);
                bodies.push(body);
                first.resolve(body);
            }
            const error = {
                type: "invalid_request_error",
                message: "dorothy --dump-context",
            };
            return Response.json(
                completions ? { error } : { type: "error", error },
                { status: 400 },
            );
        },
    });
    return {
        url: `http://127.0.0.1:${server.port}`,
        bodies,
        first: first.promise,
        stop: () => {
            server.stop(true);
        },
    };
}

// The first request a chat on this entry would send, as it would send
// it, recall tools included: a session of its own, pointed at the
// capture server with a stand-in key and no fallback, closed once the
// server has answered.
export async function dumpRequest({
    setup,
    message,
    entry,
    env = process.env,
    connect,
}: {
    setup: SessionSetup;
    message: string;
    entry: RouteEntry;
    env?: Env;
    connect?: ConnectRecall;
}): Promise<unknown | null> {
    const server = captureServer();
    const conversation = new Conversation({
        ...setup,
        route: [{ ...entry, baseUrl: server.url, key: DUMP_KEY }],
        env: { ...env, [DUMP_KEY]: "dorothy --dump-context" },
        ...(connect === undefined ? {} : { connect }),
    });
    try {
        const done = new Promise<void>((resolve) => {
            conversation.subscribe((event) => {
                if (event.type === "turn-end" || event.type === "error") {
                    resolve();
                }
            });
        });
        conversation.start();
        conversation.send(message);
        await done;
        return server.bodies[0] ?? null;
    } finally {
        await conversation.close();
        server.stop();
    }
}
