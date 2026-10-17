// vim:set expandtab shiftwidth=4 filetype=typescript:
// SPDX-License-Identifier: GPL-3.0-only

//
//
// ~chewygumxx/dorothy.git
// ::: :/packages/memory/src/bodies/record.ts
//
//

// A Claude Code session recorded into its conversation, under the
// store's lock: the conversation found by the session's id, or by a
// session its lines name; the transcript read from the resume point,
// the line after the last one recorded; what is new appended with each
// line's time and uuid; the session's row of conversation_sessions
// written into the index itself, as the index's lock is not re-entrant;
// and the change committed to history, as chat commits a turn. A line
// it cannot read halts the reading and is kept aside.

import { readdir, readFile, truncate } from "node:fs/promises";
import { join } from "node:path";
import { type Env, newPhrase } from "@dorothy/core";
import type { HistoryHandle, Lock } from "../memory/sidecar.js";
import type { RecallIndex } from "../recall/store.js";
import { sessionPhrase } from "../recall/sync.js";
import { TranscriptWriter, transcriptDir } from "../transcript.js";
import { type LinesRead, readLines } from "./claude-code.js";
import type { HookLog } from "./log.js";
import { keepHalt, keepNewType, resolveHalt } from "./unread.js";

export type SessionReport = {
    session: string;
    // Claude Code's transcript of the session, or its copy kept aside.
    transcript: string;
    // The launch's directory.
    dir: string;
    // The launch's start: a session new to Dorothy is hers from here.
    since: number | null;
    // The session is over: a call never answered is recorded failed.
    ended: boolean;
};

export type RecordDeps = {
    env: Env;
    index: RecallIndex | null;
    versions: HistoryHandle | null;
    log: HookLog;
    // The project of the launch's directory, for the session event.
    project: string | null;
    now?: () => Date;
};

export type Recorded =
    | {
          kind: "recorded";
          phrase: string;
          appended: number;
          // The bytes of Claude Code's transcript read.
          size: number;
          halted: boolean;
      }
    | { kind: "nothing"; size: number }
    | { kind: "missing"; reason: string }
    | { kind: "unlocked" };

const describeError = (error: unknown) =>
    error instanceof Error ? error.message : String(error);

function parsed(line: string): Record<string, unknown> | null {
    try {
        const value: unknown = JSON.parse(line);
        return typeof value === "object" && value !== null
            ? (value as Record<string, unknown>)
            : null;
    } catch {
        return null;
    }
}

// The uuids of the Claude Code lines a conversation already holds, and
// the last of them, from its transcript's text.
export function recordedUuids(text: string): {
    uuids: Set<string>;
    last: string | null;
} {
    const uuids = new Set<string>();
    let last: string | null = null;
    for (const line of text.split("\n")) {
        const uuid = parsed(line)?.sourceUuid;
        if (typeof uuid === "string") {
            uuids.add(uuid);
            last = uuid;
        }
    }
    return { uuids, last };
}

// The body sessions a conversation's session events name.
function sessionsIn(text: string): Set<string> {
    const sessions = new Set<string>();
    for (const line of text.split("\n")) {
        const event = parsed(line);
        if (
            event?.kind === "session" &&
            typeof event.sourceSession === "string"
        ) {
            sessions.add(event.sourceSession);
        }
    }
    return sessions;
}

// Without the index: the transcript whose session event names it.
async function scanFor(dir: string, session: string): Promise<string | null> {
    let names: string[];
    try {
        names = await readdir(dir);
    } catch {
        return null;
    }
    for (const name of names.filter((name) => name.endsWith(".jsonl"))) {
        const text = await readFile(join(dir, name), "utf8").catch(() => "");
        if (text.includes(session) && sessionsIn(text).has(session)) {
            return name.slice(0, -".jsonl".length);
        }
    }
    return null;
}

// A writer killed mid-append leaves a line that was never a whole
// event: it is cut off before anything is appended.
async function cutTornTail(path: string): Promise<string> {
    let text: string;
    try {
        text = await readFile(path, "utf8");
    } catch {
        return "";
    }
    if (text === "" || text.endsWith("\n")) {
        return text;
    }
    const whole = text.slice(0, text.lastIndexOf("\n") + 1);
    await truncate(path, Buffer.byteLength(whole));
    return whole;
}

export async function recordSession(
    report: SessionReport,
    deps: RecordDeps,
): Promise<Recorded> {
    const lock: Lock | undefined = deps.index?.lock ?? deps.versions?.lock;
    if (lock === undefined) {
        return { kind: "unlocked" };
    }
    const recording: Recording = {
        report,
        deps,
        dir: transcriptDir(deps.env),
        now: deps.now ?? (() => new Date()),
    };
    return lock(async (): Promise<Recorded> => {
        const transcript = await readWhole(report.transcript);
        if ("reason" in transcript) {
            return { kind: "missing", reason: transcript.reason };
        }
        const { lines, size } = transcript;
        const found = await findConversation(lines, recording);
        const { recorded, joined, from } = await resumeFrom(
            found,
            lines,
            recording,
        );
        const read = readLines(lines.slice(from), {
            ended: report.ended,
            recorded,
            since: found === null ? report.since : null,
        });
        await keepNewTypes(read.unknown, lines, from, recording);
        const phrase =
            read.events.length > 0
                ? await appendEvents(read, found, joined, recording)
                : found;
        await noteHalt(read.halt, lines, from, phrase, recording);
        if (phrase === null) {
            return { kind: "nothing", size };
        }
        deps.log.info(
            `session ${report.session}: ${read.events.length} events into ${phrase}`,
        );
        return {
            kind: "recorded",
            phrase,
            appended: read.events.length,
            size,
            halted: read.halt !== null,
        };
    });
}

// What recording one session shares.
type Recording = {
    report: SessionReport;
    deps: RecordDeps;
    // The transcripts' directory.
    dir: string;
    now: () => Date;
};

// Claude Code's transcript to its last whole line: a line it is still
// writing waits for the next reading. size is the bytes read.
async function readWhole(
    path: string,
): Promise<{ lines: string[]; size: number } | { reason: string }> {
    let text: string;
    try {
        text = await readFile(path, "utf8");
    } catch (error) {
        return { reason: describeError(error) };
    }
    const whole = text.slice(0, text.lastIndexOf("\n") + 1);
    return {
        lines: whole === "" ? [] : whole.slice(0, -1).split("\n"),
        size: Buffer.byteLength(whole),
    };
}

// The conversation the session continues: found by its own id, else by
// another session its lines name; null for one new to Dorothy.
async function findConversation(
    lines: readonly string[],
    { report, deps, dir }: Recording,
): Promise<string | null> {
    const named = new Set<string>();
    for (const line of lines) {
        const id = parsed(line)?.sessionId;
        if (typeof id === "string" && id !== report.session) {
            named.add(id);
        }
    }
    for (const id of [report.session, ...named]) {
        const found =
            deps.index === null
                ? await scanFor(dir, id)
                : sessionPhrase(deps.index, id);
        if (found !== null) {
            return found;
        }
    }
    return null;
}

// Where reading resumes: the line after the last one the conversation
// holds. joined: its session event names this session already.
async function resumeFrom(
    found: string | null,
    lines: readonly string[],
    { report, dir }: Recording,
): Promise<{ recorded: Set<string>; joined: boolean; from: number }> {
    if (found === null) {
        return { recorded: new Set(), joined: false, from: 0 };
    }
    const own = await cutTornTail(join(dir, `${found}.jsonl`));
    const { uuids, last } = recordedUuids(own);
    const at =
        last === null
            ? -1
            : lines.findIndex((line) => parsed(line)?.uuid === last);
    return {
        recorded: uuids,
        joined: sessionsIn(own).has(report.session),
        from: at + 1,
    };
}

// A line of a type the reader neither maps nor lists is passed over, and
// kept once.
async function keepNewTypes(
    unknown: LinesRead["unknown"],
    lines: readonly string[],
    from: number,
    { report, deps }: Recording,
): Promise<void> {
    for (const { line, type } of unknown) {
        await keepNewType(deps.env, type, lines[from + line] ?? "");
        deps.log.warn(
            `session ${report.session}: line ${from + line + 1} is of a new type, ${type}; passed over`,
        );
    }
}

// The events appended to the conversation, a new one if none was found,
// after a session event if this session has none there yet; one history
// commit. The conversation's phrase.
async function appendEvents(
    read: LinesRead,
    found: string | null,
    joined: boolean,
    { report, deps, dir, now }: Recording,
): Promise<string> {
    const phrase = found ?? newPhrase();
    const path = join(dir, `${phrase}.jsonl`);
    const writer = await TranscriptWriter.open(path, now);
    try {
        if (!joined) {
            await writer.append(
                {
                    kind: "session",
                    phrase,
                    sdkSessionId: "",
                    model: read.model ?? "unknown",
                    promptHash: "",
                    resumed: found !== null,
                    source: "claude-code",
                    sourceSession: report.session,
                    ...(deps.project === null ? {} : { project: deps.project }),
                },
                { at: read.events[0]?.at },
            );
            deps.index?.db.run(
                "INSERT OR IGNORE INTO conversation_sessions (session, phrase) VALUES (?, ?)",
                [report.session, phrase],
            );
        }
        for (const event of read.events) {
            await writer.append(event.entry, {
                at: event.at,
                sourceUuid: event.uuid,
            });
        }
    } finally {
        await writer.close();
    }
    await deps.versions?.recorder([path], `turn: ${phrase} (claude-code)`);
    return phrase;
}

// A halt is kept aside with the lines from it on and logged; a reading
// that did not halt resolves one kept before.
async function noteHalt(
    halt: LinesRead["halt"],
    lines: readonly string[],
    from: number,
    phrase: string | null,
    { report, deps, now }: Recording,
): Promise<void> {
    if (halt === null) {
        await resolveHalt(deps.env, report.session);
        return;
    }
    const line = from + halt.line;
    await keepHalt(
        deps.env,
        {
            session: report.session,
            conversation: phrase,
            transcript: report.transcript,
            dir: report.dir,
            since: report.since,
            line: line + 1,
            type: halt.type,
            uuid: halt.uuid,
            reason: halt.reason,
            at: now().toISOString(),
        },
        lines.slice(line),
    );
    deps.log.error(
        `session ${report.session}: halted at line ${line + 1} (${halt.type ?? "no type"}, ${halt.uuid ?? "no uuid"}): ${halt.reason}`,
    );
}
