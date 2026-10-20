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

import { open } from "node:fs/promises";
import {
    type Env,
    newPhrase,
    type RecordEvent,
    type RecordRequest,
    type RecordResponse,
} from "@dorothy/core";
import { recordedUuids } from "../bodies/record.js";
import { type Lock, type Recorder, setBackfilled } from "../memory/sidecar.js";
import type { RecallIndex } from "../recall/store.js";
import { sessionPhrase } from "../recall/sync.js";
import {
    cutTornTail,
    type TranscriptEntry,
    TranscriptWriter,
    toolEntry,
    transcriptDir,
    transcriptPath,
} from "../transcript.js";
import { ContractError } from "./errors.js";

export type RecordDeps = {
    env: Env;
    index: RecallIndex;
    recorder: Recorder | null;
    backfill?: boolean;
    lock?: Lock;
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
    // What was last read of each conversation's file, so that a record
    // reads only what was appended; none reads the whole file each time.
    held?: Map<string, Held>;
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

// The source ids a conversation's file held when last read, and the
// file it was read from.
export type Held = { ino: number; size: number; ids: Set<string> };

// Whether the byte before offset ends a line, so that reading on from it
// starts one.
async function endsLine(
    handle: Awaited<ReturnType<typeof open>>,
    offset: number,
): Promise<boolean> {
    const byte = Buffer.alloc(1);
    await handle.read(byte, 0, 1, offset - 1);
    return byte[0] === 0x0a;
}

// The source ids a transcript holds, or null where there is no file. Only
// what was appended since the last read is read, unless the file shrank,
// was replaced, or its last read ended inside a line: then all of it.
async function heldIn(
    path: string,
    cache: Map<string, Held>,
): Promise<Set<string> | null> {
    let handle: Awaited<ReturnType<typeof open>>;
    try {
        handle = await open(path, "r");
    } catch (error) {
        if ((error as { code?: unknown }).code === "ENOENT") {
            cache.delete(path);
            return null;
        }
        throw error;
    }
    try {
        const { ino, size } = await handle.stat();
        const kept = cache.get(path);
        const resume =
            kept !== undefined &&
            kept.ino === ino &&
            kept.size <= size &&
            (kept.size === 0 || (await endsLine(handle, kept.size)));
        const ids = resume ? kept.ids : new Set<string>();
        const from = resume ? kept.size : 0;
        if (size > from) {
            const bytes = Buffer.alloc(size - from);
            const { bytesRead } = await handle.read(
                bytes,
                0,
                bytes.length,
                from,
            );
            const text = bytes.subarray(0, bytesRead).toString("utf8");
            // A line cut short is no event held: a write will cut it off.
            const whole = text.slice(0, text.lastIndexOf("\n") + 1);
            for (const id of recordedUuids(whole).uuids) {
                ids.add(id);
            }
        }
        cache.set(path, { ino, size, ids });
        return ids;
    } finally {
        await handle.close();
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
    return (deps.lock ?? deps.index.lock)(async () => {
        const found = deps.sessions.get(key) ?? sessionPhrase(deps.index, key);
        const phrase = found ?? (deps.phrase ?? newPhrase)();
        const path = transcriptPath(phrase, deps.env);
        // A file may be gone that the session cache or index still names,
        // as history removes one it heals: the conversation starts over.
        const cache = deps.held ?? new Map<string, Held>();
        const held = found === null ? null : await heldIn(path, cache);
        const starting = held === null;
        // This request's own ids join the cache's only once written.
        const seen = new Set<string>();
        const fresh: RecordEvent[] = [];
        for (const event of events) {
            if (
                !(held?.has(event.sourceId) ?? false) &&
                !seen.has(event.sourceId)
            ) {
                seen.add(event.sourceId);
                fresh.push(event);
            }
        }
        if (fresh.length > 0) {
            const marked = await setBackfilled(
                transcriptDir(deps.env),
                phrase,
                deps.backfill ?? false,
            );
            // A writer killed mid-append left a line that would swallow
            // the first event written after it.
            if (await cutTornTail(path)) {
                cache.delete(path);
            }
            const writer = await TranscriptWriter.open(path, deps.now);
            try {
                if (starting) {
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
            // Publish under the same lock as creation. Another process
            // may have synced before this file existed, then waited here.
            deps.index.db.run(
                "INSERT OR IGNORE INTO conversation_sessions (session, phrase) VALUES (?, ?)",
                [key, phrase],
            );
            await deps.recorder?.(
                marked === null ? [path] : [path, marked],
                `turn: ${phrase} (${request.host})`,
            );
        }
        for (const id of seen) {
            held?.add(id);
        }
        deps.sessions.set(key, phrase);
        return {
            accepted: fresh.length,
            duplicates: events.length - fresh.length,
            through: events.at(-1)?.sourceId ?? null,
        };
    });
}
