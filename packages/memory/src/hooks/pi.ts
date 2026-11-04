// vim:set expandtab shiftwidth=4 filetype=typescript:
// SPDX-License-Identifier: GPL-3.0-only

//
//
// ~chewygumxx/dorothy.git
// ::: :/packages/memory/src/hooks/pi.ts
//
//

// dorothy --pi-hook: what Dorothy's Pi extension asks of her memory, as
// JSON. A start or prompt is answered as any host hook is (`hostContext`),
// for the archive segment of the session's active leaf; a settled turn or
// an end sends that file's segments through the record client, read by
// the sweep's own source. Never a throw: a fault is a warning's stable
// code, never content. Recording is `off` for a private, file-less or
// refused session, `delivered` once the service took every segment sent
// and the file holds nothing back, else `pending`. Records take the
// project of the file's own header, as the sweep does, so whichever
// writes a conversation first gives it the same project; context takes
// the live `cwd`. A file whose header names another session than the
// request's is neither mapped nor sent (`pi_session_mismatch`).

import {
    BLOCK_REASONS,
    type BlockReason,
    type Env,
    type RecordEvent,
    type RecordRequest,
    type RecordResponse,
} from "@dorothy/core";
import { identify as identifyProject } from "../projects/identify.js";
import type { PiSegment } from "../recording/pi.js";
import { type PiSessionFile, readPiSession } from "../recording/pi-source.js";
import { PI_HOOK_EVENTS } from "./payload.js";
import { type HostHookDeps, hostContext } from "./run.js";

export { PI_HOOK_EVENTS };
export type PiHookRequest = {
    event: (typeof PI_HOOK_EVENTS)[number];
    sessionId: string;
    sessionFile: string | null;
    leafId: string | null;
    cwd: string;
    private: boolean;
    reason?: BlockReason;
    prompt?: string;
};
export type PiHookReply = {
    session: string | null;
    context: string;
    recording: "off" | "pending" | "delivered";
    // Stable code, never raw content.
    warning: string | null;
};
export type PiHookDeps = HostHookDeps & {
    env: Env;
    record: (request: RecordRequest) => Promise<RecordResponse | null>;
};

// Events per record request: half the service's 8 MiB body, so a long
// segment goes in parts rather than being refused whole.
const RECORD_BYTES = 4 * 1024 * 1024;

const text = (value: unknown): value is string =>
    typeof value === "string" && value !== "";
const nullable = (value: unknown): value is string | null =>
    value === null || text(value);

function parse(input: unknown): PiHookRequest | null {
    if (typeof input !== "object" || input === null) return null;
    const json = input as Record<string, unknown>;
    if (
        !(PI_HOOK_EVENTS as readonly unknown[]).includes(json.event) ||
        !text(json.sessionId) ||
        !nullable(json.sessionFile) ||
        !nullable(json.leafId) ||
        !text(json.cwd) ||
        typeof json.private !== "boolean" ||
        (json.reason !== undefined &&
            !(BLOCK_REASONS as readonly unknown[]).includes(json.reason)) ||
        (json.prompt !== undefined && typeof json.prompt !== "string")
    )
        return null;
    return json as PiHookRequest;
}

// Events in parts of at most RECORD_BYTES each, in order.
function parts(events: readonly RecordEvent[]): RecordEvent[][] {
    const found: RecordEvent[][] = [];
    let part: RecordEvent[] = [];
    let bytes = 0;
    for (const event of events) {
        const size = Buffer.byteLength(JSON.stringify(event)) + 1;
        if (part.length > 0 && bytes + size > RECORD_BYTES) {
            found.push(part);
            part = [];
            bytes = 0;
        }
        part.push(event);
        bytes += size;
    }
    if (part.length > 0) found.push(part);
    return found;
}

// The segment holding the active leaf, read from the file's own graph:
// never guessed when the file is held for its parent.
function leafSegment(found: PiSessionFile, leafId: string | null) {
    if (found.kind !== "read" || leafId === null) return null;
    const entries = found.file.read.ancestry?.entries;
    return entries && Object.hasOwn(entries, leafId)
        ? (entries[leafId]?.owner ?? null)
        : null;
}

// What keeps a read from being recorded whole, as a warning's code.
function holdOf(found: PiSessionFile): string | null {
    if (found.kind === "outside") return "pi_session_outside";
    if (found.kind !== "read") return null;
    if (found.file.orphan) return "pi_ancestry_missing";
    return found.file.read.halt === null ? null : "pi_session_halted";
}

async function send(
    request: PiHookRequest,
    found: Extract<PiSessionFile, { kind: "read" }>,
    session: string | null,
    deps: PiHookDeps,
): Promise<boolean> {
    // A settled turn added to its leaf's segment; an end sends them all.
    const segments = found.file.read.segments.filter(
        (segment: PiSegment) =>
            request.event === "end" ||
            session === null ||
            segment.session === session,
    );
    const cwd = found.file.read.cwd ?? request.cwd;
    const project = (
        await (deps.identify ?? identifyProject)(cwd).catch(() => null)
    )?.id;
    let taken = true;
    for (const segment of segments)
        for (const events of parts(segment.events)) {
            const response = await deps
                .record({
                    host: "pi",
                    session: segment.session,
                    ...(project === undefined ? {} : { project }),
                    ...(segment.parent === null
                        ? {}
                        : { parent: segment.parent }),
                    events,
                })
                .catch(() => null);
            // The client keeps what it could not send, in order.
            if (response === null) taken = false;
        }
    return taken;
}

export async function runPiHostHook(
    input: unknown,
    deps: PiHookDeps,
): Promise<PiHookReply> {
    const request = parse(input);
    if (request === null)
        return {
            session: null,
            context: "",
            recording: "off",
            warning: "pi_request_invalid",
        };
    const off = request.private || request.sessionFile === null;
    let found: PiSessionFile = { kind: "missing" };
    let warning: string | null = null;
    if (!off && request.sessionFile !== null) {
        try {
            found = await readPiSession(deps.env, request.sessionFile, {
                ended: request.event === "end",
            });
        } catch {
            warning = "pi_session_unreadable";
        }
    }
    // The request's session and the file's own: one never stands for the
    // other's leaf or archive.
    const mismatch =
        found.kind === "read" &&
        found.file.read.nativeSession !== null &&
        found.file.read.nativeSession !== request.sessionId;
    warning = warning ?? (mismatch ? "pi_session_mismatch" : holdOf(found));
    const session = mismatch ? null : leafSegment(found, request.leafId);
    const refused = off || found.kind === "outside";
    if (request.event === "start" || request.event === "prompt") {
        const context = await answer(request, session, deps);
        return {
            session,
            context: context ?? "",
            recording: refused ? "off" : "pending",
            warning:
                warning ?? (context === null ? "pi_memory_unavailable" : null),
        };
    }
    if (refused || mismatch || found.kind !== "read")
        return {
            session,
            context: "",
            recording: refused ? "off" : "pending",
            warning,
        };
    const taken = await send(request, found, session, deps);
    const whole = taken && !found.file.read.pending && warning === null;
    return {
        session,
        context: "",
        recording: whole ? "delivered" : "pending",
        warning: warning ?? (taken ? null : "pi_record_queued"),
    };
}

// The block or recall, for the leaf's segment where the file names one,
// else for the native session, which no archive conversation shares.
async function answer(
    request: PiHookRequest,
    session: string | null,
    deps: PiHookDeps,
): Promise<string | null> {
    if (request.event === "prompt" && !request.prompt?.trim()) return "";
    return hostContext(
        "pi",
        request.event === "start" ? "session-start" : "prompt",
        {
            session: session ?? request.sessionId,
            cwd: request.cwd,
            reason: request.reason ?? "startup",
            prompt: request.prompt ?? null,
        },
        { ...deps, client: { env: deps.env, ...deps.client } },
    );
}
