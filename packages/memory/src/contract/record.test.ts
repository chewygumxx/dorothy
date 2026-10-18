// vim:set expandtab shiftwidth=4 filetype=typescript:
// SPDX-License-Identifier: GPL-3.0-only

//
//
// ~chewygumxx/dorothy.git
// ::: :/packages/memory/src/contract/record.test.ts
//
//

import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Env, RecordEvent, RecordRequest } from "@dorothy/core";
import { indexPath, RecallIndex } from "../recall/store.js";
import { syncIndex } from "../recall/sync.js";
import { transcriptDir, transcriptPath } from "../transcript.js";
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
        expect(lines().filter((line) => line.kind === "user")).toHaveLength(3);
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
        expect(
            await acceptRecord(
                { ...request([user("a")]), private: true },
                deps(),
            ),
        ).toEqual({ accepted: 0, duplicates: 0, through: null });
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
