// vim:set expandtab shiftwidth=4 filetype=typescript:
// SPDX-License-Identifier: GPL-3.0-only

//
//
// ~chewygumxx/dorothy.git
// ::: :/packages/cli/src/hosts/pi/steward/ledger.test.ts
//
//

import { Database } from "bun:sqlite";
import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { FLEET_ID, NOW } from "./fixtures.js";
import {
    BUSY_TIMEOUT_MS,
    type Identity,
    type Ledger,
    ledgerPath,
    openLedger,
} from "./ledger.js";
import type { TaskBrief, TaskState } from "./types.js";

const OID = "0123456789abcdef0123456789abcdef01234567";
const DIGEST = `sha256:${"a".repeat(64)}`;
const ME: Identity = { pid: 4242, startedAt: "boot:1000" };
const HELPER: Identity = { pid: 4343, startedAt: "boot:1001" };

let root: string;
let path: string;
let open: Ledger[];

const brief = (taskId: string, workerId = "trial-codex"): TaskBrief => ({
    taskId,
    workerId,
    briefPath: join(root, "fixture", `${taskId}.md`),
    reportPath: join(root, "fixture", `${taskId}.report.md`),
    baseOid: OID,
});

const ledger = (fleetId = FLEET_ID) => {
    const opened = openLedger(path, fleetId, () => NOW);
    open.push(opened);
    return opened;
};

beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "dorothy-ledger-"));
    path = ledgerPath({ XDG_STATE_HOME: join(root, "state") }, FLEET_ID);
    open = [];
});

afterEach(async () => {
    for (const opened of open) {
        opened.close();
    }
    await rm(root, { recursive: true, force: true });
});

describe("ledgerPath", () => {
    it("is the fleet's file below the injected state home", () => {
        expect(ledgerPath({ XDG_STATE_HOME: "/s" }, FLEET_ID)).toBe(
            `/s/dorothy/pi/steward/${FLEET_ID}.sqlite`,
        );
        expect(
            ledgerPath({ HOME: "/h", XDG_STATE_HOME: "rel" }, FLEET_ID),
        ).toBe(`/h/.local/state/dorothy/pi/steward/${FLEET_ID}.sqlite`);
    });

    it("refuses an environment naming no absolute home", () => {
        for (const env of [{}, { HOME: "" }, { HOME: "rel" }]) {
            expect(() => ledgerPath(env, FLEET_ID)).toThrow(
                "STATE_HOME_MISSING",
            );
        }
    });

    it("refuses a fleet id that is not a uuid", () => {
        expect(() => ledgerPath({ XDG_STATE_HOME: "/s" }, "../x")).toThrow(
            "LEDGER_FLEET_INVALID",
        );
    });
});

describe("the ledger's file", () => {
    it("is private, in WAL with full sync and a 2000 ms busy timeout", async () => {
        const db = ledger();
        expect((await stat(path)).mode & 0o777).toBe(0o600);
        expect((await stat(join(path, ".."))).mode & 0o777).toBe(0o700);
        const pragma = (name: string) =>
            Object.values(db.pragma(name) ?? {})[0];
        expect(pragma("journal_mode")).toBe("wal");
        expect(pragma("synchronous")).toBe(2);
        expect(pragma("busy_timeout")).toBe(BUSY_TIMEOUT_MS);
        expect(BUSY_TIMEOUT_MS).toBe(2000);
    });

    it("holds fleet, controller, tasks, operations and receipts", () => {
        ledger().close();
        open = [];
        const raw = new Database(path, { readonly: true });
        const tables = raw
            .query("SELECT name FROM sqlite_master WHERE type = 'table'")
            .all()
            .map((row) => (row as { name: string }).name)
            .sort();
        raw.close();
        expect(tables).toEqual(
            expect.arrayContaining([
                "controller",
                "fleet",
                "operations",
                "receipts",
                "tasks",
            ]),
        );
    });

    it("belongs to one fleet: another's id is refused", () => {
        ledger().close();
        open = [];
        expect(() => ledger("00000000-0000-4000-8000-0000000000f2")).toThrow(
            "LEDGER_FLEET_MISMATCH",
        );
    });

    it("refuses a schema of another version", () => {
        ledger().close();
        open = [];
        const raw = new Database(path);
        raw.run("PRAGMA user_version = 99");
        raw.close();
        expect(() => ledger()).toThrow("LEDGER_VERSION");
    });
});

describe("tasks", () => {
    it("records intent with its digest and pinned terminal", () => {
        const db = ledger();
        const op = db.reserve(brief("t1"), DIGEST, "term_1", HELPER);
        const task = db.task("t1");
        expect(task).toMatchObject({
            ...brief("t1"),
            briefDigest: DIGEST,
            state: "intent",
            terminalId: "term_1",
            createdAt: NOW.toISOString(),
            updatedAt: NOW.toISOString(),
            reportDigest: null,
            revision: null,
            code: null,
        });
        expect(op).toMatchObject({
            taskId: "t1",
            kind: "dispatch",
            state: "pending",
            pid: HELPER.pid,
            startedAt: HELPER.startedAt,
        });
    });

    it("keeps a task id unique within the fleet, after a restart too", () => {
        const db = ledger();
        db.reserve(brief("t1"), DIGEST, "term_1", HELPER);
        db.move("t1", ["intent"], "failed", { code: "X" });
        db.close();
        open = [];
        const again = ledger();
        expect(() =>
            again.reserve(brief("t1", "trial-claude"), DIGEST, "t", HELPER),
        ).toThrow("TASK_EXISTS");
        expect(again.task("t1")?.state).toBe("failed");
    });

    it("reserves a worker once across all active tasks", () => {
        const db = ledger();
        db.reserve(brief("t1"), DIGEST, "term_1", HELPER);
        expect(() => db.reserve(brief("t2"), DIGEST, "term_1", HELPER)).toThrow(
            "WORKER_RESERVED",
        );
        expect(db.task("t2")).toBeNull();
        db.reserve(brief("t3", "trial-claude"), DIGEST, "term_2", HELPER);
    });

    it("holds the worker while unknown, reported or cancel-requested", () => {
        const holding: TaskState[] = [
            "sent",
            "running",
            "reported",
            "cancel-requested",
            "unknown",
        ];
        const db = ledger();
        for (const [index, state] of holding.entries()) {
            const id = `h${index}`;
            db.reserve(brief(id), DIGEST, "term_1", HELPER);
            expect(db.move(id, ["intent"], state)).toBe(true);
            expect(() =>
                db.reserve(brief(`${id}x`), DIGEST, "term_1", HELPER),
            ).toThrow("WORKER_RESERVED");
            db.move(id, [state], "failed");
        }
    });

    it("releases the worker once verified, cancelled or failed", () => {
        const db = ledger();
        for (const [index, state] of (
            ["verified", "cancelled", "failed"] as const
        ).entries()) {
            const id = `r${index}`;
            db.reserve(brief(id), DIGEST, "term_1", HELPER);
            db.move(id, ["intent"], state);
        }
        db.reserve(brief("next"), DIGEST, "term_1", HELPER);
        expect(db.task("next")?.state).toBe("intent");
    });

    it("moves only from the expected state", () => {
        const db = ledger();
        db.reserve(brief("t1"), DIGEST, "term_1", HELPER);
        expect(db.move("t1", ["sent"], "running")).toBe(false);
        expect(db.task("t1")?.state).toBe("intent");
        expect(db.move("t1", ["intent"], "sent")).toBe(true);
        expect(
            db.move("t1", ["sent"], "reported", {
                reportDigest: DIGEST,
                revision: OID,
                code: "R",
            }),
        ).toBe(true);
        expect(db.task("t1")).toMatchObject({
            state: "reported",
            reportDigest: DIGEST,
            revision: OID,
            code: "R",
        });
    });

    it("refuses a state it does not know", () => {
        const db = ledger();
        db.reserve(brief("t1"), DIGEST, "term_1", HELPER);
        expect(() =>
            db.move("t1", ["intent"], "done" as unknown as TaskState),
        ).toThrow();
        expect(db.task("t1")?.state).toBe("intent");
    });

    it("settles an operation and its task together", () => {
        const db = ledger();
        const op = db.reserve(brief("t1"), DIGEST, "term_1", HELPER);
        expect(
            db.conclude(op.id, "done", null, { from: ["intent"], to: "sent" }),
        ).toBe(true);
        expect(db.task("t1")?.state).toBe("sent");
        expect(db.operations("t1")[0]?.state).toBe("done");
        expect(db.pending()).toEqual([]);
        // A task moved meanwhile is left as it is, the operation settled.
        const second = db.begin(
            "t1",
            "cancel",
            ["sent"],
            "cancel-requested",
            HELPER,
        );
        expect(second?.state).toBe("pending");
        expect(
            db.conclude(second?.id ?? 0, "uncertain", "U", {
                from: ["sent"],
                to: "running",
            }),
        ).toBe(false);
        expect(db.task("t1")?.state).toBe("cancel-requested");
        expect(db.operations("t1").map((o) => o.state)).toEqual([
            "done",
            "uncertain",
        ]);
    });

    it("begins an operation only where its task is in the expected state", () => {
        const db = ledger();
        db.reserve(brief("t1"), DIGEST, "term_1", HELPER);
        expect(
            db.begin("t1", "cancel", ["running"], "cancel-requested", HELPER),
        ).toBeNull();
        expect(db.operations("t1")).toHaveLength(1);
    });
});

describe("the controller claim", () => {
    const OTHER: Identity = { pid: 5151, startedAt: "boot:2000" };
    const never = async () => {
        throw new Error("liveness asked");
    };

    it("is taken by the first controller and held by it", async () => {
        const db = ledger();
        expect(await db.claim(ME, never)).toBe("claimed");
        expect(await db.claim(ME, never)).toBe("held");
        expect(db.controller()).toEqual(ME);
    });

    it("refuses a second live controller", async () => {
        const db = ledger();
        await db.claim(ME, never);
        const asked: Identity[] = [];
        await expect(
            db.claim(OTHER, async (pid, startedAt) => {
                asked.push({ pid, startedAt });
                return true;
            }),
        ).rejects.toThrow("CONTROLLER_LIVE");
        expect(asked).toEqual([ME]);
        expect(db.controller()).toEqual(ME);
    });

    it("refuses takeover while the owner's liveness is uncertain", async () => {
        const db = ledger();
        await db.claim(ME, never);
        await expect(db.claim(OTHER, never)).rejects.toThrow(
            "CONTROLLER_UNCERTAIN",
        );
        expect(db.controller()).toEqual(ME);
    });

    it("is taken over once the owner is proven gone", async () => {
        const db = ledger();
        await db.claim(ME, never);
        db.reserve(brief("t1"), DIGEST, "term_1", HELPER);
        expect(await db.claim(OTHER, async () => false)).toBe("taken");
        expect(db.controller()).toEqual(OTHER);
        expect(db.task("t1")?.state).toBe("intent");
    });

    it("tells a reused pid from its owner by the start identity", async () => {
        const db = ledger();
        await db.claim(ME, never);
        const reused = { pid: ME.pid, startedAt: "boot:9999" };
        await expect(db.claim(reused, async () => true)).rejects.toThrow(
            "CONTROLLER_LIVE",
        );
        expect(await db.claim(reused, async () => false)).toBe("taken");
    });

    it("lets one of two takeovers win", async () => {
        const db = ledger();
        const other = ledger();
        await db.claim(ME, never);
        const third = { pid: 6161, startedAt: "boot:3000" };
        const results = await Promise.allSettled([
            db.claim(OTHER, async () => false),
            other.claim(third, async () => false),
        ]);
        expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
        expect(
            results.find((r) => r.status === "rejected")?.reason?.code,
        ).toMatch(/^CONTROLLER_(RACE|LIVE|UNCERTAIN)$/);
    });

    it("survives a reopen", async () => {
        const db = ledger();
        await db.claim(ME, never);
        db.close();
        open = [];
        expect(await ledger().claim(ME, never)).toBe("held");
    });
});

describe("receipts", () => {
    it("are recorded by the runner and listed by task", () => {
        const db = ledger();
        db.reserve(brief("t1"), DIGEST, "term_1", HELPER);
        const receipt = {
            taskId: "t1",
            revision: OID,
            reportDigest: DIGEST,
            command: ["bun", "test"],
            exitCode: 0,
            logPath: join(root, "fixture", "t1.log"),
        };
        db.recordReceipt(receipt);
        expect(db.receipts("t1")).toEqual([
            { ...receipt, recordedAt: NOW.toISOString() },
        ]);
        expect(db.receipts("t2")).toEqual([]);
    });

    it("refuse a task the ledger does not hold", () => {
        const db = ledger();
        expect(() =>
            db.recordReceipt({
                taskId: "ghost",
                revision: OID,
                reportDigest: DIGEST,
                command: ["bun", "test"],
                exitCode: 0,
                logPath: "/x",
            }),
        ).toThrow("TASK_MISSING");
    });
});
