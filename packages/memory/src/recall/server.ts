// vim:set expandtab shiftwidth=4 filetype=typescript:
// SPDX-License-Identifier: GPL-3.0-only

//
//
// ~chewygumxx/dorothy.git
// ::: :/packages/memory/src/recall/server.ts
//
//

import { type Env, isUuid, readConfig, SERVER_NAME } from "@dorothy/core";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { liveSession } from "../bodies/launches.js";
import { FACT_TYPES } from "../facts/file.js";
import { dataRoot, type FactStore } from "../facts/store.js";
import type { HistoryHandle, OpenHistory } from "../memory/sidecar.js";
import { vocabularyPath } from "../memory/vocabulary.js";
import { identify } from "../projects/identify.js";
import { transcriptDir } from "../transcript.js";
import {
    listTags,
    NO_FACT,
    openConversation,
    openFact,
    RecallError,
    recollect,
    search,
} from "./query.js";
import { remember } from "./remember.js";
import { indexPath, RecallIndex } from "./store.js";
import { sessionPhrase, syncIndex, transcriptTurns } from "./sync.js";

// The guidance on when to look things up lives here: it always reaches the
// model with the tools.
export const SEARCH_DESCRIPTION = [
    "Search your memory by the words it contains, by tags, or both: the",
    "facts you and the user have kept, and your past conversations with",
    "this user. Your notes on earlier conversations give their gist; when",
    "they or the user point at detail you lack, search, then open what",
    "matched. Facts come first, live before retired, each with its id,",
    "scope, type, title, description, origin and a snippet; then",
    "conversations, each with its description, its tags as keywords,",
    "dates and up to three snippets. Matched words are marked with « and",
    "». kind limits the search to conversations or facts. tags are labels",
    "from the tags tool; a result carries every one of them, or a",
    "narrower tag. after and before are dates like 2026-10-05, a fact's",
    "by when it was created; limit is 1 to 10 for each, 5 by default.",
].join(" ");

export const OPEN_DESCRIPTION = [
    "Open one past conversation, usually at a turn a search matched, or",
    "one fact by its id. Give conversation or fact, not both. Say",
    "honestly in purpose what you hope to find; later you will judge",
    "whether it served. A conversation returns its notes and the turns",
    "around the one asked for; open again at another turn to read",
    "further. A fact returns whole, with who wrote it and from where.",
].join(" ");

export const REMEMBER_DESCRIPTION = [
    "Keep a fact for later conversations, in Claude Code and in chat:",
    "something lasting about the user, their work or how they want you",
    "to work, not what this conversation already holds. action write",
    "takes name (lower case words joined by hyphens), scope (personal,",
    "or project for this session's repository), type (user, feedback,",
    "project or reference), title (at most 60 characters), description",
    "(one sentence, at most 160) and body. Writing a name that exists",
    "corrects that fact. action retire takes name, scope and why. You",
    "cannot change a fact the user or a repository wrote, nor revive a",
    "retired one: tell the user what you would change instead.",
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
    // The data directory, whose knowledge/ is synced with the transcripts;
    // null leaves facts as the index last saw them.
    facts?: string | null;
    // The live conversation, never among the results.
    exclude: string | null;
    // In Claude Code: the session live in the launch, read at each call,
    // whose conversation is left out and named as remember's from. A
    // hook records it only after its first reply, and /clear replaces
    // it. exclude, chat's, comes first.
    liveSession?: (() => Promise<string | null>) | null;
    // Serve recollect over the live conversation's clusters; the session
    // was seeded with them.
    recollect?: boolean;
    halfLifeDays: number;
    now?: () => number;
    // The server's project id: search ranks its facts with personal
    // ones, and remember writes scope "project" there. null outside one.
    project?: string | null;
    // History for remember's commits, opened at its first call, never
    // pushing; null commits nothing.
    openHistory?: OpenHistory | null;
};

const describeError = (error: unknown) =>
    error instanceof Error ? error.message : String(error);

// Runs the calls it is given one at a time, in the order given; a call
// that rejects does not stop the ones after it.
export function inSequence(): <T>(call: () => Promise<T>) => Promise<T> {
    let queue: Promise<unknown> = Promise.resolve();
    return (call) => {
        const answered = queue.then(call);
        queue = answered.catch(() => {});
        return answered;
    };
}

export function createRecallServer(options: RecallServerOptions): McpServer {
    const server = new McpServer({ name: SERVER_NAME, version: "1.0.0" });
    const now = options.now ?? Date.now;
    let index: RecallIndex | null = null;
    const excluded = async (index: RecallIndex): Promise<string | null> => {
        if (options.exclude !== null || !options.liveSession) {
            return options.exclude;
        }
        const session = await options.liveSession();
        return session === null ? null : sessionPhrase(index, session);
    };
    // Calls are answered in the order they arrived, so a search sent after
    // a remember finds what it wrote.
    const inOrder = inSequence();
    // Every call syncs first, so results are never stale. The sync holds the
    // write lock across awaits, and the call waits its turn in the index's
    // queue rather than reading rows a sync for another call has half
    // written. work must not call exclusive or syncIndex: that would wait
    // on itself.
    const answer = (
        work: (index: RecallIndex, exclude: string | null) => unknown,
    ) => inOrder(() => answering(work));
    const answering = async (
        work: (index: RecallIndex, exclude: string | null) => unknown,
    ) => {
        try {
            index ??= options.openIndex();
            const ready = index;
            await syncIndex(
                ready,
                options.dir,
                now(),
                options.vocabulary ?? null,
                options.facts ?? null,
            );
            const exclude = await excluded(ready);
            const result = await ready.exclusive(() => work(ready, exclude));
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
    const project = options.project ?? null;
    const root = options.facts ?? null;
    let versions: HistoryHandle | null | undefined;
    // remember uses history's combined lock, or the index's without it:
    // it never runs inside exclusive; the next query syncs what it wrote.
    const write = (
        work: (store: FactStore, from: string | null) => Promise<unknown>,
    ) => inOrder(() => writing(work));
    const writing = async (
        work: (store: FactStore, from: string | null) => Promise<unknown>,
    ) => {
        try {
            if (root === null) {
                throw new RecallError("Facts are unavailable.");
            }
            index ??= options.openIndex();
            // Opened once: null (history off or broken) is kept too.
            if (versions === undefined) {
                versions = (await options.openHistory?.(index)) ?? null;
            }
            const result = await work(
                {
                    root,
                    lock: versions?.lock ?? index.lock,
                    recorder: versions?.recorder ?? null,
                    now: () => new Date(now()),
                },
                await excluded(index),
            );
            return {
                content: [
                    { type: "text" as const, text: JSON.stringify(result) },
                ],
            };
        } catch (error) {
            const text =
                error instanceof RecallError
                    ? error.message
                    : `Memory could not be written: ${describeError(error)}`;
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
                kind: z.enum(["conversations", "facts"]).optional(),
                tags: z.array(z.string()).optional(),
                after: z.string().optional(),
                before: z.string().optional(),
                limit: z.number().optional(),
            },
        },
        (input) =>
            answer((index, exclude) =>
                search(index, input, {
                    exclude,
                    now: now(),
                    halfLifeDays: options.halfLifeDays,
                    project,
                }),
            ),
    );
    server.registerTool(
        "open",
        {
            description: OPEN_DESCRIPTION,
            inputSchema: {
                conversation: z.string().optional(),
                fact: z.string().optional(),
                purpose: z.string(),
                turn: z.number().optional(),
            },
        },
        (input) =>
            answer((index, exclude) => {
                const { conversation, fact } = input;
                if ((conversation === undefined) === (fact === undefined)) {
                    throw new RecallError(
                        conversation === undefined
                            ? "Give a conversation or a fact to open."
                            : "Give a conversation or a fact to open, not both.",
                    );
                }
                if (fact !== undefined) {
                    if (root === null) {
                        throw new RecallError(NO_FACT);
                    }
                    return openFact(index, input, root);
                }
                return openConversation(
                    index,
                    { ...input, conversation: conversation as string },
                    { exclude },
                );
            }),
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
            answer((index, exclude) =>
                listTags(index, input, {
                    exclude,
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
                answer(async (index) => {
                    // A hidden chat's text is not in the index; she may still
                    // reopen her own turns from its transcript.
                    const hidden =
                        (
                            index.db
                                .query(
                                    "SELECT hidden FROM conversations WHERE phrase = ?",
                                )
                                .get(live) as { hidden: number } | null
                        )?.hidden === 1;
                    return recollect(index, input, {
                        phrase: live,
                        ...(hidden
                            ? { kept: await transcriptTurns(options.dir, live) }
                            : {}),
                    });
                }),
        );
    }
    if (root !== null) {
        server.registerTool(
            "remember",
            {
                description: REMEMBER_DESCRIPTION,
                inputSchema: {
                    action: z.enum(["write", "retire"]),
                    name: z.string(),
                    scope: z.enum(["personal", "project"]),
                    type: z.enum(FACT_TYPES).optional(),
                    title: z.string().optional(),
                    description: z.string().optional(),
                    body: z.string().optional(),
                    why: z.string().optional(),
                },
            },
            (input) =>
                write((store, from) =>
                    remember(store, input, { project, from }),
                ),
        );
    }
    return server;
}

// dorothy --recall-server: an MCP server on stdin and stdout until stdin
// closes. It talks to no model, so it needs no credentials. History is
// opened for remember's commits alone, never to push the mirror: chat's
// launch does that.
export async function runRecallServer(
    {
        exclude,
        recollect: serveRecollect,
        project,
    }: { exclude: string | null; recollect: boolean; project: string | null },
    env: Env = process.env,
): Promise<number> {
    const { config } = await readConfig(env);
    const found =
        project === null ? null : await identify(project).catch(() => null);
    // Claude Code's server inherits its launch; chat's, which names its
    // conversation, may too when chat runs inside her Claude Code.
    const launch = env.DOROTHY_LAUNCH ?? "";
    const server = createRecallServer({
        openIndex: () => RecallIndex.open(indexPath(env)),
        dir: transcriptDir(env),
        vocabulary: vocabularyPath(env),
        facts: dataRoot(env),
        exclude,
        liveSession: isUuid(launch) ? () => liveSession(env, launch) : null,
        recollect: serveRecollect,
        halfLifeDays: config.memory.halfLifeDays,
        project: found?.id ?? null,
        openHistory: async (index) => {
            const { commandHistory } = await import("../history/commands.js");
            return commandHistory({
                env,
                remindMirror: false,
                pushOnClose: false,
            })(index);
        },
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
