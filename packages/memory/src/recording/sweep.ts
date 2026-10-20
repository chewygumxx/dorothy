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
import { type LinesRead, readLines } from "../bodies/claude-code.js";
import type { Recorded, SessionReport } from "../bodies/record.js";
import {
    keepHalt,
    keepNewType,
    readRecord,
    resolveHalt,
    unit,
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
    // The conversation a session already has, if any, up to date with the
    // archive.
    conversation?: (host: Host, session: string) => Promise<string | null>;
    // Visit only the sessions this accepts (a reread of halted ones).
    only?: (session: SourceSession) => boolean;
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
        uuid?: string | null;
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

// A session whose identity is unresolved has no privacy to decide, so
// none of its content is kept: a halt is told by where it is alone (its
// source's key and line or row), and a new type is passed over unkept.
function pointerOnly(found: View, session: SourceSession): View {
    const halt = found.halt;
    return {
        ...found,
        unknown: [],
        halt:
            halt === null
                ? null
                : {
                      line: halt.line,
                      type: null,
                      reason: halt.reason,
                      rest: [
                          JSON.stringify({
                              key: session.key,
                              [unit(session.host)]: halt.line,
                          }),
                      ],
                  },
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
        if (deps.only?.(session) === false) continue;
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
    const { deps } = sweeping;
    const { host } = session;
    const ended = isOver(sweeping, session);
    if (host === "claude-code" && read.kind === "file")
        return recordClaudeRead(sweeping, session, read, ended, mark, result);
    const viewed = view(read, ended, session.session ?? null);
    const id = viewed.session;
    const found = id === null ? pointerOnly(viewed, session) : viewed;
    const named = id ?? basename(session.path, ".jsonl");
    if (
        id === null &&
        found.events.length > 0 &&
        !waits(deps, found.events, mark)
    ) {
        result.failed += 1;
        deps.log.error(
            `recording: ${host}: ${named} names no session; not recorded`,
        );
        return;
    }
    // Privacy first: a private session keeps nothing, not even aside; one
    // with no identity cannot be judged, and keeps pointers alone.
    const secret =
        id !== null &&
        (deps.isPrivate?.({ host, session: id, cwd: found.cwd }) ?? false);
    if (secret) {
        result.private += 1;
    } else if (waits(deps, found.events, mark)) {
        result.waiting += 1;
        return settle(sweeping, session, read, named, found, ended, result);
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
    await settle(sweeping, session, read, named, found, ended, result, {
        phrase: response.phrase,
        secret,
    });
}

// What a read leaves behind once its events are dealt with: halts and new
// types kept aside, then the read remembered, unless it is torn or raced,
// halted, holds events behind an unanswered call before the session is
// over, or its diagnostics could not be kept. A torn or raced read may
// stop in the middle of a record that is whole next time: it keeps
// nothing aside. A private session keeps nothing, and is remembered.
async function settle(
    sweeping: Sweeping,
    session: SourceSession,
    read: SourceRead,
    named: string,
    found: View,
    ended: boolean,
    result: HostSweep,
    {
        phrase = null,
        secret = false,
    }: { phrase?: string | null; secret?: boolean } = {},
) {
    const { deps, state } = sweeping;
    let kept = true;
    if (!secret && read.stable) {
        // A halt with nothing new to record still belongs to a conversation
        // the session may already have.
        const conversation =
            phrase ??
            (found.halt === null || found.session === null
                ? null
                : ((await deps.conversation?.(session.host, named)) ?? null));
        kept = await keepAside(
            deps,
            session,
            named,
            found,
            conversation,
            result,
        );
    }
    const holding = !kept || found.halt !== null || (found.pending && !ended);
    if (secret || !holding) rememberRead(state, session.key, read);
}

async function keepAside(
    deps: SweepDeps,
    session: SourceSession,
    named: string,
    found: View,
    phrase: string | null,
    result: HostSweep,
): Promise<boolean> {
    const { host } = session;
    let kept = true;
    for (const { type, example } of found.unknown) {
        try {
            if (await keepNewType(deps.env, type, example)) {
                deps.log.warn(
                    `recording: ${host}: ${named} holds a record of a new type, ${type}; passed over`,
                );
            }
        } catch (error) {
            // Not remembered, so it is read, and kept, again.
            kept = false;
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
        return kept;
    }
    result.halted += 1;
    const { line, type, reason, rest, uuid = null } = found.halt;
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
                uuid,
                reason,
                at: (deps.now?.() ?? new Date()).toISOString(),
            },
            rest,
        );
        // Told when it is new, not at every sweep.
        if (before?.line === line) return kept;
    } catch (error) {
        deps.log.warn(
            `recording: ${host}: ${named}: its halt can't be kept (${describe(error)})`,
        );
    }
    deps.log.error(
        `recording: ${host}: ${named} halted at ${unit(host)} ${line} (${type ?? "no type"}): ${reason}`,
    );
    return kept;
}

// What Claude Code's reader left over, as the other hosts' do: for a
// session that waits, which the recorder never sees.
function claudeView(
    lines: readonly string[],
    found: LinesRead,
    session: string,
): View {
    return {
        session,
        cwd: null,
        parent: null,
        events: [],
        halt:
            found.halt === null
                ? null
                : {
                      line: found.halt.line + 1,
                      type: found.halt.type,
                      reason: found.halt.reason,
                      rest: lines.slice(found.halt.line),
                      uuid: found.halt.uuid,
                  },
        unknown: found.unknown.map(({ line, type }) => ({
            type,
            example: lines[line] ?? "",
        })),
        pending: found.held,
    };
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
    const id = basename(session.path, ".jsonl");
    const cwd = firstCwd(read.lines);
    // Privacy first: a private session keeps nothing, not even aside.
    if (deps.isPrivate?.({ host: "claude-code", session: id, cwd }) ?? false) {
        result.private += 1;
        rememberRead(state, session.key, read);
        return;
    }
    const lines = readLines(read.lines, { ended });
    if (waits(deps, lines.events, mark)) {
        result.waiting += 1;
        const found = claudeView(read.lines, lines, id);
        return settle(sweeping, session, read, id, found, ended, result);
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
