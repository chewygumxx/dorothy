// vim:set expandtab shiftwidth=4 filetype=typescript:
// SPDX-License-Identifier: GPL-3.0-only

//
//
// ~chewygumxx/dorothy.git
// ::: :/src/recall/server.ts
//
//

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { readConfig } from "../config.js";
import { transcriptDir } from "../transcript.js";
import type { Env } from "../xdg.js";
import { openConversation, RecallError, search } from "./query.js";
import { indexPath, RecallIndex } from "./store.js";
import { syncIndex } from "./sync.js";
import { SERVER_NAME } from "./types.js";

// The guidance on when to look things up lives here: it always reaches the
// model with the tools.
export const SEARCH_DESCRIPTION = [
    "Search your past conversations with this user by the words they",
    "contain. Your notes on earlier conversations give their gist; when the",
    "notes or the user point at detail you lack, search, then open what",
    "matched. Each result names a conversation, with its description, dates",
    "and up to three snippets, matched words marked with « and ». after and",
    "before are dates like 2026-10-05; limit is 1 to 10, 5 by default.",
].join(" ");

export const OPEN_DESCRIPTION = [
    "Open one past conversation to read what was said, usually at a turn a",
    "search matched. Say honestly in purpose what you hope to find; later",
    "you will judge whether it served. Returns the conversation's notes and",
    "the turns around the one asked for; open again at another turn to read",
    "further.",
].join(" ");

export type RecallServerOptions = {
    openIndex: () => RecallIndex;
    // The transcripts directory.
    dir: string;
    // The live conversation, never among the results.
    exclude: string | null;
    halfLifeDays: number;
    now?: () => number;
};

const describeError = (error: unknown) =>
    error instanceof Error ? error.message : String(error);

export function createRecallServer(options: RecallServerOptions): McpServer {
    const server = new McpServer({ name: SERVER_NAME, version: "1.0.0" });
    const now = options.now ?? Date.now;
    let index: RecallIndex | null = null;
    // Every call syncs first, so results are never stale. The sync holds the
    // write lock across awaits, and MCP may deliver calls concurrently, so
    // the query waits its turn in the index's queue rather than reading
    // rows a sync for another call has half written. work must not call
    // exclusive or syncIndex: that would wait on itself.
    const answer = async (work: (index: RecallIndex) => unknown) => {
        try {
            index ??= options.openIndex();
            const ready = index;
            await syncIndex(ready, options.dir, now());
            const result = await ready.exclusive(() => work(ready));
            return {
                content: [
                    { type: "text" as const, text: JSON.stringify(result) },
                ],
            };
        } catch (error) {
            const text =
                error instanceof RecallError
                    ? error.message
                    : `The memory index failed: ${describeError(error)}`;
            return {
                isError: true,
                content: [{ type: "text" as const, text }],
            };
        }
    };
    server.registerTool(
        "search",
        {
            description: SEARCH_DESCRIPTION,
            inputSchema: {
                query: z.string(),
                after: z.string().optional(),
                before: z.string().optional(),
                limit: z.number().optional(),
            },
        },
        (input) =>
            answer((index) =>
                search(index, input, {
                    exclude: options.exclude,
                    now: now(),
                    halfLifeDays: options.halfLifeDays,
                }),
            ),
    );
    server.registerTool(
        "open",
        {
            description: OPEN_DESCRIPTION,
            inputSchema: {
                conversation: z.string(),
                purpose: z.string(),
                turn: z.number().optional(),
            },
        },
        (input) =>
            answer((index) =>
                openConversation(index, input, { exclude: options.exclude }),
            ),
    );
    return server;
}

// dorothy --recall-server: an MCP server on stdin and stdout until stdin
// closes. It talks to no model, so it needs no credentials.
export async function runRecallServer(
    exclude: string | null,
    env: Env = process.env,
): Promise<number> {
    const { config } = await readConfig(env);
    const server = createRecallServer({
        openIndex: () => RecallIndex.open(indexPath(env)),
        dir: transcriptDir(env),
        exclude,
        halfLifeDays: config.memory.halfLifeDays,
    });
    const closed = new Promise<void>((resolve) => {
        process.stdin.once("end", resolve);
        process.stdin.once("close", resolve);
    });
    await server.connect(new StdioServerTransport());
    await closed;
    await server.close();
    return 0;
}
