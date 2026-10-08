// vim:set expandtab shiftwidth=4 filetype=typescript:
// SPDX-License-Identifier: GPL-3.0-only

//
//
// ~chewygumxx/dorothy.git
// ::: :/packages/memory/src/history/lint.ts
//
//

import { parseSidecar } from "../memory/sidecar.js";
import { parseVocabulary } from "../memory/vocabulary.js";

// What a path in the data directory holds, by where it sits.
export type FileKind = "vocabulary" | "sidecar" | "transcript" | "other";

export function fileKind(path: string): FileKind {
    if (path === "tags.json") {
        return "vocabulary";
    }
    if (/^transcripts\/[^/]+\.meta\.json$/.test(path)) {
        return "sidecar";
    }
    if (/^transcripts\/[^/]+\.jsonl$/.test(path)) {
        return "transcript";
    }
    return "other";
}

const utf8 = new TextDecoder("utf-8", { fatal: true });

const isRecord = (value: unknown): value is Record<string, unknown> =>
    typeof value === "object" && value !== null && !Array.isArray(value);

function eventProblem(line: Uint8Array): string | null {
    let event: unknown;
    try {
        event = JSON.parse(utf8.decode(line));
    } catch {
        return "not JSON";
    }
    return isRecord(event) &&
        typeof event.v === "number" &&
        typeof event.kind === "string"
        ? null
        : "not an event with v and kind";
}

const startsWith = (bytes: Uint8Array, prefix: Uint8Array) =>
    bytes.length >= prefix.length &&
    prefix.every((byte, index) => bytes[index] === byte);

// A transcript only grows: what was committed stays as it was, and each
// whole line after it is an event. A last line with no newline is what a
// crash mid-append leaves, and is allowed; so is a line that began before
// the committed end, which was a torn line when it was committed.
function transcriptProblem(
    bytes: Uint8Array,
    committed: Uint8Array | null,
): string | null {
    if (committed !== null && !startsWith(bytes, committed)) {
        return "it changed before its end, and a transcript only grows";
    }
    const from = committed?.length ?? 0;
    let start = 0;
    let line = 1;
    for (;;) {
        const end = bytes.indexOf(0x0a, start);
        if (end === -1) {
            return null;
        }
        if (start >= from) {
            const problem = eventProblem(bytes.subarray(start, end));
            if (problem !== null) {
                return `line ${line} is ${problem}`;
            }
        }
        start = end + 1;
        line += 1;
    }
}

// Null when the file may be committed, otherwise why not. committed is
// the file as last committed, or null when it never was; only a
// transcript's lint reads it.
export function lint(
    path: string,
    bytes: Uint8Array,
    committed: Uint8Array | null,
): string | null {
    const kind = fileKind(path);
    if (kind === "other") {
        return null;
    }
    if (kind === "transcript") {
        return transcriptProblem(bytes, committed);
    }
    let text: string;
    try {
        text = utf8.decode(bytes);
    } catch {
        return "it is not UTF-8";
    }
    const read =
        kind === "vocabulary" ? parseVocabulary(text) : parseSidecar(text);
    return read.kind === "ok" ? null : read.reason;
}
