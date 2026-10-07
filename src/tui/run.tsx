// vim:set expandtab shiftwidth=4 filetype=typescriptreact:
// SPDX-License-Identifier: GPL-3.0-only

//
//
// ~chewygumxx/dorothy.git
// ::: :/src/tui/run.tsx
//
//

import { randomBytes } from "node:crypto";
import { render } from "ink";
import { COMPACTION_TIMEOUT_MS } from "../compaction/compact.js";
import { clusterTokens, seedTurns } from "../compaction/plan.js";
import {
    type Claim,
    Compaction,
    type SaveResult,
    type Seed,
} from "../compaction/session.js";
import { type Config, readConfig } from "../config.js";
import {
    type ChatSession,
    Conversation,
    conversationOptions,
    recallLaunch,
    type SessionSetup,
} from "../conversation.js";
import { indexCatalogue } from "../memory/catalogue.js";
import { tokens } from "../memory/rank.js";
import { MemoryService } from "../memory/service.js";
import {
    appendClusters,
    type Cluster,
    type Lock,
    readSidecar,
    updateSidecar,
} from "../memory/sidecar.js";
import { type MemoryHooks, trackMemory } from "../memory/track.js";
import {
    type PersonaMode,
    personaPrompt,
    promptHash,
    type Turn,
} from "../persona.js";
import { indexPath, RecallIndex } from "../recall/store.js";
import { newPhrase } from "../session-id.js";
import { structuredCall } from "../structured.js";
import {
    type ResumedTurn,
    readTranscript,
    TranscriptWriter,
    transcriptDir,
    transcriptPath,
} from "../transcript.js";
import { App } from "./App.js";
import { editInEditor } from "./external-editor.js";

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
}: {
    compaction: Pick<Compaction, "session"> | null;
    // A new session from its seed, untracked.
    connect: (seed: Seed) => ChatSession;
    clusters: readonly Cluster[];
    memory: MemoryHooks | null;
}): (turns: Turn[]) => ChatSession {
    return (turns) => {
        const session =
            compaction === null
                ? connect({ turns: seedTurns(turns, clusters), clusters })
                : compaction.session(turns, connect);
        return memory === null ? session : trackMemory(session, memory);
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

// Compaction's save: the clusters and their cost go into the notes, unless
// the notes' clusters already reach their turns, which are handed back.
// Without a transcript there is no conversation for notes to describe;
// the clusters live in this run only.
export function clusterSaver({
    dir,
    phrase,
    lock,
    transcript,
}: {
    dir: string;
    phrase: string;
    lock?: Lock;
    transcript: boolean;
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
): { index: RecallIndex | null; warning: string | null } {
    return openIndex(indexUses(config, compactable), () =>
        RecallIndex.open(indexPath()),
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

export async function runTui(
    resume: string | null,
    persona: PersonaMode = "chat",
): Promise<number> {
    const phrase = resume ?? newPhrase();
    const path = transcriptPath(phrase);
    const dir = transcriptDir();
    let history: ResumedTurn[] = [];
    let costUsd = 0;
    const warnings: string[] = [];
    const { config, warnings: configWarnings } = await readConfig();
    warnings.push(...configWarnings);

    // A resumed conversation starts from its clusters. Notes that cannot be
    // read are never written, so compaction stays off for this chat.
    let clusters: Cluster[] = [];
    let compactable = config.compaction.enabled;
    if (resume !== null) {
        try {
            const read = await readTranscript(path);
            history = read.turns;
            costUsd = read.costUsd;
            if (read.skipped > 0) {
                warnings.push(
                    `skipped ${read.skipped} malformed line(s) in ${path}`,
                );
            }
        } catch (error) {
            process.stderr.write(
                `dorothy: cannot resume ${resume}: ${path}: ${describeError(error)}\n`,
            );
            return 1;
        }
        const notes = await readSidecar(dir, phrase);
        if (notes.kind === "ok") {
            clusters = notes.sidecar.clusters;
        } else if (notes.kind === "unparseable" && compactable) {
            compactable = false;
            warnings.push(
                `compaction: off for this chat; its notes can't be read (${notes.reason})`,
            );
        }
    }

    let writer: TranscriptWriter | null = null;
    try {
        writer = await TranscriptWriter.open(path);
    } catch (error) {
        warnings.push(`transcript not saved: ${describeError(error)}`);
    }
    const transcript = writer;

    // The index is opened before the first session, whose prompt carries
    // the block.
    const opened = openChatIndex(config, compactable);
    const index = opened.index;
    if (opened.warning !== null) {
        warnings.push(opened.warning);
    }
    let memory: MemoryService | null = null;
    if (config.memory.enabled && index !== null) {
        const loaded = await indexCatalogue(index, dir).load();
        warnings.push(...loaded.warnings);
        memory = new MemoryService({
            dir,
            phrase,
            history,
            config: config.memory,
            entries: loaded.entries,
            index,
            // Without a transcript the live chat is left alone.
            flushed: transcript === null ? null : () => transcript.flushed(),
        });
        warnings.push(...memory.warnings());
    }

    const recall =
        config.memory.recall && index !== null ? recallLaunch(phrase) : null;

    // Every session, first, resumed, reconnected or compacted, starts the
    // same way: the clusters, the notes on other conversations with the
    // clusters' tokens charged first, then the turns after the clusters.
    const setup = (seed: Seed): SessionSetup => ({
        history: seed.turns,
        clusters: seed.clusters,
        memory:
            memory?.block(clusterTokens(seed.clusters, recall !== null)) ?? "",
        recall,
        persona,
    });
    const connect = (seed: Seed): ChatSession => {
        const conversation = new Conversation(setup(seed));
        conversation.start();
        return conversation;
    };

    const claims = index;
    const compaction = compactable
        ? new Compaction({
              config: config.compaction,
              // The review's idle wait too: at a shared idle compaction
              // runs first only because its timer is armed first, on the
              // same turn-end, and same-delay timers fire in order. Keep
              // the two delays shared, or order them some other way.
              idleMs: config.memory.idleSeconds * 1000,
              clusters,
              persona: personaPrompt({ recall: false, mode: persona }),
              // With recall on, a session with clusters offers recollect.
              recollect: recall !== null,
              call: structuredCall(),
              save: clusterSaver({
                  dir,
                  phrase,
                  ...(claims === null ? {} : { lock: claims.lock }),
                  transcript: transcript !== null,
              }),
              ready: () =>
                  transcript === null
                      ? Promise.resolve({ ok: true })
                      : notesReady(dir, phrase),
              record: async (entry) => {
                  await transcript?.append({ kind: "compaction", ...entry });
              },
              estimate: (seed) =>
                  tokens(String(conversationOptions(setup(seed)).systemPrompt)),
              claims: claims === null ? null : indexClaims(claims, phrase),
          })
        : null;

    const app = render(
        <App
            phrase={phrase}
            promptHash={promptHash(
                personaPrompt({ recall: recall !== null, mode: persona }),
            )}
            history={history}
            editDraft={(text) => editInEditor(text)}
            createSession={sessionMaker({
                compaction,
                connect,
                clusters,
                memory,
            })}
            notices={memory ?? undefined}
            transcript={writer}
            initialWarnings={warnings}
            initialCostUsd={costUsd}
            config={config}
        />,
        // Kitty-protocol terminals report Shift+Enter apart from Enter.
        { exitOnCtrlC: false, kittyKeyboard: { mode: "auto" } },
    );
    try {
        await app.waitUntilExit();
    } finally {
        // Running reviews and compactions are closed unsaved, and let go
        // of their claims before the index they are held in closes.
        await closeInOrder([
            () => compaction?.stop(),
            () => memory?.stop(),
            () => index?.close(),
            () => writer?.close(),
        ]);
    }
    return 0;
}
