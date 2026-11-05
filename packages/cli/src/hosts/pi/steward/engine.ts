// vim:set expandtab shiftwidth=4 filetype=typescript:
// SPDX-License-Identifier: GPL-3.0-only

//
//
// ~chewygumxx/dorothy.git
// ::: :/packages/cli/src/hosts/pi/steward/engine.ts
//
//

// Stewardship's operations over the registry, herdr and the ledger: list,
// read, dispatch, wait, cancel, reconcile and finish, each one request and
// one reply. Intent is persisted before any send, an uncertain send is never
// retried, the worker is observed again immediately before every send and
// refused if its terminal is not the one pinned, and only the runner's
// receipt verifies a task. Worker text is evidence, never authority.

import { createHash } from "node:crypto";
import { lstat, open, readFile } from "node:fs/promises";
import { join } from "node:path";
import type { Env } from "@dorothy/core";
import {
    createHerdrRun,
    type HerdrRun,
    MAX_OUTPUT_BYTES,
    MAX_READ_LINES,
    observeWorker,
    timed,
} from "./herdr.js";
import {
    type Identity,
    type Ledger,
    ledgerPath,
    openLedger,
    type StoredTask,
} from "./ledger.js";
import {
    type FrozenFleet,
    fixturePath,
    identityOf,
    isTaskId,
    readFleet,
} from "./registry.js";
import {
    type CompletionEvidence,
    type Fleet,
    type Occupant,
    StewardError,
    type StewardReply,
    type StewardRequest,
    type TaskBrief,
    type TaskRecord,
    type TaskState,
    type Worker,
    type WorkerObservation,
} from "./types.js";

// The label a dispatch carries: `[from dorothy] Read <brief> for task <id>.`
export const COORDINATOR = "dorothy";
// The repository's labelled sender, under its pane lock.
export const SENDER = join(
    import.meta.dir,
    "..",
    "..",
    "..",
    "..",
    "..",
    "..",
    ".agents",
    "skills",
    "agent-stewardship",
    "scripts",
    "send-prompt.sh",
);
// The skill's interrupt: one Escape, under the same pane lock.
export const INTERRUPTER = join(SENDER, "..", "send-interrupt.sh");
export const SEND_TIMEOUT_MS = 15_000;
// The interrupt waits this long for the pane's lock, within its timeout.
export const LOCK_WAIT_S = 5;
export const INTERRUPT_TIMEOUT_MS = 15_000;
export const READ_TIMEOUT_MS = 5000;
export const MAX_WAIT_MS = 60_000;
export const POLL_MS = 500;
// A brief or report is read whole, at most this much.
export const MAX_FILE_BYTES = 64 * 1024;

// The sender's refusals before it writes anything: usage, blocked, absent,
// another pane, not ready. Any other exit may have written.
const REFUSALS = [2, 3, 4, 5, 6, 9, 10];
// The interrupt's: usage, blocked, absent, another pane, the lock not had
// in time, another terminal. Any other exit may have sent the Escape.
const UNSENT = [2, 3, 4, 5, 7, 8, 9, 10];
const OID = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/;
const DIGEST = /^sha256:[0-9a-f]{64}$/;
// biome-ignore lint/suspicious/noControlCharactersInRegex: refusing them
const CONTROL = /[\u0000-\u001f\u007f]/;
const FINAL: readonly TaskState[] = ["verified", "cancelled", "failed"];

export type StewardDeps = {
    env: Env;
    now: () => Date;
    run: HerdrRun;
    // True alive, false proven gone, a rejection uncertain: for the
    // controller and for any helper that left an operation pending.
    controllerAlive: (pid: number, startedAt: string) => Promise<boolean>;
    // `send-prompt.sh` by default; tests pass a fake.
    sender?: HerdrRun;
    // This helper's identity; by default its pid and /proc start.
    self?: Identity;
    // `send-interrupt.sh` by default; tests pass a fake.
    interrupter?: HerdrRun;
    sendTimeoutMs?: number;
    interruptTimeoutMs?: number;
    pollMs?: number;
    // Linux process-start identity for a sessionless native occupant.
    occupantStart?: (pid: number) => Promise<string>;
};

type Context = {
    fleet: FrozenFleet;
    ledger: Ledger;
    deps: StewardDeps;
    // Null preserves ordinary --pi's independent per-operation bounds.
    deadlineAt: number | null;
    self: () => Promise<Identity>;
    observe: (worker: Worker) => Promise<WorkerObservation>;
};

function remaining(ctx: Context): number | null {
    return ctx.deadlineAt === null
        ? null
        : ctx.deadlineAt - ctx.deps.now().getTime();
}

function requireTime(ctx: Context): void {
    if ((remaining(ctx) ?? 1) <= 0) refuse("STEWARD_DEADLINE");
}

function boundedMs(ctx: Context, timeoutMs: number): number {
    requireTime(ctx);
    return Math.min(timeoutMs, remaining(ctx) ?? timeoutMs);
}

const refuse = (code: string, detail = code): never => {
    throw new StewardError(code, detail);
};

const record = ({
    terminalId: _,
    occupant: __,
    ...task
}: StoredTask): TaskRecord => task;

const reply = (
    ok: boolean,
    code: string,
    tasks?: (StoredTask | null)[],
    workers?: WorkerObservation[],
): StewardReply => ({
    ok,
    code,
    ...(tasks
        ? { tasks: tasks.filter((t): t is StoredTask => !!t).map(record) }
        : {}),
    ...(workers ? { workers } : {}),
});

// Linux's start of a process, `<boot id>:<start ticks>`, so a reused pid
// or a reboot gives another identity. Other platforms fail explicitly.
export async function processStart(pid: number): Promise<string> {
    if (process.platform !== "linux") {
        refuse("STEWARD_PLATFORM", process.platform);
    }
    const boot = (
        await readFile("/proc/sys/kernel/random/boot_id", "utf8")
    ).trim();
    const stat = await readFile(`/proc/${pid}/stat`, "utf8").catch(() =>
        refuse("PROCESS_MISSING", String(pid)),
    );
    // The command may hold spaces and parentheses: fields follow the last.
    const fields = stat.slice(stat.lastIndexOf(")") + 2).split(" ");
    const [state, ticks] = [fields[0], fields[19]];
    if (!ticks || !/^\d+$/.test(ticks) || state === "Z" || state === "X") {
        refuse("PROCESS_MISSING", String(pid));
    }
    return `${boot}:${ticks}`;
}

// The production `controllerAlive`: true while the process with that start
// lives, false once it is gone or the pid is another's; other failures
// reject, which callers take as uncertain.
export async function processAlive(
    pid: number,
    startedAt: string,
): Promise<boolean> {
    if (process.platform !== "linux") {
        refuse("STEWARD_PLATFORM", process.platform);
    }
    if (!Number.isSafeInteger(pid) || pid <= 0) {
        return false;
    }
    try {
        return (await processStart(pid)) === startedAt;
    } catch (error) {
        if (error instanceof StewardError && error.code === "PROCESS_MISSING") {
            return false;
        }
        throw error;
    }
}

const sha256 = (data: Uint8Array) =>
    `sha256:${createHash("sha256").update(data).digest("hex")}`;

// A file read whole, refused over the bound.
async function bounded(path: string, tooLarge: string): Promise<Buffer> {
    const handle = await open(path, "r");
    try {
        const buffer = Buffer.alloc(MAX_FILE_BYTES + 1);
        const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
        if (bytesRead > MAX_FILE_BYTES) {
            refuse(tooLarge);
        }
        return buffer.subarray(0, bytesRead);
    } finally {
        await handle.close();
    }
}

async function briefDigest(fleet: Fleet, path: string): Promise<string> {
    const at = await fixturePath(fleet, path, "brief");
    return sha256(await bounded(at, "BRIEF_TOO_LARGE"));
}

type Report =
    | { kind: "none" }
    | { kind: "mismatch" }
    | { kind: "invalid"; code: string }
    | {
          kind: "match";
          digest: string;
          status: string;
          revision: string | null;
      };

// The report at the task's path, if any: it matches only when it names the
// task (`Task: <id>`). Its status and revision are the worker's claims.
async function readReport(fleet: Fleet, task: TaskBrief): Promise<Report> {
    let path: string;
    try {
        path = await fixturePath(fleet, task.reportPath, "report");
    } catch (error) {
        return {
            kind: "invalid",
            code: error instanceof StewardError ? error.code : "REPORT_INVALID",
        };
    }
    if (!(await lstat(path).catch(() => null))) {
        return { kind: "none" };
    }
    let data: Buffer;
    try {
        data = await bounded(path, "REPORT_TOO_LARGE");
    } catch (error) {
        return {
            kind: "invalid",
            code: error instanceof StewardError ? error.code : "REPORT_INVALID",
        };
    }
    const text = data.toString("utf8");
    const field = (name: string) =>
        new RegExp(`^${name}:[ \\t]*(\\S+)[ \\t]*$`, "im").exec(text)?.[1] ??
        null;
    if (field("Task") !== task.taskId) {
        return { kind: "mismatch" };
    }
    const revision = field("Revision");
    return {
        kind: "match",
        digest: sha256(data),
        status: (field("Status") ?? "").toLowerCase(),
        revision: revision && OID.test(revision) ? revision : null,
    };
}

const workerOf = (fleet: Fleet, id: unknown): Worker =>
    fleet.workers.find((worker) => worker.id === id) ??
    refuse("WORKER_UNKNOWN", String(id).slice(0, 64));

function checkPath(value: unknown, what: string): string {
    if (typeof value !== "string" || CONTROL.test(value)) {
        refuse("PATH_INVALID", what);
    }
    return value as string;
}

// The brief's fields, checked in order, before anything is observed.
function checkBrief(fleet: Fleet, task: unknown): TaskBrief {
    const raw = (task ?? {}) as Record<string, unknown>;
    if (!isTaskId(raw.taskId)) {
        refuse("TASK_ID_INVALID");
    }
    workerOf(fleet, raw.workerId);
    if (typeof raw.baseOid !== "string" || !OID.test(raw.baseOid)) {
        refuse("BASE_OID_INVALID");
    }
    return {
        taskId: raw.taskId as string,
        workerId: raw.workerId as string,
        briefPath: checkPath(raw.briefPath, "brief"),
        reportPath: checkPath(raw.reportPath, "report"),
        baseOid: raw.baseOid as string,
    };
}

function checkRequest(request: StewardRequest): void {
    const controller = request?.controller;
    if (
        typeof request?.registry !== "string" ||
        !Number.isSafeInteger(controller?.pid) ||
        controller.pid <= 0 ||
        typeof controller.startedAt !== "string" ||
        controller.startedAt.length < 1 ||
        controller.startedAt.length > 128 ||
        CONTROL.test(controller.startedAt) ||
        typeof request.operation?.kind !== "string"
    ) {
        refuse("REQUEST_INVALID");
    }
    const pinned = [
        request.registryDigest,
        request.fleetId,
        request.fixtureRoot,
    ];
    if (
        pinned.some((value) => value !== undefined) &&
        pinned.some((value) => typeof value !== "string" || value.length === 0)
    ) {
        refuse("REQUEST_INVALID");
    }
    if (
        request.deadlineAt !== undefined &&
        (typeof request.deadlineAt !== "string" ||
            !Number.isFinite(Date.parse(request.deadlineAt)))
    ) {
        refuse("REQUEST_INVALID");
    }
}

// Why the observed occupant may not be acted on, or null: the terminal
// must be the pinned resource and the session or process-start identity
// must be the pinned occupant. Migrated rows without one fail closed.
function identityRefusal(
    seen: WorkerObservation,
    pinned: { terminalId: string | null; occupant: Occupant | null },
): string | null {
    if (!seen.matches) {
        return seen.code ?? "WORKER_MISMATCH";
    }
    if (!pinned.occupant || !seen.occupant) return "WORKER_UNIDENTIFIED";
    if (
        !seen.terminalId ||
        seen.terminalId !== pinned.terminalId ||
        JSON.stringify(seen.occupant) !== JSON.stringify(pinned.occupant)
    ) {
        return "WORKER_REPLACED";
    }
    return null;
}

const sameOccupant = (seen: WorkerObservation) => ({
    terminalId: seen.terminalId,
    occupant: seen.occupant,
});

// The shell sender/interrupter repeats this comparison under the pane
// lock. A process pin names only herdr's observed foreground group, never
// an arbitrary pid supplied by a model.
export function occupantArgs(occupant: Occupant): string[] {
    return occupant.kind === "session"
        ? ["--expect-session", occupant.value]
        : ["--expect-process", String(occupant.pid), occupant.startedAt];
}

// Abandoned operations: a pending one whose helper is proven gone. An
// abandoned dispatch makes its intent unknown, as the send may or may not
// have started; a live or uncertain helper's is left alone.
async function settleAbandoned(ctx: Context, taskId?: string): Promise<void> {
    for (const op of ctx.ledger.pending()) {
        if (taskId !== undefined && op.taskId !== taskId) {
            continue;
        }
        let living: boolean;
        try {
            living = await ctx.deps.controllerAlive(op.pid, op.startedAt);
        } catch {
            continue;
        }
        if (living) {
            continue;
        }
        if (op.kind === "dispatch") {
            ctx.ledger.conclude(op.id, "uncertain", "SEND_ABANDONED", {
                from: ["intent"],
                to: "unknown",
                fields: { code: "SEND_ABANDONED" },
            });
        } else {
            ctx.ledger.conclude(op.id, "uncertain", "CANCEL_ABANDONED");
        }
    }
}

// One look at a task: its report, then its worker. A matching report makes
// it reported (cancelled, where a cancel was asked and the report says so);
// a worker seen working after the send makes it running. Idle is never
// completion.
async function reconcileTask(
    ctx: Context,
    taskId: string,
): Promise<{ task: StoredTask; seen?: WorkerObservation }> {
    await settleAbandoned(ctx, taskId);
    const task = ctx.ledger.task(taskId) as StoredTask;
    if (task.state === "intent" || FINAL.includes(task.state)) {
        return { task };
    }
    const found = await readReport(ctx.fleet, task);
    const current = () => ctx.ledger.task(taskId) as StoredTask;
    if (found.kind === "match") {
        const fields = {
            reportDigest: found.digest,
            revision: found.revision,
            code: null,
        };
        if (task.state === "reported") {
            if (found.digest !== task.reportDigest) {
                ctx.ledger.move(taskId, ["reported"], "reported", fields);
            }
        } else if (
            task.state === "cancel-requested" &&
            found.status === "cancelled"
        ) {
            ctx.ledger.move(taskId, ["cancel-requested"], "cancelled", fields);
        } else {
            ctx.ledger.move(taskId, [task.state], "reported", fields);
        }
        return { task: current() };
    }
    if (found.kind !== "none") {
        const code = found.kind === "mismatch" ? "REPORT_MISMATCH" : found.code;
        ctx.ledger.move(taskId, [task.state], task.state, { code });
    }
    if (task.state === "reported") {
        return { task: current() };
    }
    const worker = ctx.fleet.workers.find((w) => w.id === task.workerId);
    if (!worker) {
        return { task: current() };
    }
    const seen = await ctx.observe(worker);
    const refusal = identityRefusal(seen, task);
    if (refusal === "WORKER_REPLACED") {
        ctx.ledger.move(taskId, [task.state], task.state, { code: refusal });
    } else if (!refusal && seen.state === "working" && task.state === "sent") {
        ctx.ledger.move(taskId, ["sent"], "running");
    }
    return { task: current(), seen };
}

async function reconcileAll(ctx: Context): Promise<WorkerObservation[]> {
    await settleAbandoned(ctx);
    const seen: WorkerObservation[] = [];
    for (const task of ctx.ledger.tasks()) {
        if (!FINAL.includes(task.state)) {
            const looked = await reconcileTask(ctx, task.taskId);
            if (looked.seen) {
                seen.push(looked.seen);
            }
        }
    }
    return seen;
}

const sameBrief = (a: TaskBrief, b: TaskBrief) =>
    a.taskId === b.taskId &&
    a.workerId === b.workerId &&
    a.briefPath === b.briefPath &&
    a.reportPath === b.reportPath &&
    a.baseOid === b.baseOid;

// A repeated id: identical arguments and brief give the old state back;
// any change is refused, and the attempt kept.
async function repeat(
    ctx: Context,
    existing: StoredTask,
    brief: TaskBrief,
): Promise<StewardReply> {
    if (!sameBrief(existing, brief)) {
        return reply(false, "TASK_CONFLICT", [existing]);
    }
    if (
        (await briefDigest(ctx.fleet, brief.briefPath)) !== existing.briefDigest
    ) {
        return reply(false, "BRIEF_CHANGED", [existing]);
    }
    return reply(true, "TASK_EXISTS", [existing]);
}

type SendOutcome = "sent" | `refused:${number}` | "uncertain" | "deadline";

// Herdr's done is an unseen completed turn, ready for another prompt. It
// says nothing about the task's report or verification.
const dispatchReady = (state: WorkerObservation["state"]) =>
    state === "idle" || state === "done";

async function send(
    ctx: Context,
    worker: Worker,
    brief: TaskBrief,
    occupant: Occupant,
): Promise<SendOutcome> {
    const sender = ctx.deps.sender ?? createHerdrRun({ bin: SENDER });
    const args = [
        "--from",
        COORDINATOR,
        "--expect-pane",
        worker.pane,
        "--require-ready",
        ...occupantArgs(occupant),
        ...(ctx.deadlineAt === null
            ? []
            : ["--deadline-at", String(ctx.deadlineAt)]),
        worker.name,
    ];
    const message = `Read ${brief.briefPath} for task ${brief.taskId}.`;
    try {
        const timeoutMs = boundedMs(
            ctx,
            ctx.deps.sendTimeoutMs ?? SEND_TIMEOUT_MS,
        );
        // Recheck the frozen bytes immediately before the external mutation.
        await readFleet(
            ctx.fleet.sourcePath,
            ctx.deps.now(),
            identityOf(ctx.fleet),
        );
        const { code } = await timed(
            sender,
            args,
            ctx.deps.env,
            timeoutMs,
            message,
        );
        if (code === 0) {
            return "sent";
        }
        return REFUSALS.includes(code) ? `refused:${code}` : "uncertain";
    } catch (error) {
        if (error instanceof StewardError) {
            if (error.code === "REGISTRY_CHANGED") throw error;
            if (error.code === "STEWARD_DEADLINE") return "deadline";
        }
        return "uncertain";
    }
}

async function dispatch(ctx: Context, task: unknown): Promise<StewardReply> {
    requireTime(ctx);
    const { fleet, ledger } = ctx;
    const asked = checkBrief(fleet, task);
    const worker = workerOf(fleet, asked.workerId);
    const brief = {
        ...asked,
        briefPath: await fixturePath(fleet, asked.briefPath, "brief"),
        reportPath: await fixturePath(fleet, asked.reportPath, "report"),
    };
    await settleAbandoned(ctx);
    // The registry is frozen before the reservation, not merely at launch.
    await readFleet(ctx.fleet.sourcePath, ctx.deps.now(), identityOf(fleet));
    const existing = ledger.task(brief.taskId);
    if (existing) {
        return repeat(ctx, existing, brief);
    }
    if (worker.availability !== "available") {
        refuse("WORKER_UNAVAILABLE", worker.availability);
    }
    // The reservation is the ledger's index; this only spares a look.
    if (
        ledger
            .tasks()
            .some((t) => t.workerId === worker.id && !FINAL.includes(t.state))
    ) {
        refuse("WORKER_RESERVED", worker.id);
    }
    if (await lstat(brief.reportPath).catch(() => null)) {
        refuse("REPORT_EXISTS");
    }
    const digest = await briefDigest(fleet, brief.briefPath);
    const helper = await ctx.self();

    const seen = await ctx.observe(worker);
    if (!seen.matches) {
        refuse(seen.code ?? "WORKER_MISMATCH");
    }
    if (!dispatchReady(seen.state)) {
        refuse("WORKER_NOT_IDLE", seen.state);
    }
    if (!seen.terminalId || !seen.occupant) {
        refuse("WORKER_UNIDENTIFIED");
    }
    let op: ReturnType<Ledger["reserve"]>;
    requireTime(ctx);
    try {
        op = ledger.reserve(
            brief,
            digest,
            seen.terminalId as string,
            helper,
            seen.occupant,
        );
    } catch (error) {
        const raced = ledger.task(brief.taskId);
        if (
            error instanceof StewardError &&
            error.code === "TASK_EXISTS" &&
            raced
        ) {
            return repeat(ctx, raced, brief);
        }
        throw error;
    }

    // Immediately before the send: the occupant as pinned, ready, then the
    // brief as recorded. A refusal here is known unsent: the task fails,
    // its id spent.
    const fail = (code: string) => {
        ledger.conclude(op.id, "done", code, {
            from: ["intent"],
            to: "failed",
            fields: { code },
        });
        return reply(
            false,
            code.startsWith("SEND_REFUSED") ? "SEND_REFUSED" : code,
            [ledger.task(brief.taskId)],
        );
    };
    const again = await ctx.observe(worker);
    const refusal =
        identityRefusal(again, sameOccupant(seen)) ??
        (dispatchReady(again.state) ? null : "WORKER_NOT_IDLE");
    if (refusal) {
        return fail(refusal);
    }
    let now: string;
    try {
        now = await briefDigest(fleet, brief.briefPath);
    } catch (error) {
        return fail(
            error instanceof StewardError ? error.code : "BRIEF_CHANGED",
        );
    }
    if (now !== digest) {
        return fail("BRIEF_CHANGED");
    }

    const outcome = await send(ctx, worker, brief, seen.occupant as Occupant);
    if (outcome === "deadline") return fail("STEWARD_DEADLINE");
    if (outcome === "sent") {
        ledger.conclude(op.id, "done", null, { from: ["intent"], to: "sent" });
        return reply(true, "TASK_SENT", [ledger.task(brief.taskId)], [again]);
    }
    if (outcome === "uncertain") {
        ledger.conclude(op.id, "uncertain", "SEND_UNCERTAIN", {
            from: ["intent"],
            to: "unknown",
            fields: { code: "SEND_UNCERTAIN" },
        });
        return reply(false, "SEND_UNCERTAIN", [ledger.task(brief.taskId)]);
    }
    return fail(`SEND_REFUSED_${outcome.slice("refused:".length)}`);
}

const taskOf = (ctx: Context, taskId: unknown): StoredTask =>
    (isTaskId(taskId) ? ctx.ledger.task(taskId) : null) ??
    refuse("TASK_MISSING");

const SETTLED: Partial<Record<TaskState, string>> = {
    reported: "TASK_REPORTED",
    verified: "TASK_VERIFIED",
    cancelled: "TASK_CANCELLED",
    failed: "TASK_FAILED",
};

// Waits at most `timeoutMs` for the task to report, settle or need a
// person, looking every `pollMs`. A timeout or a killed wait changes
// nothing: the worker stays reserved and its state is what was observed.
async function wait(
    ctx: Context,
    taskId: unknown,
    timeoutMs: unknown,
): Promise<StewardReply> {
    if (
        typeof timeoutMs !== "number" ||
        !Number.isInteger(timeoutMs) ||
        timeoutMs < 0 ||
        timeoutMs > MAX_WAIT_MS
    ) {
        refuse("WAIT_INVALID");
    }
    const id = taskOf(ctx, taskId).taskId;
    const started = performance.now();
    for (;;) {
        const { task, seen } = await reconcileTask(ctx, id);
        const workers = seen ? [seen] : [];
        const settled = SETTLED[task.state];
        if (settled) {
            return reply(true, settled, [task], workers);
        }
        if (seen && !seen.matches) {
            return reply(true, seen.code ?? "WORKER_MISMATCH", [task], workers);
        }
        if (seen?.state === "blocked") {
            return reply(true, "WORKER_BLOCKED", [task], workers);
        }
        requireTime(ctx);
        const requestedLeft =
            (timeoutMs as number) - (performance.now() - started);
        const left = Math.min(requestedLeft, remaining(ctx) ?? requestedLeft);
        if (left <= 0) {
            return reply(true, "WAIT_TIMEOUT", [task], workers);
        }
        await Bun.sleep(Math.min(ctx.deps.pollMs ?? POLL_MS, left));
    }
}

// Records the request, then sends one interrupt (Escape) to the worker
// still holding the pinned terminal, through `send-interrupt.sh`, which
// takes the pane's lock (5 s at most) and rereads pane, terminal and
// status under it. A refusal before the Escape withdraws the request;
// any other failure keeps it, uncertain. Only a report saying so cancels.
async function cancel(ctx: Context, taskId: unknown): Promise<StewardReply> {
    requireTime(ctx);
    const { ledger } = ctx;
    const id = taskOf(ctx, taskId).taskId;
    await settleAbandoned(ctx, id);
    const task = ledger.task(id) as StoredTask;
    if (task.state === "intent") {
        return reply(false, "TASK_IN_FLIGHT", [task]);
    }
    if (FINAL.includes(task.state)) {
        return reply(false, "TASK_FINISHED", [task]);
    }
    if (task.state === "reported") {
        return reply(false, "TASK_REPORTED", [task]);
    }
    if (task.state === "cancel-requested") {
        return reply(true, "CANCEL_REQUESTED", [task]);
    }
    const worker = workerOf(ctx.fleet, task.workerId);
    const helper = await ctx.self();
    const seen = await ctx.observe(worker);
    const refusal = identityRefusal(seen, task);
    if (refusal) {
        return reply(false, refusal, [ledger.task(id)], [seen]);
    }
    const before = task.state;
    requireTime(ctx);
    const op = ledger.begin(id, "cancel", [before], "cancel-requested", helper);
    if (!op) {
        const now = ledger.task(id) as StoredTask;
        return now.state === "cancel-requested"
            ? reply(true, "CANCEL_REQUESTED", [now], [seen])
            : reply(false, "TASK_MOVED", [now], [seen]);
    }
    let code: number | null = null;
    const left = remaining(ctx);
    if (left !== null && left <= 0) {
        code = 10;
    }
    try {
        if (code === null)
            ({ code } = await timed(
                ctx.deps.interrupter ?? createHerdrRun({ bin: INTERRUPTER }),
                [
                    "--expect-pane",
                    worker.pane,
                    "--expect-terminal",
                    task.terminalId as string,
                    ...occupantArgs(task.occupant as Occupant),
                    ...(ctx.deadlineAt === null
                        ? []
                        : ["--deadline-at", String(ctx.deadlineAt)]),
                    "--lock-wait",
                    String(LOCK_WAIT_S),
                    worker.name,
                ],
                ctx.deps.env,
                left === null
                    ? (ctx.deps.interruptTimeoutMs ?? INTERRUPT_TIMEOUT_MS)
                    : Math.min(
                          ctx.deps.interruptTimeoutMs ?? INTERRUPT_TIMEOUT_MS,
                          left,
                      ),
            ));
    } catch {
        code = null;
    }
    if (code === 0) {
        ledger.conclude(op.id, "done", null);
        return reply(true, "CANCEL_REQUESTED", [ledger.task(id)], [seen]);
    }
    if (code !== null && UNSENT.includes(code)) {
        const why = `CANCEL_NOT_SENT_${code}`;
        ledger.conclude(op.id, "done", why, {
            from: ["cancel-requested"],
            to: before,
            fields: { code: why },
        });
        return reply(false, "CANCEL_NOT_SENT", [ledger.task(id)], [seen]);
    }
    ledger.conclude(op.id, "uncertain", "CANCEL_UNCERTAIN", {
        from: ["cancel-requested"],
        to: "cancel-requested",
        fields: { code: "CANCEL_UNCERTAIN" },
    });
    return reply(false, "CANCEL_UNCERTAIN", [ledger.task(id)], [seen]);
}

function checkEvidence(value: unknown): CompletionEvidence {
    const raw = (value ?? {}) as Record<string, unknown>;
    const check = (raw.verification ?? {}) as Record<string, unknown>;
    if (
        typeof raw.reportDigest !== "string" ||
        !DIGEST.test(raw.reportDigest) ||
        typeof raw.revision !== "string" ||
        !OID.test(raw.revision) ||
        !Array.isArray(check.command) ||
        check.command.length < 1 ||
        !check.command.every((word) => typeof word === "string") ||
        !Number.isInteger(check.exitCode) ||
        typeof check.logPath !== "string"
    ) {
        refuse("EVIDENCE_INVALID");
    }
    return value as CompletionEvidence;
}

// Verifies recorded evidence; it runs nothing. A reported task becomes
// verified only on the runner's receipt for this task, its current
// revision and its report's digest, the report unchanged since.
async function finish(
    ctx: Context,
    taskId: unknown,
    value: unknown,
): Promise<StewardReply> {
    const { ledger } = ctx;
    const evidence = checkEvidence(value);
    const task = taskOf(ctx, taskId);
    if (task.state !== "reported") {
        return reply(false, "TASK_NOT_REPORTED", [task]);
    }
    const found = await readReport(ctx.fleet, task);
    if (found.kind !== "match" || found.digest !== task.reportDigest) {
        if (found.kind === "match") {
            ledger.move(task.taskId, ["reported"], "reported", {
                reportDigest: found.digest,
                revision: found.revision,
            });
        }
        return reply(false, "REPORT_CHANGED", [ledger.task(task.taskId)]);
    }
    if (evidence.reportDigest !== task.reportDigest) {
        return reply(false, "REPORT_DIGEST_MISMATCH", [task]);
    }
    if (evidence.revision !== task.revision) {
        return reply(false, "REVISION_STALE", [task]);
    }
    const { verification } = evidence;
    const receipt = ledger
        .receipts(task.taskId)
        .find(
            (r) =>
                r.revision === task.revision &&
                r.reportDigest === task.reportDigest &&
                r.exitCode === verification.exitCode &&
                r.logPath === verification.logPath &&
                JSON.stringify(r.command) ===
                    JSON.stringify(verification.command),
        );
    if (!receipt) {
        return reply(false, "RECEIPT_MISSING", [task]);
    }
    if (receipt.exitCode === 0) {
        ledger.move(task.taskId, ["reported"], "verified", { code: null });
        return reply(true, "TASK_VERIFIED", [ledger.task(task.taskId)]);
    }
    ledger.move(task.taskId, ["reported"], "failed", {
        code: "VERIFICATION_FAILED",
    });
    return reply(true, "TASK_FAILED", [ledger.task(task.taskId)]);
}

// What the worker's pane shows: at most 200 lines and 32 KiB, of a worker
// that matches. The text is the worker's, untrusted.
async function read(
    ctx: Context,
    workerId: unknown,
    lines: unknown,
): Promise<StewardReply> {
    if (
        typeof lines !== "number" ||
        !Number.isInteger(lines) ||
        lines < 1 ||
        lines > MAX_READ_LINES
    ) {
        refuse("READ_INVALID");
    }
    const worker = workerOf(ctx.fleet, workerId);
    const seen = await ctx.observe(worker);
    if (!seen.matches) {
        return reply(false, seen.code ?? "WORKER_MISMATCH", undefined, [seen]);
    }
    let out: { code: number; stdout: string };
    try {
        out = await timed(
            ctx.deps.run,
            [
                "agent",
                "read",
                worker.name,
                "--lines",
                String(lines),
                "--format",
                "text",
            ],
            ctx.deps.env,
            READ_TIMEOUT_MS,
        );
    } catch (error) {
        const code = error instanceof StewardError ? error.code : "";
        return reply(
            false,
            code === "HERDR_OUTPUT_LIMIT"
                ? "READ_TOO_LARGE"
                : code === "HERDR_TIMEOUT"
                  ? "HERDR_TIMEOUT"
                  : "HERDR_UNAVAILABLE",
            undefined,
            [seen],
        );
    }
    if (out.code !== 0) {
        return reply(false, "HERDR_FAILED", undefined, [seen]);
    }
    if (Buffer.byteLength(out.stdout) > MAX_OUTPUT_BYTES) {
        return reply(false, "READ_TOO_LARGE", undefined, [seen]);
    }
    const text = out.stdout
        .replace(/\n$/, "")
        .split("\n")
        .slice(-(lines as number))
        .join("\n");
    return { ...reply(true, "OK", undefined, [seen]), text };
}

async function operate(
    ctx: Context,
    operation: StewardRequest["operation"],
): Promise<StewardReply> {
    switch (operation.kind) {
        case "list": {
            const workers: WorkerObservation[] = [];
            for (const worker of ctx.fleet.workers) {
                workers.push({
                    ...(await ctx.observe(worker)),
                    availability: worker.availability,
                });
            }
            return reply(true, "OK", ctx.ledger.tasks(), workers);
        }
        case "read":
            return read(ctx, operation.workerId, operation.lines);
        case "dispatch":
            return dispatch(ctx, operation.task);
        case "wait":
            return wait(ctx, operation.taskId, operation.timeoutMs);
        case "cancel":
            return cancel(ctx, operation.taskId);
        case "reconcile": {
            if (operation.taskId === undefined) {
                const workers = await reconcileAll(ctx);
                return reply(true, "OK", ctx.ledger.tasks(), workers);
            }
            const id = taskOf(ctx, operation.taskId).taskId;
            const { task, seen } = await reconcileTask(ctx, id);
            return reply(true, "OK", [task], seen ? [seen] : undefined);
        }
        case "finish":
            return finish(ctx, operation.taskId, operation.evidence);
        default:
            return refuse("REQUEST_INVALID", "operation");
    }
}

// Runs one request: the registry read against the injected clock, the
// fleet's ledger opened, the controller claimed (and, on a takeover, every
// task reconciled first), then the operation. Every failure is a reply
// with its code; nothing is thrown.
export async function runSteward(
    request: StewardRequest,
    deps: StewardDeps,
): Promise<StewardReply> {
    let ledger: Ledger | undefined;
    try {
        checkRequest(request);
        const pinned = request.registryDigest
            ? {
                  fleetId: request.fleetId as string,
                  fixtureRoot: request.fixtureRoot as string,
                  sourceDigest: request.registryDigest,
              }
            : undefined;
        const fleet = await readFleet(request.registry, deps.now(), pinned);
        ledger = openLedger(
            ledgerPath(deps.env, fleet.fleetId),
            fleet.fleetId,
            deps.now,
        );
        const deadlineAt = request.deadlineAt
            ? Date.parse(request.deadlineAt)
            : null;
        if (deadlineAt !== null && deps.now().getTime() >= deadlineAt) {
            const id =
                "taskId" in request.operation &&
                typeof request.operation.taskId === "string"
                    ? request.operation.taskId
                    : null;
            const current = id ? ledger.task(id) : null;
            return reply(false, "STEWARD_DEADLINE", [current]);
        }
        const claim = await ledger.claim(
            request.controller,
            deps.controllerAlive,
        );
        let self: Promise<Identity> | undefined;
        const ctx: Context = {
            fleet,
            ledger,
            deps,
            deadlineAt,
            self: () => {
                self ??= deps.self
                    ? Promise.resolve(deps.self)
                    : processStart(process.pid).then((startedAt) => ({
                          pid: process.pid,
                          startedAt,
                      }));
                return self;
            },
            observe: (worker) =>
                observeWorker(worker, deps.run, {
                    env: deps.env,
                    now: deps.now,
                    ...(deadlineAt === null
                        ? {}
                        : {
                              timeoutMs: Math.max(
                                  1,
                                  deadlineAt - deps.now().getTime(),
                              ),
                          }),
                    processStart: deps.occupantStart ?? processStart,
                }),
        };
        if (claim === "taken") {
            await reconcileAll(ctx);
        }
        return await operate(ctx, request.operation);
    } catch (error) {
        if (error instanceof StewardError) {
            return { ok: false, code: error.code, text: error.message };
        }
        return { ok: false, code: "STEWARD_FAILED" };
    } finally {
        ledger?.close();
    }
}
