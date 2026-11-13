// vim:set expandtab shiftwidth=4 filetype=typescript:
// SPDX-License-Identifier: GPL-3.0-only

//
//
// ~xxdorothy/dorothy.git
// ::: :/packages/memory/src/recording/sweep-pi.test.ts
//
//

import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { dismissHalt, readRecord, startNotices } from "../bodies/unread.js";
import { piSessionRoot } from "../hosts/pi-root.js";
import { eventId } from "./pi.js";
import {
    assistant,
    COMPACTED_LINES,
    compactedForkLines,
    entry,
    forkLines,
    header,
    PARENT_LINES,
    PI_FORK,
    PI_SESSION,
    piText,
    text,
    toolCall,
    user,
} from "./pi-fixtures.js";
import { segmentId } from "./pi-tree.js";
import { sweepPath } from "./state.js";
import { HOUR, NOW, type Rig, rig } from "./sweep-testing.js";

let r: Rig;
let dir = "";
beforeEach(async () => {
    r = await rig();
    dir = join(piSessionRoot(r.env), "digest", "--fixture-project--");
});
afterEach(async () => {
    await r.close();
});

const ROOT_SEGMENT = segmentId(PI_SESSION, "user0001");
const pi = async (options: Parameters<Rig["run"]>[0] = {}) => {
    const [found] = await r.run({ hosts: ["pi"], ...options });
    if (!found) throw new Error("no result for pi");
    return found;
};
const write = (name: string, lines: readonly string[], age = 0) =>
    r.file(join(dir, name), piText(lines), age);
const hints = async () =>
    JSON.parse(await readFile(sweepPath(r.env), "utf8")).sessions as Record<
        string,
        unknown
    >;
const keyOf = (path: string) => JSON.stringify(["pi", path]);
const said = (conversation: Record<string, unknown>[]) =>
    conversation
        .filter((line) => line.kind !== "session")
        .map((line) => line.sourceUuid);
// Lost hints and sidecars: the next sweep reads everything again.
const replay = async () => {
    await rm(sweepPath(r.env), { force: true });
    await rm(join(r.env.XDG_STATE_HOME as string, "dorothy/pi"), {
        recursive: true,
        force: true,
    });
    return { accepted: (await pi()).events };
};

describe("sweeping Pi", () => {
    it("records each segment as its own conversation, linked to its parent", async () => {
        await write("a.jsonl", [
            ...PARENT_LINES,
            assistant("asst0002", "user0001", [text("Synthetic retry.")], 3),
        ]);
        expect(await pi()).toMatchObject({
            sessions: 2,
            events: 3,
            error: null,
        });
        expect(r.requests.every((request) => request.host === "pi")).toBe(true);
        const sessions = (await r.conversations()).map(
            (conversation) => conversation[0],
        );
        expect(sessions).toEqual(
            expect.arrayContaining([
                expect.objectContaining({
                    source: "pi",
                    sourceSession: `pi:${ROOT_SEGMENT}`,
                }),
                expect.objectContaining({
                    source: "pi",
                    sourceSession: `pi:${segmentId(PI_SESSION, "asst0002")}`,
                    parentSession: `pi:${ROOT_SEGMENT}`,
                }),
            ]),
        );
        expect(await replay()).toMatchObject({ accepted: 0 });
    });

    it("records a fork listed before its parent once, with no copies", async () => {
        const parent = join(dir, "b-parent.jsonl");
        const child = await write("a-child.jsonl", forkLines(parent));
        await write("b-parent.jsonl", PARENT_LINES);
        expect(await pi()).toMatchObject({ sessions: 2, events: 4 });
        expect(r.requests.map((request) => request.session)).toEqual([
            segmentId(PI_FORK, "user0002"),
            ROOT_SEGMENT,
        ]);
        expect(r.requests[0]?.parent).toBe(ROOT_SEGMENT);
        const conversations = await r.conversations();
        const fork = conversations.find(
            (conversation) =>
                conversation[0]?.sourceSession ===
                `pi:${segmentId(PI_FORK, "user0002")}`,
        );
        expect(said(fork ?? [])).toEqual([
            eventId(PI_FORK, "user0002", "user", 0),
            eventId(PI_FORK, "asst0002", "assistant", 0),
        ]);
        expect(Object.keys(await hints())).toContain(keyOf(child));
        expect(await replay()).toMatchObject({ accepted: 0 });
    });

    it("records Pi's own fork past a compaction once, with no copies", async () => {
        const parent = await write("a-parent.jsonl", COMPACTED_LINES);
        await write("b-child.jsonl", compactedForkLines(parent));
        expect(await pi()).toMatchObject({ sessions: 2, events: 8 });
        const conversations = await r.conversations();
        const [root, fork] = r.requests.map((request) => request.session);
        const of = (session: string | undefined) =>
            said(
                conversations.find(
                    (c) => c[0]?.sourceSession === `pi:${session}`,
                ) ?? [],
            );
        // The interrupted call once, by Pi's own result; the empty
        // errored reply, the system entry and the summary not at all.
        expect(of(root)).toEqual([
            eventId(PI_SESSION, "user0001", "user", 0),
            eventId(PI_SESSION, "asst0001", "tool", 0),
            eventId(PI_SESSION, "user0002", "user", 0),
            eventId(PI_SESSION, "asst0003", "assistant", 0),
            eventId(PI_SESSION, "user0003", "user", 0),
            eventId(PI_SESSION, "asst0004", "assistant", 0),
        ]);
        expect(of(fork)).toEqual([
            eventId(PI_FORK, "user0004", "user", 0),
            eventId(PI_FORK, "asst0005", "assistant", 0),
        ]);
        expect(r.requests[1]?.parent).toBe(root);
        expect(
            conversations.flat().find((line) => line.kind === "tool"),
        ).toMatchObject({ ok: false, output: "Command aborted" });
        expect(await replay()).toMatchObject({ accepted: 0 });
    });

    it("holds a fork of a parent outside its root, telling it once", async () => {
        const outside = await r.file(
            join(r.home, "outside", "parent.jsonl"),
            piText(PARENT_LINES),
            0,
        );
        const child = await write("child.jsonl", forkLines(outside));
        expect(await pi()).toMatchObject({ held: 1, sessions: 0, events: 0 });
        expect(await pi()).toMatchObject({ held: 1, events: 0 });
        // An hour untouched ends its calls, never its wait for a parent.
        const later = new Date(NOW.getTime() + 2 * HOUR);
        expect(await pi({ now: () => later })).toMatchObject({ held: 1 });
        expect(r.requests).toEqual([]);
        expect(
            r.logs.filter((line) => line.includes("parent session's ancestry")),
        ).toHaveLength(1);
        expect(Object.keys(await hints())).not.toContain(keyOf(child));
    });

    it("keeps a Pi halt under its host, for reread and dismissal", async () => {
        const lines = [
            ...PARENT_LINES,
            entry("message", "bad00001", "asst0001", { message: {} }, 3),
        ];
        const path = await write("a.jsonl", lines);
        expect(await pi()).toMatchObject({ halted: 1, events: 2 });
        expect(await readRecord(r.env, PI_SESSION, "pi")).toMatchObject({
            host: "pi",
            session: PI_SESSION,
            transcript: path,
            line: 4,
            type: "message",
            reason: "message",
        });
        const told = (await startNotices(r.env)).join("\n");
        expect(told).toContain("a Pi session");
        expect(told).toContain(`--sweep --dismiss pi ${PI_SESSION}`);
        // A reread visits the halted file alone, whatever its hint.
        await write("other.jsonl", forkLines(join(dir, "gone.jsonl")));
        expect(
            await pi({ only: (session) => session.path === path }),
        ).toMatchObject({ held: 0, halted: 0, events: 0 });
        expect(await dismissHalt(r.env, PI_SESSION, "pi")).toBe(true);
        expect(await readRecord(r.env, PI_SESSION, "pi")).toMatchObject({
            dismissed: true,
        });
        await write("a.jsonl", [
            ...PARENT_LINES,
            user("user0002", "asst0001", "Synthetic fixed.", 3),
        ]);
        expect(
            await pi({ only: (session) => session.path === path }),
        ).toMatchObject({ halted: 0, events: 1 });
        expect(await readRecord(r.env, PI_SESSION, "pi")).toBeNull();
    });

    it("holds a segment behind an open call until an hour untouched", async () => {
        const path = await write("a.jsonl", [
            header(),
            user("user0001", null, "Synthetic question.", 1),
            assistant("asst0001", "user0001", [toolCall("call-1", "read")], 2),
        ]);
        expect(await pi()).toMatchObject({ events: 1 });
        expect(Object.keys(await hints())).not.toContain(keyOf(path));
        const later = new Date(NOW.getTime() + 2 * HOUR);
        expect(await pi({ now: () => later })).toMatchObject({ events: 1 });
        // The segment is sent whole; the archive keeps only the new event.
        expect(r.requests.at(-1)?.events?.slice(1)).toEqual([
            expect.objectContaining({
                kind: "tool",
                ok: false,
                sourceId: eventId(PI_SESSION, "asst0001", "tool", 0),
            }),
        ]);
        expect(Object.keys(await hints())).toContain(keyOf(path));
    });

    it("remembers a file only once every segment is recorded", async () => {
        const path = await write("a.jsonl", [
            ...PARENT_LINES,
            assistant("asst0002", "user0001", [text("Synthetic retry.")], 3),
        ]);
        let calls = 0;
        const failing = await r.run({
            hosts: ["pi"],
            record: async () => {
                calls += 1;
                if (calls === 2) throw new Error("synthetic outage");
                return {
                    accepted: 0,
                    duplicates: 0,
                    through: null,
                    phrase: null,
                };
            },
        });
        expect(failing[0]?.error).toBe("synthetic outage");
        expect(Object.keys(await hints())).not.toContain(keyOf(path));
        expect(await pi()).toMatchObject({ sessions: 2, events: 3 });
        expect(Object.keys(await hints())).toContain(keyOf(path));
    });

    it("leaves a session before the watermark to the backfill", async () => {
        await pi();
        await write("a.jsonl", PARENT_LINES, 2 * HOUR);
        expect(await pi()).toMatchObject({ waiting: 1, events: 0 });
        expect(await pi({ backfill: true })).toMatchObject({ events: 2 });
    });
});
