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
import { SERVER_NAME } from "../contracts/recall.js";
import { vocabularyPath } from "../memory/vocabulary.js";
import { transcriptDir } from "../transcript.js";
import type { Env } from "../xdg.js";
import {
    listTags,
    openConversation,
    RecallError,
    recollect,
    search,
} from "./query.js";
import { indexPath, RecallIndex } from "./store.js";
import { syncIndex } from "./sync.js";

// The guidance on when to look things up lives here: it always reaches the
// model with the tools.
export const SEARCH_DESCRIPTION = [
    "Search your past conversations with this user by the words they",
    "contain, by tags, or both. Your notes on earlier conversations give",
    "their gist; when the notes or the user point at detail you lack,",
    "search, then open what matched. tags are labels from the tags tool;",
    "a result carries every one of them, or a narrower tag. Each result",
    "names a conversation, with its description, its tags as keywords,",
    "dates and up to three snippets, matched words marked with « and ».",
    "after and before are dates like 2026-10-05; limit is 1 to 10, 5 by",
    "default.",
].join(" ");

export const OPEN_DESCRIPTION = [
    "Open one past conversation to read what was said, usually at a turn a",
    "search matched. Say honestly in purpose what you hope to find; later",
    "you will judge whether it served. Returns the conversation's notes and",
    "the turns around the one asked for; open again at another turn to read",
    "further.",
].join(" ");

export const RECOLLECT_DESCRIPTION = [
    "Open one cluster of this conversation, from your summaries of its",
    "earlier turns, to read what was said word for word. Give words to start",
    "at the first turn in the cluster that contains them, or a turn number;",
    "call again with a later turn to read further.",
].join(" ");

export const TAGS_DESCRIPTION = [
    "List the tags you have given your past conversations with this",
    "user, most relevant first, each with what it covers, its broader and",
    "narrower tags, and how many conversations carry it. Use it to see",
    "what topics your conversations cover when your notes and the user",
    "point somewhere search words do not reach, then search by tag. under",
    "lists only the tags beneath one; limit is 1 to 50, 20 by default.",
].join(" ");

export type RecallServerOptions = {
    openIndex: () => RecallIndex;
    // The transcripts directory.
    dir: string;
    // tags.json, synced with the transcripts; null leaves tags as the
    // index last saw them.
    vocabulary?: string | null;
    // The live conversation, never among the results.
    exclude: string | null;
    // Serve recollect over the live conversation's clusters; the session
    // was seeded with them.
    recollect?: boolean;
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
            await syncIndex(
                ready,
                options.dir,
                now(),
                options.vocabulary ?? null,
            );
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
                query: z.string().optional(),
                tags: z.array(z.string()).optional(),
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
    server.registerTool(
        "tags",
        {
            description: TAGS_DESCRIPTION,
            inputSchema: {
                under: z.string().optional(),
                limit: z.number().optional(),
            },
        },
        (input) =>
            answer((index) =>
                listTags(index, input, {
                    exclude: options.exclude,
                    now: now(),
                    halfLifeDays: options.halfLifeDays,
                }),
            ),
    );
    const live = options.exclude;
    if (options.recollect === true && live !== null) {
        server.registerTool(
            "recollect",
            {
                description: RECOLLECT_DESCRIPTION,
                inputSchema: {
                    cluster: z.number().int().min(1),
                    words: z.string().optional(),
                    turn: z.number().optional(),
                },
            },
            (input) =>
                answer((index) => recollect(index, input, { phrase: live })),
        );
    }
    return server;
}

// dorothy --recall-server: an MCP server on stdin and stdout until stdin
// closes. It talks to no model, so it needs no credentials.
export async function runRecallServer(
    exclude: string | null,
    serveRecollect: boolean,
    env: Env = process.env,
): Promise<number> {
    const { config } = await readConfig(env);
    const server = createRecallServer({
        openIndex: () => RecallIndex.open(indexPath(env)),
        dir: transcriptDir(env),
        vocabulary: vocabularyPath(env),
        exclude,
        recollect: serveRecollect,
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
