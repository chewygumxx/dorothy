// vim:set expandtab shiftwidth=4 filetype=typescript:
// SPDX-License-Identifier: GPL-3.0-only

//
//
// ~chewygumxx/dorothy.git
// ::: :/src/dump.ts
//
//

import { type Options, query } from "@anthropic-ai/claude-agent-sdk";
import { clusterTokens, seedTurns } from "./compaction/plan.js";
import { readConfig } from "./config.js";
import type { Turn } from "./contracts/session.js";
import { conversationOptions, recallLaunch } from "./conversation.js";
import { earlierSection } from "./memory/block.js";
import { indexCatalogue } from "./memory/catalogue.js";
import { buildMemory } from "./memory/rank.js";
import { type Cluster, readSidecar } from "./memory/sidecar.js";
import type { PersonaMode } from "./persona.js";
import { indexPath, RecallIndex } from "./recall/store.js";
import { newPhrase } from "./session-id.js";
import { readTranscript, transcriptDir, transcriptPath } from "./transcript.js";
import type { Env } from "./xdg.js";

export type CaptureQueryFn = (params: {
    prompt: string;
    options: Options;
}) => AsyncIterable<unknown>;

const describeError = (error: unknown) =>
    error instanceof Error ? error.message : String(error);

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

export type DumpRequest = {
    resume: string | null;
    message: string;
    persona: PersonaMode;
};

// What a chat would send first, built as the TUI builds it: the same
// config, history, memory block and recall server. Like a chat's start it
// syncs the index; unlike one, it writes no transcript and starts no review.
export async function runDump(
    request: DumpRequest,
    {
        env = process.env,
        queryFn = query,
        write = {
            out: (text: string) => {
                process.stdout.write(text);
            },
            err: (text: string) => {
                process.stderr.write(text);
            },
        },
    }: {
        env?: Env;
        queryFn?: CaptureQueryFn;
        write?: { out: (text: string) => void; err: (text: string) => void };
    } = {},
): Promise<number> {
    const phrase = request.resume ?? newPhrase();
    let history: Turn[] = [];
    if (request.resume !== null) {
        const path = transcriptPath(phrase, env);
        try {
            history = (await readTranscript(path)).turns;
        } catch (error) {
            write.err(
                `dorothy: cannot resume ${phrase}: ${path}: ${describeError(error)}\n`,
            );
            return 1;
        }
    }
    const { config, warnings } = await readConfig(env);
    let clusters: Cluster[] = [];
    if (request.resume !== null) {
        const notes = await readSidecar(transcriptDir(env), phrase);
        if (notes.kind === "ok") {
            clusters = notes.sidecar.clusters;
        }
    }
    let index: RecallIndex | null = null;
    if (config.memory.enabled || config.memory.recall) {
        try {
            index = RecallIndex.open(indexPath(env));
        } catch (error) {
            warnings.push(
                `memory: the index can't be opened (${describeError(error)})`,
            );
        }
    }
    try {
        const recall =
            config.memory.recall && index !== null
                ? recallLaunch(phrase)
                : null;
        let memory = "";
        if (config.memory.enabled && index !== null) {
            const loaded = await indexCatalogue(
                index,
                transcriptDir(env),
            ).load();
            const built = buildMemory(loaded.entries, {
                now: Date.now(),
                config: config.memory,
                exclude: phrase,
                reserved: clusterTokens(clusters, recall !== null),
            });
            warnings.push(...loaded.warnings, ...built.warnings);
            memory = built.block;
        }
        const body = await dumpRequest({
            prompt: request.message,
            options: conversationOptions({
                history: seedTurns(history, clusters),
                memory,
                earlier: earlierSection(clusters, recall !== null),
                recall,
                recollect: recall !== null && clusters.length > 0,
                persona: request.persona,
            }),
            queryFn,
        });
        for (const warning of warnings) {
            write.err(`dorothy: ${warning}\n`);
        }
        if (body === null) {
            write.err("dorothy: the CLI sent no request to dump\n");
            return 1;
        }
        write.out(`${JSON.stringify(body, null, 2)}\n`);
        return 0;
    } finally {
        index?.close();
    }
}
