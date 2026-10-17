// vim:set expandtab shiftwidth=4 filetype=typescript:
// SPDX-License-Identifier: GPL-3.0-only

//
//
// ~chewygumxx/dorothy.git
// ::: :/packages/memory/src/bodies/hook.ts
//
//

// dorothy --claude-hook: what Claude Code's hooks run in a launch of
// dorothy --claude. A Stop records the session, syncs the launch's
// project and reviews by chat's rule; a SessionEnd hands its session to
// a detached catch-up and returns at once; the catch-up does that for
// every session of a launch once claude has exited. Claude Code owns
// the terminal, so the hook and the catch-up write nothing to it and
// always exit 0: what went wrong is in the hook's log. --reread and
// --dismiss are the user's, and speak.

import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { open, readdir, stat } from "node:fs/promises";
import { join } from "node:path";
import {
    type Env,
    isUuid,
    REAL_TIMERS,
    readConfig,
    type StructuredCall,
    sleep,
    type Timers,
} from "@dorothy/core";
import { dataRoot } from "../facts/store.js";
import { commandHistory } from "../history/commands.js";
import { indexCatalogue } from "../memory/catalogue.js";
import { REVIEW_TIMEOUT_MS } from "../memory/review.js";
import { Reviewer, type ReviewProblem } from "../memory/reviewer.js";
import { type HistoryHandle, readSidecar } from "../memory/sidecar.js";
import { vocabularyPath } from "../memory/vocabulary.js";
import { identify } from "../projects/identify.js";
import { syncProject } from "../projects/sync.js";
import { indexPath, RecallIndex } from "../recall/store.js";
import { syncIndex } from "../recall/sync.js";
import { readTranscript, transcriptDir } from "../transcript.js";
import {
    type LaunchNote,
    launchHolds,
    launchSessions,
    noteSession,
    readLaunch,
    removeLaunch,
    type SessionNote,
} from "./launches.js";
import { type HookLog, hookLog } from "./log.js";
import { type Recorded, recordSession, type SessionReport } from "./record.js";
import {
    addNotice,
    copyPath,
    dismissHalt,
    halts,
    readRecord,
    unreadDir,
} from "./unread.js";

export type HookMode =
    | { kind: "hook" }
    | { kind: "catch-up"; launch: string; session: string | null }
    | { kind: "reread" }
    | { kind: "dismiss"; session: string };

export type Output = { write(text: string): unknown };

export type HookDeps = {
    env?: Env;
    stdin?: () => Promise<string>;
    // Reviews, as chat's: the agent's call and the persona without recall.
    call: StructuredCall;
    persona: string;
    // This program as a command, for the detached catch-up.
    self: readonly string[];
    spawnDetached?: (cmd: string[]) => void;
    timers?: Timers;
    now?: () => Date;
    // For --reread and --dismiss alone.
    out?: Output;
    err?: Output;
};

export type HookInput = {
    event: string;
    session: string;
    transcript: string;
    cwd: string;
};

const describeError = (error: unknown) =>
    error instanceof Error ? error.message : String(error);
// A claim outlives the longest review by this much, as chat's do.
const CLAIM_MARGIN_MS = 30_000;

const PROBLEMS: Record<ReviewProblem["kind"], string> = {
    transcript: "its transcript can't be read",
    call: "the review call failed",
    notes: "the review's notes were not usable",
    save: "its notes can't be saved",
    tags: "tags are paused: the vocabulary can't be read",
};

// A reviewer's warning as the log may hold it: never the message,
// which names the title, but a failed call's error.
const reviewProblem = (problem: ReviewProblem) => {
    const what =
        problem.error === undefined
            ? PROBLEMS[problem.kind]
            : `${PROBLEMS[problem.kind]} (${problem.error})`;
    return problem.phrase === null
        ? `review: ${what}`
        : `review of ${problem.phrase}: ${what}`;
};

// A hook's JSON on stdin, or null for one it cannot use.
export function parseHookInput(text: string): HookInput | null {
    try {
        const input = JSON.parse(text) as Record<string, unknown>;
        const {
            hook_event_name: event,
            session_id: session,
            transcript_path: transcript,
            cwd,
        } = input;
        return typeof event === "string" &&
            typeof session === "string" &&
            isUuid(session) &&
            typeof transcript === "string" &&
            typeof cwd === "string"
            ? { event, session, transcript, cwd }
            : null;
    } catch {
        return null;
    }
}

// Whether a main-thread line of the conversation has come after size
// bytes: a reply, or a prompt the user has sent. Bookkeeping does not
// count.
export async function activitySince(
    path: string,
    size: number,
): Promise<boolean> {
    let text: string;
    try {
        const handle = await open(path, "r");
        try {
            const length = Math.max(0, (await handle.stat()).size - size);
            const bytes = Buffer.alloc(length);
            await handle.read(bytes, 0, length, size);
            text = bytes.toString("utf8");
        } finally {
            await handle.close();
        }
    } catch {
        return false;
    }
    return text.split("\n").some((line) => {
        try {
            const event = JSON.parse(line) as {
                type?: unknown;
                isSidechain?: unknown;
            };
            return (
                (event.type === "user" ||
                    event.type === "assistant" ||
                    event.type === "attachment") &&
                event.isSidechain !== true
            );
        } catch {
            return false;
        }
    });
}

// A hook's work on one session, apart from files and processes.
export type Steps = {
    record(ended: boolean): Promise<Recorded>;
    sync(): Promise<void>;
    state(
        phrase: string,
    ): Promise<{ reviewedThrough: number; turns: number; hidden: boolean }>;
    review(phrase: string): Promise<void>;
    activity(size: number): Promise<boolean>;
    sleep(ms: number): Promise<void>;
};

// After a reply: record and sync. A conversation never reviewed is
// reviewed at once; otherwise, once it has been idle, unless a later
// hook has it, it is recorded again and reviewed if turns are uncovered.
export async function afterStop(steps: Steps, idleMs: number): Promise<void> {
    const first = await steps.record(false);
    if (first.kind !== "recorded") {
        return;
    }
    await steps.sync();
    const state = await steps.state(first.phrase);
    if (state.hidden) {
        return;
    }
    if (state.reviewedThrough === 0 && state.turns > 0) {
        await steps.review(first.phrase);
        return;
    }
    await steps.sleep(idleMs);
    if (await steps.activity(first.size)) {
        return;
    }
    const again = await steps.record(false);
    if (again.kind !== "recorded") {
        return;
    }
    const now = await steps.state(again.phrase);
    if (!now.hidden && now.turns > now.reviewedThrough) {
        await steps.review(again.phrase);
    }
}

// At a session's end, or catching one up: record to the end, a call
// never answered recorded failed; sync; review what is uncovered.
export async function afterEnd(steps: Steps): Promise<void> {
    const done = await steps.record(true);
    if (done.kind !== "recorded") {
        return;
    }
    await steps.sync();
    const state = await steps.state(done.phrase);
    if (!state.hidden && state.turns > state.reviewedThrough) {
        await steps.review(done.phrase);
    }
}

// What one process holds while it records: the index, history, and the
// launch's project.
type Held = {
    env: Env;
    log: HookLog;
    index: RecallIndex | null;
    versions: HistoryHandle | null;
    deps: HookDeps;
    now: () => Date;
};

// Opens the index (synced, so a rebuilt one knows its sessions) and
// history, which commits without the mirror, for work; null, told at
// the next start, when neither can lock the store.
async function holding(
    env: Env,
    log: HookLog,
    deps: HookDeps,
    work: (held: Held) => Promise<void>,
): Promise<boolean> {
    let index: RecallIndex | null = null;
    try {
        index = RecallIndex.open(indexPath(env));
        const warnings = await syncIndex(
            index,
            transcriptDir(env),
            Date.now(),
            vocabularyPath(env),
            dataRoot(env),
        );
        for (const warning of warnings) {
            log.warn(warning);
        }
    } catch (error) {
        log.warn(`the index can't be opened (${describeError(error)})`);
        index?.close();
        index = null;
    }
    const versions = await commandHistory({
        env,
        remindMirror: false,
        err: { write: (text: string) => log.warn(text.trim()) },
    })(index);
    if (index === null && versions === null) {
        log.error(
            "neither the index nor history can lock the store: nothing recorded",
        );
        await addNotice(
            env,
            "memory: a Claude Code session was not recorded: neither the memory index nor history could be opened (see claude-hook.log)",
        ).catch(() => {});
        return false;
    }
    try {
        await work({
            env,
            log,
            index,
            versions,
            deps,
            now: deps.now ?? (() => new Date()),
        });
    } finally {
        versions?.close();
        index?.close();
    }
    return true;
}

async function stepsFor(
    held: Held,
    report: Omit<SessionReport, "ended">,
): Promise<Steps> {
    const { env, log, index, versions, deps, now } = held;
    const dir = transcriptDir(env);
    const project = (await identify(report.dir).catch(() => null))?.id ?? null;
    const timers = deps.timers ?? REAL_TIMERS;
    const { config } = await readConfig(env);
    return {
        record: async (ended) => {
            const recorded = await recordSession(
                { ...report, ended },
                { env, index, versions, log, project, now },
            );
            if (recorded.kind === "missing") {
                log.warn(
                    `session ${report.session}: its transcript can't be read (${recorded.reason})`,
                );
            }
            return recorded;
        },
        sync: async () => {
            const lock = index?.lock ?? versions?.lock;
            if (lock === undefined) {
                return;
            }
            const result = await syncProject(report.dir, {
                root: dataRoot(env),
                lock,
                recorder: versions?.recorder ?? null,
            }).catch((error: unknown) => ({
                kind: "failed" as const,
                reason: describeError(error),
            }));
            if (result.kind === "failed") {
                log.warn(`sync failed: ${result.reason}`);
            }
        },
        state: async (phrase) => {
            const read = await readSidecar(dir, phrase);
            const sidecar = read.kind === "ok" ? read.sidecar : null;
            const turns = (
                await readTranscript(join(dir, `${phrase}.jsonl`)).catch(
                    () => ({ turns: [] }),
                )
            ).turns.length;
            return {
                reviewedThrough: sidecar?.reviewedThrough ?? 0,
                turns,
                // Notes that cannot be read are never written over.
                hidden: read.kind === "unparseable" || sidecar?.hidden === true,
            };
        },
        review: async (phrase) => {
            if (index === null) {
                log.info(
                    `no review of ${phrase} without the index; chat's catch-up will`,
                );
                return;
            }
            const loaded = await indexCatalogue(
                index,
                dir,
                vocabularyPath(env),
                dataRoot(env),
            ).load();
            for (const warning of loaded.warnings) {
                log.warn(warning);
            }
            const owner = `${process.pid}-${randomBytes(4).toString("hex")}`;
            const claimed = await index.claim(
                phrase,
                owner,
                now().getTime(),
                REVIEW_TIMEOUT_MS + CLAIM_MARGIN_MS,
            );
            if (!claimed) {
                log.info(`${phrase} is under review elsewhere`);
                return;
            }
            try {
                const reviewer = new Reviewer({
                    dir,
                    config: config.memory,
                    index,
                    vocabulary: vocabularyPath(env),
                    versions,
                    call: deps.call,
                    persona: deps.persona,
                    now,
                    entries: () => loaded.entries,
                    // The log names the phrase, the kind and a call's
                    // error: the message holds the title.
                    warn: (_message, problem) =>
                        log.warn(reviewProblem(problem)),
                    cost: (usd) =>
                        log.info(`review of ${phrase} cost $${usd.toFixed(4)}`),
                });
                const reviewed = await reviewer.review(
                    phrase,
                    new AbortController().signal,
                );
                log.info(`review of ${phrase}: ${reviewed.kind}`);
            } finally {
                await index.release(phrase, owner);
            }
        },
        activity: (size) => activitySince(report.transcript, size),
        sleep: (ms) => sleep(timers, ms, new AbortController().signal),
    };
}

const reportOf = (
    note: Pick<SessionNote, "session" | "transcript">,
    launch: LaunchNote,
) => ({
    session: note.session,
    transcript: note.transcript,
    dir: launch.dir,
    since: Date.parse(launch.started),
});

// Claude Code's transcript of a session, under its config directory.
async function findTranscript(
    claude: string,
    session: string,
): Promise<string | null> {
    const projects = join(claude, "projects");
    for (const name of await readdir(projects).catch(() => [] as string[])) {
        const path = join(projects, name, `${session}.jsonl`);
        if (((await stat(path).catch(() => null))?.size ?? 0) > 0) {
            return path;
        }
    }
    return null;
}

async function onHook(env: Env, log: HookLog, deps: HookDeps): Promise<void> {
    const input = parseHookInput(
        await (deps.stdin ?? (() => Bun.stdin.text()))(),
    );
    if (input === null) {
        log.error("a hook's input could not be read");
        return;
    }
    const launchId = env.DOROTHY_LAUNCH ?? "";
    const launch = isUuid(launchId) ? await readLaunch(env, launchId) : null;
    if (launch === null) {
        log.error(
            `session ${input.session}: ${input.event} came with no launch Dorothy noted`,
        );
        return;
    }
    const now = deps.now ?? (() => new Date());
    await noteSession(env, launchId, {
        session: input.session,
        transcript: input.transcript,
        cwd: input.cwd,
        seen: now().toISOString(),
        ...(input.event === "SessionEnd" ? { ended: true } : {}),
    });
    if (input.event === "SessionEnd") {
        (deps.spawnDetached ?? spawnDetached)([
            ...deps.self,
            "--claude-hook",
            "--catch-up",
            launchId,
            "--session",
            input.session,
        ]);
        return;
    }
    if (input.event !== "Stop") {
        log.warn(
            `session ${input.session}: ${input.event} is not a hook Dorothy asked for`,
        );
        return;
    }
    const { config } = await readConfig(env);
    await holding(env, log, deps, async (held) =>
        afterStop(
            await stepsFor(held, reportOf(input, launch)),
            config.memory.idleSeconds * 1000,
        ),
    );
}

async function catchUp(
    env: Env,
    log: HookLog,
    deps: HookDeps,
    launchId: string,
    only: string | null,
): Promise<void> {
    const launch = await readLaunch(env, launchId);
    if (launch === null) {
        log.warn(`launch ${launchId}: no notes to catch up`);
        if (only === null) {
            await removeLaunch(env, launchId);
        }
        return;
    }
    let notes = await launchSessions(env, launchId);
    if (only !== null) {
        notes = notes.filter((note) => note.session === only);
    } else if (
        launch.session !== null &&
        !notes.some((note) => note.session === launch.session)
    ) {
        const transcript = await findTranscript(launch.claude, launch.session);
        if (transcript !== null) {
            notes.push({
                v: 1,
                session: launch.session,
                transcript,
                cwd: launch.dir,
                seen: launch.started,
            });
            log.warn(
                `session ${launch.session}: Claude Code ran no hooks; recorded at the catch-up`,
            );
            await addNotice(
                env,
                `memory: Claude Code ran no hooks in session ${launch.session} (disableAllHooks, an untrusted folder, --bare or --safe-mode turn them off); it is recorded at the catch-up instead`,
            ).catch((error: unknown) =>
                log.warn(
                    `session ${launch.session}: its notice can't be kept (${describeError(error)})`,
                ),
            );
        }
    }
    await holding(env, log, deps, async (held) => {
        for (const note of notes) {
            await afterEnd(await stepsFor(held, reportOf(note, launch)));
        }
    });
    if (only === null) {
        await removeLaunch(env, launchId);
    }
}

async function reread(
    env: Env,
    log: HookLog,
    deps: HookDeps,
    out: Output,
    err: Output,
): Promise<number> {
    const records = await halts(env);
    if (records.length === 0) {
        out.write("dorothy: no unreadable lines are kept\n");
        return 0;
    }
    let failed = 0;
    const held = await holding(env, log, deps, async (held) => {
        for (const record of records) {
            const there =
                ((await stat(record.transcript).catch(() => null))?.size ?? 0) >
                0;
            const steps = await stepsFor(held, {
                session: record.session,
                transcript: there
                    ? record.transcript
                    : copyPath(env, record.session),
                dir: record.dir,
                since: record.since,
            });
            // A session no launch holds is over: a call never answered
            // is recorded failed, not waited for.
            const recorded = await steps.record(
                !(await launchHolds(env, record.session)),
            );
            // Nothing to record, and no halt kept: it read to its end.
            const read =
                recorded.kind === "recorded"
                    ? !recorded.halted
                    : recorded.kind === "nothing" &&
                      (await readRecord(env, record.session)) === null;
            if (read) {
                out.write(`dorothy: read ${record.session} to its end\n`);
                if (recorded.kind === "recorded") {
                    await steps.sync();
                }
            } else {
                failed += 1;
                const kept = await halts(env);
                const now = kept.find((one) => one.session === record.session);
                err.write(
                    `dorothy: ${record.session} still can't be read${now === undefined ? "" : ` past line ${now.line} (${now.reason})`}\n`,
                );
            }
        }
    });
    if (!held) {
        err.write(
            "dorothy: neither the memory index nor history can lock the store\n",
        );
        return 1;
    }
    return failed === 0 ? 0 : 1;
}

function spawnDetached(cmd: string[]): void {
    const [command, ...args] = cmd;
    if (command === undefined) {
        return;
    }
    // Its own session, so claude's teardown does not take it.
    spawn(command, args, { detached: true, stdio: "ignore" })
        .on("error", () => {})
        .unref();
}

export async function runClaudeHook(
    mode: HookMode,
    deps: HookDeps,
): Promise<number> {
    const env = deps.env ?? process.env;
    const out = deps.out ?? process.stdout;
    const err = deps.err ?? process.stderr;
    const log = hookLog(env, deps.now === undefined ? {} : { now: deps.now });
    if (mode.kind === "dismiss") {
        if (await dismissHalt(env, mode.session)) {
            out.write(
                `dorothy: ${mode.session} will not be told again; its lines stay in ${unreadDir(env)}\n`,
            );
            return 0;
        }
        err.write(`dorothy: no unreadable session ${mode.session}\n`);
        return 1;
    }
    if (mode.kind === "reread") {
        return reread(env, log, deps, out, err);
    }
    try {
        if (mode.kind === "hook") {
            await onHook(env, log, deps);
        } else {
            await catchUp(env, log, deps, mode.launch, mode.session);
        }
    } catch (error) {
        log.error(describeError(error));
    }
    return 0;
}
