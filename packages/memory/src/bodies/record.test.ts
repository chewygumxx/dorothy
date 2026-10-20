// vim:set expandtab shiftwidth=4 filetype=typescript:
// SPDX-License-Identifier: GPL-3.0-only

//
//
// ~chewygumxx/dorothy.git
// ::: :/packages/memory/src/bodies/record.test.ts
//
//

import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import {
    appendFile,
    chmod,
    mkdtemp,
    readFile,
    rm,
    writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
    type HistoryHandle,
    type Lock,
    readSidecar,
    sidecarPath,
} from "../memory/sidecar.js";
import { RecallIndex } from "../recall/store.js";
import { sessionPhrase } from "../recall/sync.js";
import { transcriptDir } from "../transcript.js";
import {
    assistantLine,
    at,
    meta,
    result,
    SESSION,
    text,
    use,
    userLine,
} from "./fixtures.js";
import { hookLog, hookLogPath } from "./log.js";
import {
    type RecordDeps,
    recordedUuids,
    recordSession,
    type SessionReport,
} from "./record.js";
import { copyPath, dismissHalt, readRecord, unreadDir } from "./unread.js";

// Runs work one at a time, as the index's lock does across processes.
function serial(): Lock {
    let chain: Promise<unknown> = Promise.resolve();
    return (work) => {
        const run = chain.then(work);
        chain = run.catch(() => {});
        return run;
    };
}

let home = "";
let env: Record<string, string>;
let index: RecallIndex;
let commits: string[];
let claude = "";
beforeEach(async () => {
    home = await mkdtemp(join(tmpdir(), "dorothy-record-"));
    env = {
        HOME: home,
        XDG_DATA_HOME: join(home, "data"),
        XDG_CACHE_HOME: join(home, "cache"),
        XDG_STATE_HOME: join(home, "state"),
    };
    index = RecallIndex.open(join(home, "recall.sqlite"));
    commits = [];
    claude = join(home, "claude.jsonl");
});
afterEach(async () => {
    index.close();
    await rm(home, { recursive: true, force: true });
});

const versions = (lock: Lock = index.lock): HistoryHandle => ({
    recorder: async (_paths, message) => {
        commits.push(message);
    },
    lock,
    sweep: async () => {},
    heal: async () => false,
    close: () => {},
});
const deps = (overrides: Partial<RecordDeps> = {}): RecordDeps => ({
    env,
    index,
    versions: versions(),
    log: hookLog(env),
    project: "github.com/u/here",
    ...overrides,
});
const report = (fields: Partial<SessionReport> = {}): SessionReport => ({
    session: SESSION,
    transcript: claude,
    dir: "/work",
    since: null,
    ended: false,
    ...fields,
});
const write = (lines: string[]) =>
    writeFile(claude, lines.map((line) => `${line}\n`).join(""));
const add = (lines: string[]) =>
    appendFile(claude, lines.map((line) => `${line}\n`).join(""));
const events = async (phrase: string) =>
    (await readFile(join(transcriptDir(env), `${phrase}.jsonl`), "utf8"))
        .trim()
        .split("\n")
        .map((line) => JSON.parse(line));

describe("recordSession", () => {
    it("takes history's combined lock when the index is available", async () => {
        await write([userLine("u1", 0, "hello")]);
        const holding: Lock = async () => {
            throw new Error("shared history lock busy");
        };
        await expect(
            recordSession(report(), deps({ versions: versions(holding) })),
        ).rejects.toThrow("shared history lock busy");
    });
    it("records a new session as a conversation of its own, from its lines", async () => {
        await write([
            userLine("u1", 0, "hello"),
            assistantLine("a1", 1, [text("Hi.")]),
            meta("ai-title"),
        ]);
        const recorded = await recordSession(report(), deps());
        expect(recorded).toMatchObject({
            kind: "recorded",
            appended: 2,
            halted: false,
        });
        if (recorded.kind !== "recorded") {
            throw new Error(recorded.kind);
        }
        expect(await events(recorded.phrase)).toEqual([
            {
                v: 1,
                kind: "session",
                at: at(0),
                phrase: recorded.phrase,
                sdkSessionId: "",
                model: "claude-opus-5-5",
                promptHash: "",
                resumed: false,
                source: "claude-code",
                sourceSession: SESSION,
                project: "github.com/u/here",
            },
            { v: 1, kind: "user", at: at(0), text: "hello", sourceUuid: "u1" },
            {
                v: 1,
                kind: "assistant",
                at: at(1),
                text: "Hi.",
                interrupted: false,
                sourceUuid: "a1",
            },
        ]);
        expect(sessionPhrase(index, SESSION)).toBe(recorded.phrase);
        expect(commits).toEqual([`turn: ${recorded.phrase} (claude-code)`]);
    });

    it("takes up after the last line recorded, with no second session event", async () => {
        await write([userLine("u1", 0, "hello")]);
        const first = await recordSession(report(), deps());
        await add([
            assistantLine("a1", 1, [text("Hi.")]),
            userLine("u2", 2, "more"),
        ]);
        const second = await recordSession(report(), deps());
        expect(second).toMatchObject({ kind: "recorded", appended: 2 });
        if (first.kind !== "recorded") {
            throw new Error(first.kind);
        }
        const kinds = (await events(first.phrase)).map(
            (event) => event.sourceUuid ?? event.kind,
        );
        expect(kinds).toEqual(["session", "u1", "a1", "u2"]);
    });

    it("records a plain session resumed in a launch from the launch on", async () => {
        await write([
            userLine("u1", 0, "before"),
            assistantLine("a1", 1, [text("old")]),
            userLine("u2", 5, "after"),
        ]);
        const recorded = await recordSession(
            report({ since: Date.parse(at(3)) }),
            deps(),
        );
        if (recorded.kind !== "recorded") {
            throw new Error(recorded.kind);
        }
        expect(
            (await events(recorded.phrase)).map(
                (event) => event.text ?? event.kind,
            ),
        ).toEqual(["session", "after"]);
    });

    it("passes over a line of an unexpected shape from before the launch", async () => {
        await write([
            assistantLine("a1", 0, [], {
                message: { role: "assistant", content: "plain" },
            }),
            userLine("u1", 1, "before"),
            userLine("u2", 5, "after"),
        ]);
        const recorded = await recordSession(
            report({ since: Date.parse(at(3)) }),
            deps(),
        );
        if (recorded.kind !== "recorded") {
            throw new Error(recorded.kind);
        }
        expect(recorded).toMatchObject({ appended: 1, halted: false });
        expect(
            (await events(recorded.phrase)).map(
                (event) => event.text ?? event.kind,
            ),
        ).toEqual(["session", "after"]);
        expect(await readRecord(env, SESSION)).toBeNull();
    });

    it("appends each event once when two hooks record at once", async () => {
        await write([
            userLine("u1", 0, "a"),
            assistantLine("a1", 1, [text("b")]),
            userLine("u2", 2, "c"),
        ]);
        const both = await Promise.all([
            recordSession(report(), deps()),
            recordSession(report(), deps()),
        ]);
        const phrase = both.find(
            (one) => one.kind === "recorded" && one.appended > 0,
        );
        if (phrase?.kind !== "recorded") {
            throw new Error("nothing recorded");
        }
        expect(
            (await events(phrase.phrase)).map(
                (event) => event.sourceUuid ?? event.kind,
            ),
        ).toEqual(["session", "u1", "a1", "u2"]);
        expect(
            both
                .map((one) => (one.kind === "recorded" ? one.appended : -1))
                .sort(),
        ).toEqual([0, 3]);
    });

    it("cuts a torn last line of her transcript before appending", async () => {
        await write([userLine("u1", 0, "a")]);
        const first = await recordSession(report(), deps());
        if (first.kind !== "recorded") {
            throw new Error(first.kind);
        }
        await appendFile(
            join(transcriptDir(env), `${first.phrase}.jsonl`),
            '{"v":1,"kind":"us',
        );
        await add([userLine("u2", 1, "b")]);
        await recordSession(report(), deps());
        expect(
            (await events(first.phrase)).map(
                (event) => event.sourceUuid ?? event.kind,
            ),
        ).toEqual(["session", "u1", "u2"]);
    });

    it("reads a transcript it cannot cut, its whole lines only", async () => {
        await write([userLine("u1", 0, "a")]);
        const first = await recordSession(report(), deps());
        if (first.kind !== "recorded") {
            throw new Error(first.kind);
        }
        const path = join(transcriptDir(env), `${first.phrase}.jsonl`);
        await appendFile(path, '{"v":1,"kind":"us');
        // Readable, but not open for writing.
        await chmod(path, 0o444);
        const again = await recordSession(report(), deps());
        expect(again).toMatchObject({
            kind: "recorded",
            phrase: first.phrase,
            appended: 0,
        });
        // Left as it was, and nothing recorded twice.
        const kept = await readFile(path, "utf8");
        expect(kept.endsWith('{"v":1,"kind":"us')).toBe(true);
        expect(kept.split('"sourceUuid":"u1"')).toHaveLength(2);
    });

    it("leaves a line Claude Code is still writing for the next reading", async () => {
        await writeFile(
            claude,
            `${userLine("u1", 0, "a")}\n${userLine("u2", 1, "b").slice(0, 20)}`,
        );
        const recorded = await recordSession(report(), deps());
        expect(recorded).toMatchObject({
            kind: "recorded",
            appended: 1,
            size: Buffer.byteLength(`${userLine("u1", 0, "a")}\n`),
        });
    });

    it("waits for a call's answer, then records it at the call's place", async () => {
        await write([
            userLine("u1", 0, "go"),
            assistantLine("a1", 1, [use("t1", "Bash", { command: "ls" })]),
        ]);
        const first = await recordSession(report(), deps());
        expect(first).toMatchObject({ appended: 1 });
        await add([
            userLine("r1", 2, [result("t1", "x")]),
            assistantLine("a2", 3, [text("Done.")]),
        ]);
        const second = await recordSession(report(), deps());
        expect(second).toMatchObject({ appended: 2 });
        if (first.kind !== "recorded") {
            throw new Error(first.kind);
        }
        expect((await events(first.phrase)).map((event) => event.kind)).toEqual(
            ["session", "user", "tool", "assistant"],
        );
    });

    for (const backfill of [false, true])
        it(`records through a broken Claude sidecar with backfill=${backfill}`, async () => {
            const warnings: string[] = [];
            const recording = deps({
                backfill,
                log: {
                    info() {},
                    error() {},
                    warn: (message) => warnings.push(message),
                },
            });
            await write([userLine("u1", 0, "Synthetic.")]);
            const first = await recordSession(report(), recording);
            if (first.kind !== "recorded") throw new Error(first.kind);
            const path = sidecarPath(transcriptDir(env), first.phrase);
            await writeFile(path, "{not json");
            await add([userLine("u2", 1, "Synthetic more.")]);
            expect(await recordSession(report(), recording)).toMatchObject({
                appended: 1,
            });
            expect(await readFile(path, "utf8")).toBe("{not json");
            expect(warnings).toHaveLength(1);
        });

    for (const initiallyBackfilled of [false, true])
        it(`keeps Claude review eligibility during backfill, marked=${initiallyBackfilled}`, async () => {
            await write([userLine("u1", 0, "Synthetic.")]);
            const first = await recordSession(
                report(),
                deps({ backfill: initiallyBackfilled }),
            );
            if (first.kind !== "recorded") throw new Error(first.kind);
            await add([userLine("u2", 1, "Synthetic more.")]);
            expect(
                await recordSession(report(), deps({ backfill: true })),
            ).toMatchObject({ appended: 1 });
            const read = await readSidecar(transcriptDir(env), first.phrase);
            expect(read.kind === "ok" && read.sidecar.backfilled === true).toBe(
                initiallyBackfilled,
            );
        });

    it("says it holds lines behind a call not yet answered", async () => {
        await write([
            userLine("u1", 0, "go"),
            assistantLine("a1", 1, [use("t1", "Bash", { command: "ls" })]),
        ]);
        expect(await recordSession(report(), deps())).toMatchObject({
            kind: "recorded",
            appended: 1,
            held: true,
        });
        expect(
            await recordSession(report({ ended: true }), deps()),
        ).toMatchObject({ kind: "recorded", appended: 1, held: false });
    });

    it("says it holds, though nothing was recorded", async () => {
        await write([assistantLine("a1", 1, [use("t1", "Bash", {})])]);
        expect(await recordSession(report(), deps())).toMatchObject({
            kind: "nothing",
            held: true,
        });
    });

    it("halts at a line it cannot read, keeps the rest aside, and resolves once read", async () => {
        await write([
            userLine("u1", 0, "fine"),
            "{torn but whole",
            userLine("u2", 1, "after"),
        ]);
        const halted = await recordSession(report(), deps());
        expect(halted).toMatchObject({
            kind: "recorded",
            appended: 1,
            halted: true,
        });
        expect(await readFile(copyPath(env, SESSION), "utf8")).toBe(
            `{torn but whole\n${userLine("u2", 1, "after")}\n`,
        );
        expect(await readRecord(env, SESSION)).toMatchObject({
            line: 2,
            type: null,
            reason: "not a JSON object",
        });
        // The reader is fixed, as an update would: the line is now whole.
        await write([
            userLine("u1", 0, "fine"),
            userLine("u3", 0, "mended"),
            userLine("u2", 1, "after"),
        ]);
        const read = await recordSession(report(), deps());
        expect(read).toMatchObject({ appended: 2, halted: false });
        expect(await readRecord(env, SESSION)).toBeNull();
    });

    it("logs each Claude halt once, including after dismissal", async () => {
        const errors: string[] = [];
        const recording = deps({
            log: {
                info() {},
                warn() {},
                error: (message) => errors.push(message),
            },
        });
        await write(["{bad first line"]);
        await recordSession(report(), recording);
        await recordSession(report(), recording);
        await dismissHalt(env, SESSION);
        await recordSession(report(), recording);
        expect(errors).toHaveLength(1);
        await write([userLine("u1", 0, "Synthetic."), "{bad next line"]);
        await recordSession(report(), recording);
        expect(errors).toHaveLength(2);
    });

    it("keeps one example of a new type, and reads on", async () => {
        await write([meta("brand-new"), userLine("u1", 0, "a")]);
        expect(await recordSession(report(), deps())).toMatchObject({
            appended: 1,
            halted: false,
        });
        expect(
            await readFile(
                join(unreadDir(env), "types", "brand-new.jsonl"),
                "utf8",
            ),
        ).toBe(`${meta("brand-new")}\n`);
    });

    it("warns of a new type after the last line recorded once, not at every reading", async () => {
        await write([userLine("u1", 0, "a"), meta("brand-new")]);
        for (let reading = 0; reading < 3; reading += 1) {
            await recordSession(report(), deps());
        }
        const log = await readFile(hookLogPath(env), "utf8");
        expect(log.match(/is of a new type/g)).toHaveLength(1);
        // Nothing appended, nothing said of it.
        expect(log.match(/events into/g)).toHaveLength(1);
    });

    it("records though the state directory cannot be written", async () => {
        await writeFile(join(home, "state"), "a file, not a directory");
        await write([meta("brand-new"), userLine("u1", 0, "fine")]);
        expect(await recordSession(report(), deps())).toMatchObject({
            kind: "recorded",
            appended: 1,
            halted: false,
        });
        await add([userLine("u2", 1, "x"), "{torn but whole"]);
        expect(await recordSession(report(), deps())).toMatchObject({
            kind: "recorded",
            appended: 1,
            halted: true,
        });
        const log = await readFile(hookLogPath(env), "utf8");
        expect(log).toContain("can't be kept");
        expect(log).toContain("its halt can't be kept");
        expect(commits).toHaveLength(2);
    });

    it("continues the conversation of a session its lines name", async () => {
        await write([userLine("u1", 0, "a")]);
        const first = await recordSession(report(), deps());
        const next = "1a9fbe6c-eadc-4a7f-b276-81978839a61f";
        await writeFile(
            claude,
            `${userLine("u1", 0, "a")}\n${userLine("u2", 1, "b", { sessionId: next })}\n`,
        );
        const second = await recordSession(report({ session: next }), deps());
        if (first.kind !== "recorded" || second.kind !== "recorded") {
            throw new Error("not recorded");
        }
        expect(second.phrase).toBe(first.phrase);
        const read = await events(first.phrase);
        expect(
            read.map((event) => event.sourceSession ?? event.sourceUuid),
        ).toEqual([SESSION, "u1", next, "u2"]);
        expect(read[2]).toMatchObject({ kind: "session", resumed: true });
    });

    it("finds the conversation without the index, under history's lock", async () => {
        await write([userLine("u1", 0, "a")]);
        const first = await recordSession(report(), deps());
        await add([userLine("u2", 1, "b")]);
        const second = await recordSession(
            report(),
            deps({ index: null, versions: versions(serial()) }),
        );
        expect(second).toMatchObject({ kind: "recorded", appended: 1 });
        if (first.kind !== "recorded" || second.kind !== "recorded") {
            throw new Error("not recorded");
        }
        expect(second.phrase).toBe(first.phrase);
    });

    it("records nothing without a lock, a transcript or a word of hers", async () => {
        await write([meta("mode")]);
        expect(
            await recordSession(
                report(),
                deps({ index: null, versions: null }),
            ),
        ).toEqual({ kind: "unlocked" });
        expect(
            await recordSession(
                report({ transcript: join(home, "gone.jsonl") }),
                deps(),
            ),
        ).toMatchObject({ kind: "missing" });
        expect(await recordSession(report(), deps())).toEqual({
            kind: "nothing",
            held: false,
            size: Buffer.byteLength(`${meta("mode")}\n`),
        });
    });
});

describe("recordedUuids", () => {
    it("collects the uuids recorded and the last of them", () => {
        const text = [
            JSON.stringify({ kind: "session" }),
            JSON.stringify({ kind: "user", sourceUuid: "u1" }),
            "{torn",
            JSON.stringify({ kind: "assistant", sourceUuid: "a1" }),
        ].join("\n");
        expect(recordedUuids(text)).toEqual({
            uuids: new Set(["u1", "a1"]),
            last: "a1",
        });
    });
});
