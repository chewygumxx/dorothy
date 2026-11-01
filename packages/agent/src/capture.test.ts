// vim:set expandtab shiftwidth=4 filetype=typescript:
// SPDX-License-Identifier: GPL-3.0-only

//
//
// ~chewygumxx/dorothy.git
// ::: :/packages/agent/src/capture.test.ts
//
//

import { describe, expect, it } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { anthropicEntry } from "@dorothy/core";
import { captureServer, dumpRequest } from "./capture.js";
import { personaPrompt } from "./persona.js";

describe("captureServer", () => {
    it("records the request bodies it is sent, and answers every call with an error", async () => {
        const server = captureServer();
        try {
            const hello = await fetch(`${server.url}/api/hello`, {
                method: "HEAD",
            });
            const sent = await fetch(`${server.url}/v1/messages`, {
                method: "POST",
                body: JSON.stringify({ messages: [] }),
            });
            expect(hello.status).toBe(400);
            expect(sent.status).toBe(400);
            expect(server.bodies).toEqual([{ messages: [] }]);
        } finally {
            server.stop();
        }
    });

    it("resolves first with the first body, and only the first", async () => {
        const server = captureServer();
        try {
            for (const n of [1, 2]) {
                await fetch(`${server.url}/v1/messages`, {
                    method: "POST",
                    body: JSON.stringify({ n }),
                });
            }
            expect(await server.first).toEqual({ n: 1 });
            expect(server.bodies).toHaveLength(2);
        } finally {
            server.stop();
        }
    });

    it("records a Chat Completions request too, answering in its shape", async () => {
        const server = captureServer();
        try {
            const response = await fetch(`${server.url}/v1/chat/completions`, {
                method: "POST",
                body: JSON.stringify({ model: "m" }),
            });
            expect(response.status).toBe(400);
            expect(await response.json()).toEqual({
                error: {
                    type: "invalid_request_error",
                    message: "dorothy --dump-context",
                },
            });
            expect(server.bodies).toEqual([{ model: "m" }]);
        } finally {
            server.stop();
        }
    });
});

describe("dumpRequest", () => {
    const FAKE_MCP = join(import.meta.dir, "fake-mcp.ts");
    const OPUS = anthropicEntry("claude-opus-5-5");

    it("returns the first request a chat would send, captured on loopback", async () => {
        const body = (await dumpRequest({
            setup: {},
            message: "hi",
            entry: OPUS,
            env: {},
        })) as Record<string, unknown>;
        expect(body.model).toBe("claude-opus-5-5");
        expect(body.system).toEqual([
            {
                type: "text",
                text: personaPrompt({ recall: false, mode: "chat" }),
                cache_control: { type: "ephemeral" },
            },
        ]);
        expect(body.messages).toEqual([
            {
                role: "user",
                content: [
                    {
                        type: "text",
                        text: "hi",
                        cache_control: { type: "ephemeral" },
                    },
                ],
            },
        ]);
    });

    it("carries the recall tools a chat would offer", async () => {
        // The recall server runs in the cache root: a temporary one, never the user's.
        const cache = mkdtempSync(join(tmpdir(), "dorothy-capture-"));
        try {
            const body = (await dumpRequest({
                setup: {
                    recall: { command: process.execPath, args: [FAKE_MCP] },
                },
                message: "hi",
                entry: OPUS,
                env: { PATH: process.env.PATH ?? "", XDG_CACHE_HOME: cache },
            })) as { tools: { name: string }[] };
            expect(body.tools.map((tool) => tool.name).sort()).toEqual([
                "mcp__memory__open",
                "mcp__memory__remember",
                "mcp__memory__search",
                "mcp__memory__tags",
            ]);
        } finally {
            rmSync(cache, { recursive: true, force: true });
        }
    });

    it("reports a recall server that would not start, and sends no tools", async () => {
        const reports: [string, string][] = [];
        const body = (await dumpRequest({
            setup: { recall: { command: "recall", args: [] } },
            message: "hi",
            entry: OPUS,
            env: {},
            connect: async () => {
                throw new Error("spawn failed");
            },
            report: (kind, message) => reports.push([kind, message]),
        })) as Record<string, unknown>;
        expect(body.model).toBe("claude-opus-5-5");
        expect(body.tools).toBeUndefined();
        expect(reports).toEqual([
            ["warning", "memory: recall is unavailable (spawn failed)"],
        ]);
    });

    it("reports why no request was sent, when none was", async () => {
        const reports: [string, string][] = [];
        const body = await dumpRequest({
            setup: {},
            message: "hi",
            entry: { ...OPUS, kind: "unknown" as never },
            env: {},
            report: (kind, message) => reports.push([kind, message]),
        });
        expect(body).toBeNull();
        expect(reports).toEqual([
            ["error", expect.stringContaining("no provider for unknown")],
        ]);
    });
});
