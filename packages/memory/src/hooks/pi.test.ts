// vim:set expandtab shiftwidth=4 filetype=typescript:
// SPDX-License-Identifier: GPL-3.0-only

//
//
// ~chewygumxx/dorothy.git
// ::: :/packages/memory/src/hooks/pi.test.ts
//
//

import {
    afterAll,
    afterEach,
    beforeAll,
    beforeEach,
    describe,
    expect,
    it,
} from "bun:test";
import {
    mkdir,
    mkdtemp,
    readdir,
    rm,
    symlink,
    writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Env, RecordRequest, RecordResponse } from "@dorothy/core";
import { acceptRecord } from "../contract/record.js";
import { piSessionRoot } from "../hosts/pi-root.js";
import { syncIndex } from "../recall/sync.js";
import { eventId } from "../recording/pi.js";
import {
    assistant,
    forkLines,
    header,
    PARENT_LINES,
    PI_FORK,
    PI_SESSION,
    piText,
    text,
    toolCall,
    user,
} from "../recording/pi-fixtures.js";
import { segmentId } from "../recording/pi-tree.js";
import { type Rig, rig } from "../recording/sweep-testing.js";
import { transcriptDir } from "../transcript.js";
import { type PiHookDeps, type PiHookRequest, runPiHostHook } from "./pi.js";

let seen: { path: string; body: Record<string, unknown> }[] = [];
let server: ReturnType<typeof Bun.serve>;
beforeAll(() => {
    server = Bun.serve({
        port: 0,
        async fetch(request) {
            const path = new URL(request.url).pathname;
            if (path === "/v1/health") return Response.json({ ok: true });
            const body = (await request.json()) as Record<string, unknown>;
            seen.push({ path, body });
            if (path === "/v1/block")
                return Response.json({
                    text: "BLOCK",
                    digest: "xxh3:0000000000000000",
                    items: [],
                    used: 5,
                });
            return Response.json({ text: "RECALL", ids: [], used: 6 });
        },
    });
});
afterAll(() => server.stop(true));

let r: Rig;
let env: Env;
let dir = "";
let recordCalls: RecordRequest[] = [];
let warned: string[] = [];
const PROJECT_A = "/fixture/project-a";
const PROJECT_B = "/fixture/project-b";
const projectA = "github.com/fixture/a";
const projectB = "github.com/fixture/b";
beforeEach(async () => {
    r = await rig();
    env = { ...r.env, DOROTHY_MEMORY_URL: `http://127.0.0.1:${server.port}` };
    dir = join(piSessionRoot(env), "digest", "--fixture-project--");
    seen = [];
    recordCalls = [];
    warned = [];
    sessions = new Map();
});
afterEach(async () => {
    await r.close();
});

// The service's record route, as the CLI helper's client reaches it.
let sessions = new Map<string, string>();
const archive = async (request: RecordRequest): Promise<RecordResponse> =>
    acceptRecord(request, {
        env,
        index: r.index,
        recorder: null,
        lock: r.index.lock,
        loopback: true,
        sync: () => syncIndex(r.index, transcriptDir(env)),
        claudeTranscript: null,
        sessions,
    });
const deps = (
    record: (
        request: RecordRequest,
    ) => Promise<RecordResponse | null> = archive,
) => ({
    env,
    serve: [] as string[],
    identify: async (cwd: string) =>
        cwd === PROJECT_A
            ? { id: projectA }
            : cwd === PROJECT_B
              ? { id: projectB }
              : null,
    log: {
        info: () => {},
        warn: (message: string) => warned.push(message),
        error: (message: string) => warned.push(message),
    },
    record: async (request: RecordRequest) => {
        recordCalls.push(request);
        return record(request);
    },
});
const ask = (over: Partial<PiHookRequest>, using: PiHookDeps = deps()) =>
    runPiHostHook(
        {
            event: "start",
            sessionId: PI_SESSION,
            sessionFile: join(dir, "a.jsonl"),
            leafId: null,
            cwd: PROJECT_A,
            private: false,
            ...over,
        },
        using,
    );
const write = (name: string, lines: readonly string[]) =>
    r.file(join(dir, name), piText(lines), 0);
const ROOT_SEGMENT = segmentId(PI_SESSION, "user0001");
const RETRY_SEGMENT = segmentId(PI_SESSION, "asst0002");
const branched = [
    header(PI_SESSION, undefined, 3, PROJECT_A),
    ...PARENT_LINES.slice(1),
    assistant("asst0002", "user0001", [text("Synthetic retry.")], 3),
];
const sourceIds = async () =>
    (await r.conversations()).flatMap((conversation) =>
        conversation
            .filter((line) => line.kind !== "session")
            .map((line) => line.sourceUuid),
    );
const sweepPi = async () => (await r.run({ hosts: ["pi"] }))[0];

describe("runPiHostHook", () => {
    it("answers an invalid request with a code alone", async () => {
        for (const input of [
            null,
            "start",
            { event: "start" },
            { event: "later", sessionId: PI_SESSION },
        ])
            expect(await runPiHostHook(input, deps())).toEqual({
                session: null,
                context: "",
                recording: "off",
                warning: "pi_request_invalid",
            });
        expect(seen).toEqual([]);
        expect(recordCalls).toEqual([]);
    });

    it("opens with the block for the active leaf's segment and project", async () => {
        await write("a.jsonl", branched);
        expect(await ask({ leafId: "asst0002" })).toEqual({
            session: RETRY_SEGMENT,
            context: "BLOCK",
            recording: "pending",
            warning: null,
        });
        expect(seen).toEqual([
            {
                path: "/v1/block",
                body: {
                    host: "pi",
                    session: RETRY_SEGMENT,
                    project: projectA,
                    reason: "startup",
                },
            },
        ]);
        expect(recordCalls).toEqual([]);
    });

    it("rebinds a resumed session that enters another project", async () => {
        const inB = [header(PI_FORK, undefined, 3, PROJECT_B)];
        await write("a.jsonl", PARENT_LINES);
        const b = await write("b.jsonl", [
            ...inB,
            user("user0001", null, "Synthetic question in B.", 1),
        ]);
        await ask({ leafId: "asst0001", reason: "resume" });
        const resumed = { sessionId: PI_FORK, sessionFile: b, cwd: PROJECT_B };
        await ask({ ...resumed, leafId: "user0001", reason: "resume" });
        await ask({
            ...resumed,
            event: "prompt",
            leafId: "user0001",
            prompt: "Synthetic prompt.",
        });
        expect(seen.map(({ path, body }) => [path, body.project])).toEqual([
            ["/v1/block", projectA],
            ["/v1/block", projectB],
            ["/v1/recall", projectB],
        ]);
        expect(seen[1]?.body.reason).toBe("resume");
        expect(seen[2]?.body.prompt).toBe("Synthetic prompt.");
        await ask({ ...resumed, event: "settled", leafId: "user0001" });
        const secondProjectRequest = recordCalls[0];
        expect(secondProjectRequest?.project).toBe(projectB);
    });

    it("records under the file's own project, as the sweep does", async () => {
        // A real repository, so the hook and the sweep use one resolver.
        const repo = await mkdtemp(join(tmpdir(), "dorothy-pi-repo-"));
        try {
            await mkdir(join(repo, ".git"));
            await writeFile(
                join(repo, ".git", "config"),
                '[remote "origin"]\n\turl = https://github.com/fixture/b.git\n',
            );
            const lines = [
                header(PI_SESSION, undefined, 3, repo),
                ...PARENT_LINES.slice(1),
            ];
            const path = await write("a.jsonl", lines);
            // The sweep first, then the hook told of a live directory Pi
            // was given in place of the header's: one project for both.
            await sweepPi();
            const swept = r.requests.map((request) => request.project);
            expect(swept).toEqual(["github.com/fixture/b"]);
            const { identify: _, ...resolving } = deps();
            await ask(
                { event: "settled", leafId: "asst0001", sessionFile: path },
                resolving,
            );
            expect(recordCalls.map((request) => request.project)).toEqual(
                swept,
            );
        } finally {
            await rm(repo, { recursive: true, force: true });
        }
    });

    it("refuses a session id the file does not carry", async () => {
        await write("a.jsonl", PARENT_LINES);
        const other = { sessionId: PI_FORK, leafId: "asst0001" };
        expect(await ask(other)).toEqual({
            session: null,
            context: "BLOCK",
            recording: "pending",
            warning: "pi_session_mismatch",
        });
        expect(seen[0]?.body.session).toBe(PI_FORK);
        expect(await ask({ ...other, event: "settled" })).toEqual({
            session: null,
            context: "",
            recording: "pending",
            warning: "pi_session_mismatch",
        });
        expect(await ask({ ...other, event: "end" })).toMatchObject({
            recording: "pending",
            warning: "pi_session_mismatch",
        });
        expect(recordCalls).toEqual([]);
    });

    it("records the leaf's segment when settled, and all at the end", async () => {
        await write("a.jsonl", branched);
        expect(await ask({ event: "settled", leafId: "asst0002" })).toEqual({
            session: RETRY_SEGMENT,
            context: "",
            recording: "delivered",
            warning: null,
        });
        expect(recordCalls).toEqual([
            {
                host: "pi",
                session: RETRY_SEGMENT,
                project: projectA,
                parent: ROOT_SEGMENT,
                events: [
                    expect.objectContaining({
                        sourceId: eventId(
                            PI_SESSION,
                            "asst0002",
                            "assistant",
                            0,
                        ),
                    }),
                ],
            },
        ]);
        expect(await ask({ event: "end", leafId: "asst0002" })).toMatchObject({
            recording: "delivered",
        });
        expect(recordCalls.map((request) => request.session)).toEqual([
            RETRY_SEGMENT,
            ROOT_SEGMENT,
            RETRY_SEGMENT,
        ]);
        expect(recordCalls.every((request) => request.host === "pi")).toBe(
            true,
        );
        expect((await sourceIds()).sort()).toEqual(
            [
                eventId(PI_SESSION, "user0001", "user", 0),
                eventId(PI_SESSION, "asst0001", "assistant", 0),
                eventId(PI_SESSION, "asst0002", "assistant", 0),
            ].sort(),
        );
        expect(seen).toEqual([]);
    });

    it("records an open call failed only at the end", async () => {
        await write("a.jsonl", [
            header(),
            user("user0001", null, "Synthetic question.", 1),
            assistant("asst0001", "user0001", [toolCall("call-1", "read")], 2),
        ]);
        const call = eventId(PI_SESSION, "asst0001", "tool", 0);
        expect(
            await ask({ event: "settled", leafId: "asst0001" }),
        ).toMatchObject({ recording: "pending", warning: null });
        expect(await sourceIds()).not.toContain(call);
        expect(await ask({ event: "end", leafId: "asst0001" })).toMatchObject({
            recording: "delivered",
        });
        expect(await sourceIds()).toContain(call);
    });

    it("keeps nothing of a private or file-less session", async () => {
        const path = await write("a.jsonl", PARENT_LINES);
        for (const over of [
            { private: true, sessionFile: path },
            { sessionFile: null },
        ]) {
            expect(
                await ask({ event: "settled", leafId: "asst0001", ...over }),
            ).toEqual({
                session: null,
                context: "",
                recording: "off",
                warning: null,
            });
            expect(await ask({ ...over })).toEqual({
                session: null,
                context: "BLOCK",
                recording: "off",
                warning: null,
            });
        }
        expect(recordCalls).toEqual([]);
        expect(seen.map(({ body }) => body.session)).toEqual([
            PI_SESSION,
            PI_SESSION,
        ]);
        // Not even read: a read would leave the file's sidecar.
        expect(
            await readdir(
                join(env.XDG_STATE_HOME as string, "dorothy/pi"),
            ).catch(() => []),
        ).toEqual([]);
    });

    it("waits for a session Pi has not written yet", async () => {
        expect(await ask({})).toEqual({
            session: null,
            context: "BLOCK",
            recording: "pending",
            warning: null,
        });
        expect(seen[0]?.body.session).toBe(PI_SESSION);
        expect(await ask({ event: "settled" })).toEqual({
            session: null,
            context: "",
            recording: "pending",
            warning: null,
        });
        expect(recordCalls).toEqual([]);
    });

    it("holds a fork whose ancestry is missing, guessing no session", async () => {
        const outside = await r.file(
            join(r.home, "outside", "parent.jsonl"),
            piText(PARENT_LINES),
            0,
        );
        const path = await write("fork.jsonl", forkLines(outside));
        const asked = {
            sessionId: PI_FORK,
            sessionFile: path,
            leafId: "asst0002",
        };
        for (const event of ["start", "settled"] as const)
            expect(await ask({ ...asked, event })).toEqual({
                session: null,
                context: event === "start" ? "BLOCK" : "",
                recording: "pending",
                warning: "pi_ancestry_missing",
            });
        expect(seen[0]?.body.session).toBe(PI_FORK);
        expect(recordCalls).toEqual([]);
    });

    it("refuses a session file outside the root or a symlink", async () => {
        const outside = await r.file(
            join(r.home, "outside", "a.jsonl"),
            piText(PARENT_LINES),
            0,
        );
        await write("real.jsonl", PARENT_LINES);
        await symlink(join(dir, "real.jsonl"), join(dir, "linked.jsonl"));
        for (const sessionFile of [
            outside,
            join(dir, "..", "..", "..", "..", "..", "outside", "a.jsonl"),
            join(dir, "linked.jsonl"),
        ])
            expect(
                await ask({
                    event: "settled",
                    leafId: "asst0001",
                    sessionFile,
                }),
            ).toEqual({
                session: null,
                context: "",
                recording: "off",
                warning: "pi_session_outside",
            });
        expect(recordCalls).toEqual([]);
    });

    it("keeps work for catch-up through a service outage", async () => {
        await write("a.jsonl", branched);
        const down = deps(async () => null);
        expect(await ask({ event: "end", leafId: "asst0002" }, down)).toEqual({
            session: RETRY_SEGMENT,
            context: "",
            recording: "pending",
            warning: "pi_record_queued",
        });
        expect(await sourceIds()).toEqual([]);
        // The sweep recovers it from the file; a replay adds nothing.
        expect(await sweepPi()).toMatchObject({ sessions: 2, events: 3 });
        recordCalls = [];
        expect(await ask({ event: "end", leafId: "asst0002" })).toMatchObject({
            recording: "delivered",
        });
        const replay = async () => ({
            accepted: (
                await Promise.all(
                    recordCalls.map((request) => archive(request)),
                )
            ).reduce((sum, response) => sum + response.accepted, 0),
        });
        expect(await replay()).toMatchObject({ accepted: 0 });
        expect(await sourceIds()).toHaveLength(3);
    });

    it("records each event once while a sweep runs beside it", async () => {
        await write("a.jsonl", branched);
        await Promise.all([
            ask({ event: "end", leafId: "asst0002" }),
            sweepPi(),
            ask({ event: "settled", leafId: "asst0002" }),
        ]);
        const ids = await sourceIds();
        expect(ids).toHaveLength(3);
        expect(new Set(ids).size).toBe(3);
        expect((await r.conversations()).length).toBe(2);
    });

    it("warns, never fails, when the service is gone", async () => {
        await write("a.jsonl", PARENT_LINES);
        const gone = {
            ...deps(),
            env: { ...env, DOROTHY_MEMORY_URL: "http://127.0.0.1:9" },
        };
        expect(await ask({ leafId: "asst0001" }, gone)).toEqual({
            session: ROOT_SEGMENT,
            context: "",
            recording: "pending",
            warning: "pi_memory_unavailable",
        });
        expect(warned.join(" ")).toContain("pi session-start");
    });
});
