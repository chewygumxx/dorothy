// vim:set expandtab shiftwidth=4 filetype=typescript:
// SPDX-License-Identifier: GPL-3.0-only

//
//
// ~chewygumxx/dorothy.git
// ::: :/packages/memory/src/memory/open.ts
//
//

import { randomBytes } from "node:crypto";
import {
    type ChatSession,
    type Config,
    type Env,
    type NoticeSource,
    newPhrase,
    type RecallLaunch,
    type ResumedTurn,
    readConfig,
    type SessionStart,
    type StructuredCall,
    type Turn,
} from "@dorothy/core";
import { startNotices } from "../bodies/unread.js";
import { COMPACTION_TIMEOUT_MS } from "../compaction/compact.js";
import { clusterTokens, seedTurns } from "../compaction/plan.js";
import {
    type Claim,
    Compaction,
    type Outgoing,
    type SaveResult,
    type Seed,
} from "../compaction/session.js";
import { dataRoot } from "../facts/store.js";
import { entryHook } from "../history/commands.js";
import {
    type HookCommand,
    historyRoot,
    type MemoryHistory,
    maintainDaily,
    openHistory,
} from "../history/history.js";
import { Mirror } from "../history/mirror.js";
import { type MemoryRepo, MIRROR, NO_MIRROR } from "../history/repo.js";
import { parseKey } from "../history/seal.js";
import { identify } from "../projects/identify.js";
import { type SyncResult, syncProject } from "../projects/sync.js";
import { indexPath, RecallIndex } from "../recall/store.js";
import {
    readTranscript,
    TranscriptWriter,
    transcriptDir,
    transcriptPath,
} from "../transcript.js";
import { earlierSection } from "./block.js";
import { indexCatalogue } from "./catalogue.js";
import { tokens } from "./rank.js";
import { noticeChannel, sessionRecorder } from "./record.js";
import { MemoryService } from "./service.js";
import {
    appendClusters,
    type Cluster,
    type HistoryHandle,
    type Lock,
    type Recorder,
    readSidecar,
    updateSidecar,
} from "./sidecar.js";
import { type MemoryHooks, trackMemory } from "./track.js";
import { vocabularyPath } from "./vocabulary.js";

const describeError = (error: unknown) =>
    error instanceof Error ? error.message : String(error);

// A claim outlives the longest compaction by this much, as reviews' do.
const CLAIM_MARGIN_MS = 30_000;

// App's createSession: a session over every turn so far, compacting when
// compaction is on. Memory tracks the session App sees, not each inner
// one: it hears of a message when the user sends it, even one compaction
// holds back, so a review's idle wait ends then rather than starting a
// review that takes the claim while the message waits.
export function sessionMaker({
    compaction,
    connect,
    clusters,
    memory,
    turnEnded = null,
}: {
    compaction: Pick<Compaction, "session"> | null;
    // A new session from its seed, untracked.
    connect: (seed: Seed) => ChatSession;
    clusters: readonly Cluster[];
    memory: MemoryHooks | null;
    turnEnded?: (() => void) | null;
}): (turns: Turn[]) => ChatSession {
    const hooks = withTurnEnd(memory, turnEnded);
    return (turns) => {
        const session =
            compaction === null
                ? connect({ turns: seedTurns(turns, clusters), clusters })
                : compaction.session(turns, connect);
        return hooks === null ? session : trackMemory(session, hooks);
    };
}

// Memory's hooks, with history told of each turn's end after memory.
export function withTurnEnd(
    memory: MemoryHooks | null,
    turnEnded: (() => void) | null,
): MemoryHooks | null {
    if (turnEnded === null) {
        return memory;
    }
    return {
        sent: (text) => memory?.sent(text),
        ready: () => memory?.ready(),
        turnEnded: () => {
            memory?.turnEnded();
            turnEnded();
        },
    };
}

// Commits the live transcript at each turn's end, once it is flushed:
// in order, and never awaited by the chat. settled() is for quitting.
export function turnCommitter(
    history: Pick<MemoryHistory, "turn" | "warn">,
    path: string,
    flushed: () => Promise<void>,
): { ended: () => void; settled: () => Promise<void> } {
    let chain: Promise<void> = Promise.resolve();
    return {
        ended: () => {
            chain = chain.then(async () => {
                try {
                    await flushed();
                    await history.turn(path);
                } catch (error) {
                    history.warn(
                        `history: couldn't commit turn (${describeError(error)})`,
                    );
                }
            });
        },
        settled: () => chain,
    };
}

// Syncs chat's project in the background, one run at a time: a run asked
// for while one is under way runs once after it. Never awaited by the
// chat; settled() is for quitting.
export function projectSyncer(
    sync: () => Promise<SyncResult>,
    warn: (message: string) => void,
): { run(): void; settled(): Promise<void> } {
    let running: Promise<void> | null = null;
    let again = false;
    const once = async () => {
        try {
            const result = await sync();
            if (result.kind === "failed") {
                warn(`sync: ${result.reason}`);
            }
        } catch (error) {
            warn(`sync: ${describeError(error)}`);
        }
    };
    const loop = async () => {
        do {
            again = false;
            await once();
        } while (again);
        running = null;
    };
    return {
        run: () => {
            if (running !== null) {
                again = true;
                return;
            }
            running = loop();
        },
        settled: () => running ?? Promise.resolve(),
    };
}

// One source for App: memory's notices and history's.
export function mergeNotices(
    ...sources: (NoticeSource | null | undefined)[]
): NoticeSource | undefined {
    const present = sources.filter(
        (source): source is NoticeSource =>
            source !== null && source !== undefined,
    );
    if (present.length <= 1) {
        return present[0];
    }
    return {
        subscribe(listener) {
            const stops = present.map((source) => source.subscribe(listener));
            return () => {
                for (const stop of stops) {
                    stop();
                }
            };
        },
    };
}

export type LaunchedHistory = {
    history: MemoryHistory;
    mirror: Mirror;
    // Waits for a seal under way, never for a push.
    close(): Promise<void>;
};

// History at launch, before anything is read: opened under the index's
// lock, swept, and the mirror pushed in the background. Null when the config turns it off, or when it can't be used,
// which joins the launch's warnings with its own.
export async function launchHistory({
    config,
    index,
    warnings,
    env = process.env,
    hook = entryHook(),
    maintain = maintainDaily,
}: {
    config: Pick<Config, "history">;
    index: { lock: Lock } | null;
    warnings: string[];
    env?: Env;
    hook?: HookCommand | null;
    maintain?: (repo: MemoryRepo) => Promise<boolean>;
}): Promise<LaunchedHistory | null> {
    if (!config.history.enabled) {
        return null;
    }
    const opened = await openHistory({
        root: historyRoot(env),
        index,
        hook,
        warn: (message) => warnings.push(message),
    });
    if (!opened.ok) {
        warnings.push(opened.reason);
        return null;
    }
    const { history } = opened;
    await history.sweep();
    const mirror = new Mirror({
        repo: history.repo,
        lock: history.lock,
        key: () => parseKey(env.DOROTHY_MIRROR_KEY),
        token: () => env.DOROTHY_MIRROR_TOKEN ?? null,
        warn: (message) => history.warn(message),
        pushMs: config.history.pushSeconds * 1000,
    });
    history.afterCommit(() => mirror.schedule());
    // With a mirror, a push at every launch: what a push cut short at
    // quit left is sent now, and one with nothing new is cheap. The push
    // seals whatever waits first.
    let pushed: Promise<unknown> = Promise.resolve();
    try {
        if ((await history.repo.remote(MIRROR)) === null) {
            history.warn(NO_MIRROR);
        } else {
            pushed = mirror.push();
        }
    } catch (error) {
        history.warn(
            `history: couldn't look for the mirror (${describeError(error)})`,
        );
    }
    // The repack waits for the launch's push, so the two never run at
    // once, and is skipped once history has closed.
    let closed = false;
    void pushed.then(() => (closed ? false : maintain(history.repo)));
    warnings.push(...history.takeWarnings());
    return {
        history,
        mirror,
        close: async () => {
            closed = true;
            await mirror.stop();
            opened.close();
        },
    };
}

// Before each compaction: notes that became unreadable since launch are
// left alone, as at launch, so compaction stops rather than paying for
// clusters it can't save.
export async function notesReady(
    dir: string,
    phrase: string,
): Promise<SaveResult> {
    const notes = await readSidecar(dir, phrase);
    return notes.kind === "unparseable"
        ? { ok: false, reason: `its notes can't be read (${notes.reason})` }
        : { ok: true };
}

// Before each compaction: the turns about to leave are the transcript's
// turns of those numbers. Another chat writing to the conversation puts
// its own turns between this chat's, so that this chat's turn 5 may be the
// transcript's turn 7; a cluster saved for turns 5 and 6 would then
// describe the wrong ones, and resume would drop the transcript's own.
// Turns are only ever appended, so that they agree now means they always
// will, however much is written after. Without a transcript nothing is
// saved, and nothing is checked.
export async function turnsAgree(
    transcript: Pick<TranscriptWriter, "flushed"> | null,
    path: string,
    outgoing: Outgoing | null,
): Promise<SaveResult> {
    if (transcript === null || outgoing === null) {
        return { ok: true };
    }
    // Everything this chat has sent is on disk before it is read.
    await transcript.flushed();
    const written = (await readTranscript(path)).turns;
    for (const [at, turn] of outgoing.turns.entries()) {
        const number = outgoing.from + at;
        const theirs = written[number - 1];
        if (theirs?.role !== turn.role || theirs.text !== turn.text) {
            return {
                ok: false,
                reason: `turn ${number} here is not turn ${number} of its transcript, which another chat is writing to`,
            };
        }
    }
    return { ok: true };
}

// Compaction's save: the clusters and their cost go into the notes, unless
// the notes' clusters already reach their turns, which are handed back.
// Without a transcript there is no conversation for notes to describe;
// the clusters live in this launch only.
export function clusterSaver({
    dir,
    phrase,
    lock,
    transcript,
    recorder = null,
}: {
    dir: string;
    phrase: string;
    lock?: Lock;
    transcript: boolean;
    recorder?: Recorder | null;
}): (clusters: readonly Cluster[], costUsd: number) => Promise<SaveResult> {
    return async (added, costUsd) => {
        if (!transcript) {
            return { ok: true };
        }
        const result = await updateSidecar(
            dir,
            phrase,
            (current) => appendClusters(current, added, costUsd),
            lock,
            recorder === null
                ? undefined
                : {
                      recorder,
                      message: `compaction: ${phrase} (dorothy, ${added[0]?.model ?? "unknown"})`,
                  },
        );
        if (result.kind === "written") {
            return { ok: true };
        }
        if (result.kind !== "unchanged") {
            return { ok: false, reason: result.reason };
        }
        // Another TUI compacted this conversation first: compaction judges
        // whether its clusters can be taken up in place of these.
        return { ok: true, clusters: result.sidecar?.clusters ?? [] };
    };
}

// Compaction's claims on the conversation in the index, which reviews take
// too. Each chain of runs has its own owner: with one for the TUI, a run
// after App reconnects could take the claim the old chain still holds,
// whose release would then delete it while the new run works. A chain
// takes its claim at each run, renewing it once held, so that it lasts a
// call and a margin from the start of each.
export function indexClaims(
    index: Pick<RecallIndex, "claim" | "renew" | "release">,
    phrase: string,
): () => Claim {
    return () => {
        const owner = `${process.pid}-${randomBytes(4).toString("hex")}`;
        const life = COMPACTION_TIMEOUT_MS + CLAIM_MARGIN_MS;
        return {
            take: async () =>
                (await index.renew(phrase, owner, Date.now(), life)) ||
                index.claim(phrase, owner, Date.now(), life),
            release: () => index.release(phrase, owner),
        };
    };
}

// What the index serves in this chat: compaction when the chat compacts,
// which its unreadable notes can rule out whatever the config says.
export function indexUses(
    config: Pick<Config, "memory">,
    compactable: boolean,
): { memory: boolean; recall: boolean; compaction: boolean } {
    return {
        memory: config.memory.enabled,
        recall: config.memory.recall,
        compaction: compactable,
    };
}

// The index serves memory, recall, and compaction's claim and the sidecar's
// lock; it is opened when any of them is on, and serves only those. Without
// it, memory and recall are off and compaction runs unlocked.
export function openIndex<T>(
    uses: { memory: boolean; recall: boolean; compaction: boolean },
    open: () => T,
): { index: T | null; warning: string | null } {
    if (!uses.memory && !uses.recall && !uses.compaction) {
        return { index: null, warning: null };
    }
    try {
        return { index: open(), warning: null };
    } catch (error) {
        const lost = [
            ...(uses.memory ? ["memory"] : []),
            ...(uses.recall ? ["recall"] : []),
            ...(uses.compaction ? ["compaction's lock"] : []),
        ];
        const listed =
            lost.length === 1
                ? lost.join("")
                : `${lost.slice(0, -1).join(", ")} and ${lost.at(-1)}`;
        // Memory and recall lose the index itself. When only compaction
        // wanted it, "memory:" would be wrong, and "compaction:" would be
        // cleared by the first compaction that succeeds, which runs
        // unlocked and leaves this true; so it is worded by the index.
        const reason = describeError(error);
        return {
            index: null,
            warning:
                uses.memory || uses.recall
                    ? `memory: the index can't be opened (${reason}); starting without ${listed}`
                    : `index: can't be opened (${reason}); starting without ${listed}`,
        };
    }
}

// The chat's index, in the cache, when memory, recall or this chat's
// compaction uses it; null otherwise, or with a warning when it can't be
// opened.
export function openChatIndex(
    config: Pick<Config, "memory">,
    compactable: boolean,
    env: Env = process.env,
): { index: RecallIndex | null; warning: string | null } {
    return openIndex(indexUses(config, compactable), () =>
        RecallIndex.open(indexPath(env)),
    );
}

// Each step of quitting runs even if an earlier one throws, so a throw
// can't leave the index or the transcript open; the first throw is
// rethrown once all have run.
export async function closeInOrder(
    steps: readonly (() => unknown)[],
): Promise<void> {
    let failure: { error: unknown } | null = null;
    for (const step of steps) {
        try {
            await step();
        } catch (error) {
            failure ??= { error };
        }
    }
    if (failure !== null) {
        throw failure.error;
    }
}

// What memory needs of the model side, as text: it never builds a
// prompt from the persona itself.
export type MemoryPrompts = {
    // Reviews run on the chat persona, without recall.
    review: string;
    // Compaction runs on the persona of this chat's mode, without recall.
    compaction: string;
    // The promptHash a session records, with recall on or off.
    hash(recall: boolean): string;
    // The system prompt a session starting so would have, for
    // compaction's estimate of what a compacted session costs.
    session(start: SessionStart): string;
};

export type OpenMemoryOptions = {
    // The chat to resume, or null for a new one.
    resume: string | null;
    call: StructuredCall;
    prompts: MemoryPrompts;
    // A new session from memory's start, untracked and unrecorded.
    connect(start: SessionStart): ChatSession;
    recallLaunch(phrase: string): RecallLaunch;
    // The directory chat started in; its project, if any, is recorded and synced.
    cwd?: string | null;
    env?: Env;
};

// A chat's memory, open: what the screen starts from, the sessions it
// makes, and the notices it shows.
export type Memory = {
    phrase: string;
    history: ResumedTurn[];
    costUsd: number;
    config: Config;
    warnings: string[];
    notices: NoticeSource | undefined;
    createSession(turns: Turn[]): ChatSession;
    // Running reviews and compactions are closed unsaved, and let go of
    // their claims before the index they are held in closes.
    close(): Promise<void>;
};

export type OpenedMemory =
    | { ok: true; memory: Memory }
    | { ok: false; message: string };

export async function openMemory({
    resume,
    call,
    prompts,
    connect,
    recallLaunch,
    cwd = null,
    env = process.env,
}: OpenMemoryOptions): Promise<OpenedMemory> {
    const phrase = resume ?? newPhrase();
    const path = transcriptPath(phrase, env);
    const dir = transcriptDir(env);
    const warnings: string[] = [];
    const { config, warnings: configWarnings } = await readConfig(env);
    warnings.push(...configWarnings);
    // What Claude Code's hooks could not tell, and lines left unread,
    // told at chat's start as at dorothy --claude's.
    warnings.push(...(await startNotices(env).catch(() => [])));

    // The index and history open before anything is read, so that
    // history restores a broken file first. The index serves compaction
    // whenever the config lets it, since this chat's notes are not read
    // yet.
    const opened = openChatIndex(config, config.compaction.enabled, env);
    const index = opened.index;
    if (opened.warning !== null) {
        warnings.push(opened.warning);
    }
    const launched = await launchHistory({ config, index, warnings, env });

    const project = await identifyProject(cwd, warnings);
    const resumed =
        resume === null
            ? FRESH
            : await readResumed(resume, path, dir, warnings);
    if ("refusal" in resumed) {
        await closeInOrder([() => launched?.close(), () => index?.close()]);
        return { ok: false, message: resumed.refusal };
    }
    const { history, costUsd, clusters } = resumed;
    const compactable = compactionAllowed(config, resumed, warnings);
    const transcript = await openWriter(path, warnings, launched?.history.lock);
    const service =
        config.memory.enabled && index !== null
            ? await startService({
                  index,
                  dir,
                  phrase,
                  history,
                  config,
                  versions: launched?.history.handle() ?? null,
                  call,
                  persona: prompts.review,
                  transcript,
                  warnings,
                  env,
              })
            : null;

    const recall =
        config.memory.recall && index !== null ? recallLaunch(phrase) : null;

    // Every session, first, resumed, reconnected or compacted, starts the
    // same way: the clusters, the notes on other conversations with the
    // clusters' tokens charged first, then the turns after the clusters.
    const startOf = (seed: Seed): SessionStart => ({
        history: seed.turns,
        memory:
            service?.block(clusterTokens(seed.clusters, recall !== null)) ?? "",
        earlier: earlierSection(seed.clusters, recall !== null),
        recall,
        recollect: recall !== null && seed.clusters.length > 0,
    });

    const claims = index;
    // Canonical writers prefer history's combined lock, falling back
    // to the index when history is unavailable.
    const writeLock = launched?.history.lock ?? claims?.lock;
    const channel = noticeChannel();
    // Chat syncs its project at its start and after each turn; with
    // memory off, or without a lock to sync under, it does not.
    const syncer =
        !config.memory.enabled || project === null || cwd === null
            ? null
            : chatSyncer(cwd, writeLock, launched, channel, env);
    syncer?.run();
    const committer = chatCommitter(launched, transcript, path);
    const compaction = compactable
        ? chatCompaction({
              config,
              clusters,
              prompts,
              recollect: recall !== null,
              call,
              dir,
              phrase,
              path,
              writeLock,
              transcript,
              recorder: launched?.history.recorder ?? null,
              claims,
              startOf,
          })
        : null;

    // The recorder wraps what the session maker returns: it hears the one
    // session App sees across compaction's swaps, and records a message
    // when the user sends it, even one compaction holds back. That a
    // reply is appended before memory's turn-end hook asks for the flush
    // holds in either order, as the recorder records an event before
    // passing it on and trackMemory (track.ts) calls its hooks after.
    const record = chatRecorder(transcript, {
        phrase,
        promptHash: prompts.hash(recall !== null),
        resumed: history.length > 0,
        project,
        channel,
    });
    const make = sessionMaker({
        compaction,
        connect: (seed) => connect(startOf(seed)),
        clusters,
        memory: service,
        turnEnded: afterTurn(committer, syncer),
    });

    return {
        ok: true,
        memory: {
            phrase,
            history,
            costUsd,
            config,
            warnings,
            notices: mergeNotices(service, launched?.history, channel),
            createSession: (turns) => {
                const session = make(turns);
                return record === null ? session : record(session);
            },
            close: () =>
                closeInOrder([
                    () => compaction?.stop(),
                    () => service?.stop(),
                    () => committer?.settled(),
                    () => syncer?.settled(),
                    () => transcript?.close(),
                    () => launched?.close(),
                    () => index?.close(),
                ]),
        },
    };
}

// The project of the directory chat started in, if it is in one.
async function identifyProject(
    cwd: string | null,
    warnings: string[],
): Promise<string | null> {
    if (cwd === null) {
        return null;
    }
    try {
        return (await identify(cwd))?.id ?? null;
    } catch (error) {
        warnings.push(
            `project: ${cwd} can't be identified (${describeError(error)})`,
        );
        return null;
    }
}

// What a chat starts from: a new one, nothing.
type Resumed = {
    history: ResumedTurn[];
    costUsd: number;
    clusters: Cluster[];
    // Its notes can't be read; why.
    notesBroken: boolean;
    notesReason: string;
};

const FRESH: Resumed = {
    history: [],
    costUsd: 0,
    clusters: [],
    notesBroken: false,
    notesReason: "",
};

// A resumed conversation starts from its turns and its clusters; or why it
// can't be resumed. Claude Code's conversations are its hooks' to write,
// and Dorothy's compaction does not run on them.
async function readResumed(
    resume: string,
    path: string,
    dir: string,
    warnings: string[],
): Promise<Resumed | { refusal: string }> {
    let read: Awaited<ReturnType<typeof readTranscript>>;
    try {
        read = await readTranscript(path);
    } catch (error) {
        return {
            refusal: `cannot resume ${resume}: ${path}: ${describeError(error)}`,
        };
    }
    if (read.claudeSession !== null) {
        return {
            refusal: `cannot resume ${resume}: it is a Claude Code conversation; resume it there with dorothy --claude --resume ${read.claudeSession}`,
        };
    }
    if (read.skipped > 0) {
        warnings.push(`skipped ${read.skipped} malformed line(s) in ${path}`);
    }
    const notes = await readSidecar(dir, resume);
    return {
        history: read.turns,
        costUsd: read.costUsd,
        clusters: notes.kind === "ok" ? notes.sidecar.clusters : [],
        notesBroken: notes.kind === "unparseable",
        notesReason: notes.kind === "unparseable" ? notes.reason : "",
    };
}

async function openWriter(
    path: string,
    warnings: string[],
    lock?: Lock,
): Promise<TranscriptWriter | null> {
    try {
        return await TranscriptWriter.open(path, undefined, lock);
    } catch (error) {
        warnings.push(`transcript not saved: ${describeError(error)}`);
        return null;
    }
}

// Memory's service over the catalogue of other conversations.
async function startService({
    index,
    dir,
    phrase,
    history,
    config,
    versions,
    call,
    persona,
    transcript,
    warnings,
    env,
}: {
    index: RecallIndex;
    dir: string;
    phrase: string;
    history: ResumedTurn[];
    config: Config;
    versions: HistoryHandle | null;
    call: StructuredCall;
    persona: string;
    transcript: TranscriptWriter | null;
    warnings: string[];
    env: Env;
}): Promise<MemoryService> {
    const vocabulary = vocabularyPath(env);
    const loaded = await indexCatalogue(
        index,
        dir,
        vocabulary,
        dataRoot(env),
    ).load();
    warnings.push(...loaded.warnings);
    const service = new MemoryService({
        dir,
        phrase,
        history,
        config: config.memory,
        entries: loaded.entries,
        index,
        vocabulary,
        versions,
        call,
        persona,
        // Without a transcript the live chat is left alone.
        flushed: transcript === null ? null : () => transcript.flushed(),
    });
    warnings.push(...service.warnings());
    return service;
}

// Chat syncs its project at its start and after each turn; without a lock
// to sync under, it does not.
function chatSyncer(
    cwd: string,
    lock: Lock | undefined,
    launched: LaunchedHistory | null,
    channel: ReturnType<typeof noticeChannel>,
    env: Env,
): ReturnType<typeof projectSyncer> | null {
    if (lock === undefined) {
        return null;
    }
    return projectSyncer(
        () =>
            syncProject(cwd, {
                root: dataRoot(env),
                lock,
                recorder: launched?.history.recorder ?? null,
            }),
        (message) => channel.warn(message),
    );
}

// Compaction for this chat, from the clusters it resumed with.
function chatCompaction({
    config,
    clusters,
    prompts,
    recollect,
    call,
    dir,
    phrase,
    path,
    writeLock,
    transcript,
    recorder,
    claims,
    startOf,
}: {
    config: Config;
    clusters: Cluster[];
    prompts: MemoryPrompts;
    recollect: boolean;
    call: StructuredCall;
    dir: string;
    phrase: string;
    path: string;
    writeLock: Lock | undefined;
    transcript: TranscriptWriter | null;
    recorder: Recorder | null;
    claims: RecallIndex | null;
    startOf: (seed: Seed) => SessionStart;
}): Compaction {
    return new Compaction({
        config: config.compaction,
        // The review's idle wait too: at a shared idle compaction runs
        // first only because its timer is armed first, on the same
        // turn-end, and same-delay timers fire in order. Keep the two
        // delays shared, or order them some other way.
        idleMs: config.memory.idleSeconds * 1000,
        clusters,
        persona: prompts.compaction,
        // With recall on, a session with clusters offers recollect.
        recollect,
        call,
        save: clusterSaver({
            dir,
            phrase,
            ...(writeLock === undefined ? {} : { lock: writeLock }),
            transcript: transcript !== null,
            recorder,
        }),
        ready: async (outgoing) => {
            if (transcript === null) {
                return { ok: true };
            }
            const notes = await notesReady(dir, phrase);
            return notes.ok ? turnsAgree(transcript, path, outgoing) : notes;
        },
        record: async (entry) => {
            await transcript?.append({ kind: "compaction", ...entry });
        },
        estimate: (seed) => tokens(prompts.session(startOf(seed))),
        claims: claims === null ? null : indexClaims(claims, phrase),
    });
}

// Notes that cannot be read are never written, so compaction stays off
// for a chat whose notes are broken.
function compactionAllowed(
    config: Config,
    resumed: Resumed,
    warnings: string[],
): boolean {
    if (!config.compaction.enabled) {
        return false;
    }
    if (resumed.notesBroken) {
        warnings.push(
            `compaction: off for this chat; its notes can't be read (${resumed.notesReason})`,
        );
    }
    return !resumed.notesBroken;
}

// Each turn committed to history, once the transcript is flushed.
function chatCommitter(
    launched: LaunchedHistory | null,
    transcript: TranscriptWriter | null,
    path: string,
): ReturnType<typeof turnCommitter> | null {
    if (launched === null || transcript === null) {
        return null;
    }
    return turnCommitter(launched.history, path, () => transcript.flushed());
}

// At each turn's end: the turn committed, the project synced.
function afterTurn(
    committer: ReturnType<typeof turnCommitter> | null,
    syncer: ReturnType<typeof projectSyncer> | null,
): (() => void) | null {
    if (committer === null && syncer === null) {
        return null;
    }
    return () => {
        committer?.ended();
        syncer?.run();
    };
}

function chatRecorder(
    transcript: TranscriptWriter | null,
    {
        phrase,
        promptHash,
        resumed,
        project,
        channel,
    }: {
        phrase: string;
        promptHash: string;
        resumed: boolean;
        project: string | null;
        channel: ReturnType<typeof noticeChannel>;
    },
): ReturnType<typeof sessionRecorder> | null {
    if (transcript === null) {
        return null;
    }
    return sessionRecorder({
        sink: transcript,
        phrase,
        promptHash,
        resumed,
        ...(project === null ? {} : { project }),
        warn: (message) => channel.warn(message),
    });
}
