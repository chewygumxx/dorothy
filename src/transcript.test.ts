// vim:set expandtab shiftwidth=4 filetype=typescript:
// SPDX-License-Identifier: GPL-3.0-only

//
//
// ~chewygumxx/dorothy.git
// ::: :/src/transcript.test.ts
//
//

import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import {
    parseTranscript,
    readTranscript,
    TranscriptWriter,
    transcriptDir,
    transcriptPath,
} from "./transcript.js";

const AT = new Date("2026-10-03T00:00:00.000Z");
const clock = () => AT;

let dir = "";
beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "dorothy-transcript-"));
});
afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
});

async function lines(path: string): Promise<unknown[]> {
    const text = await readFile(path, "utf8");
    return text
        .trimEnd()
        .split("\n")
        .map((line) => JSON.parse(line));
}

describe("transcriptDir", () => {
    it("uses XDG_DATA_HOME", () => {
        expect(transcriptDir({ XDG_DATA_HOME: "/data", HOME: "/home/u" })).toBe(
            "/data/dorothy/transcripts",
        );
    });

    it("falls back to ~/.local/share when unset or empty", () => {
        const expected = "/home/u/.local/share/dorothy/transcripts";
        expect(transcriptDir({ HOME: "/home/u" })).toBe(expected);
        expect(transcriptDir({ XDG_DATA_HOME: "", HOME: "/home/u" })).toBe(
            expected,
        );
    });

    it("ignores an empty HOME and a relative XDG_DATA_HOME", () => {
        const expected = join(homedir(), ".local/share/dorothy/transcripts");
        expect(transcriptDir({ HOME: "" })).toBe(expected);
        expect(transcriptDir({ XDG_DATA_HOME: "data", HOME: "" })).toBe(
            expected,
        );
    });

    it("names the file after the phrase", () => {
        expect(transcriptPath("a-b-c-d", { XDG_DATA_HOME: "/data" })).toBe(
            "/data/dorothy/transcripts/a-b-c-d.jsonl",
        );
    });
});

describe("TranscriptWriter", () => {
    it("creates missing directories and stamps v and at", async () => {
        const path = join(dir, "nested", "a-b-c-d.jsonl");
        const writer = await TranscriptWriter.open(path, clock);
        await writer.append({ kind: "user", text: "hi" });
        await writer.close();
        expect(await readFile(path, "utf8")).toBe(
            '{"v":1,"kind":"user","at":"2026-10-03T00:00:00.000Z","text":"hi"}\n',
        );
    });

    it("creates the transcript and its directory private to the user", async () => {
        const path = join(dir, "nested", "a-b-c-d.jsonl");
        const writer = await TranscriptWriter.open(path, clock);
        await writer.close();
        expect((await stat(path)).mode & 0o777).toBe(0o600);
        expect((await stat(join(dir, "nested"))).mode & 0o777).toBe(0o700);
    });

    it("keeps order when appends are not awaited", async () => {
        const path = join(dir, "order.jsonl");
        const writer = await TranscriptWriter.open(path, clock);
        for (const text of ["one", "two", "three"]) {
            void writer.append({ kind: "user", text });
        }
        await writer.close();
        expect(
            (await lines(path)).map((e) => (e as { text: string }).text),
        ).toEqual(["one", "two", "three"]);
    });

    it("writes newlines, quotes and emoji as one line that round-trips", async () => {
        const path = join(dir, "text.jsonl");
        const text = 'line one\nline "two" 🐈';
        const writer = await TranscriptWriter.open(path, clock);
        await writer.append({ kind: "assistant", text, interrupted: false });
        await writer.close();
        expect((await readFile(path, "utf8")).split("\n")).toHaveLength(2);
        expect((await readTranscript(path)).turns).toEqual([
            { role: "assistant", text },
        ]);
    });

    it("appends to an existing transcript", async () => {
        const path = join(dir, "resume.jsonl");
        const first = await TranscriptWriter.open(path, clock);
        await first.append({ kind: "user", text: "before" });
        await first.close();
        const second = await TranscriptWriter.open(path, clock);
        await second.append({ kind: "user", text: "after" });
        await second.close();
        expect(await lines(path)).toHaveLength(2);
    });

    it("rejects when the directory cannot be created", async () => {
        const blocker = join(dir, "file");
        await writeFile(blocker, "");
        await expect(
            TranscriptWriter.open(join(blocker, "x.jsonl"), clock),
        ).rejects.toThrow();
    });
});

describe("readTranscript", () => {
    const statsLine = (costUsd: number, extra = {}) =>
        JSON.stringify({
            v: 1,
            kind: "stats",
            at: "x",
            inputTokens: 1,
            cacheReadTokens: 2,
            cacheWriteTokens: 3,
            outputTokens: 4,
            ttftMs: 5,
            durationMs: 6,
            costUsd,
            sessionCostUsd: costUsd,
            ...extra,
        });
    const turnLine = (kind: string, text: string) =>
        JSON.stringify({ v: 1, kind, at: "x", text, interrupted: false });
    const turnStats = (costUsd: number) => ({
        inputTokens: 1,
        cacheReadTokens: 2,
        cacheWriteTokens: 3,
        outputTokens: 4,
        ttftMs: 5,
        durationMs: 6,
        costUsd,
        sessionCostUsd: costUsd,
    });

    it("gives each reply its stats and the chat's cost by then", async () => {
        const path = join(dir, "stats.jsonl");
        await writeFile(
            path,
            [
                turnLine("user", "a"),
                turnLine("assistant", "b"),
                statsLine(0.25),
                turnLine("user", "c"),
                turnLine("assistant", "d"),
                turnLine("user", "e"),
                turnLine("assistant", "f"),
                statsLine(0.5),
            ].join("\n"),
        );
        expect((await readTranscript(path)).turns).toEqual([
            { role: "user", text: "a" },
            {
                role: "assistant",
                text: "b",
                stats: turnStats(0.25),
                chatCostUsd: 0.25,
            },
            { role: "user", text: "c" },
            { role: "assistant", text: "d" },
            { role: "user", text: "e" },
            {
                role: "assistant",
                text: "f",
                stats: turnStats(0.5),
                chatCostUsd: 0.75,
            },
        ]);
    });

    it("attaches no stats that are malformed or follow no reply", async () => {
        const path = join(dir, "stray.jsonl");
        await writeFile(
            path,
            [
                turnLine("user", "a"),
                statsLine(0.25),
                turnLine("assistant", "b"),
                statsLine(0.5, { inputTokens: "many" }),
            ].join("\n"),
        );
        expect(await readTranscript(path)).toEqual({
            turns: [
                { role: "user", text: "a" },
                { role: "assistant", text: "b" },
            ],
            skipped: 0,
            costUsd: 0.75,
        });
    });

    it("returns turns in order and the cost so far, skipping malformed lines", async () => {
        const path = join(dir, "read.jsonl");
        await writeFile(
            path,
            [
                '{"v":1,"kind":"session","at":"x","phrase":"a-b-c-d","sdkSessionId":"s","model":"m","promptSha256":"h","resumed":false}',
                '{"v":1,"kind":"user","at":"x","text":"hello"}',
                "not json",
                '{"v":1,"kind":"assistant","at":"x","text":"hi there","interrupted":false}',
                '{"v":1,"kind":"stats","at":"x","inputTokens":1,"outputTokens":2,"ttftMs":null,"durationMs":3,"costUsd":0.25,"sessionCostUsd":0.25}',
                '{"v":1,"kind":"stats","at":"x","costUsd":0.5}',
                '{"v":1,"kind":"stats","at":"x","costUsd":"lots"}',
                '{"v":1,"kind":"mystery"}',
                '{"v":1,"kind":"user","at":"x"}',
                "",
            ].join("\n"),
        );
        expect(await readTranscript(path)).toEqual({
            turns: [
                { role: "user", text: "hello" },
                {
                    role: "assistant",
                    text: "hi there",
                    stats: {
                        inputTokens: 1,
                        cacheReadTokens: 0,
                        cacheWriteTokens: 0,
                        outputTokens: 2,
                        ttftMs: null,
                        durationMs: 3,
                        costUsd: 0.25,
                        sessionCostUsd: 0.25,
                    },
                    chatCostUsd: 0.25,
                },
            ],
            skipped: 3,
            costUsd: 0.75,
        });
    });

    it("rejects for a missing file", async () => {
        await expect(
            readTranscript(join(dir, "missing.jsonl")),
        ).rejects.toThrow();
    });
});

describe("parseTranscript", () => {
    it("reads text as readTranscript reads a file", async () => {
        const text = [
            JSON.stringify({
                v: 1,
                kind: "session",
                at: "2026-10-03T00:00:00.000Z",
                phrase: "p",
                sdkSessionId: "s",
                model: "m",
                promptSha256: "h",
                resumed: false,
            }),
            JSON.stringify({
                v: 1,
                kind: "user",
                at: "2026-10-03T00:00:01.000Z",
                text: "Hi",
            }),
            "not json",
            JSON.stringify({
                v: 1,
                kind: "assistant",
                at: "2026-10-03T00:00:02.000Z",
                text: "Hello",
                interrupted: false,
            }),
        ].join("\n");
        const path = join(dir, "chat.jsonl");
        await writeFile(path, text);
        const parsed = parseTranscript(text);
        expect(parsed.turns).toEqual([
            { role: "user", text: "Hi" },
            { role: "assistant", text: "Hello" },
        ]);
        expect(parsed.skipped).toBe(1);
        expect(await readTranscript(path)).toEqual(parsed);
    });
});

describe("TranscriptWriter.flushed", () => {
    it("resolves once every append queued so far is in the file", async () => {
        const path = join(dir, "chat.jsonl");
        const writer = await TranscriptWriter.open(path, clock);
        void writer.append({ kind: "user", text: "one" });
        void writer.append({ kind: "user", text: "two" });
        await writer.flushed();
        expect(await lines(path)).toHaveLength(2);
        await writer.close();
    });

    it("resolves even when an append failed", async () => {
        const writer = await TranscriptWriter.open(
            join(dir, "chat.jsonl"),
            clock,
        );
        await writer.close();
        await expect(
            writer.append({ kind: "user", text: "late" }),
        ).rejects.toThrow();
        await expect(writer.flushed()).resolves.toBeUndefined();
    });
});
