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
                { role: "assistant", text: "hi there" },
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
