// vim:set expandtab shiftwidth=4 filetype=typescript:
// SPDX-License-Identifier: GPL-3.0-only

//
//
// ~chewygumxx/dorothy.git
// ::: :/packages/memory/src/recording/sweep-testing.ts
//
//

// A sweep's test rig: temporary roots, the archive's real record path and
// Claude Code's real session recorder, as the service binds them.

import { Database } from "bun:sqlite";
import {
    appendFile,
    mkdir,
    mkdtemp,
    readdir,
    readFile,
    rm,
    utimes,
    writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import type { Env, RecordRequest } from "@dorothy/core";
import { recordSession } from "../bodies/record.js";
import { acceptRecord, sessionKey } from "../contract/record.js";
import { dataRoot, type FactStore } from "../facts/store.js";
import { indexPath, RecallIndex } from "../recall/store.js";
import { sessionPhrase, syncIndex } from "../recall/sync.js";
import { transcriptDir } from "../transcript.js";
import { HERMES_SCHEMA } from "./hermes-fixtures.js";
import {
    type HostSweep,
    type SweepConversation,
    type SweepDeps,
    sweep,
} from "./sweep.js";

export const NOW = new Date("2026-10-14T08:00:00.000Z");
export const HOUR = 3_600_000;

export type Rig = {
    home: string;
    env: Env;
    store: FactStore;
    index: RecallIndex;
    recorded: SweepConversation[];
    requests: RecordRequest[];
    // Claude Code's recorder as the service binds it, for the hooks' path.
    claude: SweepDeps["recordClaude"];
    logs: string[];
    commits: string[];
    // Run a sweep as a service just started would: no process memory.
    run(options?: Partial<SweepDeps>): Promise<HostSweep[]>;
    // Writes a file as last touched `age` ms before NOW: real clocks vary.
    file(path: string, text: string, age?: number): Promise<string>;
    append(path: string, text: string, age?: number): Promise<void>;
    hermes(seed: (db: Database) => void): Promise<string>;
    // The conversations on disk, each as its parsed events.
    conversations(): Promise<Record<string, unknown>[][]>;
    close(): Promise<void>;
};

export async function rig(): Promise<Rig> {
    const home = await mkdtemp(join(tmpdir(), "dorothy-sweep-"));
    const env: Env = {
        HOME: home,
        XDG_DATA_HOME: join(home, "data"),
        XDG_CACHE_HOME: join(home, "cache"),
        XDG_STATE_HOME: join(home, "state"),
    };
    await mkdir(join(home, "cache", "dorothy"), { recursive: true });
    const index = RecallIndex.open(indexPath(env));
    const commits: string[] = [];
    const store: FactStore = {
        root: dataRoot(env),
        lock: index.lock,
        recorder: async (_paths, message) => {
            commits.push(message);
        },
    };
    const recorded: SweepConversation[] = [];
    const requests: RecordRequest[] = [];
    const logs: string[] = [];
    const log = (level: string) => (message: string) =>
        logs.push(`${level} ${message}`);
    const claude: SweepDeps["recordClaude"] = (report, project) =>
        recordSession(report, {
            env,
            index,
            versions: {
                recorder: store.recorder as never,
                lock: index.lock,
                sweep: async () => {},
                heal: async () => false,
                close: () => {},
            },
            log: { info() {}, warn: log("warn"), error: log("error") },
            project,
        });
    const rig: Rig = {
        home,
        claude,
        env,
        store,
        index,
        recorded,
        requests,
        logs,
        commits,
        async run(options = {}) {
            // A fresh process each time: its session cache is empty.
            const sessions = new Map<string, string>();
            return sweep({
                hosts: ["claude-code", "codex", "hermes"],
                backfill: false,
                env,
                store,
                now: () => NOW,
                log: {
                    info: log("info"),
                    warn: log("warn"),
                    error: log("error"),
                },
                onRecorded: (conversation) => recorded.push(conversation),
                record: async (request) => {
                    requests.push(request);
                    const result = await acceptRecord(request, {
                        env,
                        index,
                        recorder: null,
                        lock: index.lock,
                        loopback: true,
                        sync: () => syncIndex(index, transcriptDir(env)),
                        claudeTranscript: null,
                        sessions,
                    });
                    return {
                        ...result,
                        phrase:
                            sessions.get(
                                sessionKey(request.host, request.session),
                            ) ?? null,
                    };
                },
                conversation: async (host, session) => {
                    await syncIndex(index, transcriptDir(env));
                    return sessionPhrase(index, sessionKey(host, session));
                },
                recordClaude: claude,
                ...options,
            });
        },
        async file(path, text, age = 2 * HOUR) {
            await mkdir(dirname(path), { recursive: true });
            await writeFile(path, text);
            const when = new Date(NOW.getTime() - age);
            await utimes(path, when, when);
            return path;
        },
        async append(path, text, age = 0) {
            await appendFile(path, text);
            const when = new Date(NOW.getTime() - age);
            await utimes(path, when, when);
        },
        async hermes(seed) {
            const path = join(home, ".hermes", "state.db");
            await mkdir(dirname(path), { recursive: true });
            const db = new Database(path);
            try {
                db.exec(HERMES_SCHEMA);
                seed(db);
            } finally {
                db.close();
            }
            return path;
        },
        async conversations() {
            const dir = transcriptDir(env);
            const names = (await readdir(dir).catch(() => [])).filter((name) =>
                name.endsWith(".jsonl"),
            );
            const found: Record<string, unknown>[][] = [];
            for (const name of names.sort())
                found.push(
                    (await readFile(join(dir, name), "utf8"))
                        .trim()
                        .split("\n")
                        .map((line) => JSON.parse(line)),
                );
            return found;
        },
        async close() {
            index.close();
            await rm(home, { recursive: true, force: true });
        },
    };
    return rig;
}
