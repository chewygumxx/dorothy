// vim:set expandtab shiftwidth=4 filetype=typescript:
// SPDX-License-Identifier: GPL-3.0-only

//
//
// ~chewygumxx/dorothy.git
// ::: :/packages/cli/src/hosts/pi/steward/simulation.ts
//
//

// The simulated trial a scenario runs in: three declared workers in a
// private root, each with a clone of the fixture repository, the engine
// reached through the helper's request (`runSteward`) over a fake herdr, a
// fake sender and a fake interrupter, and the owner's kit outside every
// clone. Workers are scripted: a commit, a report, a herdr state. The
// "model" is scripted too: every call it makes is a recorded decision, so a
// run measures the plumbing and the ledger, never a model's judgement.

import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runSteward, type StewardDeps } from "./engine.js";
import {
    type FakeHerdr,
    type FakeSender,
    FLEET_ID,
    fakeHerdr,
    fakeSender,
    herdrAgentOf,
    NOW,
} from "./fixtures.js";
import type { HerdrRun } from "./herdr.js";
import { type Identity, ledgerPath, openLedger } from "./ledger.js";
import {
    cloneOrigin,
    commitAll,
    createOrigin,
    createOwnerKit,
    headOf,
    type OwnerEnv,
    type OwnerKit,
    type OwnerOutcome,
    verifySubmission,
} from "./owner.js";
import { readFleet } from "./registry.js";
import type {
    Availability,
    Fleet,
    StewardReply,
    StewardRequest,
    TaskBrief,
    TaskRecord,
    TaskState,
    Worker,
} from "./types.js";

export type Slot = "impl" | "rev" | "spare";
const SLOTS: readonly Slot[] = ["impl", "rev", "spare"];

// Who is who: the names, panes, task id prefix, the order the registry
// lists them in and the order reports arrive in. The held-out cast changes
// every one, so nothing may depend on a name, a slot's place or an order.
export type Cast = {
    label: string;
    names: Record<Slot, string>;
    panes: Record<Slot, string>;
    terminals: Record<Slot, string>;
    registryOrder: readonly Slot[];
    prefix: string;
    reportOrder: "forward" | "reverse";
    // The order the suite runs its scenarios in.
    scenarioOrder: "forward" | "reverse";
};

export const DEFAULT_CAST: Cast = {
    label: "default",
    names: { impl: "trial-codex", rev: "trial-claude", spare: "trial-spare" },
    panes: { impl: "w1:p1", rev: "w1:p2", spare: "w1:p3" },
    terminals: {
        impl: "term_0000000000000a1",
        rev: "term_0000000000000a2",
        spare: "term_0000000000000a3",
    },
    registryOrder: ["impl", "rev", "spare"],
    prefix: "trial",
    reportOrder: "forward",
    scenarioOrder: "forward",
};

export const HELD_OUT_CAST: Cast = {
    label: "held-out",
    names: { impl: "scribe-7", rev: "critic-3", spare: "bench-9" },
    panes: { impl: "w4:p9", rev: "w2:p1", spare: "w7:p4" },
    terminals: {
        impl: "term_00000000000ffe3",
        rev: "term_00000000000ffe1",
        spare: "term_00000000000ffe2",
    },
    registryOrder: ["spare", "rev", "impl"],
    prefix: "x7q",
    reportOrder: "reverse",
    scenarioOrder: "reverse",
};

export type Decision = {
    scripted: true;
    label: string;
    op: string;
    code: string | null;
    ok: boolean | null;
};
export type Check = { name: string; ok: boolean; detail: string };

export type BootOptions = {
    availability?: Partial<Record<Slot, Availability>>;
    // The clock the registry and the engine read: fixed, unless a real
    // process (Pi's helper) reads the real one.
    now?: Date;
};

// The line of `slug.ts` a worker changes.
const SOURCE_LINE = /^ {4}return .*;$/m;
const FIXES = {
    // Trims the hyphens but leaves accented letters as separators: passes
    // the examples in CONTRACT.md and fails the owner's test.
    incomplete:
        '    return text.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");',
    complete:
        '    return text.normalize("NFKD").replace(/\\p{M}+/gu, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");',
} as const;
export type Fix = keyof typeof FIXES;

const sha256 = (text: string) =>
    `sha256:${createHash("sha256").update(text).digest("hex")}`;

export type ReportFields = {
    task?: string;
    status?: string;
    // null leaves the line out.
    revision?: string | null;
    verification?: string;
    // Appended as written: a worker's words.
    extra?: string[];
};

type Parts = {
    cast: Cast;
    root: string;
    fleet: Fleet;
    registry: string;
    origin: string;
    baseOid: string;
    kit: OwnerKit;
    ownerEnv: OwnerEnv;
    env: Record<string, string>;
    now: Date;
};

export class Sim {
    readonly w: Record<Slot, Worker>;
    readonly herdr: FakeHerdr;
    readonly sender: FakeSender = fakeSender();
    readonly interrupter: FakeSender = fakeSender();
    readonly me: Identity = { pid: 1000, startedAt: "boot:ctl-1" };
    readonly helper: Identity = { pid: 3000, startedAt: "boot:helper" };
    readonly alive = new Map<string, boolean | "uncertain">();
    readonly decisions: Decision[] = [];
    readonly checks: Check[] = [];
    // Revisions the harness knows meet the contract: the oracle the
    // verified-task count is measured against, apart from anything the
    // engine or the runner believes.
    readonly good = new Set<string>();
    private readonly clones = new Map<string, string>();
    private gets = 0;
    private readonly hooks: { n: number; fn: () => void }[] = [];

    private constructor(readonly parts: Parts) {
        const { fleet, cast } = parts;
        const find = (slot: Slot): Worker =>
            fleet.workers.find((w) => w.id === cast.names[slot]) as Worker;
        this.w = { impl: find("impl"), rev: find("rev"), spare: find("spare") };
        this.herdr = fakeHerdr(fleet.workers, { steward: true });
        this.alive.set(this.key(this.me), true);
        for (const worker of fleet.workers) {
            this.status(worker, "idle");
        }
    }

    static async boot(cast: Cast, options: BootOptions = {}): Promise<Sim> {
        const root = await mkdtemp(join(tmpdir(), "dorothy-scenario-"));
        const fixtureRoot = join(root, "fixture");
        const env = {
            HERDR_ENV: "1",
            PATH: process.env.PATH ?? "/usr/bin:/bin",
            XDG_STATE_HOME: join(root, "state"),
            XDG_RUNTIME_DIR: join(root, "run"),
        };
        const ownerEnv: OwnerEnv = {
            PATH: env.PATH,
            home: join(root, "owner-home"),
        };
        // The registry, in the cast's order, then read back as the engine
        // does.
        const now = options.now ?? NOW;
        const observedAt = new Date(now.getTime() - 10 * 60_000).toISOString();
        const expiresAt = new Date(now.getTime() + 40 * 60_000).toISOString();
        const entry = (slot: Slot) => ({
            id: cast.names[slot],
            name: cast.names[slot],
            pane: cast.panes[slot],
            harness: slot === "rev" ? "claude" : "codex",
            role:
                slot === "impl"
                    ? "implementer"
                    : slot === "rev"
                      ? "reviewer"
                      : "reserve",
            cwd: join(fixtureRoot, cast.names[slot]),
            accountLabel: `${slot}-trial`,
            availability: options.availability?.[slot] ?? "available",
            observedAt,
            expiresAt,
        });
        for (const dir of ["briefs", "reports"]) {
            await mkdir(join(fixtureRoot, dir), { recursive: true });
        }
        for (const slot of SLOTS) {
            await mkdir(entry(slot).cwd, { recursive: true });
        }
        const registry = join(root, "registry.json");
        await writeFile(
            registry,
            JSON.stringify({
                version: 1,
                fleetId: FLEET_ID,
                fixtureRoot,
                workers: cast.registryOrder.map(entry),
            }),
        );
        const fleet = await readFleet(registry, now);
        const origin = join(root, "origin");
        const baseOid = await createOrigin(origin, ownerEnv);
        const kit = await createOwnerKit({
            root: join(root, "owner"),
            fixtureRoot: fleet.fixtureRoot,
            env: ownerEnv,
        });
        return new Sim({
            cast,
            root,
            fleet,
            registry,
            origin,
            baseOid,
            kit,
            ownerEnv,
            env,
            now,
        });
    }

    get cast() {
        return this.parts.cast;
    }
    get fleet() {
        return this.parts.fleet;
    }
    terminalOf(worker: Worker): string {
        return this.cast.terminals[this.slotOf(worker)];
    }
    get baseOid() {
        return this.parts.baseOid;
    }
    get registry() {
        return this.parts.registry;
    }
    get kit() {
        return this.parts.kit;
    }
    get env() {
        return this.parts.env;
    }
    get root() {
        return this.parts.root;
    }
    get fixtureRoot() {
        return this.parts.fleet.fixtureRoot;
    }
    id = (key: string) => `${this.cast.prefix}-${key}`;
    key = (identity: Identity) => `${identity.pid}/${identity.startedAt}`;

    private slotOf(worker: Worker): Slot {
        return SLOTS.find(
            (slot) => this.cast.names[slot] === worker.id,
        ) as Slot;
    }

    private herdrRun: HerdrRun = async (args, over) => {
        if (args[0] === "agent" && args[1] === "get") {
            this.gets++;
            for (const hook of this.hooks.filter((h) => h.n === this.gets)) {
                hook.fn();
            }
        }
        return this.herdr.run(args, over);
    };

    // Arms `fn` to run just before the nth `agent get` from now.
    beforeGet(nth: number, fn: () => void): void {
        this.hooks.push({ n: this.gets + nth, fn });
    }

    deps(extra: Partial<StewardDeps> = {}): StewardDeps {
        return {
            env: this.env,
            now: () => this.parts.now,
            run: this.herdrRun,
            sender: this.sender.run,
            interrupter: this.interrupter.run,
            self: this.helper,
            pollMs: 5,
            controllerAlive: async (pid, startedAt) => {
                const known = this.alive.get(`${pid}/${startedAt}`);
                if (known === undefined || known === "uncertain") {
                    throw new Error("liveness unknown");
                }
                return known;
            },
            ...extra,
        };
    }

    // One request of the scripted coordinator, recorded as a decision.
    async act(
        label: string,
        operation: StewardRequest["operation"],
        use: { controller?: Identity; deps?: Partial<StewardDeps> } = {},
    ): Promise<StewardReply> {
        const reply = await runSteward(
            {
                registry: this.registry,
                controller: use.controller ?? this.me,
                operation,
            },
            this.deps(use.deps),
        );
        this.decisions.push({
            scripted: true,
            label,
            op: operation.kind,
            code: reply.code,
            ok: reply.ok,
        });
        return reply;
    }

    // A scripted decision that asks the engine nothing (to stop, say).
    note(label: string): void {
        this.decisions.push({
            scripted: true,
            label,
            op: "none",
            code: null,
            ok: null,
        });
    }

    check(name: string, actual: unknown, expected: unknown): void {
        const a = JSON.stringify(actual);
        const e = JSON.stringify(expected);
        this.checks.push({
            name,
            ok: a === e,
            detail: a === e ? a : `got ${a}, want ${e}`,
        });
    }

    reportPath = (taskId: string) =>
        join(this.fixtureRoot, "reports", `${taskId}.md`);

    async brief(taskId: string, worker: Worker): Promise<TaskBrief> {
        const brief: TaskBrief = {
            taskId,
            workerId: worker.id,
            briefPath: join(this.fixtureRoot, "briefs", `${taskId}.md`),
            reportPath: this.reportPath(taskId),
            baseOid: this.baseOid,
        };
        await writeFile(
            brief.briefPath,
            [
                `# Task ${taskId}`,
                "",
                "Fix `slugify` in your clone to meet CONTRACT.md.",
                `Base: ${this.baseOid}`,
                `Write the report at ${brief.reportPath}.`,
                "",
            ].join("\n"),
        );
        return brief;
    }

    async dispatch(
        taskId: string,
        worker: Worker,
        label = "dispatch",
    ): Promise<StewardReply> {
        const brief = await this.brief(taskId, worker);
        return this.act(label, { kind: "dispatch", task: brief });
    }

    // Simulated workers: what herdr shows of one, its clone, its commits
    // and its reports.
    status(worker: Worker, status: string, terminalId?: string): void {
        const agent = herdrAgentOf(worker, status);
        agent.terminal_id =
            terminalId ?? this.cast.terminals[this.slotOf(worker)];
        this.herdr.agents.set(worker.name, agent);
    }

    async clone(worker: Worker): Promise<string> {
        let path = this.clones.get(worker.id);
        if (!path) {
            path = join(worker.cwd, "repo");
            await cloneOrigin(this.parts.origin, path, this.parts.ownerEnv);
            this.clones.set(worker.id, path);
        }
        return path;
    }

    private async rewrite(worker: Worker, fix: Fix): Promise<string> {
        const clone = await this.clone(worker);
        const file = join(clone, "src", "slug.ts");
        const source = await readFile(file, "utf8");
        await writeFile(file, source.replace(SOURCE_LINE, FIXES[fix]));
        return clone;
    }

    // The worker commits a fix in its clone: the new `HEAD`.
    async commit(worker: Worker, fix: Fix, tag = ""): Promise<string> {
        const clone = await this.rewrite(worker, fix);
        const oid = await commitAll(
            clone,
            `${worker.id}: ${fix} fix ${tag}`.trim(),
            this.parts.ownerEnv,
        );
        if (fix === "complete") {
            this.good.add(oid);
        }
        return oid;
    }

    // Changes the working tree and commits nothing.
    async edit(worker: Worker, fix: Fix): Promise<void> {
        await this.rewrite(worker, fix);
    }

    async head(worker: Worker): Promise<string> {
        return headOf(await this.clone(worker), this.parts.ownerEnv);
    }

    // Writes a report and returns its digest.
    async report(taskId: string, fields: ReportFields = {}): Promise<string> {
        const text = [
            `Task: ${fields.task ?? taskId}`,
            `Status: ${fields.status ?? "done"}`,
            `Base: ${this.baseOid}`,
            ...(fields.revision === null
                ? []
                : [`Revision: ${fields.revision}`]),
            `Verification: ${fields.verification ?? "bun src/example.ts exited 0"}`,
            ...(fields.extra ?? []),
            "",
        ].join("\n");
        await writeFile(this.reportPath(taskId), text);
        return sha256(text);
    }

    // The ledger, opened for a look (or the runner's receipt).
    ledger<T>(use: (db: ReturnType<typeof openLedger>) => T): T {
        const db = openLedger(
            ledgerPath(this.env, FLEET_ID),
            FLEET_ID,
            () => this.parts.now,
        );
        try {
            return use(db);
        } finally {
            db.close();
        }
    }

    tasks(): TaskRecord[] {
        return this.ledger((db) =>
            db.tasks().map(({ terminalId: _, ...task }) => task),
        );
    }

    task(taskId: string): TaskRecord | undefined {
        return this.tasks().find((t) => t.taskId === taskId);
    }

    stateOf(taskId: string): TaskState | undefined {
        return this.task(taskId)?.state;
    }

    // The runner's act: verify the worker's submission from its clone.
    async owner(taskId: string, worker: Worker): Promise<OwnerOutcome> {
        const task = this.task(taskId) as TaskRecord;
        const clone = await this.clone(worker);
        const db = openLedger(
            ledgerPath(this.env, FLEET_ID),
            FLEET_ID,
            () => this.parts.now,
        );
        try {
            return await verifySubmission(this.kit, task, clone, (r) =>
                db.recordReceipt(r),
            );
        } finally {
            db.close();
        }
    }

    // Then ask the engine to finish on the evidence the runner recorded.
    async ownerFinish(taskId: string, worker: Worker, as?: Identity) {
        const outcome = await this.owner(taskId, worker);
        const reply =
            outcome.kind === "receipt"
                ? await this.act(
                      "finish on the owner's evidence",
                      { kind: "finish", taskId, evidence: outcome.evidence },
                      { controller: as },
                  )
                : null;
        return { outcome, reply };
    }

    // What happened, measured from the fakes and the ledger.
    sends(): { taskId: string; args: string[] }[] {
        return this.sender.calls.map((call) => ({
            taskId: /for task (\S+)\.$/.exec(call.stdin ?? "")?.[1] ?? "?",
            args: call.args,
        }));
    }

    duplicateDispatches(): number {
        const count = new Map<string, number>();
        for (const { taskId } of this.sends()) {
            count.set(taskId, (count.get(taskId) ?? 0) + 1);
        }
        return [...count.values()].reduce((n, c) => n + Math.max(0, c - 1), 0);
    }

    // Verified in the ledger but not by the oracle: a revision the harness
    // never made complete, or one with no passing owner receipt.
    falseVerifiedTasks(): string[] {
        return this.ledger((db) =>
            db
                .tasks()
                .filter((t) => t.state === "verified")
                .filter(
                    (t) =>
                        !t.revision ||
                        !this.good.has(t.revision) ||
                        !db
                            .receipts(t.taskId)
                            .some(
                                (r) =>
                                    r.revision === t.revision &&
                                    r.exitCode === 0,
                            ),
                )
                .map((t) => t.taskId),
        );
    }

    async close(): Promise<void> {
        await rm(this.root, { recursive: true, force: true });
    }
}
