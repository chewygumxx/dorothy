// vim:set expandtab shiftwidth=4 filetype=typescript:
// SPDX-License-Identifier: GPL-3.0-only

//
//
// ~chewygumxx/dorothy.git
// ::: :/packages/memory/src/recording/sweep.ts
//
//

// One sweep over the hosts: each one's sessions listed, those unchanged
// since a read skipped, the rest read whole and recorded through the
// contract's record path, which stores each event once by its sourceId.
// Nothing here trusts a cursor, so a lost hint costs only a reread.

import { basename, dirname } from "node:path";
import type {
    Env,
    RecordEvent,
    RecordRequest,
    RecordResponse,
} from "@dorothy/core";
import { readLines } from "../bodies/claude-code.js";
import type { Recorded, SessionReport } from "../bodies/record.js";
import {
    keepHalt,
    keepNewType,
    readRecord,
    resolveHalt,
} from "../bodies/unread.js";
import type { FactStore } from "../facts/store.js";
import { identify } from "../projects/identify.js";
import { readCodex } from "./codex.js";
import {
    claudeSource,
    codexSource,
    type Host,
    hermesSource,
    type Source,
    type SourceRead,
    type SourceSession,
} from "./sources.js";
import {
    forgetMissing,
    loadSweepState,
    rememberRead,
    type SweepState,
    saveSweepState,
} from "./state.js";
import { hostWatermark } from "./watermark.js";

// A session untouched this long is over: a call never answered is
// recorded failed, not waited for.
export const ENDED_AFTER_MS = 3_600_000;

export type SweepLog = {
    info(message: string): void;
    warn(message: string): void;
    error(message: string): void;
};
export type SweepRecord = RecordResponse & { phrase: string | null };
// A conversation a sweep added events to.
export type SweepConversation = {
    host: Host;
    session: string;
    phrase: string;
    project: string | null;
    accepted: number;
    backfilled: boolean;
};
export type SweepDeps = {
    hosts: readonly Host[];
    // Record every session, regardless of the watermark, marked so that
    // no extraction runs on it.
    backfill: boolean;
    env: Env;
    // The data directory, its lock and its history.
    store: FactStore;
    // The contract's record path; the phrase is the conversation's.
    record: (request: RecordRequest) => Promise<SweepRecord>;
    // Claude Code's recorder of a session's transcript.
    recordClaude: (
        report: SessionReport,
        project: string | null,
    ) => Promise<Recorded>;
    log: SweepLog;
    // `[service] claude-dirs`.
    claudeDirs?: readonly string[];
    // Whether the harness marks the session private; none is recorded.
    isPrivate?: (session: {
        host: Host;
        session: string;
        cwd: string | null;
    }) => boolean;
    onRecorded?: (conversation: SweepConversation) => void;
    // Tests' stores.
    sources?: Partial<Record<Host, Source>>;
    now?: () => Date;
};
export type HostSweep = {
    host: Host;
    // Sessions that gained events, and the events they gained.
    sessions: number;
    events: number;
    // Unchanged since last read, or gone since listed.
    skipped: number;
    // Older than the watermark: they wait for the backfill.
    waiting: number;
    private: number;
    // Sessions read up to a record that could not be read.
    halted: number;
    // Sessions that could not be read at all.
    failed: number;
    // Why the host's sweep stopped, if it did.
    error: string | null;
};

const describe = (error: unknown) =>
    error instanceof Error ? error.message : String(error);

// What a reader found, whichever host's it is.
type View = {
    session: string | null;
    cwd: string | null;
    parent: string | null;
    events: RecordEvent[];
    halt: {
        line: number;
        type: string | null;
        reason: string;
        rest: string[];
    } | null;
    unknown: { type: string; example: string }[];
    // A call unanswered holds the events after it.
    pending: boolean;
};

function view(read: SourceRead, ended: boolean, fallback: string | null): View {
    if (read.kind === "hermes") {
        const { read: found } = read;
        const session = found.session ?? fallback;
        return {
            session,
            cwd: found.cwd,
            parent: found.parent,
            events: found.events,
            halt:
                found.halt === null
                    ? null
                    : {
                          line: found.halt.id ?? 0,
                          type: found.halt.type,
                          reason: found.halt.reason,
                          rest: [
                              JSON.stringify({ session, row: found.halt.id }),
                          ],
                      },
            unknown: found.unknown.map(({ id, type }) => ({
                type: `hermes/${type}`,
                example: JSON.stringify({ id }),
            })),
            pending: found.pending !== null,
        };
    }
    const found = readCodex(read.lines, { ended });
    return {
        session: found.session,
        cwd: found.cwd,
        parent: null,
        events: found.events,
        halt:
            found.halt === null
                ? null
                : {
                      line: found.halt.line + 1,
                      type: found.halt.type,
                      reason: found.halt.reason,
                      rest: read.lines.slice(found.halt.line),
                  },
        unknown: found.unknown.map(({ line, type }) => ({
            type: `codex/${type}`,
            example: read.lines[line] ?? "",
        })),
        pending: found.pending !== null,
    };
}

type Sweeping = {
    deps: SweepDeps;
    state: SweepState;
    started: Date;
    projects: Map<string, Promise<string | null>>;
};

function projectOf(sweeping: Sweeping, cwd: string | null) {
    if (cwd === null) return Promise.resolve(null);
    let found = sweeping.projects.get(cwd);
    if (found === undefined) {
        found = identify(cwd).then(
            (project) => project?.id ?? null,
            () => null,
        );
        sweeping.projects.set(cwd, found);
    }
    return found;
}

function emptyResult(host: Host): HostSweep {
    return {
        host,
        sessions: 0,
        events: 0,
        skipped: 0,
        waiting: 0,
        private: 0,
        halted: 0,
        failed: 0,
        error: null,
    };
}
function sourceOf(deps: SweepDeps, host: Host): Source {
    return (
        deps.sources?.[host] ??
        (host === "claude-code"
            ? claudeSource(deps.env, deps.claudeDirs)
            : host === "codex"
              ? codexSource(deps.env)
              : hermesSource(deps.env))
    );
}

export async function sweep(deps: SweepDeps): Promise<HostSweep[]> {
    const { log } = deps;
    const sweeping: Sweeping = {
        deps,
        state: await loadSweepState(deps.env, (message) => log.warn(message)),
        started: deps.now?.() ?? new Date(),
        projects: new Map(),
    };
    const results: HostSweep[] = [];
    for (const host of deps.hosts) {
        const result = emptyResult(host);
        results.push(result);
        try {
            await sweepHost(sweeping, host, result);
        } catch (error) {
            result.error = describe(error);
            log.error(`recording: ${host} stopped: ${result.error}`);
        }
        try {
            await saveSweepState(deps.env, sweeping.state);
        } catch (error) {
            // Hints only: the next sweep rereads.
            log.warn(`recording: sweep hints not saved (${describe(error)})`);
        }
    }
    return results;
}

async function sweepHost(sweeping: Sweeping, host: Host, result: HostSweep) {
    const { deps, state } = sweeping;
    const mark = Date.parse(
        await hostWatermark(
            deps.store,
            host,
            sweeping.started.toISOString(),
            (message) => deps.log.warn(message),
        ),
    );
    const listed = await sourceOf(deps, host).list();
    forgetMissing(state, host, new Set(listed.map((session) => session.key)));
    for (const session of listed) {
        const at = session.at === null ? Number.NaN : Date.parse(session.at);
        if (!deps.backfill && at < mark) {
            result.waiting += 1;
            continue;
        }
        let read: SourceRead | null;
        try {
            // A backfill ignores what a live sweep remembered: that may
            // have left the session waiting for it.
            read = await session.read(
                deps.backfill ? undefined : state.sessions[session.key],
                { ended: isOver(sweeping, session) },
            );
        } catch (error) {
            result.failed += 1;
            deps.log.error(
                `recording: ${host}: ${basename(session.path)} could not be read (${describe(error)})`,
            );
            continue;
        }
        if (read === null) {
            result.skipped += 1;
            continue;
        }
        await recordRead(sweeping, session, read, mark, result);
    }
}

// Outside a backfill, a session whose every event precedes the watermark
// waits for it, whatever its mtime says: a copy or restore refreshes that.
function waits(
    deps: SweepDeps,
    events: readonly { at: string }[],
    mark: number,
) {
    return (
        !deps.backfill &&
        events.length > 0 &&
        events.every((event) => Date.parse(event.at) < mark)
    );
}

// A backfilled session, or one untouched for an hour, is over.
function isOver({ deps, started }: Sweeping, session: SourceSession) {
    const at = session.at === null ? Number.NaN : Date.parse(session.at);
    return deps.backfill || started.getTime() - at >= ENDED_AFTER_MS;
}

async function recordRead(
    sweeping: Sweeping,
    session: SourceSession,
    read: SourceRead,
    mark: number,
    result: HostSweep,
) {
    const { deps, state } = sweeping;
    const { host } = session;
    const ended = isOver(sweeping, session);
    if (host === "claude-code" && read.kind === "file")
        return recordClaudeRead(sweeping, session, read, ended, mark, result);
    const found = view(read, ended, session.session ?? null);
    if (waits(deps, found.events, mark)) {
        result.waiting += 1;
        rememberRead(state, session.key, read);
        return;
    }
    const id = found.session;
    const named = id ?? basename(session.path, ".jsonl");
    if (id === null && found.events.length > 0) {
        result.failed += 1;
        deps.log.error(
            `recording: ${host}: ${named} names no session; not recorded`,
        );
        return;
    }
    const secret =
        id !== null &&
        (deps.isPrivate?.({ host, session: id, cwd: found.cwd }) ?? false);
    if (secret) {
        result.private += 1;
    }
    const project = secret ? null : await projectOf(sweeping, found.cwd);
    let response: SweepRecord = {
        accepted: 0,
        duplicates: 0,
        through: null,
        phrase: null,
    };
    if (id !== null && (secret || found.events.length > 0)) {
        response = await deps.record({
            host,
            session: id,
            ...(project === null ? {} : { project }),
            ...(found.parent === null ? {} : { parent: found.parent }),
            ...(secret ? { private: true } : { events: found.events }),
        });
    }
    if (response.accepted > 0) {
        result.sessions += 1;
        result.events += response.accepted;
        if (response.phrase !== null) {
            deps.onRecorded?.({
                host,
                session: named,
                phrase: response.phrase,
                project,
                accepted: response.accepted,
                backfilled: deps.backfill,
            });
        }
    }
    // A torn or raced read may stop in the middle of a record that is
    // whole next time: it keeps nothing aside and is not remembered, nor
    // is a halted read, nor one holding events behind an unanswered call.
    if (!secret && read.stable)
        await keepAside(deps, session, named, found, response.phrase, result);
    const holding = found.halt !== null || (found.pending && !ended);
    if (secret || !holding) rememberRead(state, session.key, read);
}

async function keepAside(
    deps: SweepDeps,
    session: SourceSession,
    named: string,
    found: View,
    phrase: string | null,
    result: HostSweep,
) {
    const { host } = session;
    for (const { type, example } of found.unknown) {
        try {
            if (await keepNewType(deps.env, type, example)) {
                deps.log.warn(
                    `recording: ${host}: ${named} holds a record of a new type, ${type}; passed over`,
                );
            }
        } catch (error) {
            deps.log.warn(
                `recording: ${host}: a record of a new type, ${type}, can't be kept (${describe(error)})`,
            );
        }
    }
    if (found.halt === null) {
        try {
            await resolveHalt(deps.env, named, host);
        } catch (error) {
            deps.log.warn(
                `recording: ${host}: ${named}: a halt kept before can't be cleared (${describe(error)})`,
            );
        }
        return;
    }
    result.halted += 1;
    const { line, type, reason, rest } = found.halt;
    try {
        const before = await readRecord(deps.env, named, host);
        await keepHalt(
            deps.env,
            {
                host,
                session: named,
                conversation: phrase,
                transcript: session.path,
                dir: dirname(session.path),
                since: null,
                line,
                type,
                uuid: null,
                reason,
                at: (deps.now?.() ?? new Date()).toISOString(),
            },
            rest,
        );
        // Told when it is new, not at every sweep.
        if (before?.line === line) return;
    } catch (error) {
        deps.log.warn(
            `recording: ${host}: ${named}: its halt can't be kept (${describe(error)})`,
        );
    }
    deps.log.error(
        `recording: ${host}: ${named} halted at ${line} (${type ?? "no type"}): ${reason}`,
    );
}

// The directory a Claude Code session began in, from its first line to
// name one.
function firstCwd(lines: readonly string[]): string | null {
    for (const line of lines.slice(0, 200)) {
        try {
            const cwd = (JSON.parse(line) as { cwd?: unknown } | null)?.cwd;
            if (typeof cwd === "string" && cwd !== "") return cwd;
        } catch {
            // A line that is not JSON names no directory.
        }
    }
    return null;
}

// Claude Code's sessions go through its own recorder, which finds the
// conversation a session continues (`dorothy --claude`'s hooks may have
// begun it) and appends the lines not yet recorded, once each.
async function recordClaudeRead(
    sweeping: Sweeping,
    session: SourceSession,
    read: Extract<SourceRead, { kind: "file" }>,
    ended: boolean,
    mark: number,
    result: HostSweep,
) {
    const { deps, state } = sweeping;
    if (waits(deps, readLines(read.lines, { ended }).events, mark)) {
        result.waiting += 1;
        rememberRead(state, session.key, read);
        return;
    }
    const id = basename(session.path, ".jsonl");
    const cwd = firstCwd(read.lines);
    if (deps.isPrivate?.({ host: "claude-code", session: id, cwd }) ?? false) {
        result.private += 1;
        rememberRead(state, session.key, read);
        return;
    }
    const project = await projectOf(sweeping, cwd);
    const recorded = await deps.recordClaude(
        {
            session: id,
            transcript: session.path,
            dir: dirname(session.path),
            since: null,
            ended,
        },
        project,
    );
    switch (recorded.kind) {
        case "unlocked":
            throw new Error("the store could not be locked");
        case "missing":
            result.skipped += 1;
            return;
        case "nothing":
            // A halt on the first line leaves a record and no conversation.
            if ((await readRecord(deps.env, id)) !== null) result.halted += 1;
            else if (!recorded.held || ended)
                rememberRead(state, session.key, read);
            return;
        case "recorded": {
            if (recorded.appended > 0) {
                result.sessions += 1;
                result.events += recorded.appended;
                deps.onRecorded?.({
                    host: "claude-code",
                    session: id,
                    phrase: recorded.phrase,
                    project,
                    accepted: recorded.appended,
                    backfilled: deps.backfill,
                });
            }
            // Lines held behind a call wait for its answer, or the end.
            if (recorded.halted) result.halted += 1;
            else if (!recorded.held || ended)
                rememberRead(state, session.key, read);
        }
    }
}
