// vim:set expandtab shiftwidth=4 filetype=typescript:
// SPDX-License-Identifier: GPL-3.0-only

//
//
// ~chewygumxx/dorothy.git
// ::: :/packages/memory/src/service/jobs.ts
//
//

// The service's background work: conversations idle long enough are
// extracted from, and what extraction and consolidation propose is
// written as a write by the store's rules; recorded projects are
// consolidated and exported to their repositories now and then; other
// harnesses' sessions are swept at the start and on an interval.

import { type Config, knowledgeId } from "@dorothy/core";
import type { Proposal } from "../engine/engine.js";
import { knowledgePath, type MemoryEngine } from "../engine/engine.js";
import {
    type FactStore,
    isProjectId,
    PERSONAL,
    retireFact,
    type Scope,
    writeFact,
} from "../facts/store.js";
import { projectsPath, readRegistry } from "../projects/registry.js";
import { syncProject } from "../projects/sync.js";
import { guardFor } from "../recall/remember.js";
import { sweepSummary } from "../recording/report.js";
import type { HostSweep } from "../recording/sweep.js";
import { describeError } from "./http.js";

const TICK_MS = 15_000;
const EXPORT_MS = 600_000;

export type JobsDeps = {
    config: Config;
    engine: MemoryEngine;
    store: FactStore;
    // Conversations recorded and not yet extracted, by their last record.
    idle: Map<string, number>;
    // Conversations a backfill recorded, not extracted while they stay so:
    // each would cost a paid review. One that reaches idle is dropped from
    // it. A live record takes a conversation out (`noteRecorded`).
    backfilled: Set<string>;
    // Projects recorded since the last export.
    touched: Set<string>;
    // Reads the catalogue for the reviewer, which only reviews need.
    loadCatalogue: (() => Promise<void>) | null;
    warn: (message: string) => void;
    // Said once a sweep, with its counts.
    info?: ((message: string) => void) | undefined;
    // One sweep over the hosts, run at the start and every `everyMs`,
    // never two at once; none leaves the hosts alone.
    sweep?: { run: () => Promise<HostSweep[]>; everyMs: number } | null;
    // How often idle conversations are looked at; for tests.
    tickMs?: number | undefined;
};

// A record of `phrase`: a live one queues it for extraction, and frees it
// of a backfill's mark; a backfill's marks it, unless a live record
// already queued it.
export function noteRecorded(
    { idle, backfilled }: Pick<JobsDeps, "idle" | "backfilled">,
    phrase: string,
    backfill: boolean,
    now: number = Date.now(),
): void {
    if (!backfill) {
        backfilled.delete(phrase);
        idle.set(phrase, now);
    } else if (!idle.has(phrase)) {
        backfilled.add(phrase);
    }
}

export function startJobs(deps: JobsDeps): { stop(): Promise<void> } {
    const { config, engine, store, idle, backfilled, touched, warn } = deps;
    const { root, lock, recorder } = store;
    // An engine's proposal, validated as a write: one naming no project,
    // or refused, is dropped and said.
    const apply = async (proposal: Proposal) => {
        if (
            proposal.scope.kind === "project" &&
            !isProjectId(proposal.scope.id)
        ) {
            warn("a proposal named no project, and was dropped");
            return;
        }
        const id = knowledgeId(knowledgePath(proposal.scope, proposal.name));
        const result =
            proposal.action === "retire"
                ? await retireFact(
                      store,
                      { scope: proposal.scope, name: proposal.name },
                      {
                          by: "review",
                          why: proposal.why,
                          guard: guardFor(id, false, () => {}),
                      },
                  )
                : await writeFact(
                      store,
                      {
                          scope: proposal.scope,
                          name: proposal.name,
                          title: proposal.title,
                          description: proposal.description,
                          type: proposal.type,
                          body: proposal.body,
                          origin: "dorothy",
                          by: "review",
                          ...(proposal.from === undefined
                              ? {}
                              : { from: proposal.from }),
                      },
                      guardFor(id, true, () => {}),
                  );
        if (result.kind === "refused" || result.kind === "failed") {
            warn(`a proposal for ${id} was dropped: ${result.reason}`);
        }
    };

    const extraction = new AbortController();
    let extracting = false;
    const tick = setInterval(async () => {
        if (extracting) {
            return;
        }
        extracting = true;
        try {
            const wait = config.memory.idleSeconds * 1000;
            const due = [...idle]
                .filter(([, at]) => Date.now() - at >= wait)
                .map(([phrase]) => phrase);
            const extract = due.filter((phrase) => !backfilled.has(phrase));
            for (const phrase of due)
                if (backfilled.has(phrase)) idle.delete(phrase);
            // Without reviews the engine extracts nothing; only the
            // reviewer reads the catalogue.
            if (extract.length > 0) {
                await deps.loadCatalogue?.();
            }
            for (const phrase of extract) {
                idle.delete(phrase);
                const proposals = await engine.extract(
                    phrase,
                    extraction.signal,
                );
                for (const proposal of proposals.slice(
                    0,
                    config.memory.extractCap,
                )) {
                    await apply(proposal);
                }
            }
        } catch (error) {
            warn(`extraction failed: ${describeError(error)}`);
        } finally {
            extracting = false;
        }
    }, deps.tickMs ?? TICK_MS);
    // Periodically: consolidation, personal and of each project recorded,
    // then export of those projects to their repositories.
    const exporting = setInterval(async () => {
        const ids = [...touched];
        touched.clear();
        try {
            const scopes: Scope[] = [
                PERSONAL,
                ...ids.map((id) => ({ kind: "project" as const, id })),
            ];
            for (const scope of scopes) {
                for (const proposal of await engine.consolidate(scope)) {
                    await apply(proposal);
                }
            }
        } catch (error) {
            warn(`consolidation failed: ${describeError(error)}`);
        }
        if (ids.length === 0) {
            return;
        }
        const read = await readRegistry(projectsPath(root));
        for (const id of ids) {
            const roots =
                read.kind === "ok"
                    ? (read.registry.projects[id]?.roots ?? [])
                    : [];
            for (const at of roots) {
                const synced = await syncProject(at, {
                    root,
                    lock,
                    recorder,
                }).catch((error: unknown) => ({
                    kind: "failed" as const,
                    reason: describeError(error),
                }));
                if (synced.kind === "failed") {
                    warn(`export of ${id} failed: ${synced.reason}`);
                }
            }
        }
    }, EXPORT_MS);

    // Sweeps: the next waits for the one under way, which stop() awaits.
    let sweeping: Promise<void> | null = null;
    const sweepOnce = () => {
        const { sweep } = deps;
        if (sweep == null || sweeping !== null) {
            return;
        }
        const done = (async () => {
            try {
                deps.info?.(sweepSummary(await sweep.run()));
            } catch (error) {
                warn(`recording: sweep failed: ${describeError(error)}`);
            }
        })();
        sweeping = done;
        void done.then(() => {
            sweeping = null;
        });
    };
    const sweepTimer =
        deps.sweep == null ? null : setInterval(sweepOnce, deps.sweep.everyMs);
    sweepOnce();

    return {
        async stop() {
            clearInterval(tick);
            clearInterval(exporting);
            if (sweepTimer !== null) {
                clearInterval(sweepTimer);
            }
            extraction.abort();
            await sweeping;
        },
    };
}
