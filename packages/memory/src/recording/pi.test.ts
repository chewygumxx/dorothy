// vim:set expandtab shiftwidth=4 filetype=typescript:
// SPDX-License-Identifier: GPL-3.0-only

//
//
// ~xxdorothy/dorothy.git
// ::: :/packages/memory/src/recording/pi.test.ts
//
//

import { describe, expect, it } from "bun:test";
import { createHash } from "node:crypto";
import { type PiRead, type PiReadOptions, readPi } from "./pi.js";
import {
    assistant,
    bashExecution,
    branchSummary,
    compaction,
    contextEdit,
    custom,
    customMessage,
    customRole,
    entry,
    header,
    image,
    label,
    modelChange,
    PARENT_PATH,
    PI_FORK,
    PI_SESSION,
    piAt,
    sessionInfo,
    system,
    text,
    thinking,
    thinkingLevel,
    toolCall,
    toolFinal,
    toolResult,
    usageEntry,
    user,
} from "./pi-fixtures.js";

// The mapping is pinned here independently of the decoder.
const hash = (...parts: string[]) =>
    createHash("sha256").update(parts.join("\0")).digest("hex");
const seg = (session: string, first: string) => `pi-${hash(session, first)}`;
const eid = (origin: string, id: string, kind: string, occurrence = 0) =>
    `e-${hash(origin, id, kind, String(occurrence))}`;
const read = (lines: readonly string[], options: Partial<PiReadOptions> = {}) =>
    readPi(lines, { parent: null, ended: false, ...options });
const allEvents = (r: PiRead) => r.segments.flatMap((s) => s.events);
const ownerOf = (r: PiRead, sourceId: string) =>
    r.segments.find((s) => s.events.some((e) => e.sourceId === sourceId))
        ?.session;
const said = (
    kind: "user" | "assistant",
    id: string,
    words: string,
    second: number,
    origin = PI_SESSION,
) => ({
    kind,
    text: words,
    sourceId: eid(origin, id, kind),
    at: piAt(second),
    ...(kind === "assistant" ? { interrupted: false } : {}),
});

const linear = [
    header(),
    system("sys00001", null, 0),
    user("user0001", "sys00001", "Tell me about moss.", 1),
    assistant(
        "asst0001",
        "user0001",
        [thinking("Synthetic reasoning."), text("Moss likes moisture.")],
        2,
    ),
    modelChange("model001", "asst0001"),
    user("user0002", "model001", "And lichen?", 3),
    assistant("asst0002", "user0002", [text("Lichen is a partnership.")], 4),
];

describe("readPi", () => {
    it("maps a linear session into one segment keyed by its root", () => {
        const firstRead = read(linear);
        const readTwice = read(linear);
        const root = seg(PI_SESSION, "sys00001");
        expect(firstRead.nativeSession).toBe(PI_SESSION);
        expect(firstRead.cwd).toBe("/fixture/project");
        expect(firstRead.halt).toBeNull();
        expect(firstRead.pending).toBe(false);
        expect(firstRead.unknown).toEqual([]);
        expect(firstRead.segments).toEqual([
            {
                session: root,
                parent: null,
                anchor: null,
                pending: false,
                events: [
                    said("user", "user0001", "Tell me about moss.", 1),
                    said("assistant", "asst0001", "Moss likes moisture.", 2),
                    said("user", "user0002", "And lichen?", 3),
                    said(
                        "assistant",
                        "asst0002",
                        "Lichen is a partnership.",
                        4,
                    ),
                ],
            },
        ]);
        expect(readTwice.segments).toEqual(firstRead.segments);
        expect(firstRead.ancestry?.nativeSession).toBe(PI_SESSION);
        expect(Object.keys(firstRead.ancestry?.entries ?? {})).toEqual([
            "sys00001",
            "user0001",
            "asst0001",
            "model001",
            "user0002",
            "asst0002",
        ]);
        expect(firstRead.ancestry?.entries.model001).toMatchObject({
            owner: root,
            origin: PI_SESSION,
            parentId: "asst0001",
        });
        expect(firstRead.ancestry?.entries.model001?.payloadDigest).toMatch(
            /^[0-9a-f]{64}$/,
        );
    });

    it("opens a linked segment for each additional child and switches back", () => {
        const r = read([
            header(),
            user("user0001", null, "Start.", 1),
            assistant("asst0001", "user0001", [text("Ready.")], 2),
            user("user0002", "asst0001", "Branch A.", 3),
            assistant("asst0002", "user0002", [text("A answered.")], 4),
            user("user0003", "asst0001", "Branch B.", 5),
            assistant("asst0003", "user0003", [text("B answered.")], 6),
            branchSummary("summ0001", "asst0002", "asst0003"),
            user("user0004", "summ0001", "Back on A.", 7),
        ]);
        const [branchA, branchB] = r.segments;
        expect(r.segments).toHaveLength(2);
        expect(branchA?.session).toBe(seg(PI_SESSION, "user0001"));
        expect(branchB).toMatchObject({
            session: seg(PI_SESSION, "user0003"),
            parent: seg(PI_SESSION, "user0001"),
            anchor: "asst0001",
        });
        expect(branchA?.session).not.toBe(branchB?.session);
        expect(branchA?.events.map((e) => e.sourceId)).toEqual([
            eid(PI_SESSION, "user0001", "user"),
            eid(PI_SESSION, "asst0001", "assistant"),
            eid(PI_SESSION, "user0002", "user"),
            eid(PI_SESSION, "asst0002", "assistant"),
            eid(PI_SESSION, "user0004", "user"),
        ]);
        expect(branchB?.events.map((e) => e.sourceId)).toEqual([
            eid(PI_SESSION, "user0003", "user"),
            eid(PI_SESSION, "asst0003", "assistant"),
        ]);
        expect(allEvents(r).filter((e) => e.kind === "user")).toHaveLength(4);
    });

    it("counts context entries as children, so later speech keeps identity", () => {
        const before = [
            header(),
            user("user0001", null, "Start.", 1),
            assistant("asst0001", "user0001", [text("Ready.")], 2),
            modelChange("model001", "asst0001"),
            user("user0002", "asst0001", "Second child.", 3),
        ];
        const first = read(before);
        const later = read([...before, user("user0003", "model001", "On.", 4)]);
        const second = seg(PI_SESSION, "user0002");
        expect(ownerOf(first, eid(PI_SESSION, "user0002", "user"))).toBe(
            second,
        );
        expect(ownerOf(later, eid(PI_SESSION, "user0002", "user"))).toBe(
            second,
        );
        expect(ownerOf(later, eid(PI_SESSION, "user0003", "user"))).toBe(
            seg(PI_SESSION, "user0001"),
        );
    });

    it("does not count usage entries as children", () => {
        const withUsage = read([
            header(),
            user("user0001", null, "Start.", 1),
            assistant("asst0001", "user0001", [text("Ready.")], 2),
            usageEntry("usag0001", "asst0001"),
            user("user0002", "usag0001", "Continued.", 3),
            user("user0003", "asst0001", "Branched.", 4),
        ]);
        const without = read([
            header(),
            user("user0001", null, "Start.", 1),
            assistant("asst0001", "user0001", [text("Ready.")], 2),
            user("user0002", "asst0001", "Continued.", 3),
            user("user0003", "asst0001", "Branched.", 4),
        ]);
        expect(withUsage.segments).toEqual(without.segments);
        expect(withUsage.ancestry?.entries.usag0001?.owner).toBe(
            seg(PI_SESSION, "user0001"),
        );
        const usageFirst = read([
            header(),
            user("user0001", null, "Start.", 1),
            usageEntry("usag0001", "user0001"),
            assistant("asst0001", "user0001", [text("Ready.")], 2),
        ]);
        expect(usageFirst.segments.map((s) => s.session)).toEqual([
            seg(PI_SESSION, "user0001"),
        ]);
    });

    describe("file forks", () => {
        const parentLines = [
            header(),
            user("user0001", null, "Start.", 1),
            assistant("asst0001", "user0001", [text("Ready.")], 2),
            label("labl0001", "asst0001", "user0001"),
            user("user0002", "labl0001", "Next.", 3),
            assistant("asst0002", "user0002", [text("Done.")], 4),
        ];
        // createBranchedSession: labels dropped, the path re-chained, then
        // a fresh label appended at the end, then the fork's own speech.
        const forkLines = [
            header(PI_FORK, PARENT_PATH),
            user("user0001", null, "Start.", 1),
            assistant("asst0001", "user0001", [text("Ready.")], 2),
            user("user0002", "asst0001", "Next.", 3),
            assistant("asst0002", "user0002", [text("Done.")], 4),
            label("labl0002", "asst0002", "user0001"),
            user("user0003", "labl0002", "Forked.", 5),
            assistant("asst0003", "user0003", [text("Fork answer.")], 6),
        ];

        it("inherits matching entries without new speech", () => {
            const parent = read(parentLines);
            const child = read(forkLines, { parent: parent.ancestry });
            const inheritedId = eid(PI_SESSION, "user0001", "user");
            expect(child.halt).toBeNull();
            expect(child.pending).toBe(false);
            expect(child.nativeSession).toBe(PI_FORK);
            expect(
                allEvents(child).some((e) => e.sourceId === inheritedId),
            ).toBe(false);
            expect(child.segments).toEqual([
                {
                    session: seg(PI_FORK, "labl0002"),
                    parent: seg(PI_SESSION, "user0001"),
                    anchor: "asst0002",
                    pending: false,
                    events: [
                        said("user", "user0003", "Forked.", 5, PI_FORK),
                        said(
                            "assistant",
                            "asst0003",
                            "Fork answer.",
                            6,
                            PI_FORK,
                        ),
                    ],
                },
            ]);
            expect(child.ancestry?.entries.user0002).toMatchObject({
                owner: seg(PI_SESSION, "user0001"),
                origin: PI_SESSION,
                parentId: "asst0001",
            });
            const grandchild = read(
                [
                    header("77777777-8888-4999-8aaa-bbbbbbbbbbbb", PARENT_PATH),
                    ...forkLines.slice(1),
                    user("user0004", "asst0003", "Again.", 7),
                ],
                { parent: child.ancestry },
            );
            expect(allEvents(grandchild).map((e) => e.sourceId)).toEqual([
                eid("77777777-8888-4999-8aaa-bbbbbbbbbbbb", "user0004", "user"),
            ]);
            expect(grandchild.segments[0]?.parent).toBe(
                seg(PI_FORK, "labl0002"),
            );
        });

        it("holds a fork whose parent ancestry is missing", () => {
            const child = read(forkLines);
            expect(child).toEqual({
                nativeSession: PI_FORK,
                cwd: "/fixture/project",
                segments: [],
                ancestry: null,
                pending: true,
                halt: null,
                unknown: [],
            });
            const unrelated = read(linear);
            expect(unrelated.pending).toBe(false);
            expect(allEvents(unrelated)).toHaveLength(4);
        });

        it("halts an inherited entry whose payload conflicts", () => {
            const parent = read(parentLines);
            const changed = [...forkLines];
            changed[1] = user("user0001", null, "Different.", 1);
            const child = read(changed, { parent: parent.ancestry });
            expect(child.halt).toEqual({ line: 1, code: "conflict" });
            expect(allEvents(child)).toEqual([]);
        });
    });

    describe("graph validation", () => {
        const start = [header(), user("user0001", null, "Start.", 1)];
        const after = user("user0009", "user0001", "Never read.", 9);

        it("ignores an identical repeat of an entry", () => {
            const r = read([...start, start[1] ?? "", after]);
            expect(r.halt).toBeNull();
            expect(allEvents(r).map((e) => e.sourceId)).toEqual([
                eid(PI_SESSION, "user0001", "user"),
                eid(PI_SESSION, "user0009", "user"),
            ]);
        });

        it.each([
            ["duplicate", user("user0001", null, "Changed.", 1)],
            ["cycle", user("user0002", "user0002", "Loop.", 2)],
            ["parent", user("user0002", "missing1", "Orphan.", 2)],
        ])("halts a %s at the last sound boundary", (code, bad) => {
            const r = read([...start, bad, after]);
            expect(r.halt).toEqual({ line: 2, code });
            expect(allEvents(r)).toEqual([
                said("user", "user0001", "Start.", 1),
            ]);
        });

        it("validates the v3 header", () => {
            expect(read([header(PI_SESSION, undefined, 2)]).halt).toEqual({
                line: 0,
                code: "header",
            });
            expect(read(start.slice(1)).halt).toEqual({
                line: 0,
                code: "header",
            });
            expect(
                read([JSON.stringify({ type: "session", version: 3 })]).halt,
            ).toEqual({ line: 0, code: "header" });
            expect(read([])).toMatchObject({ halt: null, segments: [] });
        });
    });

    describe("tools", () => {
        const opening = [
            header(),
            user("user0001", null, "Read both.", 1),
            assistant(
                "asst0001",
                "user0001",
                [
                    text("Checking."),
                    toolCall("call_0", "read", { path: "a" }),
                    toolCall("call_0", "read", { path: "b" }),
                ],
                2,
                "toolUse",
            ),
        ];

        it("pairs repeated call ids by branch ancestry and occurrence", () => {
            const r = read([
                ...opening,
                toolResult("rslt0001", "asst0001", "call_0", "read", [
                    text("A"),
                ]),
                toolResult(
                    "rslt0002",
                    "rslt0001",
                    "call_0",
                    "read",
                    [text("B"), image],
                    4,
                ),
                assistant(
                    "asst0002",
                    "rslt0002",
                    [toolCall("call_0", "bash", { command: "ls" })],
                    5,
                    "toolUse",
                ),
                toolResult(
                    "rslt0003",
                    "asst0002",
                    "call_0",
                    "bash",
                    [text("denied")],
                    6,
                    true,
                ),
                assistant("asst0003", "rslt0003", [text("Done.")], 7),
            ]);
            expect(r.pending).toBe(false);
            expect(allEvents(r)).toEqual([
                said("user", "user0001", "Read both.", 1),
                said("assistant", "asst0001", "Checking.", 2),
                {
                    kind: "tool",
                    name: "read",
                    input: '{"path":"a"}',
                    output: "A",
                    ok: true,
                    sourceId: eid(PI_SESSION, "asst0001", "tool", 0),
                    at: piAt(3),
                },
                {
                    kind: "tool",
                    name: "read",
                    input: '{"path":"b"}',
                    output: "B\n[image]",
                    ok: true,
                    sourceId: eid(PI_SESSION, "asst0001", "tool", 1),
                    at: piAt(4),
                },
                {
                    kind: "tool",
                    name: "bash",
                    input: '{"command":"ls"}',
                    output: "denied",
                    ok: false,
                    sourceId: eid(PI_SESSION, "asst0002", "tool", 0),
                    at: piAt(6),
                },
                said("assistant", "asst0003", "Done.", 7),
            ]);
        });

        it("emits a call's evidence once across branches", () => {
            const r = read([
                ...opening,
                toolResult("rslt0001", "asst0001", "call_0", "read", [
                    text("A"),
                ]),
                toolResult("rslt0002", "rslt0001", "call_0", "read", [
                    text("B"),
                ]),
                toolResult("rslt0003", "asst0001", "call_0", "read", [
                    text("Again"),
                ]),
                toolResult("rslt0004", "rslt0003", "call_0", "read", [
                    text("Again B"),
                ]),
            ]);
            const tools = allEvents(r).filter((e) => e.kind === "tool");
            expect(tools.map((e) => e.sourceId)).toEqual([
                eid(PI_SESSION, "asst0001", "tool", 0),
                eid(PI_SESSION, "asst0001", "tool", 1),
            ]);
            expect(r.segments).toHaveLength(2);
        });

        const aborted = [
            header(),
            user("user0001", null, "Look.", 1),
            assistant(
                "asst0001",
                "user0001",
                [text("Let me look."), toolCall("call_1", "read")],
                2,
                "toolUse",
            ),
            user("user0003", "user0001", "Edited instead.", 4),
            assistant("asst0003", "user0003", [text("Sure.")], 5),
        ];
        const failed = {
            kind: "tool" as const,
            name: "read",
            input: "{}",
            output: "",
            ok: false,
            sourceId: eid(PI_SESSION, "asst0001", "tool"),
            at: piAt(2),
        };

        it("holds a pending call's segment while other branches progress", () => {
            const r = read(aborted);
            const [held, other] = r.segments;
            expect(r.pending).toBe(true);
            expect(held).toMatchObject({ pending: true });
            expect(held?.events).toEqual([
                said("user", "user0001", "Look.", 1),
                said("assistant", "asst0001", "Let me look.", 2),
            ]);
            expect(other).toMatchObject({
                session: seg(PI_SESSION, "user0003"),
                pending: false,
            });
            expect(other?.events).toHaveLength(2);
        });

        it("records an ended call once as failed, with its result's identity", () => {
            const ended = read(aborted, { ended: true });
            expect(ended.pending).toBe(false);
            expect(ended.segments[0]?.events).toEqual([
                said("user", "user0001", "Look.", 1),
                said("assistant", "asst0001", "Let me look.", 2),
                failed,
            ]);
            const answered = read(
                [
                    ...aborted.slice(0, 3),
                    toolResult("rslt0001", "asst0001", "call_1", "read", [
                        text("Late."),
                    ]),
                ],
                { ended: true },
            );
            const tools = allEvents(answered).filter((e) => e.kind === "tool");
            expect(tools.map((e) => e.sourceId)).toEqual([failed.sourceId]);
        });

        // pi-agent-core's agent-loop.js returns before executing the calls
        // of an aborted or errored response, and a sequential batch breaks
        // on abort; Pi persists nothing between a call and its results.
        it.each([
            [
                "an aborted response's calls",
                [
                    ...aborted.slice(0, 2),
                    assistant(
                        "asst0001",
                        "user0001",
                        [text("Let me look."), toolCall("call_1", "read")],
                        2,
                        "aborted",
                    ),
                ],
                "asst0001",
            ],
            [
                "calls a later turn moved past",
                [
                    ...aborted.slice(0, 3),
                    user("user0002", "asst0001", "Never mind.", 3),
                ],
                "user0002",
            ],
        ] as const)(
            "records %s failed once, ended or not",
            (_, lines, leaf) => {
                const live = read(lines);
                const ended = read(lines, { ended: true });
                expect(live.pending).toBe(false);
                expect(live.segments).toEqual(ended.segments);
                const tools = allEvents(live).filter((e) => e.kind === "tool");
                expect(tools).toEqual([failed]);
                const resumed = read([
                    ...lines,
                    user("user0004", leaf, "Resumed.", 6),
                ]);
                expect(resumed.pending).toBe(false);
                expect(
                    allEvents(resumed).filter((e) => e.kind === "tool"),
                ).toEqual([failed]);
                expect(allEvents(resumed).at(-1)?.sourceId).toBe(
                    eid(PI_SESSION, "user0004", "user"),
                );
            },
        );

        it("keeps a pending call held when the read stops early", () => {
            const torn = read([...aborted.slice(0, 3), '{"type":"mess'], {
                ended: true,
            });
            expect(torn.halt).toBeNull();
            expect(torn.pending).toBe(true);
            expect(allEvents(torn).some((e) => e.kind === "tool")).toBe(false);
        });

        it("pairs a result through bookkeeping between it and its call", () => {
            const r = read([
                ...aborted.slice(0, 3),
                entry("fixture_future", "futr0001", "asst0001"),
                usageEntry("usag0001", "futr0001"),
                toolResult("rslt0001", "usag0001", "call_1", "read", [
                    text("Found."),
                ]),
            ]);
            expect(r.pending).toBe(false);
            expect(allEvents(r).at(-1)).toMatchObject({
                kind: "tool",
                output: "Found.",
                sourceId: eid(PI_SESSION, "asst0001", "tool"),
            });
        });

        describe("tool-final entries", () => {
            const final = (
                id: string,
                parentId: string,
                words = "Partial output.",
                isError = true,
                callId = "call_1",
                entryId = "asst0001",
            ) =>
                toolFinal(
                    id,
                    parentId,
                    entryId,
                    callId,
                    [text(words)],
                    isError,
                );
            const finalized = {
                ...failed,
                output: "Partial output.",
                at: piAt(4),
            };
            const toolsOf = (r: PiRead) =>
                allEvents(r).filter((e) => e.kind === "tool");

            it("answers a call Pi wrote no result for, at the call's identity", () => {
                const lines = [
                    ...aborted.slice(0, 3),
                    final("finl0001", "asst0001"),
                ];
                const live = read(lines);
                expect(live.pending).toBe(false);
                expect(live.halt).toBeNull();
                expect(toolsOf(live)).toEqual([finalized]);
                expect(read(lines, { ended: true }).segments).toEqual(
                    live.segments,
                );
                const ok = read([
                    ...aborted.slice(0, 3),
                    final("finl0001", "asst0001", "Done.", false),
                ]);
                expect(toolsOf(ok)).toEqual([
                    { ...finalized, output: "Done.", ok: true },
                ]);
            });

            it("gives way to an ordinary result anywhere on the file", () => {
                for (const lines of [
                    [
                        ...aborted.slice(0, 3),
                        final("finl0001", "asst0001"),
                        toolResult("rslt0001", "finl0001", "call_1", "read", [
                            text("Late."),
                        ]),
                    ],
                    [
                        ...aborted.slice(0, 3),
                        toolResult("rslt0001", "asst0001", "call_1", "read", [
                            text("Late."),
                        ]),
                        final("finl0001", "rslt0001"),
                    ],
                ]) {
                    const tools = toolsOf(read(lines, { ended: true }));
                    expect(tools).toHaveLength(1);
                    expect(tools[0]).toMatchObject({
                        output: "Late.",
                        ok: true,
                        sourceId: failed.sourceId,
                    });
                }
            });

            it("replaces an abandoned call's failure, once", () => {
                const lines = [
                    ...aborted.slice(0, 3),
                    final("finl0001", "asst0001"),
                    final("finl0002", "finl0001", "Second copy."),
                    user("user0002", "finl0002", "Never mind.", 5),
                ];
                for (const ended of [false, true]) {
                    expect(toolsOf(read(lines, { ended }))).toEqual([
                        finalized,
                    ]);
                }
            });

            it("is ignored where it names no call on its branch", () => {
                for (const stray of [
                    final("finl0001", "asst0001", "x", true, "call_9"),
                    final(
                        "finl0001",
                        "asst0001",
                        "x",
                        true,
                        "call_1",
                        "user0001",
                    ),
                    final("finl0001", "asst0003", "x", true, "call_1"),
                    entry("custom", "finl0001", "asst0001", {
                        customType: "dorothy.tool-final",
                        data: { entryId: "asst0001", toolCallId: 1 },
                    }),
                ]) {
                    const lines = [...aborted, stray];
                    const r = read(lines);
                    expect(r.halt).toBeNull();
                    expect(toolsOf(r)).toEqual([]);
                    expect(r.segments[0]?.pending).toBe(true);
                    expect(toolsOf(read(lines, { ended: true }))).toEqual([
                        failed,
                    ]);
                }
            });
        });

        it("records a direct shell command as tool evidence", () => {
            const r = read([
                header(),
                bashExecution("bash0001", null, "ls", "a\nb", 0, 1),
                bashExecution("bash0002", "bash0001", "false", "", 1, 2),
            ]);
            expect(allEvents(r)).toEqual([
                {
                    kind: "tool",
                    name: "bash",
                    input: "ls",
                    output: "a\nb",
                    ok: true,
                    sourceId: eid(PI_SESSION, "bash0001", "tool"),
                    at: piAt(1),
                },
                {
                    kind: "tool",
                    name: "bash",
                    input: "false",
                    output: "",
                    ok: false,
                    sourceId: eid(PI_SESSION, "bash0002", "tool"),
                    at: piAt(2),
                },
            ]);
        });
    });

    describe("content", () => {
        it("keeps original speech through compaction, edits and context", () => {
            const r = read([
                header(),
                system("sys00001", null, 0),
                user("user0001", "sys00001", "Original words.", 1),
                assistant("asst0001", "user0001", [text("Heard.")], 2),
                compaction("comp0001", "asst0001", "user0001"),
                customMessage("cmsg0001", "comp0001"),
                custom("cust0001", "cmsg0001"),
                contextEdit("edit0001", "cust0001", "user0001"),
                label("labl0001", "edit0001", "user0001"),
                sessionInfo("info0001", "labl0001"),
                thinkingLevel("thnk0001", "info0001"),
                customRole("crol0001", "thnk0001"),
                user("user0002", "crol0001", "After compaction.", 3),
                assistant("asst0002", "user0002", [text("Still here.")], 4),
            ]);
            expect(r.halt).toBeNull();
            expect(r.unknown).toEqual([]);
            expect(r.segments).toHaveLength(1);
            expect(allEvents(r)).toEqual([
                said("user", "user0001", "Original words.", 1),
                said("assistant", "asst0001", "Heard.", 2),
                said("user", "user0002", "After compaction.", 3),
                said("assistant", "asst0002", "Still here.", 4),
            ]);
        });

        it("renders images as a marker and marks interrupted speech", () => {
            const r = read([
                header(),
                user("user0001", null, [text("See this."), image], 1),
                user("user0002", "user0001", "   ", 2),
                assistant(
                    "asst0001",
                    "user0002",
                    [thinking("Only thought."), toolCall("call_2", "read")],
                    3,
                    "toolUse",
                ),
                toolResult(
                    "rslt0001",
                    "asst0001",
                    "call_2",
                    "read",
                    [image],
                    4,
                ),
                assistant("asst0002", "rslt0001", [text("Cut")], 5, "aborted"),
            ]);
            expect(
                allEvents(r).map((e) => [e.kind, "text" in e && e.text]),
            ).toEqual([
                ["user", "See this.\n\n[image]"],
                ["tool", false],
                ["assistant", "Cut"],
            ]);
            expect(allEvents(r)[1]).toMatchObject({ output: "[image]" });
            expect(allEvents(r)[2]).toMatchObject({ interrupted: true });
        });
    });

    describe("diagnostics", () => {
        const start = [header(), user("user0001", null, "Start.", 1)];
        const after = user("user0009", "user0001", "Never read.", 9);

        it.each([
            ["message", entry("message", "bad00001", "user0001")],
            ["content", user("bad00001", "user0001", 42)],
            ["content", user("bad00001", "user0001", [{ type: "audio" }])],
            [
                "content",
                assistant("bad00001", "user0001", [
                    { type: "toolCall", id: "c" },
                ]),
            ],
            [
                "content",
                toolResult("bad00001", "user0001", "c", "read", [
                    { type: "x" },
                ]),
            ],
            [
                "role",
                entry("message", "bad00001", "user0001", {
                    message: { role: "future" },
                }),
            ],
            [
                "entry",
                JSON.stringify({
                    type: "message",
                    id: "bad00001",
                    parentId: "user0001",
                    timestamp: "yesterday",
                    message: { role: "user", content: "Hi." },
                }),
            ],
            ["entry", JSON.stringify({ type: "label", parentId: "user0001" })],
            ["entry", entry("model_change", "bad00001", 7 as unknown as null)],
            ["json", "{broken"],
        ])("halts malformed known records (%s)", (code, bad) => {
            const r = read([...start, bad, after]);
            expect(r.halt).toEqual({ line: 2, code });
            expect(allEvents(r)).toEqual([
                said("user", "user0001", "Start.", 1),
            ]);
        });

        it("keeps unknown types once, without speech, in the tree", () => {
            const r = read([
                ...start,
                entry("fixture_future", "futr0001", "user0001", { x: 1 }),
                user("user0002", "futr0001", "After.", 2),
                entry("fixture_future", "futr0002", "user0002", { x: 2 }),
            ]);
            expect(r.halt).toBeNull();
            expect(r.unknown).toEqual([{ line: 2, type: "fixture_future" }]);
            expect(r.segments).toHaveLength(1);
            expect(allEvents(r)).toHaveLength(2);
        });

        it("waits on a torn trailing line", () => {
            const r = read([...start, '{"type":"message","id":"asst']);
            expect(r.halt).toBeNull();
            expect(r.pending).toBe(true);
            expect(allEvents(r)).toEqual([
                said("user", "user0001", "Start.", 1),
            ]);
        });
    });

    it("keeps every earlier owner as branches are appended one at a time", () => {
        let seed = 7;
        const random = (n: number) => {
            seed = (seed * 1103515245 + 12345) % 2 ** 31;
            return seed % n;
        };
        const lines = [header()];
        const ids: string[] = [];
        const owners = new Map<string, string>();
        const links = new Map<string, unknown>();
        for (let step = 0; step < 40; step++) {
            let parentId =
                ids.length === 0 ? null : (ids[random(ids.length)] ?? null);
            for (let length = 1 + random(3); length > 0; length--) {
                const id = `node${String(ids.length).padStart(4, "0")}`;
                const kind = parentId === null ? 0 : random(6);
                const second = ids.length % 60;
                lines.push(
                    [
                        () => user(id, parentId, `Said ${id}.`, second),
                        () =>
                            assistant(
                                id,
                                parentId,
                                [text(`Answered ${id}.`)],
                                second,
                            ),
                        () => modelChange(id, parentId),
                        () => usageEntry(id, parentId),
                        () => label(id, parentId, ids[0] ?? id),
                        () => branchSummary(id, parentId, ids.at(-1) ?? id),
                    ][kind]?.() ?? "",
                );
                ids.push(id);
                parentId = id;
            }
            const r = read(lines);
            expect(r.halt).toBeNull();
            const now = new Map(
                r.segments.flatMap((s) =>
                    s.events.map((e) => [e.sourceId, s.session] as const),
                ),
            );
            for (const [id, { owner }] of Object.entries(
                r.ancestry?.entries ?? {},
            ))
                now.set(id, owner);
            for (const [key, owner] of owners) expect(now.get(key)).toBe(owner);
            for (const s of r.segments) {
                const link = { parent: s.parent, anchor: s.anchor };
                if (links.has(s.session))
                    expect(link).toEqual(links.get(s.session) as typeof link);
                links.set(s.session, link);
            }
            for (const [key, owner] of now) owners.set(key, owner);
        }
        expect(links.size).toBeGreaterThan(5);
    });
});
