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

import { SERVICE_PATHS } from "@dorothy/core";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import type { JSONRPCMessage } from "@modelcontextprotocol/sdk/types.js";
import { identify } from "../projects/identify.js";
import { type ClientOptions, clientOf, ensureService } from "./client.js";

export type BridgeOptions = ClientOptions & {
    cwd: string;
    // stdio by default; tests pass an in-memory transport.
    local?: Transport;
    // The command that starts the service here; null never starts it.
    serve: readonly string[] | null;
    // The host that launched it, named in what its model remembers.
    host?: string | null;
};

const describeError = (error: unknown) =>
    error instanceof Error ? error.message : String(error);

export async function runBridge(options: BridgeOptions): Promise<number> {
    const client = await clientOf(options);
    if (options.serve !== null) {
        await ensureService(options.serve, options);
    }
    const project = (await identify(options.cwd).catch(() => null))?.id ?? null;
    const target = new URL(SERVICE_PATHS.mcp, client.url);
    if (project !== null) {
        target.searchParams.set("project", project);
    }
    if (options.host !== undefined && options.host !== null) {
        target.searchParams.set("host", options.host);
    }
    const remote = new StreamableHTTPClientTransport(target, {
        requestInit: {
            headers:
                client.token === null
                    ? {}
                    : { authorization: `Bearer ${client.token}` },
        },
    });
    const local = options.local ?? new StdioServerTransport();
    const closed = new Promise<void>((resolve) => {
        local.onclose = () => resolve();
    });
    local.onmessage = (message: JSONRPCMessage) => {
        remote.send(message).catch((error: unknown) => {
            const { id } = message as { id?: string | number };
            if (id !== undefined) {
                void local.send({
                    jsonrpc: "2.0",
                    id,
                    error: {
                        code: -32000,
                        message: `Dorothy's memory service is unreachable: ${describeError(error)}`,
                    },
                } as JSONRPCMessage);
            }
        });
    };
    remote.onmessage = (message: JSONRPCMessage) => {
        void local.send(message);
    };
    await remote.start();
    await local.start();
    await closed;
    await remote.close().catch(() => {});
    return 0;
}
