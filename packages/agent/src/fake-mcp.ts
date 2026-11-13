// vim:set expandtab shiftwidth=4 filetype=typescript:
// SPDX-License-Identifier: GPL-3.0-only

//
//
// ~xxdorothy/dorothy.git
// ::: :/packages/agent/src/fake-mcp.ts
//
//

// A stand-in MCP server over stdio, for tests: it lists a few tools and
// answers every call with what it was started with, so that a test sees
// the arguments and environment its client gave it.

import { createInterface } from "node:readline";

const TOOLS = ["search", "open", "tags", "remember", "recollect", "extra"];

type Request = {
    id?: number;
    method: string;
    params?: { protocolVersion?: string; name?: string; arguments?: unknown };
};

const send = (message: unknown) => {
    process.stdout.write(`${JSON.stringify(message)}\n`);
};

for await (const line of createInterface({ input: process.stdin })) {
    if (line.trim() === "") {
        continue;
    }
    const request = JSON.parse(line) as Request;
    if (request.id === undefined) {
        continue;
    }
    const { id } = request;
    switch (request.method) {
        case "initialize":
            send({
                jsonrpc: "2.0",
                id,
                result: {
                    protocolVersion: request.params?.protocolVersion,
                    capabilities: { tools: {} },
                    serverInfo: { name: "fake", version: "0" },
                },
            });
            break;
        case "tools/list":
            send({
                jsonrpc: "2.0",
                id,
                result: {
                    tools: TOOLS.map((name) => ({
                        name,
                        inputSchema: { type: "object" },
                    })),
                },
            });
            break;
        case "tools/call":
            send({
                jsonrpc: "2.0",
                id,
                result: {
                    content: [
                        {
                            type: "text",
                            text: JSON.stringify({
                                tool: request.params?.name,
                                input: request.params?.arguments,
                                args: process.argv.slice(2),
                                data: process.env.XDG_DATA_HOME ?? null,
                                key: process.env.ANTHROPIC_API_KEY ?? null,
                            }),
                        },
                    ],
                    isError: request.params?.name === "extra",
                },
            });
            break;
        default:
            send({
                jsonrpc: "2.0",
                id,
                error: { code: -32601, message: "no such method" },
            });
    }
}
