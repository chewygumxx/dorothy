// vim:set expandtab shiftwidth=4 filetype=typescript:
// SPDX-License-Identifier: GPL-3.0-only

//
//
// ~xxdorothy/dorothy.git
// ::: :/packages/cli/src/hosts/pi/steward/ledger.ts
//
//

// The stewardship ledger: one SQLite file per fleet holding its identity,
// the controller's claim, tasks, the operations that may have reached a pane
// and the runner's verification receipts. Every reservation and transition
// is a transaction; a worker is held by one active task at a time, and a
// task id is never reused, across restarts too.

import { Database } from "bun:sqlite";
import { chmodSync, mkdirSync } from "node:fs";
import { dirname, isAbsolute, join } from "node:path";
import { type Env, isUuid } from "@dorothy/core";
import {
    type Occupant,
    StewardError,
    type TaskBrief,
    type TaskRecord,
    type TaskState,
} from "./types.js";

export const BUSY_TIMEOUT_MS = 2000;
// Version 2 adds the occupant pin. Version 1 rows migrate with a null
// occupant and may be read, but the engine will not send or interrupt them.
const VERSION = 2;

// The states that hold their worker: all but verified, cancelled, failed.
export const ACTIVE_STATES: readonly TaskState[] = [
    "intent",
    "sent",
    "running",
    "reported",
    "cancel-requested",
    "unknown",
];
const STATES: readonly TaskState[] = [
    ...ACTIVE_STATES,
    "verified",
    "cancelled",
    "failed",
];

// A process by its pid and start identity, so a reused pid is another.
export type Identity = { pid: number; startedAt: string };
// True alive, false proven gone; a rejection is uncertain.
export type Liveness = (pid: number, startedAt: string) => Promise<boolean>;

// A row as stored: the terminal resource and real occupant pinned at
// reservation. The terminal is only the sender's second guard.
export type StoredTask = TaskRecord & {
    terminalId: string | null;
    occupant: Occupant | null;
};

export type OperationState = "pending" | "done" | "uncertain";
export type Operation = {
    id: number;
    taskId: string;
    kind: "dispatch" | "cancel";
    state: OperationState;
    pid: number;
    startedAt: string;
    code: string | null;
    createdAt: string;
    updatedAt: string;
};

export type Receipt = {
    taskId: string;
    revision: string;
    reportDigest: string;
    command: string[];
    exitCode: number;
    logPath: string;
};

export type Fields = Partial<
    Pick<TaskRecord, "code" | "reportDigest" | "revision">
>;
export type Move = {
    from: readonly TaskState[];
    to: TaskState;
    fields?: Fields;
};

export type Claim = "claimed" | "held" | "taken";

const quoted = (values: readonly string[]) =>
    values.map((value) => `'${value}'`).join(", ");

const SCHEMA = `
CREATE TABLE fleet (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    fleet_id TEXT NOT NULL,
    created_at TEXT NOT NULL
);
CREATE TABLE controller (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    pid INTEGER NOT NULL,
    started_at TEXT NOT NULL,
    claimed_at TEXT NOT NULL
);
CREATE TABLE tasks (
    task_id TEXT PRIMARY KEY,
    worker_id TEXT NOT NULL,
    brief_path TEXT NOT NULL,
    report_path TEXT NOT NULL,
    base_oid TEXT NOT NULL,
    brief_digest TEXT NOT NULL,
    terminal_id TEXT,
    occupant TEXT,
    state TEXT NOT NULL CHECK (state IN (${quoted(STATES)})),
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    report_digest TEXT,
    revision TEXT,
    code TEXT
);
CREATE UNIQUE INDEX tasks_active_worker ON tasks (worker_id)
    WHERE state IN (${quoted(ACTIVE_STATES)});
CREATE TABLE operations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    task_id TEXT NOT NULL REFERENCES tasks (task_id),
    kind TEXT NOT NULL CHECK (kind IN ('dispatch', 'cancel')),
    state TEXT NOT NULL CHECK (state IN ('pending', 'done', 'uncertain')),
    pid INTEGER NOT NULL,
    started_at TEXT NOT NULL,
    code TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);
CREATE TABLE receipts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    task_id TEXT NOT NULL REFERENCES tasks (task_id),
    revision TEXT NOT NULL,
    report_digest TEXT NOT NULL,
    command TEXT NOT NULL,
    exit_code INTEGER NOT NULL,
    log_path TEXT NOT NULL,
    recorded_at TEXT NOT NULL
);
`;

// `$XDG_STATE_HOME/dorothy/pi/steward/<fleetId>.sqlite`, from the injected
// environment alone: an absolute XDG_STATE_HOME, else HOME's
// `.local/state`; neither refuses rather than guess a home.
export function ledgerPath(env: Env, fleetId: string): string {
    if (!isUuid(fleetId)) {
        throw new StewardError("LEDGER_FLEET_INVALID", "fleetId");
    }
    const xdg = env.XDG_STATE_HOME ?? "";
    const home = env.HOME ?? "";
    const base = isAbsolute(xdg)
        ? xdg
        : isAbsolute(home)
          ? join(home, ".local", "state")
          : null;
    if (!base) {
        throw new StewardError("STATE_HOME_MISSING", "XDG_STATE_HOME or HOME");
    }
    return join(base, "dorothy", "pi", "steward", `${fleetId}.sqlite`);
}

type Row = Record<string, string | number | null>;

const taskOf = (row: Row): StoredTask => ({
    taskId: row.task_id as string,
    workerId: row.worker_id as string,
    briefPath: row.brief_path as string,
    reportPath: row.report_path as string,
    baseOid: row.base_oid as string,
    briefDigest: row.brief_digest as string,
    state: row.state as TaskState,
    createdAt: row.created_at as string,
    updatedAt: row.updated_at as string,
    reportDigest: row.report_digest as string | null,
    revision: row.revision as string | null,
    code: row.code as string | null,
    terminalId: row.terminal_id as string | null,
    occupant: parseOccupant(row.occupant),
});

function parseOccupant(value: unknown): Occupant | null {
    if (typeof value !== "string") return null;
    try {
        const occupant = JSON.parse(value) as Occupant;
        return occupant.kind === "session" || occupant.kind === "process"
            ? occupant
            : null;
    } catch {
        return null;
    }
}

const operationOf = (row: Row): Operation => ({
    id: row.id as number,
    taskId: row.task_id as string,
    kind: row.kind as Operation["kind"],
    state: row.state as OperationState,
    pid: row.pid as number,
    startedAt: row.started_at as string,
    code: row.code as string | null,
    createdAt: row.created_at as string,
    updatedAt: row.updated_at as string,
});

export type Ledger = {
    // A pragma's value on this connection, for checks.
    pragma: (name: string) => Record<string, unknown> | null;
    claim: (controller: Identity, alive: Liveness) => Promise<Claim>;
    controller: () => Identity | null;
    task: (taskId: string) => StoredTask | null;
    tasks: () => StoredTask[];
    // Records intent, digest, pinned terminal and the worker's reservation,
    // with the pending dispatch operation, in one transaction.
    reserve: (
        brief: TaskBrief,
        briefDigest: string,
        terminalId: string,
        helper: Identity,
        occupant?: Occupant | null,
    ) => Operation;
    // Moves a task only from one of `from`; false where it was not there.
    move: (
        taskId: string,
        from: readonly TaskState[],
        to: TaskState,
        fields?: Fields,
    ) => boolean;
    // Moves a task and opens an operation on it together, or neither.
    begin: (
        taskId: string,
        kind: Operation["kind"],
        from: readonly TaskState[],
        to: TaskState,
        helper: Identity,
    ) => Operation | null;
    // Settles an operation, and moves its task if `move` still applies.
    conclude: (
        operationId: number,
        state: OperationState,
        code: string | null,
        move?: Move,
    ) => boolean;
    operations: (taskId?: string) => Operation[];
    pending: () => Operation[];
    // The runner's alone: Pi's tools never mint one.
    recordReceipt: (receipt: Receipt) => void;
    receipts: (taskId: string) => (Receipt & { recordedAt: string })[];
    close: () => void;
};

// Setting WAL takes the file's exclusive lock without waiting on the busy
// timeout, so two helpers opening a new ledger at once retry it, as long.
function walMode(db: Database): void {
    const deadline = performance.now() + BUSY_TIMEOUT_MS;
    for (;;) {
        try {
            db.run("PRAGMA journal_mode = WAL");
            return;
        } catch (error) {
            const busy = /locked|busy/i.test(String((error as Error).message));
            if (!busy || performance.now() > deadline) {
                throw error;
            }
            Bun.sleepSync(10);
        }
    }
}

function prepare(db: Database, fleetId: string, at: string): void {
    db.run(`PRAGMA busy_timeout = ${BUSY_TIMEOUT_MS}`);
    walMode(db);
    db.run("PRAGMA synchronous = FULL");
    db.run("PRAGMA foreign_keys = ON");
    db.transaction(() => {
        const version = (
            db.query("PRAGMA user_version").get() as { user_version: number }
        ).user_version;
        if (version === 0) {
            db.run(SCHEMA);
            db.run("INSERT INTO fleet VALUES (1, ?, ?)", [fleetId, at]);
            db.run(`PRAGMA user_version = ${VERSION}`);
            return;
        }
        if (version === 1) {
            db.run("ALTER TABLE tasks ADD COLUMN occupant TEXT");
            db.run(`PRAGMA user_version = ${VERSION}`);
        } else if (version !== VERSION) {
            throw new StewardError("LEDGER_VERSION", String(version));
        }
        const row = db.query("SELECT fleet_id FROM fleet").get() as Row | null;
        if (row?.fleet_id !== fleetId) {
            throw new StewardError("LEDGER_FLEET_MISMATCH", fleetId);
        }
    }).immediate();
}

// Opens (creating, private) the ledger at `path` for `fleetId`; a file of
// another fleet or schema version is refused.
export function openLedger(
    path: string,
    fleetId: string,
    now: () => Date,
): Ledger {
    mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
    chmodSync(dirname(path), 0o700);
    let db: Database;
    try {
        db = new Database(path, { create: true, strict: true });
    } catch {
        throw new StewardError("LEDGER_UNAVAILABLE", path);
    }
    try {
        chmodSync(path, 0o600);
        prepare(db, fleetId, now().toISOString());
    } catch (error) {
        db.close();
        if (error instanceof StewardError) {
            throw error;
        }
        throw new StewardError("LEDGER_UNAVAILABLE", path);
    }
    const stamp = () => now().toISOString();
    const getTask = (taskId: string): StoredTask | null => {
        const row = db
            .query("SELECT * FROM tasks WHERE task_id = ?")
            .get(taskId) as Row | null;
        return row ? taskOf(row) : null;
    };
    const getOperation = (id: number): Operation =>
        operationOf(
            db.query("SELECT * FROM operations WHERE id = ?").get(id) as Row,
        );
    const insertOperation = (
        taskId: string,
        kind: Operation["kind"],
        helper: Identity,
    ): Operation => {
        const at = stamp();
        const result = db.run(
            `INSERT INTO operations
                (task_id, kind, state, pid, started_at, created_at, updated_at)
             VALUES (?, ?, 'pending', ?, ?, ?, ?)`,
            [taskId, kind, helper.pid, helper.startedAt, at, at],
        );
        return getOperation(Number(result.lastInsertRowid));
    };
    const moveTask = (
        taskId: string,
        from: readonly TaskState[],
        to: TaskState,
        fields: Fields = {},
    ): boolean => {
        if (!STATES.includes(to) || from.some((s) => !STATES.includes(s))) {
            throw new StewardError("TASK_STATE_INVALID", to);
        }
        const sets = ["state = ?", "updated_at = ?"];
        const values: (string | null)[] = [to, stamp()];
        for (const [field, column] of [
            ["code", "code"],
            ["reportDigest", "report_digest"],
            ["revision", "revision"],
        ] as const) {
            if (field in fields) {
                sets.push(`${column} = ?`);
                values.push(fields[field] ?? null);
            }
        }
        const result = db.run(
            `UPDATE tasks SET ${sets.join(", ")}
             WHERE task_id = ? AND state IN (${from.map(() => "?").join(", ")})`,
            [...values, taskId, ...from],
        );
        return result.changes === 1;
    };
    const readController = (): Identity | null => {
        const row = db.query("SELECT * FROM controller").get() as Row | null;
        return row
            ? { pid: row.pid as number, startedAt: row.started_at as string }
            : null;
    };
    const same = (a: Identity, b: Identity) =>
        a.pid === b.pid && a.startedAt === b.startedAt;

    return {
        pragma: (name) =>
            /^[a-z_]+$/.test(name)
                ? (db.query(`PRAGMA ${name}`).get() as Record<string, unknown>)
                : null,

        // The first controller claims; the same one holds. Another is let in
        // only once the owner is proven gone, by a compare-and-swap so two
        // takeovers cannot both win; uncertain liveness refuses.
        claim: async (controller, alive) => {
            const first = db
                .transaction((): Claim | Identity => {
                    const owner = readController();
                    if (!owner) {
                        db.run("INSERT INTO controller VALUES (1, ?, ?, ?)", [
                            controller.pid,
                            controller.startedAt,
                            stamp(),
                        ]);
                        return "claimed";
                    }
                    return same(owner, controller) ? "held" : owner;
                })
                .immediate();
            if (typeof first === "string") {
                return first;
            }
            let living: boolean;
            try {
                living = await alive(first.pid, first.startedAt);
            } catch {
                throw new StewardError("CONTROLLER_UNCERTAIN", "liveness");
            }
            if (living) {
                throw new StewardError("CONTROLLER_LIVE", String(first.pid));
            }
            const swapped = db.run(
                `UPDATE controller SET pid = ?, started_at = ?, claimed_at = ?
                 WHERE pid = ? AND started_at = ?`,
                [
                    controller.pid,
                    controller.startedAt,
                    stamp(),
                    first.pid,
                    first.startedAt,
                ],
            );
            if (swapped.changes !== 1) {
                throw new StewardError("CONTROLLER_RACE", "claim moved");
            }
            return "taken";
        },

        controller: readController,
        task: getTask,
        tasks: () =>
            (
                db
                    .query("SELECT * FROM tasks ORDER BY created_at, task_id")
                    .all() as Row[]
            ).map(taskOf),

        reserve: (brief, briefDigest, terminalId, helper, occupant = null) =>
            db
                .transaction(() => {
                    if (getTask(brief.taskId)) {
                        throw new StewardError("TASK_EXISTS", brief.taskId);
                    }
                    const held = db
                        .query(
                            `SELECT task_id FROM tasks WHERE worker_id = ?
                             AND state IN (${quoted(ACTIVE_STATES)})`,
                        )
                        .get(brief.workerId);
                    if (held) {
                        throw new StewardError(
                            "WORKER_RESERVED",
                            brief.workerId,
                        );
                    }
                    const at = stamp();
                    db.run(
                        `INSERT INTO tasks
                            (task_id, worker_id, brief_path, report_path,
                             base_oid, brief_digest, terminal_id, occupant,
                             state, created_at, updated_at)
                         VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'intent', ?, ?)`,
                        [
                            brief.taskId,
                            brief.workerId,
                            brief.briefPath,
                            brief.reportPath,
                            brief.baseOid,
                            briefDigest,
                            terminalId,
                            occupant ? JSON.stringify(occupant) : null,
                            at,
                            at,
                        ],
                    );
                    return insertOperation(brief.taskId, "dispatch", helper);
                })
                .immediate(),

        move: (taskId, from, to, fields) =>
            db
                .transaction(() => moveTask(taskId, from, to, fields))
                .immediate(),

        begin: (taskId, kind, from, to, helper) =>
            db
                .transaction(() =>
                    moveTask(taskId, from, to)
                        ? insertOperation(taskId, kind, helper)
                        : null,
                )
                .immediate(),

        conclude: (operationId, state, code, move) =>
            db
                .transaction(() => {
                    const op = getOperation(operationId);
                    db.run(
                        `UPDATE operations SET state = ?, code = ?, updated_at = ?
                         WHERE id = ?`,
                        [state, code, stamp(), operationId],
                    );
                    return move
                        ? moveTask(op.taskId, move.from, move.to, move.fields)
                        : false;
                })
                .immediate(),

        operations: (taskId) =>
            (
                (taskId === undefined
                    ? db.query("SELECT * FROM operations ORDER BY id").all()
                    : db
                          .query(
                              "SELECT * FROM operations WHERE task_id = ? ORDER BY id",
                          )
                          .all(taskId)) as Row[]
            ).map(operationOf),

        pending: () =>
            (
                db
                    .query(
                        "SELECT * FROM operations WHERE state = 'pending' ORDER BY id",
                    )
                    .all() as Row[]
            ).map(operationOf),

        recordReceipt: (receipt) =>
            db
                .transaction(() => {
                    if (!getTask(receipt.taskId)) {
                        throw new StewardError("TASK_MISSING", receipt.taskId);
                    }
                    db.run(
                        `INSERT INTO receipts
                            (task_id, revision, report_digest, command,
                             exit_code, log_path, recorded_at)
                         VALUES (?, ?, ?, ?, ?, ?, ?)`,
                        [
                            receipt.taskId,
                            receipt.revision,
                            receipt.reportDigest,
                            JSON.stringify(receipt.command),
                            receipt.exitCode,
                            receipt.logPath,
                            stamp(),
                        ],
                    );
                })
                .immediate(),

        receipts: (taskId) =>
            (
                db
                    .query(
                        "SELECT * FROM receipts WHERE task_id = ? ORDER BY id",
                    )
                    .all(taskId) as Row[]
            ).map((row) => ({
                taskId: row.task_id as string,
                revision: row.revision as string,
                reportDigest: row.report_digest as string,
                command: JSON.parse(row.command as string) as string[],
                exitCode: row.exit_code as number,
                logPath: row.log_path as string,
                recordedAt: row.recorded_at as string,
            })),

        close: () => db.close(),
    };
}
