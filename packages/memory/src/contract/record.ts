// vim:set expandtab shiftwidth=4 filetype=typescript:
// SPDX-License-Identifier: GPL-3.0-only

//
//
// ~chewygumxx/dorothy.git
// ::: :/packages/memory/src/contract/record.ts
//
//

// Records into the archive: each host session one conversation, each
// event once by its sourceId, in the order sent. Under the store's lock,
// so two records of one session never interleave.

import { readFile } from "node:fs/promises";
import {
    type Env,
    newPhrase,
    type RecordEvent,
    type RecordRequest,
    type RecordResponse,
} from "@dorothy/core";
import { recordedUuids } from "../bodies/record.js";
import type { Recorder } from "../memory/sidecar.js";
import type { RecallIndex } from "../recall/store.js";
import { sessionPhrase } from "../recall/sync.js";
import {
    type TranscriptEntry,
    TranscriptWriter,
    toolEntry,
    transcriptPath,
} from "../transcript.js";
import { ContractError } from "./errors.js";

export type RecordDeps = {
    env: Env;
    index: RecallIndex;
    recorder: Recorder | null;
    // Whether the request came over loopback.
    loopback: boolean;
    // Brings the index up to date, so a session recorded before a
    // restart is found; called outside the lock, as it takes it.
    sync: () => Promise<unknown>;
    // Claude Code's transcripts, through today's reader; null refuses
    // paths.
    claudeTranscript:
        | ((
              request: RecordRequest & { transcript: string },
          ) => Promise<RecordResponse>)
        | null;
    // Conversations this process recorded, by session key.
    sessions: Map<string, string>;
    now?: () => Date;
    phrase?: () => string;
};

export const sessionKey = (host: string, session: string) =>
    host === "claude-code" ? session : `${host}:${session}`;

const NONE: RecordResponse = { accepted: 0, duplicates: 0, through: null };

function entryOf(event: RecordEvent): TranscriptEntry {
    switch (event.kind) {
        case "user":
            return { kind: "user", text: event.text };
        case "assistant":
            return {
                kind: "assistant",
                text: event.text,
                interrupted: event.interrupted ?? false,
            };
        default:
            return toolEntry({
                name: event.name,
                input: event.input,
                output: event.output,
                ok: event.ok,
            });
    }
}

async function heldIn(path: string): Promise<Set<string>> {
    try {
        return recordedUuids(await readFile(path, "utf8")).uuids;
    } catch (error) {
        if ((error as { code?: unknown }).code === "ENOENT") {
            return new Set();
        }
        throw error;
    }
}

export async function acceptRecord(
    request: RecordRequest,
    deps: RecordDeps,
): Promise<RecordResponse> {
    if (request.private === true) {
        return NONE;
    }
    if (request.transcript !== undefined) {
        if (!deps.loopback) {
            throw new ContractError(
                403,
                "a transcript path is taken only over loopback",
            );
        }
        if (request.host !== "claude-code" || deps.claudeTranscript === null) {
            throw new ContractError(
                422,
                `no reader for ${request.host} transcripts yet: send events`,
            );
        }
        return deps.claudeTranscript({
            ...request,
            transcript: request.transcript,
        });
    }
    const events = request.events ?? [];
    if (events.length === 0) {
        return NONE;
    }
    const key = sessionKey(request.host, request.session);
    if (!deps.sessions.has(key)) {
        await deps.sync();
    }
    return deps.index.lock(async () => {
        const found = deps.sessions.get(key) ?? sessionPhrase(deps.index, key);
        const phrase = found ?? (deps.phrase ?? newPhrase)();
        const path = transcriptPath(phrase, deps.env);
        const seen = found === null ? new Set<string>() : await heldIn(path);
        const fresh: RecordEvent[] = [];
        for (const event of events) {
            if (!seen.has(event.sourceId)) {
                seen.add(event.sourceId);
                fresh.push(event);
            }
        }
        if (fresh.length > 0) {
            const writer = await TranscriptWriter.open(path, deps.now);
            try {
                if (found === null) {
                    await writer.append({
                        kind: "session",
                        phrase,
                        sdkSessionId: "",
                        model: "",
                        promptHash: "",
                        resumed: false,
                        source: request.host,
                        sourceSession: key,
                        ...(request.project === undefined
                            ? {}
                            : { project: request.project }),
                        ...(request.parent === undefined
                            ? {}
                            : {
                                  parentSession: sessionKey(
                                      request.host,
                                      request.parent,
                                  ),
                              }),
                    });
                }
                for (const event of fresh) {
                    await writer.append(entryOf(event), {
                        at: event.at,
                        sourceUuid: event.sourceId,
                    });
                }
                await writer.flushed();
            } finally {
                await writer.close();
            }
            await deps.recorder?.([path], `turn: ${phrase} (${request.host})`);
        }
        deps.sessions.set(key, phrase);
        return {
            accepted: fresh.length,
            duplicates: events.length - fresh.length,
            through: events.at(-1)?.sourceId ?? null,
        };
    });
}
