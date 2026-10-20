// vim:set expandtab shiftwidth=4 filetype=typescript:
// SPDX-License-Identifier: GPL-3.0-only

//
//
// ~chewygumxx/dorothy.git
// ::: :/packages/memory/src/recording/hermes.ts
//
//

import { Database } from "bun:sqlite";
import type { RecordEvent } from "@dorothy/core";

export type HermesRead = {
    session: string | null;
    source: string | null;
    cwd: string | null;
    model: string | null;
    at: string | null;
    events: RecordEvent[];
    halt: { id: number | null; type: string | null; reason: string } | null;
    unknown: { id: number; type: string }[];
    pending: number | null;
};

type Json = Record<string, unknown>;
class Unreadable extends Error {}
const object = (value: unknown): value is Json =>
    value !== null && typeof value === "object" && !Array.isArray(value);
function text(value: unknown, reason: string): string {
    if (typeof value !== "string") throw new Unreadable(reason);
    return value;
}
function nonempty(value: unknown, reason: string): string {
    const result = text(value, reason);
    if (!result.trim()) throw new Unreadable(reason);
    return result;
}
function timestamp(value: unknown): string {
    if (typeof value !== "number" || !Number.isFinite(value))
        throw new Unreadable("invalid timestamp");
    const date = new Date(value * 1000);
    if (!Number.isFinite(date.getTime()))
        throw new Unreadable("invalid timestamp");
    return date.toISOString();
}
function json(value: string, reason: string): unknown {
    try {
        return JSON.parse(value);
    } catch {
        throw new Unreadable(reason);
    }
}
function content(value: unknown): string {
    if (value === null) return "";
    const stored = text(value, "content is not text");
    const decoded = stored.startsWith("\0json:")
        ? json(stored.slice(6), "invalid content JSON")
        : stored;
    if (typeof decoded === "string") return decoded;
    if (!Array.isArray(decoded))
        throw new Unreadable("unsupported structured content");
    return decoded
        .map((block) => {
            if (!object(block) || typeof block.type !== "string")
                throw new Unreadable("a content block without its type");
            if (["image", "image_url", "input_image"].includes(block.type))
                return "[image]";
            if (block.type === "text")
                return text(block.text, "a text block without its text");
            throw new Unreadable("an unsupported content block");
        })
        .join("\n\n");
}
function decodeSession(session: Json, rows: Json[], since: number): HermesRead {
    const read: HermesRead = {
        session: null,
        source: null,
        cwd: null,
        model: null,
        at: null,
        events: [],
        halt: null,
        unknown: [],
        pending: null,
    };
    let id: number | null = null;
    let type: string | null = "session";
    try {
        read.session = nonempty(session.id, "no session id");
        read.source = nonempty(session.source, "no session source");
        read.cwd =
            session.cwd === null
                ? null
                : nonempty(session.cwd, "invalid working directory");
        read.model =
            session.model === null
                ? null
                : nonempty(session.model, "invalid model");
        read.at = timestamp(session.started_at);
        const known = new Set<string>();
        for (const row of rows) {
            id =
                typeof row.id === "number" &&
                Number.isSafeInteger(row.id) &&
                row.id > 0
                    ? row.id
                    : null;
            type = null;
            if (id === null) throw new Unreadable("invalid message id");
            type = nonempty(row.role, "no message role");
            if (type === "system" || type === "developer") continue;
            if (type !== "user" && type !== "assistant") {
                if (!known.has(type)) {
                    read.unknown.push({ id, type });
                    known.add(type);
                }
                continue;
            }
            const said = content(row.content);
            const at = timestamp(row.timestamp);
            if (id > since && said.trim())
                read.events.push({
                    kind: type,
                    text: said,
                    sourceId: String(id),
                    at,
                    ...(type === "assistant" ? { interrupted: false } : {}),
                });
        }
    } catch (error) {
        if (!(error instanceof Unreadable)) throw error;
        read.halt = { id, type, reason: error.message };
    }
    return read;
}

// The only I/O edge: the supplied path is always opened read-only. The
// session decoder receives rows alone; this never opens a Dorothy store.
export function readHermes(db: string, since = 0): HermesRead[] {
    if (!Number.isSafeInteger(since) || since < 0)
        throw new RangeError("invalid message cursor");
    const reader = new Database(db, { readonly: true, create: false });
    try {
        const sessions = reader
            .query<Json, []>(
                "SELECT id, source, cwd, model, started_at FROM sessions ORDER BY id",
            )
            .all();
        const messages = reader.query<Json, [string]>(
            "SELECT * FROM messages WHERE session_id = ? ORDER BY id",
        );
        return sessions.map((session) =>
            decodeSession(
                session,
                typeof session.id === "string" ? messages.all(session.id) : [],
                since,
            ),
        );
    } finally {
        reader.close();
    }
}
