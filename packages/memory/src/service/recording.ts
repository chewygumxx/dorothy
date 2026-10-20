// vim:set expandtab shiftwidth=4 filetype=typescript:
// SPDX-License-Identifier: GPL-3.0-only

//
//
// ~chewygumxx/dorothy.git
// ::: :/packages/memory/src/service/recording.ts
//
//

// The sweep bound to a running store: the contract's record path and
// Claude Code's recorder under the store's one lock (each takes it
// itself, so a sweep never holds it while calling them), the index
// brought up to date before a session's conversation is looked up, and
// what a record means to extraction and export set down in the jobs'
// maps. The service binds it to its own, `dorothy --sweep` to maps that
// nothing reads.

import type { Env } from "@dorothy/core";
import type { HookLog } from "../bodies/log.js";
import { recordSession } from "../bodies/record.js";
import { acceptRecord, type Held, sessionKey } from "../contract/record.js";
import type { FactStore } from "../facts/store.js";
import type { HistoryHandle } from "../memory/sidecar.js";
import type { RecallIndex } from "../recall/store.js";
import { sessionPhrase } from "../recall/sync.js";
import type { Host } from "../recording/sources.js";
import { type HostSweep, type SweepDeps, sweep } from "../recording/sweep.js";
import { type JobsDeps, noteRecorded } from "./jobs.js";

export type SweepBinding = {
    env: Env;
    hosts: readonly Host[];
    // `[service] claude-dirs`, besides Claude Code's own directory.
    claudeDirs: readonly string[];
    store: FactStore;
    index: RecallIndex;
    // History's handle, whose lock is the store's.
    versions: HistoryHandle | null;
    // Brings the index up to date; called outside the lock, as it takes it.
    sync: () => Promise<unknown>;
    // Conversations by session key, and the ids last read of each file:
    // the record route's, so both find a session's conversation alike.
    sessions: Map<string, string>;
    held: Map<string, Held>;
    // Where a record leaves its conversation and its project.
    idle: JobsDeps["idle"];
    backfilled: JobsDeps["backfilled"];
    touched: JobsDeps["touched"];
    log: HookLog;
    now?: () => Date;
};

export function sweepDeps(
    binding: SweepBinding,
    backfill: boolean,
    only?: SweepDeps["only"],
): SweepDeps {
    const { env, index, store, sessions, log } = binding;
    return {
        hosts: binding.hosts,
        backfill,
        ...(only === undefined ? {} : { only }),
        env,
        store,
        claudeDirs: binding.claudeDirs,
        log,
        ...(binding.now === undefined ? {} : { now: binding.now }),
        // None of Claude Code, Codex or Hermes marks a session private in
        // its store, so none is judged so. A harness that does (OpenClaw's
        // incognito) will answer here when its reader joins.
        isPrivate: () => false,
        record: async (request) => {
            const result = await acceptRecord(request, {
                env,
                index,
                recorder: store.recorder,
                lock: store.lock,
                loopback: true,
                sync: binding.sync,
                claudeTranscript: null,
                sessions,
                held: binding.held,
                ...(binding.now === undefined ? {} : { now: binding.now }),
            });
            return {
                ...result,
                phrase:
                    sessions.get(sessionKey(request.host, request.session)) ??
                    null,
            };
        },
        recordClaude: (report, project) =>
            recordSession(report, {
                env,
                index,
                versions: binding.versions,
                log,
                project,
                ...(binding.now === undefined ? {} : { now: binding.now }),
            }),
        conversation: async (host, session) => {
            await binding.sync();
            return sessionPhrase(index, sessionKey(host, session));
        },
        onRecorded: ({ phrase, project, backfilled }) => {
            noteRecorded(binding, phrase, backfilled);
            if (project !== null) {
                binding.touched.add(project);
            }
        },
    };
}

export function sweepBinding(binding: SweepBinding): {
    binding: SweepBinding;
    run(options?: {
        backfill?: boolean;
        only?: SweepDeps["only"];
    }): Promise<HostSweep[]>;
} {
    return {
        binding,
        run: ({ backfill = false, only } = {}) =>
            sweep(sweepDeps(binding, backfill, only)),
    };
}
