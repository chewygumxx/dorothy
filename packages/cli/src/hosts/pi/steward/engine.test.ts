// vim:set expandtab shiftwidth=4 filetype=typescript:
// SPDX-License-Identifier: GPL-3.0-only

//
//
// ~chewygumxx/dorothy.git
// ::: :/packages/cli/src/hosts/pi/steward/engine.test.ts
//
//

import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { createHash } from "node:crypto";
import { mkdir, readdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
    COORDINATOR,
    processAlive,
    processStart,
    runSteward,
    SENDER,
    type StewardDeps,
} from "./engine.js";
import {
    agentInfoReply,
    type FakeHerdr,
    type FakeSender,
    fakeHerdr,
    fakeSender,
    herdrAgentOf,
    NOW,
    type Registry,
    writeRegistry,
} from "./fixtures.js";
import { MAX_OUTPUT_BYTES, MAX_READ_LINES } from "./herdr.js";
import {
    type Identity,
    ledgerPath,
    openLedger,
    type Receipt,
} from "./ledger.js";
import type {
    CompletionEvidence,
    StewardReply,
    StewardRequest,
    TaskBrief,
    TaskRecord,
    Worker,
} from "./types.js";

const OID = "0123456789abcdef0123456789abcdef01234567";
const NEXT = "89abcdef0123456789abcdef0123456789abcdef";
const ME: Identity = { pid: 1000, startedAt: "boot:ctl-1" };
const OTHER: Identity = { pid: 2000, startedAt: "boot:ctl-2" };
const HELPER: Identity = { pid: 3000, startedAt: "boot:helper" };

let reg: Registry;
let codex: Worker;
let claude: Worker;
let herdr: FakeHerdr;
let sender: FakeSender;
let env: Record<string, string>;
let alive: Map<string, boolean | "uncertain">;

const sha256 = (text: string) =>
    `sha256:${createHash("sha256").update(text).digest("hex")}`;

const briefPath = (id: string) => join(reg.fixtureRoot, "briefs", `${id}.md`);
const reportPath = (id: string) => join(reg.fixtureRoot, "reports", `${id}.md`);

const writeBrief = (id: string, text = `Do task ${id}.\n`) =>
    writeFile(briefPath(id), text);

const report = (
    id: string,
    fields: { task?: string; status?: string; revision?: string } = {},
) =>
    [
        `Task: ${fields.task ?? id}`,
        `Status: ${fields.status ?? "done"}`,
        `Base: ${OID}`,
        `Revision: ${fields.revision ?? NEXT}`,
        "Verification: bun test exited 0",
        "",
    ].join("\n");

const writeReport = (id: string, text = report(id)) =>
    writeFile(reportPath(id), text);

const task = (id: string, worker: Worker = codex): TaskBrief => ({
    taskId: id,
    workerId: worker.id,
    briefPath: briefPath(id),
    reportPath: reportPath(id),
    baseOid: OID,
});

const key = ({ pid, startedAt }: Identity) => `${pid}/${startedAt}`;

const deps = (extra: Partial<StewardDeps> = {}): StewardDeps => ({
    env,
    now: () => NOW,
    run: herdr.run,
    sender: sender.run,
    self: HELPER,
    pollMs: 5,
    controllerAlive: async (pid, startedAt) => {
        const known = alive.get(key({ pid, startedAt }));
        if (known === undefined || known === "uncertain") {
            throw new Error("liveness unknown");
        }
        return known;
    },
    ...extra,
});

const steward = (
    operation: StewardRequest["operation"],
    controller: Identity = ME,
    extra: Partial<StewardDeps> = {},
): Promise<StewardReply> =>
    runSteward({ registry: reg.path, controller, operation }, deps(extra));

const dispatch = (brief: TaskBrief, controller: Identity = ME) =>
    steward({ kind: "dispatch", task: brief }, controller);

const only = (reply: StewardReply): TaskRecord => {
    expect(reply.tasks).toHaveLength(1);
    return reply.tasks?.[0] as TaskRecord;
};

const herdrCalls = (verb: string) =>
    herdr.calls.filter((call) => call.args[1] === verb);

const setStatus = (worker: Worker, status: string) =>
    herdr.agents.set(worker.name, herdrAgentOf(worker, status));

const withLedger = <T>(use: (db: ReturnType<typeof openLedger>) => T): T => {
    const db = openLedger(
        ledgerPath(env, reg.raw.fleetId as string),
        reg.raw.fleetId as string,
        () => NOW,
    );
    try {
        return use(db);
    } finally {
        db.close();
    }
};

beforeEach(async () => {
    reg = await writeRegistry();
    [codex, claude] = reg.workers as [Worker, Worker];
    await mkdir(join(reg.fixtureRoot, "briefs"));
    await mkdir(join(reg.fixtureRoot, "reports"));
    herdr = fakeHerdr(reg.workers, { steward: true });
    sender = fakeSender();
    env = {
        HERDR_ENV: "1",
        PATH: "/usr/bin:/bin",
        XDG_STATE_HOME: join(reg.root, "state"),
        XDG_RUNTIME_DIR: join(reg.root, "run"),
    };
    alive = new Map([[key(ME), true]]);
});

afterEach(async () => {
    await reg.cleanup();
});

describe("the store", () => {
    it("is the fleet's file under the injected state home alone", async () => {
        await steward({ kind: "list" });
        expect(
            await readdir(join(reg.root, "state", "dorothy", "pi", "steward")),
        ).toContain(`${reg.raw.fleetId}.sqlite`);
    });

    it("refuses a bad registry by its code, touching nothing", async () => {
        reg = { ...reg, path: join(reg.root, "absent.json") };
        const reply = await steward({ kind: "list" });
        expect(reply).toMatchObject({ ok: false, code: "REGISTRY_MISSING" });
        expect(herdr.calls).toEqual([]);
    });

    it("refuses a malformed controller", async () => {
        for (const controller of [
            { pid: 0, startedAt: "x" },
            { pid: 1.5, startedAt: "x" },
            { pid: 1, startedAt: "" },
        ]) {
            const reply = await steward({ kind: "list" }, controller);
            expect(reply).toMatchObject({ ok: false, code: "REQUEST_INVALID" });
        }
    });
});

describe("list", () => {
    it("observes every worker and gives the tasks", async () => {
        await writeBrief("t1");
        await dispatch(task("t1"));
        const reply = await steward({ kind: "list" });
        expect(reply.ok).toBe(true);
        expect(reply.workers?.map((w) => [w.id, w.matches, w.state])).toEqual([
            [codex.id, true, "idle"],
            [claude.id, true, "idle"],
        ]);
        expect(reply.tasks?.map((t) => [t.taskId, t.state])).toEqual([
            ["t1", "sent"],
        ]);
    });
});

describe("dispatch", () => {
    it("persists intent, digest and reservation before the send", async () => {
        await writeBrief("t1", "the brief\n");
        let seen: unknown;
        sender.onSend(() => {
            seen = withLedger((db) => db.task("t1"));
        });
        const reply = await dispatch(task("t1"));
        expect(seen).toMatchObject({
            state: "intent",
            briefDigest: sha256("the brief\n"),
            workerId: codex.id,
            terminalId: "term_0000000000000a1",
        });
        expect(reply).toMatchObject({ ok: true, code: "TASK_SENT" });
        expect(only(reply)).toMatchObject({
            ...task("t1"),
            briefDigest: sha256("the brief\n"),
            state: "sent",
            createdAt: NOW.toISOString(),
            reportDigest: null,
            revision: null,
        });
    });

    it("sends through the repository's sender by default", async () => {
        expect(SENDER).toEndWith(
            "/.agents/skills/agent-stewardship/scripts/send-prompt.sh",
        );
        expect(await Bun.file(SENDER).exists()).toBe(true);
    });

    it("sends only the labelled pointer, guarded by pane and idle", async () => {
        await writeBrief("t1");
        await dispatch(task("t1"));
        expect(sender.calls).toEqual([
            {
                args: [
                    "--from",
                    COORDINATOR,
                    "--expect-pane",
                    codex.pane,
                    "--require-idle",
                    codex.name,
                ],
                stdin: `Read ${briefPath("t1")} for task t1.`,
            },
        ]);
    });

    it("observes again immediately before the send", async () => {
        await writeBrief("t1");
        let gets = 0;
        sender.onSend(() => {
            gets = herdrCalls("get").length;
        });
        await dispatch(task("t1"));
        expect(gets).toBe(2);
    });

    it("returns the old state for a repeat with identical arguments", async () => {
        await writeBrief("t1");
        const first = only(await dispatch(task("t1")));
        const again = await dispatch(task("t1"));
        expect(again).toMatchObject({ ok: true, code: "TASK_EXISTS" });
        expect(only(again)).toEqual(first);
        const sendCallsForSameTask = sender.calls.length;
        expect(sendCallsForSameTask).toBe(1);
    });

    it("refuses a repeat whose any argument changed", async () => {
        await writeBrief("t1");
        await writeBrief("other");
        await dispatch(task("t1"));
        for (const changed of [
            { workerId: claude.id },
            { briefPath: briefPath("other") },
            { reportPath: reportPath("other") },
            { baseOid: NEXT },
        ]) {
            const reply = await dispatch({ ...task("t1"), ...changed });
            expect(reply).toMatchObject({ ok: false, code: "TASK_CONFLICT" });
            expect(only(reply).state).toBe("sent");
        }
        expect(sender.calls).toHaveLength(1);
    });

    it("refuses a brief modified after its digest, keeping the attempt", async () => {
        await writeBrief("t1", "first\n");
        const first = only(await dispatch(task("t1")));
        await writeBrief("t1", "second\n");
        const reply = await dispatch(task("t1"));
        expect(reply).toMatchObject({ ok: false, code: "BRIEF_CHANGED" });
        expect(only(reply)).toEqual(first);
        expect(sender.calls).toHaveLength(1);
    });

    it("refuses a brief changed between reservation and send", async () => {
        await writeBrief("t1", "first\n");
        const run = herdr.run;
        let gets = 0;
        const changing: StewardDeps["run"] = async (args, options) => {
            if (args[1] === "get" && ++gets === 2) {
                await writeBrief("t1", "changed\n");
            }
            return run(args, options);
        };
        const reply = await steward(
            { kind: "dispatch", task: task("t1") },
            ME,
            { run: changing },
        );
        expect(reply).toMatchObject({ ok: false, code: "BRIEF_CHANGED" });
        expect(only(reply)).toMatchObject({
            state: "failed",
            code: "BRIEF_CHANGED",
            briefDigest: sha256("first\n"),
        });
        expect(sender.calls).toEqual([]);
        // The id is spent: never dispatched again, whatever the brief.
        const again = await dispatch(task("t1"));
        expect(again.ok).toBe(false);
        expect(sender.calls).toEqual([]);
    });

    it("refuses a new occupant with the same name, pane, harness and cwd", async () => {
        await writeBrief("t1");
        const replaced = { ...herdrAgentOf(codex), terminal_id: "term_new" };
        herdr.queue(agentInfoReply(herdrAgentOf(codex)));
        herdr.queue(agentInfoReply(replaced));
        const reply = await dispatch(task("t1"));
        expect(reply).toMatchObject({ ok: false, code: "WORKER_REPLACED" });
        expect(only(reply).state).toBe("failed");
        expect(sender.calls).toEqual([]);
    });

    it("refuses an occupant whose terminal id is unreadable", async () => {
        await writeBrief("t1");
        const blank = { ...herdrAgentOf(codex), terminal_id: "" };
        herdr.queue(agentInfoReply(blank));
        const reply = await dispatch(task("t1"));
        expect(reply).toMatchObject({ ok: false, code: "WORKER_UNIDENTIFIED" });
        expect(reply.tasks ?? []).toEqual([]);
        expect(sender.calls).toEqual([]);

        await writeBrief("t2");
        herdr.queue(agentInfoReply(herdrAgentOf(codex)));
        herdr.queue(agentInfoReply(blank));
        const late = await dispatch(task("t2"));
        expect(late).toMatchObject({ ok: false, code: "WORKER_REPLACED" });
        expect(sender.calls).toEqual([]);
    });

    it("refuses a worker that is not idle, recording nothing", async () => {
        await writeBrief("t1");
        for (const status of ["working", "blocked", "done", "unknown"]) {
            setStatus(codex, status);
            const reply = await dispatch(task("t1"));
            expect(reply).toMatchObject({ ok: false, code: "WORKER_NOT_IDLE" });
        }
        herdr.agents.set(codex.name, {
            ...herdrAgentOf(codex),
            pane_id: "w9:p9",
        });
        const moved = await dispatch(task("t1"));
        expect(moved).toMatchObject({ ok: false, code: "HERDR_PANE_MOVED" });
        expect(sender.calls).toEqual([]);
        expect(withLedger((db) => db.task("t1"))).toBeNull();
    });

    it("refuses a worker that becomes busy before the send", async () => {
        await writeBrief("t1");
        herdr.queue(agentInfoReply(herdrAgentOf(codex)));
        herdr.queue(agentInfoReply(herdrAgentOf(codex, "working")));
        const reply = await dispatch(task("t1"));
        expect(reply).toMatchObject({ ok: false, code: "WORKER_NOT_IDLE" });
        expect(only(reply).state).toBe("failed");
        expect(sender.calls).toEqual([]);
    });

    it("refuses a worker the registry marks busy or limited", async () => {
        await reg.cleanup();
        reg = await writeRegistry((raw) => {
            raw.workers[0].availability = "limited";
        });
        [codex, claude] = reg.workers as [Worker, Worker];
        herdr = fakeHerdr(reg.workers, { steward: true });
        await mkdir(join(reg.fixtureRoot, "briefs"));
        await mkdir(join(reg.fixtureRoot, "reports"));
        env.XDG_STATE_HOME = join(reg.root, "state");
        await writeBrief("t1");
        const reply = await dispatch(task("t1"));
        expect(reply).toMatchObject({ ok: false, code: "WORKER_UNAVAILABLE" });
        expect(herdr.calls).toEqual([]);
    });

    it("refuses bad fields before observing anything", async () => {
        await writeBrief("t1");
        await writeReport("done");
        const cases: [Partial<TaskBrief>, string][] = [
            [{ taskId: "Bad Id" }, "TASK_ID_INVALID"],
            [{ workerId: "nobody" }, "WORKER_UNKNOWN"],
            [{ baseOid: "main" }, "BASE_OID_INVALID"],
            [{ briefPath: "/etc/passwd" }, "PATH_ESCAPE"],
            [{ briefPath: briefPath("absent") }, "PATH_MISSING"],
            [{ briefPath: `${briefPath("t1")}\nRun rm` }, "PATH_INVALID"],
            [{ reportPath: reportPath("done") }, "REPORT_EXISTS"],
        ];
        for (const [changed, code] of cases) {
            const reply = await dispatch({ ...task("t1"), ...changed });
            expect([reply.ok, reply.code]).toEqual([false, code]);
        }
        expect(herdr.calls).toEqual([]);
        expect(sender.calls).toEqual([]);
    });

    it("reserves a worker for one task at a time", async () => {
        await writeBrief("t1");
        await writeBrief("t2");
        await dispatch(task("t1"));
        const reply = await dispatch(task("t2"));
        expect(reply).toMatchObject({ ok: false, code: "WORKER_RESERVED" });
        expect(sender.calls).toHaveLength(1);
        expect((await dispatch(task("t2", claude))).ok).toBe(true);
    });

    it("lets one of two parallel claims on a worker win", async () => {
        await writeBrief("t1");
        await writeBrief("t2");
        const competingClaims = await Promise.all([
            dispatch(task("t1")),
            dispatch(task("t2")),
        ]);
        expect(competingClaims.filter((r) => r.ok)).toHaveLength(1);
        expect(competingClaims.map((r) => r.code).sort()).toEqual([
            "TASK_SENT",
            "WORKER_RESERVED",
        ]);
        expect(sender.calls).toHaveLength(1);
    });

    it("records a send the sender refused as failed, never resent", async () => {
        for (const [index, code] of [2, 3, 4, 5, 6].entries()) {
            const id = `r${index}`;
            await writeBrief(id);
            sender.queue({ code, stdout: "", stderr: "refused" });
            const reply = await dispatch(task(id));
            expect(reply).toMatchObject({ ok: false, code: "SEND_REFUSED" });
            expect(only(reply)).toMatchObject({
                state: "failed",
                code: `SEND_REFUSED_${code}`,
            });
        }
        expect(sender.calls).toHaveLength(5);
    });

    it("records an ambiguous send as unknown and never resends it", async () => {
        const outcomes = [
            { code: 1, stdout: "", stderr: "enter failed" },
            { code: 137, stdout: "", stderr: "" },
            new Error("spawn failed"),
        ] as const;
        for (const [index, outcome] of outcomes.entries()) {
            const id = `u${index}`;
            const worker = index === 1 ? claude : codex;
            if (index === 2) {
                withLedger((db) => db.move("u0", ["unknown"], "failed"));
            }
            await writeBrief(id);
            sender.queue(outcome);
            const reply = await dispatch(task(id, worker));
            expect(reply).toMatchObject({ ok: false, code: "SEND_UNCERTAIN" });
            const afterUncertainSend = only(reply);
            expect(afterUncertainSend.state).toBe("unknown");
            const again = await dispatch(task(id, worker));
            expect(only(again).state).toBe("unknown");
        }
        expect(sender.calls).toHaveLength(3);
    });

    it("bounds the send, and a timeout is unknown", async () => {
        await writeBrief("t1");
        sender.queue("hang");
        const reply = await steward(
            { kind: "dispatch", task: task("t1") },
            ME,
            { sendTimeoutMs: 30 },
        );
        expect(reply).toMatchObject({ ok: false, code: "SEND_UNCERTAIN" });
        expect(only(reply).state).toBe("unknown");
    });
});

describe("a helper killed mid-dispatch", () => {
    const here = import.meta.dir;
    const child = (root: string) => `
import { appendFileSync, readFileSync } from "node:fs";
import { runSteward } from ${JSON.stringify(join(here, "engine.ts"))};
import { fakeHerdr, fakeSender } from ${JSON.stringify(join(here, "fixtures.ts"))};
import { readFleet } from ${JSON.stringify(join(here, "registry.ts"))};
const config = JSON.parse(process.argv[2]);
const now = () => new Date(config.now);
const fleet = await readFleet(config.registry, now());
const herdr = fakeHerdr(fleet.workers, { steward: true });
const sender = fakeSender();
sender.onSend((call) => {
    if (config.die === "before") process.exit(70);
    appendFileSync(${JSON.stringify(join(root, "sends.log"))}, JSON.stringify(call) + "\\n");
    if (config.die === "after") process.exit(71);
});
if (config.parties) {
    const gate = ${JSON.stringify(join(root, "gate"))};
    appendFileSync(gate, "x");
    while (readFileSync(gate, "utf8").length < config.parties) await Bun.sleep(2);
}
const reply = await runSteward(
    { registry: config.registry, controller: config.controller, operation: config.operation },
    {
        env: config.env,
        now,
        run: herdr.run,
        sender: sender.run,
        controllerAlive: async () => true,
        self: { pid: process.pid, startedAt: "child" },
    },
);
console.log(JSON.stringify(reply));
`;

    const spawnChild = async (config: Record<string, unknown>) => {
        const script = join(reg.root, "child.ts");
        await writeFile(script, child(reg.root));
        return Bun.spawn(
            [
                process.execPath,
                script,
                JSON.stringify({
                    registry: reg.path,
                    controller: ME,
                    env,
                    now: NOW.toISOString(),
                    ...config,
                }),
            ],
            { stdout: "pipe", stderr: "pipe", env: { PATH: env.PATH } },
        );
    };

    const sends = async () =>
        (
            await Bun.file(join(reg.root, "sends.log"))
                .text()
                .catch(() => "")
        )
            .split("\n")
            .filter(Boolean);

    const deadHelpers = () => ({
        controllerAlive: async (pid: number, startedAt: string) => {
            if (startedAt === "child") return false;
            return alive.get(key({ pid, startedAt })) === true;
        },
    });

    for (const die of ["before", "after"] as const) {
        it(`leaves an uncertain intent when it dies ${die} the send`, async () => {
            await writeBrief("t1");
            const proc = await spawnChild({
                die,
                operation: { kind: "dispatch", task: task("t1") },
            });
            expect(await proc.exited).toBe(die === "before" ? 70 : 71);
            expect(await sends()).toHaveLength(die === "before" ? 0 : 1);
            const left = withLedger((db) => ({
                task: db.task("t1"),
                pending: db.pending(),
            }));
            expect(left.task?.state).toBe("intent");
            expect(left.pending).toHaveLength(1);

            // Its intent proves nothing; reconciliation makes it unknown.
            const reply = await steward(
                { kind: "reconcile" },
                ME,
                deadHelpers(),
            );
            expect(only(reply)).toMatchObject({
                state: "unknown",
                code: "SEND_ABANDONED",
            });
            const again = await steward(
                { kind: "dispatch", task: task("t1") },
                ME,
                deadHelpers(),
            );
            expect(only(again).state).toBe("unknown");
            expect(sender.calls).toEqual([]);
        });
    }

    it("leaves a live helper's intent alone", async () => {
        const busy = { pid: 3001, startedAt: "boot:other-helper" };
        withLedger((db) => db.reserve(task("t1"), "sha256:x", "term", busy));
        alive.set(key(busy), true);
        const reply = await steward({ kind: "reconcile", taskId: "t1" });
        expect(only(reply).state).toBe("intent");
        alive.set(key(busy), "uncertain");
        const uncertain = await steward({ kind: "reconcile", taskId: "t1" });
        expect(only(uncertain).state).toBe("intent");
    });

    it("lets one of two helper processes competing for a worker send", async () => {
        await writeBrief("t1");
        await writeBrief("t2");
        const procs = await Promise.all(
            ["t1", "t2"].map((id) =>
                spawnChild({
                    parties: 2,
                    operation: { kind: "dispatch", task: task(id) },
                }),
            ),
        );
        const replies = await Promise.all(
            procs.map(async (proc) => {
                const out = await new Response(proc.stdout).text();
                expect(await proc.exited).toBe(0);
                return JSON.parse(out) as StewardReply;
            }),
        );
        expect(replies.filter((r) => r.ok)).toHaveLength(1);
        expect(replies.map((r) => r.code).sort()).toEqual([
            "TASK_SENT",
            "WORKER_RESERVED",
        ]);
        expect(await sends()).toHaveLength(1);
    });
});

describe("the controller", () => {
    it("refuses a second live controller before observing", async () => {
        await steward({ kind: "list" });
        const calls = herdr.calls.length;
        const reply = await steward({ kind: "list" }, OTHER);
        expect(reply).toMatchObject({ ok: false, code: "CONTROLLER_LIVE" });
        expect(herdr.calls).toHaveLength(calls);
    });

    it("refuses takeover while the owner's liveness is uncertain", async () => {
        await steward({ kind: "list" });
        alive.set(key(ME), "uncertain");
        const reply = await steward({ kind: "list" }, OTHER);
        expect(reply).toMatchObject({
            ok: false,
            code: "CONTROLLER_UNCERTAIN",
        });
    });

    it("takes over from a gone owner, reconciling before new dispatch", async () => {
        await writeBrief("t1");
        await writeBrief("t2");
        await writeBrief("t3");
        await dispatch(task("t1"));
        // The former owner's helper died holding an intent for Claude.
        withLedger((db) =>
            db.reserve(task("t2", claude), sha256("x"), "term", HELPER),
        );
        alive.set(key(ME), false);
        alive.set(key(HELPER), false);
        setStatus(codex, "working");

        const reply = await dispatch(task("t3", claude), OTHER);
        expect(reply).toMatchObject({ ok: false, code: "WORKER_RESERVED" });
        const tasks = (await steward({ kind: "list" }, OTHER)).tasks ?? [];
        expect(tasks.map((t) => [t.taskId, t.state])).toEqual([
            ["t1", "running"],
            ["t2", "unknown"],
        ]);
        expect(sender.calls).toHaveLength(1);
        // The new owner holds the claim: the old one may not return.
        alive.set(key(OTHER), true);
        alive.set(key(ME), true);
        expect((await steward({ kind: "list" }, ME)).code).toBe(
            "CONTROLLER_LIVE",
        );
    });
});

describe("wait", () => {
    beforeEach(async () => {
        await writeBrief("t1");
        await dispatch(task("t1"));
    });

    it("sees work start, and keeps the reservation on timeout", async () => {
        setStatus(codex, "working");
        const reply = await steward({
            kind: "wait",
            taskId: "t1",
            timeoutMs: 30,
        });
        expect(reply).toMatchObject({ ok: true, code: "WAIT_TIMEOUT" });
        expect(only(reply).state).toBe("running");
        expect(reply.workers?.[0]?.state).toBe("working");
        await writeBrief("t2");
        expect((await dispatch(task("t2"))).code).toBe("WORKER_RESERVED");
    });

    it("does not take an idle worker for a finished task", async () => {
        setStatus(codex, "working");
        await steward({ kind: "wait", taskId: "t1", timeoutMs: 0 });
        setStatus(codex, "idle");
        const reply = await steward({
            kind: "wait",
            taskId: "t1",
            timeoutMs: 20,
        });
        const afterIdleWithoutReport = only(reply);
        expect(afterIdleWithoutReport.state).not.toBe("verified");
        expect(afterIdleWithoutReport.state).toBe("running");
    });

    it("records a matching report as reported, with its digest", async () => {
        const text = report("t1");
        await writeReport("t1", text);
        const reply = await steward({
            kind: "wait",
            taskId: "t1",
            timeoutMs: 1000,
        });
        expect(reply).toMatchObject({ ok: true, code: "TASK_REPORTED" });
        expect(only(reply)).toMatchObject({
            state: "reported",
            reportDigest: sha256(text),
            revision: NEXT,
        });
    });

    it("ignores a report naming another task", async () => {
        await writeReport("t1", report("t1", { task: "t9" }));
        const reply = await steward({
            kind: "wait",
            taskId: "t1",
            timeoutMs: 0,
        });
        expect(only(reply)).toMatchObject({
            state: "sent",
            code: "REPORT_MISMATCH",
        });
    });

    it("returns when the worker blocks on a dialog", async () => {
        setStatus(codex, "blocked");
        const reply = await steward({
            kind: "wait",
            taskId: "t1",
            timeoutMs: 5000,
        });
        expect(reply).toMatchObject({ ok: true, code: "WORKER_BLOCKED" });
    });

    it("bounds the wait to 0..60000 ms", async () => {
        for (const timeoutMs of [-1, 60001, 1.5, Number.NaN]) {
            const reply = await steward({
                kind: "wait",
                taskId: "t1",
                timeoutMs,
            });
            expect(reply).toMatchObject({ ok: false, code: "WAIT_INVALID" });
        }
        const missing = await steward({
            kind: "wait",
            taskId: "t9",
            timeoutMs: 0,
        });
        expect(missing).toMatchObject({ ok: false, code: "TASK_MISSING" });
    });
});

describe("cancel", () => {
    const interrupts = () =>
        herdr.calls.filter((call) => call.args[1] === "send-keys");

    beforeEach(async () => {
        await writeBrief("t1");
        await dispatch(task("t1"));
        setStatus(codex, "working");
    });

    it("sends one interrupt to a still-matching worker", async () => {
        const reply = await steward({ kind: "cancel", taskId: "t1" });
        expect(reply).toMatchObject({ ok: true, code: "CANCEL_REQUESTED" });
        expect(only(reply).state).toBe("cancel-requested");
        expect(interrupts().map((c) => c.args)).toEqual([
            ["pane", "send-keys", codex.pane, "esc"],
        ]);
        const again = await steward({ kind: "cancel", taskId: "t1" });
        expect(only(again).state).toBe("cancel-requested");
        expect(interrupts()).toHaveLength(1);
    });

    it("sends one interrupt for two racing cancels", async () => {
        const replies = await Promise.all([
            steward({ kind: "cancel", taskId: "t1" }),
            steward({ kind: "cancel", taskId: "t1" }),
        ]);
        expect(replies.map((r) => only(r).state)).toEqual([
            "cancel-requested",
            "cancel-requested",
        ]);
        expect(interrupts()).toHaveLength(1);
    });

    it("refuses a replaced occupant, sending nothing", async () => {
        herdr.agents.set(codex.name, {
            ...herdrAgentOf(codex, "working"),
            terminal_id: "term_new",
        });
        const reply = await steward({ kind: "cancel", taskId: "t1" });
        expect(reply).toMatchObject({ ok: false, code: "WORKER_REPLACED" });
        expect(only(reply).state).toBe("sent");
        expect(interrupts()).toEqual([]);
    });

    it("permits cancelled only on a matching acknowledgement", async () => {
        await steward({ kind: "cancel", taskId: "t1" });
        setStatus(codex, "idle");
        const idle = await steward({
            kind: "wait",
            taskId: "t1",
            timeoutMs: 0,
        });
        expect(only(idle).state).toBe("cancel-requested");
        await writeReport(
            "t1",
            report("t1", { task: "t2", status: "cancelled" }),
        );
        const other = await steward({ kind: "reconcile", taskId: "t1" });
        expect(only(other).state).toBe("cancel-requested");
        await writeReport("t1", report("t1", { status: "cancelled" }));
        const acked = await steward({ kind: "reconcile", taskId: "t1" });
        expect(only(acked).state).toBe("cancelled");
        await writeBrief("t2");
        expect((await dispatch(task("t2"))).ok).toBe(true);
    });

    it("takes a finished report after a cancel as reported", async () => {
        await steward({ kind: "cancel", taskId: "t1" });
        await writeReport("t1");
        const reply = await steward({ kind: "reconcile", taskId: "t1" });
        expect(only(reply).state).toBe("reported");
    });

    it("keeps the request when the interrupt's outcome is uncertain", async () => {
        herdr.queue(agentInfoReply(herdrAgentOf(codex, "working")));
        herdr.queue(new Error("socket gone"));
        const reply = await steward({ kind: "cancel", taskId: "t1" });
        expect(reply).toMatchObject({ ok: false, code: "CANCEL_UNCERTAIN" });
        expect(only(reply).state).toBe("cancel-requested");
    });

    it("refuses an intent in flight and a finished task", async () => {
        withLedger((db) =>
            db.reserve(task("t2", claude), sha256("x"), "term", HELPER),
        );
        alive.set(key(HELPER), true);
        const inFlight = await steward({ kind: "cancel", taskId: "t2" });
        expect(inFlight).toMatchObject({ ok: false, code: "TASK_IN_FLIGHT" });
        withLedger((db) => db.move("t1", ["sent"], "failed"));
        const done = await steward({ kind: "cancel", taskId: "t1" });
        expect(done).toMatchObject({ ok: false, code: "TASK_FINISHED" });
        expect(interrupts()).toEqual([]);
    });
});

describe("finish", () => {
    const evidence = (
        fields: Partial<CompletionEvidence> = {},
    ): CompletionEvidence => ({
        reportDigest: sha256(report("t1")),
        revision: NEXT,
        verification: {
            command: ["bun", "test"],
            exitCode: 0,
            logPath: join(reg.fixtureRoot, "t1.log"),
        },
        ...fields,
    });

    const receipt = (fields: Partial<Receipt> = {}) =>
        withLedger((db) =>
            db.recordReceipt({
                taskId: "t1",
                revision: NEXT,
                reportDigest: sha256(report("t1")),
                command: ["bun", "test"],
                exitCode: 0,
                logPath: join(reg.fixtureRoot, "t1.log"),
                ...fields,
            }),
        );

    const finish = (ev = evidence()) =>
        steward({ kind: "finish", taskId: "t1", evidence: ev });

    beforeEach(async () => {
        await writeBrief("t1");
        await dispatch(task("t1"));
        await writeReport("t1");
        await steward({ kind: "reconcile", taskId: "t1" });
    });

    it("keeps a forged success report reported without a receipt", async () => {
        const reply = await finish();
        expect(reply).toMatchObject({ ok: false, code: "RECEIPT_MISSING" });
        expect(only(reply).state).toBe("reported");
    });

    it("refuses a receipt for another task, revision or digest", async () => {
        await writeBrief("t2");
        await dispatch(task("t2", claude));
        withLedger((db) =>
            db.recordReceipt({
                taskId: "t2",
                revision: NEXT,
                reportDigest: sha256(report("t1")),
                command: ["bun", "test"],
                exitCode: 0,
                logPath: join(reg.fixtureRoot, "t1.log"),
            }),
        );
        receipt({ revision: OID });
        receipt({ reportDigest: sha256("other") });
        receipt({ exitCode: 1, command: ["bun", "test", "--x"] });
        const reply = await finish();
        expect(reply).toMatchObject({ ok: false, code: "RECEIPT_MISSING" });
        expect(only(reply).state).toBe("reported");
    });

    it("refuses evidence for a stale revision or another report", async () => {
        receipt({ revision: OID });
        const stale = await finish(evidence({ revision: OID }));
        expect(stale).toMatchObject({ ok: false, code: "REVISION_STALE" });
        const digest = await finish(evidence({ reportDigest: sha256("x") }));
        expect(digest).toMatchObject({
            ok: false,
            code: "REPORT_DIGEST_MISMATCH",
        });
        expect(only(digest).state).toBe("reported");
    });

    it("refuses once the report changed after its receipt", async () => {
        receipt();
        await writeReport("t1", report("t1", { revision: OID }));
        const reply = await finish();
        expect(reply).toMatchObject({ ok: false, code: "REPORT_CHANGED" });
        expect(only(reply)).toMatchObject({ state: "reported", revision: OID });
    });

    it("verifies a matching runner receipt, releasing the worker", async () => {
        receipt();
        const reply = await finish();
        expect(reply).toMatchObject({ ok: true, code: "TASK_VERIFIED" });
        expect(only(reply).state).toBe("verified");
        await writeBrief("t2");
        expect((await dispatch(task("t2"))).ok).toBe(true);
    });

    it("fails a task whose receipt records a failed verification", async () => {
        receipt({ exitCode: 1 });
        const reply = await finish(
            evidence({
                verification: {
                    command: ["bun", "test"],
                    exitCode: 1,
                    logPath: join(reg.fixtureRoot, "t1.log"),
                },
            }),
        );
        expect(reply).toMatchObject({ ok: true, code: "TASK_FAILED" });
        expect(only(reply).state).toBe("failed");
    });

    it("refuses a task that has not reported", async () => {
        await writeBrief("t2");
        await dispatch(task("t2", claude));
        const reply = await steward({
            kind: "finish",
            taskId: "t2",
            evidence: evidence(),
        });
        expect(reply).toMatchObject({ ok: false, code: "TASK_NOT_REPORTED" });
    });
});

describe("read", () => {
    const read = (lines: number, worker: Worker = codex) =>
        steward({ kind: "read", workerId: worker.id, lines });

    it("reads at most the asked lines of a matching worker", async () => {
        herdr.screens.set(
            codex.name,
            `${Array.from({ length: 300 }, (_, i) => `line ${i}`).join("\n")}\n`,
        );
        const reply = await read(3);
        expect(reply).toMatchObject({ ok: true, code: "OK" });
        expect(reply.text).toBe("line 297\nline 298\nline 299");
        expect(herdrCalls("read").map((c) => c.args)).toEqual([
            ["agent", "read", codex.name, "--lines", "3", "--format", "text"],
        ]);
    });

    it("caps a read at 200 lines", async () => {
        expect(MAX_READ_LINES).toBe(200);
        herdr.screens.set(
            codex.name,
            Array.from({ length: 300 }, (_, i) => `l${i}`).join("\n"),
        );
        const reply = await read(200);
        expect(reply.text?.split("\n")).toHaveLength(200);
        for (const lines of [0, 201, 1.5, -1]) {
            const refused = await read(lines);
            expect(refused).toMatchObject({ ok: false, code: "READ_INVALID" });
        }
        expect(herdrCalls("read")).toHaveLength(1);
    });

    it("refuses output over 32 KiB", async () => {
        herdr.screens.set(codex.name, "x".repeat(MAX_OUTPUT_BYTES + 1));
        const reply = await read(1);
        expect(reply).toMatchObject({ ok: false, code: "READ_TOO_LARGE" });
        expect(reply.text).toBeUndefined();
    });

    it("reads nothing of a worker that does not match", async () => {
        herdr.agents.set(codex.name, {
            ...herdrAgentOf(codex),
            agent: "claude",
        });
        const reply = await read(10);
        expect(reply).toMatchObject({
            ok: false,
            code: "HERDR_HARNESS_MISMATCH",
        });
        expect(herdrCalls("read")).toEqual([]);
        const unknown = await steward({
            kind: "read",
            workerId: "nobody",
            lines: 1,
        });
        expect(unknown).toMatchObject({ ok: false, code: "WORKER_UNKNOWN" });
    });
});

describe("process identity", () => {
    it("tells a live process from a gone one by its start", async () => {
        const proc = Bun.spawn(["sleep", "30"]);
        const startedAt = await processStart(proc.pid);
        expect(startedAt).toMatch(/^[0-9a-f-]+:\d+$/);
        expect(await processAlive(proc.pid, startedAt)).toBe(true);
        expect(await processAlive(proc.pid, `${startedAt}0`)).toBe(false);
        proc.kill("SIGKILL");
        await proc.exited;
        expect(await processAlive(proc.pid, startedAt)).toBe(false);
    });
});
