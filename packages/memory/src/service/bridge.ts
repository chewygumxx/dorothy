// vim:set expandtab shiftwidth=4 filetype=typescript:
// SPDX-License-Identifier: GPL-3.0-only

//
//
// ~chewygumxx/dorothy.git
// ::: :/packages/memory/src/service/bridge.ts
//
//

// --mcp: MCP over stdio for hosts that only launch processes, passed to
// the memory service over HTTP, so harnesses' writes still go through
// one process. The project is the repository of the directory it runs
// in. A request the service cannot take is answered with an error.

import type { Readable, Writable } from "node:stream";
import { SERVICE_PATHS } from "@dorothy/core";
import {
    StreamableHTTPClientTransport,
    StreamableHTTPError,
} from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import type { JSONRPCMessage } from "@modelcontextprotocol/sdk/types.js";
import { identify } from "../projects/identify.js";
import { type ClientOptions, clientOf, ensureService } from "./client.js";

export type BridgeOptions = ClientOptions & {
    cwd: string;
    // stdio by default; tests pass an in-memory transport.
    local?: Transport;
    // What stdio reads, process.stdin by default; its end ends the bridge.
    stdin?: Readable;
    // What stdio writes, process.stdout by default.
    stdout?: Writable;
    // The command that starts the service here; null never starts it.
    serve: readonly string[] | null;
    // The host that launched it, named in what its model remembers.
    host?: string | null;
    // How long a request may wait for the service, in all.
    timeoutMs?: number;
};

const REQUEST_TIMEOUT = 30_000;

const describeError = (error: unknown) =>
    error instanceof Error ? error.message : String(error);

// What a request the service did not answer is told, by why.
function whyNot(error: unknown): string {
    if (error instanceof StreamableHTTPError && error.code !== undefined) {
        return `Dorothy's memory service refused the request (${error.code})`;
    }
    return `Dorothy's memory service is unreachable: ${describeError(error)}`;
}

export async function runBridge(options: BridgeOptions): Promise<number> {
    const stdin = options.stdin ?? process.stdin;
    const local =
        options.local ?? new StdioServerTransport(stdin, options.stdout);
    // The service's side, or why it could not be made: a failure here is
    // answered to each request rather than thrown at a host that cannot
    // see it.
    let remote: StreamableHTTPClientTransport | null = null;
    let setup: unknown = null;
    try {
        const client = await clientOf(options);
        if (options.serve !== null) {
            await ensureService(options.serve, options);
        }
        const project =
            (await identify(options.cwd).catch(() => null))?.id ?? null;
        const target = new URL(SERVICE_PATHS.mcp, client.url);
        if (project !== null) {
            target.searchParams.set("project", project);
        }
        if (options.host !== undefined && options.host !== null) {
            target.searchParams.set("host", options.host);
        }
        remote = new StreamableHTTPClientTransport(target, {
            requestInit: {
                headers:
                    client.token === null
                        ? {}
                        : { authorization: `Bearer ${client.token}` },
            },
        });
    } catch (error) {
        setup = error;
    }
    const closed = new Promise<void>((resolve) => {
        local.onclose = () => resolve();
    });
    // Requests sent on and not yet answered: the input ending waits for
    // them, within their time, so the last answer is not cut off.
    const waiting = new Set<string | number>();
    let ending = false;
    const close = () => {
        local.close().catch(() => {});
    };
    const end = () => {
        ending = true;
        if (waiting.size === 0) {
            close();
        }
    };
    const answered = (id: string | number) => {
        waiting.delete(id);
        if (ending && waiting.size === 0) {
            close();
        }
    };
    const refuse = (id: string | number, message: string) => {
        if (waiting.has(id)) {
            answered(id);
            local
                .send({
                    jsonrpc: "2.0",
                    id,
                    error: { code: -32000, message },
                } as JSONRPCMessage)
                .catch(() => {});
        }
    };
    if (options.local === undefined) {
        stdin.on("end", end);
        stdin.on("close", end);
    }
    local.onmessage = (message: JSONRPCMessage) => {
        const { id } = message as { id?: string | number };
        const asked = id !== undefined && "method" in message;
        if (asked) {
            waiting.add(id);
        }
        if (remote === null) {
            if (asked) {
                refuse(id, whyNot(setup));
            }
            return;
        }
        const timer = setTimeout(() => {
            if (asked) {
                refuse(id, "Dorothy's memory service did not answer in time");
            }
        }, options.timeoutMs ?? REQUEST_TIMEOUT);
        remote
            .send(message)
            .catch((error: unknown) => {
                if (asked) {
                    refuse(id, whyNot(error));
                }
            })
            .finally(() => clearTimeout(timer));
    };
    if (remote !== null) {
        remote.onmessage = (message: JSONRPCMessage) => {
            const { id } = message as { id?: string | number };
            // An answer that came after its request was told otherwise is
            // dropped; the host heard already.
            if (id !== undefined && !("method" in message)) {
                if (!waiting.has(id)) {
                    return;
                }
                answered(id);
            }
            local.send(message).catch(() => {});
        };
        await remote.start();
    }
    await local.start();
    await closed;
    stdin.off("end", end);
    stdin.off("close", end);
    await remote?.close().catch(() => {});
    return 0;
}
