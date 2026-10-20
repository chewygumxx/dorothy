// vim:set expandtab shiftwidth=4 filetype=typescript:
// SPDX-License-Identifier: GPL-3.0-only

//
//
// ~chewygumxx/dorothy.git
// ::: :/packages/memory/src/contract/record.test.ts
//
//

import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import {
    appendFileSync,
    existsSync,
    mkdirSync,
    mkdtempSync,
    readdirSync,
    readFileSync,
    rmSync,
    writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
    type Env,
    newPhrase,
    type RecordEvent,
    type RecordRequest,
} from "@dorothy/core";
import {
    EMPTY_SIDECAR,
    setBackfilled,
    sidecarPath,
    updateSidecar,
} from "../memory/sidecar.js";
import { indexPath, RecallIndex } from "../recall/store.js";
import { syncIndex } from "../recall/sync.js";
import {
    readTranscript,
    transcriptDir,
    transcriptPath,
} from "../transcript.js";
import { ContractError } from "./errors.js";
import { acceptRecord, type RecordDeps, sessionKey } from "./record.js";

const AT = "2026-10-18T09:30:00.000Z";
const PHRASE = "bingo-overabundance-mazer-kasha";

let home: string;
let env: Env;
let index: RecallIndex;

beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), "dorothy-record-"));
    env = {
        HOME: home,
        XDG_DATA_HOME: join(home, "data"),
        XDG_CACHE_HOME: join(home, "cache"),
        XDG_STATE_HOME: join(home, "state"),
    };
    mkdirSync(join(home, "cache", "dorothy"), { recursive: true });
    index = RecallIndex.open(indexPath(env));
});
afterEach(() => {
    index.close();
    rmSync(home, { recursive: true, force: true });
});

const deps = (fields: Partial<RecordDeps> = {}): RecordDeps => ({
    env,
    index,
    recorder: null,
    loopback: true,
    sync: async () => {},
    claudeTranscript: null,
    sessions: new Map(),
    phrase: () => PHRASE,
    ...fields,
});
const user = (sourceId: string, text = "Hi"): RecordEvent => ({
    sourceId,
    at: AT,
    kind: "user",
    text,
});
const request = (events: RecordEvent[]): RecordRequest => ({
    host: "codex",
    session: "s1",
    project: "github.com/me/app",
    events,
});
const lines = () =>
    readFileSync(transcriptPath(PHRASE, env), "utf8")
        .trim()
        .split("\n")
        .map((line) => JSON.parse(line));

describe("acceptRecord", () => {
    for (const backfill of [false, true])
        it(`records through an unparseable sidecar with backfill=${backfill}`, async () => {
            const warnings: string[] = [];
            const shared = deps({
                backfill,
                warn: (message) => warnings.push(message),
            });
            await acceptRecord(request([user("a")]), shared);
            const path = sidecarPath(transcriptDir(env), PHRASE);
            writeFileSync(path, "{not json");
            expect(
                await acceptRecord(request([user("b")]), shared),
            ).toMatchObject({ accepted: 1 });
            expect(readFileSync(path, "utf8")).toBe("{not json");
            expect(warnings).toHaveLength(1);
            expect(
                lines()
                    .filter((line) => line.kind === "user")
                    .map((line) => line.sourceUuid),
            ).toEqual(["a", "b"]);
        });

    it("opens a conversation for a new session and appends its events", async () => {
        const result = await acceptRecord(
            request([
                user("a"),
                {
                    sourceId: "b",
                    at: AT,
                    kind: "tool",
                    name: "Bash",
                    input: "echo sk-ant-api03-secretsecretsecret",
                    output: "ok",
                    ok: true,
                },
            ]),
            deps(),
        );
        expect(result).toEqual({ accepted: 2, duplicates: 0, through: "b" });
        const [session, said, tool] = lines();
        expect(session).toMatchObject({
            kind: "session",
            phrase: PHRASE,
            source: "codex",
            sourceSession: "codex:s1",
            project: "github.com/me/app",
        });
        expect(said).toMatchObject({
            kind: "user",
            text: "Hi",
            sourceUuid: "a",
        });
        expect(tool.kind).toBe("tool");
        expect(tool.input).not.toContain("secretsecret");
    });

    it("stores each event once, in the order sent", async () => {
        const shared = deps();
        await acceptRecord(request([user("a"), user("b")]), shared);
        const again = await acceptRecord(
            request([user("b"), user("c"), user("c"), user("d")]),
            shared,
        );
        expect(again).toEqual({ accepted: 2, duplicates: 2, through: "d" });
        expect(
            lines()
                .filter((line) => line.kind === "user")
                .map((line) => line.sourceUuid),
        ).toEqual(["a", "b", "c", "d"]);
    });

    it("serialises two records of one session sent at once", async () => {
        const shared = deps();
        const events = [user("a"), user("b"), user("c")];
        const [first, second] = await Promise.all([
            acceptRecord(request(events), shared),
            acceptRecord(request(events), shared),
        ]);
        expect((first?.accepted ?? 0) + (second?.accepted ?? 0)).toBe(3);
        expect(
            lines()
                .filter((line) => line.kind === "user")
                .map((line) => line.sourceUuid),
        ).toEqual(["a", "b", "c"]);
    });

    for (const host of ["codex", "hermes"])
        it(`serialises new ${host} sessions across index connections`, async () => {
            const other = RecallIndex.open(indexPath(env));
            // Order SQLite work as separate processes waiting on the store
            // lock would: a synchronous BUSY wait cannot yield this event loop.
            let queue: Promise<unknown> = Promise.resolve();
            const ordered = <T>(work: () => Promise<T>): Promise<T> => {
                const next = queue.then(work);
                queue = next.catch(() => {});
                return next;
            };
            let synced = 0;
            const gate = Promise.withResolvers<void>();
            const bothSynced = async (connection: RecallIndex) => {
                await ordered(() => syncIndex(connection, transcriptDir(env)));
                if (++synced === 2) gate.resolve();
                await gate.promise;
            };
            try {
                const record = { ...request([user("a")]), host };
                const results = await Promise.all([
                    acceptRecord(
                        record,
                        deps({
                            sync: () => bothSynced(index),
                            lock: (work) => ordered(() => index.lock(work)),
                        }),
                    ),
                    acceptRecord(
                        record,
                        deps({
                            index: other,
                            sync: () => bothSynced(other),
                            phrase: newPhrase,
                            lock: (work) => ordered(() => other.lock(work)),
                        }),
                    ),
                ]);
                expect(
                    results.reduce((sum, result) => sum + result.accepted, 0),
                ).toBe(1);
                expect(
                    readdirSync(transcriptDir(env)).filter((name) =>
                        name.endsWith(".jsonl"),
                    ),
                ).toHaveLength(1);
            } finally {
                other.close();
            }
        });

    it("marks a backfill under the lock while another sidecar edit waits", async () => {
        const pending: Promise<unknown>[] = [];
        try {
            await index.lock(async () => {
                pending.push(
                    updateSidecar(
                        transcriptDir(env),
                        PHRASE,
                        (current) => ({
                            ...(current ?? EMPTY_SIDECAR),
                            title: "Synthetic.",
                        }),
                        index.lock,
                    ),
                );
                const marked = setBackfilled(transcriptDir(env), PHRASE, true);
                pending.push(marked);
                const completed = await Promise.race([
                    marked.then(() => true),
                    new Promise<boolean>((resolve) =>
                        setTimeout(() => resolve(false), 1000),
                    ),
                ]);
                expect(completed).toBe(true);
            });
        } finally {
            await Promise.allSettled(pending);
        }
    });

    describe("reading only what was appended", () => {
        const path = () => transcriptPath(PHRASE, env);
        const line = (id: string) =>
            `${JSON.stringify({ v: 1, kind: "user", at: AT, text: "x", sourceUuid: id })}\n`;

        it("trusts what it read before, and reads what came after", async () => {
            const shared = deps({ held: new Map() });
            await acceptRecord(request([user("a")]), shared);
            // A second record reads the file once, and keeps what it found.
            await acceptRecord(request([user("a")]), shared);
            // Garble the first event in place, its length kept: a read of
            // the whole file would no longer find "a" there.
            const text = readFileSync(path(), "utf8");
            const garbled = text.replace(
                '"sourceUuid":"a"',
                '"sourceUuid":"z"',
            );
            expect(garbled).not.toBe(text);
            writeFileSync(path(), garbled);
            appendFileSync(path(), line("x"));
            const again = await acceptRecord(
                request([user("a"), user("x"), user("b")]),
                shared,
            );
            expect(again).toEqual({ accepted: 1, duplicates: 2, through: "b" });
            // Without what was read before, the whole file is read.
            const cold = await acceptRecord(
                request([user("a")]),
                deps({ sessions: shared.sessions, held: new Map() }),
            );
            expect(cold.accepted).toBe(1);
        });

        it("reads it all again when the file shrank or was replaced", async () => {
            const shared = deps({ held: new Map() });
            await acceptRecord(request([user("a"), user("b")]), shared);
            // Replaced by a shorter file of other events.
            rmSync(path());
            writeFileSync(path(), line("q"));
            const again = await acceptRecord(
                request([user("a"), user("q")]),
                shared,
            );
            expect(again).toMatchObject({ accepted: 1, duplicates: 1 });
        });

        it("reads it all again when the last read ended inside a line", async () => {
            const shared = deps({ held: new Map() });
            await acceptRecord(request([user("a")]), shared);
            const torn = line("t1");
            appendFileSync(path(), torn.slice(0, 20));
            await acceptRecord(request([user("a")]), shared);
            appendFileSync(path(), torn.slice(20));
            // Read on from the middle of the line, t1 would not be found.
            const again = await acceptRecord(request([user("t1")]), shared);
            expect(again).toMatchObject({ accepted: 0, duplicates: 1 });
        });
    });

    it("cuts a torn tail before it appends, so the event reads back", async () => {
        const path = () => transcriptPath(PHRASE, env);
        const shared = deps({ held: new Map() });
        await acceptRecord(request([user("a", "First")]), shared);
        appendFileSync(path(), '{"v":1,"kind":"user","text":"torn');
        const result = await acceptRecord(
            request([user("b", "Second")]),
            shared,
        );
        expect(result).toEqual({ accepted: 1, duplicates: 0, through: "b" });
        const read = await readTranscript(path());
        expect(read.turns.map((turn) => turn.text)).toEqual([
            "First",
            "Second",
        ]);
        expect(read.skipped).toBe(0);
        // A resend is found after the cut, a new event added.
        const again = await acceptRecord(
            request([user("b", "Second"), user("c", "Third")]),
            shared,
        );
        expect(again).toEqual({ accepted: 1, duplicates: 1, through: "c" });
        expect((await readTranscript(path())).turns).toHaveLength(3);
    });

    it("does not count a tail left unended as recorded", async () => {
        const path = () => transcriptPath(PHRASE, env);
        const shared = deps({ held: new Map() });
        await acceptRecord(request([user("a", "First")]), shared);
        // Whole JSON, but the writer died before its newline.
        appendFileSync(
            path(),
            JSON.stringify({
                v: 1,
                kind: "user",
                at: AT,
                text: "Second",
                sourceUuid: "b",
            }),
        );
        const result = await acceptRecord(
            request([user("b", "Second")]),
            shared,
        );
        expect(result).toEqual({ accepted: 1, duplicates: 0, through: "b" });
        expect(
            (await readTranscript(path())).turns.map((turn) => turn.text),
        ).toEqual(["First", "Second"]);
    });

    it("writes the session's header again where its file is gone", async () => {
        const shared = deps();
        await acceptRecord(request([user("a")]), shared);
        // History may remove a file a session cache still names.
        rmSync(transcriptPath(PHRASE, env));
        const again = await acceptRecord(
            request([user("a"), user("b")]),
            shared,
        );
        expect(again).toEqual({ accepted: 2, duplicates: 0, through: "b" });
        expect(lines().map((line) => line.kind)).toEqual([
            "session",
            "user",
            "user",
        ]);
        expect(lines()[0]).toMatchObject({ source: "codex", phrase: PHRASE });
    });

    it("finds the conversation again after a restart, through the index", async () => {
        await acceptRecord(request([user("a")]), deps());
        const fresh = deps({
            sessions: new Map(),
            sync: () => syncIndex(index, transcriptDir(env)),
            phrase: () => "other-phrase-is-wrong",
        });
        const again = await acceptRecord(
            request([user("a"), user("b")]),
            fresh,
        );
        expect(again).toEqual({ accepted: 1, duplicates: 1, through: "b" });
    });

    it("links a forked session to its parent", async () => {
        await acceptRecord({ ...request([user("a")]), parent: "s0" }, deps());
        expect(lines()[0]).toMatchObject({ parentSession: "codex:s0" });
    });

    it("stores nothing of a private session", async () => {
        const sessions = new Map<string, string>();
        let read = 0;
        const shared = deps({
            sessions,
            sync: async () => {
                read += 1;
            },
            claudeTranscript: async () => {
                read += 1;
                return { accepted: 1, duplicates: 0, through: null };
            },
        });
        const nothing = { accepted: 0, duplicates: 0, through: null };
        for (const body of [
            { events: [user("a")] },
            { transcript: "/tmp/x.jsonl" },
        ]) {
            expect(
                await acceptRecord(
                    {
                        host: "claude-code",
                        session: "s1",
                        private: true,
                        ...body,
                    },
                    shared,
                ),
            ).toEqual(nothing);
        }
        expect(read).toBe(0);
        expect(sessions.size).toBe(0);
        expect(existsSync(transcriptDir(env))).toBe(false);
        expect(
            index.db.query("SELECT COUNT(*) AS n FROM conversations").get(),
        ).toEqual({ n: 0 });
    });

    it("refuses a transcript path from beyond loopback, or with no reader", async () => {
        const path = { host: "codex", session: "s1", transcript: "/tmp/x" };
        await expect(
            acceptRecord(path, deps({ loopback: false })),
        ).rejects.toThrow(ContractError);
        await expect(acceptRecord(path, deps())).rejects.toThrow(
            "no reader for codex transcripts",
        );
    });

    it("keys Claude Code's sessions bare and others by host", () => {
        expect(sessionKey("claude-code", "u1")).toBe("u1");
        expect(sessionKey("codex", "u1")).toBe("codex:u1");
    });
});
