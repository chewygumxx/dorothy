// vim:set expandtab shiftwidth=4 filetype=typescript:
// SPDX-License-Identifier: GPL-3.0-only

//
//
// ~chewygumxx/dorothy.git
// ::: :/packages/memory/src/service/sweep-command.ts
//
//

// dorothy --sweep: one sweep in the foreground, for a user without the
// service, printing a host and a count a line; --backfill records the
// backlog; --reread reads again, and only, what other harnesses' sessions
// could not be; --dismiss stops telling of one.

import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { type Env, type RecordingHost, readConfig } from "@dorothy/core";
import { hookLog } from "../bodies/log.js";
import { dismissHalt, halts, readRecord, unreadDir } from "../bodies/unread.js";
import { dataRoot } from "../facts/store.js";
import { commandHistory } from "../history/commands.js";
import { vocabularyPath } from "../memory/vocabulary.js";
import { indexPath, RecallIndex } from "../recall/store.js";
import { syncIndex } from "../recall/sync.js";
import { hostLines } from "../recording/report.js";
import type { SourceSession } from "../recording/sources.js";
import { transcriptDir } from "../transcript.js";
import { sweepBinding } from "./recording.js";

type Output = { write(text: string): unknown };
type Streams = { env?: Env; out?: Output; err?: Output };

const describeError = (error: unknown) =>
    error instanceof Error ? error.message : String(error);

export async function runSweep({
    env = process.env,
    out = process.stdout,
    err = process.stderr,
    backfill,
    reread = false,
    now,
}: Streams & {
    backfill: boolean;
    reread?: boolean;
    now?: () => Date;
}): Promise<number> {
    const { config, warnings } = await readConfig(env);
    for (const warning of warnings) {
        err.write(`dorothy: ${warning}\n`);
    }
    // A reread visits the hosts that kept a halt, whatever is set.
    const kept = reread ? await otherHalts(env) : [];
    const hosts = reread
        ? ([...new Set(kept.map((record) => record.host))] as RecordingHost[])
        : config.recording.hosts;
    if (reread && kept.length === 0) {
        out.write("dorothy: no unreadable sessions are kept\n");
        return 0;
    }
    if (hosts.length === 0) {
        err.write(
            'dorothy: no host to sweep: name some in [recording] hosts of config.toml, such as hosts = ["claude-code", "codex"]\n',
        );
        return 1;
    }
    const log = hookLog(env);
    let index: RecallIndex | null = null;
    try {
        mkdirSync(dirname(indexPath(env)), { recursive: true, mode: 0o700 });
        index = RecallIndex.open(indexPath(env));
    } catch (error) {
        err.write(
            `dorothy: the index can't be opened (${describeError(error)})\n`,
        );
        return 1;
    }
    const versions = await commandHistory({
        env,
        remindMirror: false,
        pushOnClose: false,
        err,
    })(index);
    const sync = () =>
        syncIndex(
            index,
            transcriptDir(env),
            Date.now(),
            vocabularyPath(env),
            dataRoot(env),
        );
    try {
        const sweeping = sweepBinding({
            env,
            hosts,
            claudeDirs: config.service.claudeDirs,
            store: {
                root: dataRoot(env),
                lock: versions?.lock ?? index.lock,
                recorder: versions?.recorder ?? null,
            },
            index,
            versions,
            sync,
            sessions: new Map(),
            held: new Map(),
            // Nothing extracts from what a foreground sweep records: the
            // next launch's catch-up reviews it, as it does any.
            idle: new Map(),
            backfilled: new Set(),
            touched: new Set(),
            log: {
                info: (message) => log.info(message),
                warn: (message) => {
                    log.warn(message);
                    err.write(`dorothy: ${message}\n`);
                },
                error: (message) => {
                    log.error(message);
                    err.write(`dorothy: ${message}\n`);
                },
            },
            ...(now === undefined ? {} : { now }),
        });
        // A reread visits the halted sessions and no other.
        const results = await sweeping.run({
            backfill,
            ...(reread ? { only: haltedAmong(kept) } : {}),
        });
        for (const text of hostLines(results)) {
            out.write(`${text}\n`);
        }
        const stopped = results.some((result) => result.error !== null);
        const unread = reread ? await rereadReport(env, kept, out, err) : 0;
        return stopped || unread > 0 ? 1 : 0;
    } catch (error) {
        err.write(`dorothy: the sweep failed: ${describeError(error)}\n`);
        return 1;
    } finally {
        await versions?.close();
        index.close();
    }
}

// The halts kept for a harness other than Claude Code, which has
// `--claude-hook --reread` of its own.
const otherHalts = async (env: Env) =>
    (await halts(env)).flatMap((record) =>
        record.host === undefined || record.host === "claude-code"
            ? []
            : [{ ...record, host: record.host }],
    );

// Whether a listed session is one a halt was kept for: its transcript, and
// its id where the listing names one (Hermes keeps all in one database).
const haltedAmong =
    (kept: readonly { host: string; session: string; transcript: string }[]) =>
    (listed: SourceSession) =>
        kept.some(
            (record) =>
                record.host === listed.host &&
                record.transcript === listed.path &&
                (listed.session === undefined ||
                    listed.session === record.session),
        );

// What became of each halt a reread went to: how many are kept still.
async function rereadReport(
    env: Env,
    before: readonly { host: string; session: string }[],
    out: Output,
    err: Output,
): Promise<number> {
    let still = 0;
    for (const { host, session } of before) {
        const now = await readRecord(env, session, host);
        if (now === null) {
            out.write(`dorothy: read ${host} ${session} to its end\n`);
        } else {
            still += 1;
            err.write(
                `dorothy: ${host} ${session} still can't be read past ${host === "hermes" ? "row" : "line"} ${now.line} (${now.reason})\n`,
            );
        }
    }
    return still;
}

export async function runSweepDismiss(
    host: string,
    session: string,
    {
        env = process.env,
        out = process.stdout,
        err = process.stderr,
    }: Streams = {},
): Promise<number> {
    try {
        if (await dismissHalt(env, session, host)) {
            out.write(
                `dorothy: ${host} ${session} will not be told again; its rest stays in ${unreadDir(env)}\n`,
            );
            return 0;
        }
    } catch (error) {
        err.write(`dorothy: ${describeError(error)}\n`);
        return 1;
    }
    err.write(`dorothy: no unreadable ${host} session ${session}\n`);
    return 1;
}
