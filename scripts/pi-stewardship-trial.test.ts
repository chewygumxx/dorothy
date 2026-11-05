// vim:set expandtab shiftwidth=4 filetype=typescript:
// SPDX-License-Identifier: GPL-3.0-only

//
//
// ~chewygumxx/dorothy.git
// ::: :/scripts/pi-stewardship-trial.test.ts
//
//

// The live trial's runner, offline: a fake herdr that records every pane
// it is asked to create or close (and holds one pane of the user's own,
// which the runner must never touch), a fake clock, a scripted Pi that
// coordinates through the real engine and asks a loopback fake provider
// through the runner's proxy, and simulated workers committing in real
// clones. No real pane, worker, network or user root is touched; the
// live run itself is never made here.

import { afterAll, describe, expect, it } from "bun:test";
import { createHash } from "node:crypto";
import {
    chmod,
    mkdir,
    mkdtemp,
    readdir,
    readFile,
    realpath,
    rm,
    stat,
    writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { runSteward } from "../packages/cli/src/hosts/pi/steward/engine.js";
import type { HerdrRun } from "../packages/cli/src/hosts/pi/steward/herdr.js";
import {
    ledgerPath,
    openLedger,
} from "../packages/cli/src/hosts/pi/steward/ledger.js";
import { commitAll } from "../packages/cli/src/hosts/pi/steward/owner.js";
import {
    FIXES,
    SOURCE_LINE,
} from "../packages/cli/src/hosts/pi/steward/simulation.js";
import type {
    StewardReply,
    StewardRequest,
} from "../packages/cli/src/hosts/pi/steward/types.js";
import {
    type Chunk,
    type FakeProvider,
    finish,
    MODEL,
    SYNTHETIC_KEY,
    said,
    startFakeProvider,
} from "../packages/cli/src/hosts/pi/testing.js";
import { startForwardingProxy } from "./pi-proxy.js";
import {
    layoutOf,
    operatorRelease,
    preflight,
    runTrial,
    type TrialArgs,
    type TrialDeps,
    type TrialResult,
} from "./pi-stewardship-trial.js";

const roots: string[] = [];
const providers: FakeProvider[] = [];

// The briefs are sealed read-only while the trial runs; teardown makes
// every directory writable again, then removes only its own root.
async function unseal(dir: string): Promise<void> {
    await chmod(dir, 0o700).catch(() => {});
    for (const entry of await readdir(dir, { withFileTypes: true }).catch(
        () => [],
    )) {
        if (entry.isDirectory()) await unseal(join(dir, entry.name));
    }
}

afterAll(async () => {
    for (const provider of providers) await provider.close();
    for (const root of roots) {
        await unseal(root);
        await rm(root, { recursive: true, force: true });
    }
});

const UPSTREAM_KEY = "upstream-fixture-key-0123456789";
const START = Date.parse("2026-11-05T10:00:00.000Z");
const PI_SELF = { pid: 4242, startedAt: "fake-pi" };
// A pane of the user's own development fleet, in its own workspace.
const FOREIGN = "w9:p1";

type Reply = { code: number; stdout: string; stderr: string };
const json = (body: unknown, code = 0): Reply => ({
    code,
    stdout: `${JSON.stringify(body)}\n`,
    stderr: "",
});
const herdrError = (code: string) =>
    json({ error: { code, message: code }, id: "cli" }, 1);

type Agent = {
    name: string | undefined;
    kind: string;
    status: string;
    terminal: string;
    process: number;
};
type Pane = {
    id: string;
    workspace: string;
    cwd: string;
    env: Record<string, string>;
    agent: Agent | null;
    terminal: string;
    text: string;
    typed: string;
};

type Job = { taskId: string; brief: string; ticks: number; prepared?: boolean };

// The fake herdr and everything behind it: panes, agents, a scripted Pi
// (once its pane runs the launcher) and the two workers' jobs.
class World {
    clock = START;
    panes = new Map<string, Pane>();
    created: string[] = [];
    closed: string[] = [];
    closedWorkspaces: string[] = [];
    calls: string[][] = [];
    // A herdr reply to give instead, where the test breaks a command.
    fail: ((args: string[]) => Reply | null) | null = null;
    jobs = new Map<string, Job>();
    pi: FakePi | null = null;
    onInterrupt: (() => void) | null = null;
    onAgentStart: (() => void) | null = null;
    secret: string | null = null;
    piBanner = true;
    piLive = true;
    stderrNotReady = false;
    emptyMutations = false;
    shellEchoOnly = false;
    retainStoppedAgent = false;
    compactionAcknowledges = true;
    tamperField: "fleetId" | "fixtureRoot" | null = null;
    reviewOverride: ((taskId: string, approved: boolean) => boolean) | null =
        null;
    // What the upstream had been asked when Pi was first refused.
    upstreamCount: () => number = () => 0;
    upstreamAtFirstRefusal = -1;
    private nextWorkspace = 4;
    private nextTerminal = 1;
    private nextProcess = 5100;
    private nextPane = new Map<string, number>();

    constructor() {
        this.panes.set(FOREIGN, {
            id: FOREIGN,
            workspace: "w9",
            cwd: "/home/user/dev/dorothy",
            env: {},
            agent: {
                name: "dev-claude",
                kind: "claude",
                status: "idle",
                terminal: "term_0000000000000ff",
                process: 5099,
            },
            terminal: "term_0000000000000ff",
            text: "the user's own session",
            typed: "",
        });
    }

    now = () => new Date(this.clock);

    terminal() {
        return `term_${String(this.nextTerminal++).padStart(15, "0")}`;
    }

    private pane(workspace: string, cwd: string, env: Record<string, string>) {
        const n = (this.nextPane.get(workspace) ?? 0) + 1;
        this.nextPane.set(workspace, n);
        const id = `${workspace}:p${n}`;
        this.panes.set(id, {
            id,
            workspace,
            cwd,
            env,
            agent: null,
            terminal: this.terminal(),
            text: "",
            typed: "",
        });
        this.created.push(id);
        return id;
    }

    find(target: string): Pane | undefined {
        return [...this.panes.values()].find(
            (pane) =>
                pane.id === target ||
                (pane.agent !== null && pane.agent.name === target),
        );
    }

    agentInfo(pane: Pane): Reply {
        const agent = pane.agent as Agent;
        return json({
            id: "cli:agent:get",
            result: {
                type: "agent_info",
                agent: {
                    agent: agent.kind,
                    agent_status: agent.status,
                    cwd: pane.cwd,
                    focused: false,
                    foreground_cwd: pane.cwd,
                    ...(agent.name ? { name: agent.name } : {}),
                    pane_id: pane.id,
                    revision: 1,
                    state_change_seq: 1,
                    tab_id: `${pane.workspace}:t1`,
                    terminal_id: agent.terminal,
                    terminal_title: "trial",
                    terminal_title_stripped: "trial",
                    workspace_id: pane.workspace,
                },
            },
        });
    }

    processInfo(pane: Pane): Reply {
        return json({
            id: "cli:pane:process-info",
            result: {
                process_info: {
                    foreground_process_group_id: pane.agent?.process ?? 0,
                    foreground_processes: [],
                    shell_pid: 5000,
                },
            },
        });
    }

    herdr: HerdrRun = async (args) => {
        this.calls.push([...args]);
        const broken = this.fail?.(args);
        if (broken) return broken;
        const [noun, verb] = args;
        const flag = (name: string) => {
            const at = args.indexOf(name);
            return at < 0 ? undefined : args[at + 1];
        };
        if (noun === "workspace" && verb === "create") {
            const workspace = `w${this.nextWorkspace++}`;
            const root = this.pane(workspace, flag("--cwd") ?? "/", {});
            return json({
                id: "cli:workspace:create",
                result: {
                    workspace: { workspace_id: workspace },
                    tab: { tab_id: `${workspace}:t1` },
                    root_pane: { pane_id: root },
                },
            });
        }
        if (noun === "pane" && verb === "split") {
            const from = this.panes.get(flag("--pane") ?? "");
            if (!from) return herdrError("pane_not_found");
            const env: Record<string, string> = {};
            args.forEach((word, at) => {
                if (word === "--env") {
                    const [key, ...value] = (args[at + 1] ?? "").split("=");
                    env[key as string] = value.join("=");
                }
            });
            const id = this.pane(from.workspace, flag("--cwd") ?? "/", env);
            return json({
                id: "cli:pane:split",
                result: { pane: { pane_id: id } },
            });
        }
        if (noun === "pane" && verb === "close") {
            const id = args[2] as string;
            if (!this.panes.delete(id)) return herdrError("pane_not_found");
            this.closed.push(id);
            return json({ id: "cli:pane:close", result: {} });
        }
        if (noun === "pane" && verb === "list") {
            const workspace = flag("--workspace");
            return json({
                id: "cli:pane:list",
                result: {
                    panes: [...this.panes.values()]
                        .filter((pane) => pane.workspace === workspace)
                        .map((pane) => ({ pane_id: pane.id })),
                },
            });
        }
        if (noun === "workspace" && verb === "close") {
            this.closedWorkspaces.push(args[2] as string);
            return json({ id: "cli:workspace:close", result: {} });
        }
        if (noun === "pane" && verb === "process-info") {
            const pane = this.panes.get(flag("--pane") ?? "");
            return pane?.agent
                ? this.processInfo(pane)
                : herdrError("pane_not_found");
        }
        if (noun === "agent" && verb === "start") {
            this.onAgentStart?.();
            const pane = this.panes.get(flag("--pane") ?? "");
            if (!pane || (pane.agent && pane.agent.process !== 0))
                return herdrError("pane_not_available");
            pane.agent = {
                name: args[2],
                kind: flag("--kind") ?? "?",
                status: "idle",
                terminal: pane.terminal,
                process: ++this.nextProcess,
            };
            pane.text = `${pane.agent.kind} ready\n`;
            if (this.stderrNotReady) {
                return {
                    code: 1,
                    stdout: "",
                    stderr: JSON.stringify({
                        error: { code: "agent_not_ready" },
                    }),
                };
            }
            return json({ id: "cli:agent:start", result: { type: "ok" } });
        }
        if (noun === "agent" && verb === "get") {
            const pane = this.find(args[2] as string);
            return pane?.agent
                ? this.agentInfo(pane)
                : herdrError("agent_not_found");
        }
        if (noun === "agent" && verb === "read") {
            const pane = this.find(args[2] as string);
            return pane?.agent
                ? { code: 0, stdout: pane.text, stderr: "" }
                : herdrError("agent_not_found");
        }
        if (noun === "pane" && verb === "read") {
            const pane = this.panes.get(args[2] as string);
            return pane
                ? { code: 0, stdout: pane.text, stderr: "" }
                : herdrError("pane_not_found");
        }
        if (noun === "agent" && verb === "send-keys") {
            const pane = this.find(args[2] as string);
            if (!pane?.agent) return herdrError("agent_not_found");
            if (args[3] === "ctrl+c") {
                // The process is gone. Herdr may retain the old name for a
                // moment; process identity, not that name, proves the exit.
                this.jobs.delete(pane.agent.name as string);
                if (this.retainStoppedAgent) {
                    pane.agent.process = 0;
                    pane.agent.status = "done";
                } else {
                    pane.agent = null;
                }
                pane.text += "\n$ ";
            }
            return json({ id: "cli:agent:send-keys", result: {} });
        }
        if (noun === "pane" && verb === "run") {
            const pane = this.panes.get(args[2] as string);
            if (!pane) return herdrError("pane_not_found");
            await this.launch(pane, args.slice(3).join(" "));
            return json({ id: "cli:pane:run", result: {} });
        }
        if (noun === "pane" && verb === "send-text") {
            const pane = this.panes.get(args[2] as string);
            if (!pane) return herdrError("pane_not_found");
            pane.typed += args[3] ?? "";
            return this.emptyMutations
                ? { code: 0, stdout: "", stderr: "" }
                : json({ id: "cli:pane:send-text", result: {} });
        }
        if (noun === "pane" && verb === "send-keys") {
            const pane = this.panes.get(args[2] as string);
            if (!pane) return herdrError("pane_not_found");
            if (args[3] === "enter") {
                const text = pane.typed;
                pane.typed = "";
                if (this.pi && pane.id === this.pi.pane) {
                    await this.pi.turn(text);
                } else {
                    const ready = /DOROTHY_WORKER_READY_[a-z-]+/.exec(text);
                    if (this.shellEchoOnly) pane.text += `\n$ ${text}\n`;
                    else if (ready) pane.text += `\n${ready[0]}\n`;
                }
            }
            return this.emptyMutations
                ? { code: 0, stdout: "", stderr: "" }
                : json({ id: "cli:pane:send-keys", result: {} });
        }
        return { code: 2, stdout: "", stderr: `fake herdr: ${args.join(" ")}` };
    };

    // The launcher: the plan it names, and a scripted Pi on the pane.
    async launch(pane: Pane, command: string) {
        const script = await readFile(command.trim(), "utf8");
        const plan = JSON.parse(
            await readFile(
                (/'([^']+plan\.json)'/.exec(script)?.[1] ?? "") as string,
                "utf8",
            ),
        );
        pane.agent = this.piLive
            ? {
                  name: undefined,
                  kind: "pi",
                  status: "idle",
                  terminal: pane.terminal,
                  process: ++this.nextProcess,
              }
            : null;
        pane.text = this.piBanner ? "pi v1.5.0\n" : "$ shell\n";
        if (this.secret) {
            const sessions = join(
                dirname(plan.steward),
                "pi/data/dorothy/pi/sessions",
            );
            await mkdir(sessions, { recursive: true });
            await writeFile(
                join(sessions, "session.jsonl"),
                `${JSON.stringify({ text: this.secret })}\n`,
            );
        }
        this.pi = new FakePi(this, pane.id, plan, this.script);
    }

    // What the scripted Pi does, set by the test before the run.
    script: Behaviour = "coordinate";

    // The sender: a labelled pointer reaches the worker, which starts.
    sender: HerdrRun = async (args, options) => {
        const name = args.at(-1) as string;
        const pane = this.find(name);
        const [, brief, taskId] =
            /^Read (\S+) for task (\S+)\.$/.exec(options.stdin ?? "") ?? [];
        if (!pane?.agent || !taskId)
            return { code: 6, stdout: "", stderr: "not idle" };
        if (pane.agent.status !== "idle")
            return { code: 6, stdout: "", stderr: "not idle" };
        pane.agent.status = "working";
        this.jobs.set(name, { taskId, brief: brief as string, ticks: 15 });
        return { code: 0, stdout: "", stderr: "" };
    };

    // One step of the workers and of Pi.
    async tick() {
        for (const [name, job] of [...this.jobs]) {
            if (--job.ticks > 0) continue;
            const pane = this.find(name);
            const finished = await work(this, pane as Pane, job);
            if (!finished) {
                job.ticks = 1;
                continue;
            }
            this.jobs.delete(name);
            if (pane?.agent) pane.agent.status = "idle";
        }
        await this.pi?.tick();
    }
}

type Behaviour = "coordinate" | "chatter" | "quiet" | "tamper";

const git = (cwd: string, ...args: string[]) => {
    const ran = Bun.spawnSync(["git", ...args], {
        cwd,
        env: {
            PATH: process.env.PATH ?? "",
            HOME: cwd,
            GIT_CONFIG_NOSYSTEM: "1",
            GIT_CONFIG_GLOBAL: "/dev/null",
        },
    });
    if (ran.exitCode !== 0) throw new Error(ran.stderr.toString());
    return ran.stdout.toString().trim();
};

const field = (text: string, name: string) =>
    new RegExp(`^${name}:[ \\t]*(\\S+)`, "m").exec(text)?.[1] ?? null;

// A worker doing its brief: the implementer commits the incomplete fix
// first and the complete one after a review; the reviewer checks out the
// revision named by the latest fix report and judges it.
async function work(world: World, pane: Pane, job: Job) {
    const brief = await readFile(job.brief, "utf8");
    const report = field(brief, "Report") as string;
    const base = field(brief, "Base") as string;
    const env = { PATH: process.env.PATH ?? "", home: pane.cwd };
    if (world.secret) pane.text += `\n${world.secret}\n`;
    if (job.taskId.startsWith("fix-")) {
        const file = join(pane.cwd, "src", "slug.ts");
        const fix = job.taskId.startsWith("fix-1") ? "incomplete" : "complete";
        let revision = "";
        if (!job.prepared) {
            const source = await readFile(file, "utf8");
            await writeFile(file, source.replace(SOURCE_LINE, FIXES[fix]));
            revision = await commitAll(pane.cwd, job.taskId, env);
            job.prepared = true;
        } else {
            revision = git(pane.cwd, "rev-parse", "HEAD");
        }
        const checkpoint = /^Checkpoint: (\S+)$/m.exec(brief)?.[1];
        if (checkpoint && !(await stat(checkpoint).catch(() => null)))
            return false;
        await writeFile(
            report,
            [
                `Task: ${job.taskId}`,
                "Status: done",
                `Base: ${base}`,
                `Revision: ${revision}`,
                `Verification: bun src/example.ts: examples pass ${world.secret ?? ""}`,
                "",
            ].join("\n"),
        );
        return true;
    }
    const reviewed = /^Review: (.+)$/m
        .exec(brief)?.[1]
        ?.split(/,\s*/)
        .map((path) => path.trim());
    let revision = "";
    let implementer = "";
    for (const path of reviewed ?? []) {
        const text = await readFile(path, "utf8").catch(() => null);
        if (text) {
            revision = field(text, "Revision") ?? "";
            break;
        }
    }
    implementer = field(brief, "Implementer") as string;
    git(
        pane.cwd,
        "fetch",
        "-q",
        implementer,
        "+refs/heads/*:refs/remotes/impl/*",
    );
    git(pane.cwd, "checkout", "-q", "--detach", revision);
    const source = await readFile(join(pane.cwd, "src", "slug.ts"), "utf8");
    const approved =
        world.reviewOverride?.(job.taskId, source.includes("normalize")) ??
        source.includes("normalize");
    await writeFile(
        report,
        [
            `Task: ${job.taskId}`,
            `Status: ${approved ? "approved" : "changes-requested"}`,
            `Base: ${base}`,
            `Revision: ${revision}`,
            `Findings: ${approved ? "none" : "diacritics are not folded"} ${world.secret ?? ""}`,
            "",
        ].join("\n"),
    );
    void world;
    return true;
}

// The coordinator as a script: each step asks the provider once through
// the runner's proxy, then acts through the real engine, as her tools do.
class FakePi {
    turns: string[] = [];
    calls = 0;
    refused = 0;
    started = false;
    compacted = false;
    finalAsked = false;
    constructor(
        readonly world: World,
        readonly pane: string,
        readonly plan: {
            env: Record<string, string>;
            baseUrl: string;
            steward: string;
        },
        readonly behaviour: Behaviour,
    ) {}

    async ask(): Promise<boolean> {
        const response = await fetch(`${this.plan.baseUrl}/chat/completions`, {
            method: "POST",
            headers: {
                "content-type": "application/json",
                authorization: `Bearer ${SYNTHETIC_KEY}`,
            },
            body: JSON.stringify({
                model: MODEL,
                messages: [{ role: "system", content: "s" }],
                max_completion_tokens: 1000,
                stream: true,
            }),
        });
        await response.text();
        if (response.ok) this.calls++;
        else if (this.refused++ === 0)
            this.world.upstreamAtFirstRefusal = this.world.upstreamCount();
        return response.ok;
    }

    steward(operation: StewardRequest["operation"]): Promise<StewardReply> {
        return runSteward(
            { registry: this.plan.steward, controller: PI_SELF, operation },
            {
                env: this.plan.env,
                now: this.world.now,
                run: this.world.herdr,
                controllerAlive: async () => true,
                sender: this.world.sender,
                self: PI_SELF,
                occupantStart: async (pid) => `boot:${pid}`,
            },
        );
    }

    async turn(text: string) {
        this.turns.push(text);
        if (text === "/compact") {
            await this.ask();
            this.compacted = true;
            const pane = this.world.panes.get(this.pane) as Pane;
            if (this.world.compactionAcknowledges)
                pane.text += "Compacted from 12k tokens\n";
            return;
        }
        if (!this.started) {
            this.started = true;
            this.kickoff = text;
        }
        if (/coordinator\.md/.test(text) && this.behaviour === "coordinate") {
            this.finalAsked = true;
        }
        await this.ask();
    }

    kickoff = "";

    // The briefs the kickoff names, by task id: worker, brief, report.
    briefs(): Map<string, { worker: string; brief: string; report: string }> {
        const found = new Map();
        for (const match of this.kickoff.matchAll(
            /(\S+) to (\S+): brief (\S+) report (\S+);/g,
        )) {
            found.set(match[1], {
                worker: match[2],
                brief: match[3],
                report: match[4],
            });
        }
        return found;
    }

    async tick() {
        if (!this.started) return;
        if (this.behaviour === "quiet") return;
        if (this.behaviour === "chatter") {
            await this.ask();
            return;
        }
        if (this.behaviour === "tamper") {
            // Her shell could write the registry: a pane of the user's.
            const registry = JSON.parse(
                await readFile(this.plan.steward, "utf8"),
            );
            if (this.world.tamperField) {
                registry[this.world.tamperField] =
                    this.world.tamperField === "fleetId"
                        ? "00000000-0000-4000-8000-0000000000f9"
                        : "/tmp";
                await writeFile(this.plan.steward, JSON.stringify(registry));
            } else if (registry.workers.length === 2) {
                registry.workers.push({
                    ...registry.workers[0],
                    id: "dev-claude",
                    name: "dev-claude",
                    pane: FOREIGN,
                });
                await writeFile(this.plan.steward, JSON.stringify(registry));
            }
            return;
        }
        const reconciled = await this.steward({ kind: "reconcile" });
        const tasks = new Map(
            (reconciled.tasks ?? []).map((task) => [task.taskId, task]),
        );
        const base = /baseOid ([0-9a-f]+)/.exec(this.kickoff)?.[1] as string;
        const briefs = this.briefs();
        const final = (id: string) =>
            ["verified", "failed", "cancelled"].includes(
                tasks.get(id)?.state ?? "",
            );
        const active = [...tasks.values()].some(
            (task) => !["verified", "failed", "cancelled"].includes(task.state),
        );
        if (this.finalAsked) {
            this.finalAsked = false;
            const report = /write (\S+coordinator\.md)/.exec(
                this.turns.at(-1) ?? "",
            )?.[1] as string;
            await writeFile(
                report,
                [...tasks.values()]
                    .map((task) => `${task.taskId}: ${task.state}`)
                    .join("\n"),
            );
            await this.ask();
            return;
        }
        if (active) return;
        const order = ["fix-1", "fix-1b", "review-1", "fix-2", "review-2"];
        const next = order.find((id) => {
            if (tasks.has(id)) return false;
            if (id === "fix-1b") return tasks.get("fix-1")?.state === "failed";
            if (id === "review-1")
                return (
                    final("fix-1b") || tasks.get("fix-1")?.state === "verified"
                );
            if (id === "fix-2") return final("review-1");
            if (id === "review-2") return final("fix-2");
            return true;
        });
        if (!next) return;
        const planned = briefs.get(next);
        if (!planned) return;
        if (!(await this.ask())) return;
        await this.steward({
            kind: "dispatch",
            task: {
                taskId: next,
                workerId: planned.worker,
                briefPath: planned.brief,
                reportPath: planned.report,
                baseOid: base,
            },
        });
    }
}

// A private trial directory with both worker homes signed in, as the
// user's checklist leaves it.
async function trialDir(options: { homes?: boolean } = {}) {
    const root = await realpath(
        await mkdtemp(join(tmpdir(), "dorothy-trial-test-")),
    );
    roots.push(root);
    const trial = join(root, "trial");
    await mkdir(trial, { mode: 0o700 });
    if (options.homes !== false) {
        for (const home of ["codex", "claude"]) {
            await mkdir(join(trial, "homes", home), {
                recursive: true,
                mode: 0o700,
            });
            await chmod(join(trial, "homes"), 0o700);
        }
    }
    return {
        root,
        trial,
        args: {
            registry: join(trial, "registry.json"),
            out: join(root, "out"),
            maxUsd: 5,
            maxTurns: 30,
            timeoutMs: 1_800_000,
        } satisfies TrialArgs,
    };
}

type Upstream = Chunk[] | { status: number; body: string };
const replyWith = (prompt: number): Chunk[] => [
    said("ok"),
    finish("stop"),
    {
        id: "chatcmpl-fixture",
        object: "chat.completion.chunk",
        created: 0,
        model: MODEL,
        choices: [],
        usage: { prompt_tokens: prompt, completion_tokens: 5 },
    },
];

function depsFor(
    world: World,
    upstream: (index: number) => Upstream = () => replyWith(10),
): { deps: TrialDeps; provider: FakeProvider } {
    const provider = startFakeProvider((_, index) => upstream(index));
    providers.push(provider);
    world.upstreamCount = () => provider.requests.length;
    const deps: TrialDeps = {
        env: {
            PATH: process.env.PATH ?? "",
            HOME: "/nonexistent-home",
            HERDR_ENV: "1",
            HERDR_SOCKET_PATH: "/nonexistent/herdr.sock",
        },
        now: world.now,
        sleep: async (ms) => {
            world.clock += ms;
            await world.tick();
        },
        platform: "linux",
        uid: process.getuid?.() ?? 0,
        herdr: world.herdr,
        interruptWorker: async (worker, pin) => {
            world.onInterrupt?.();
            const agent = world.find(worker.name)?.agent;
            const occupant = agent
                ? {
                      kind: "process",
                      pid: agent.process,
                      startedAt: `boot:${agent.process}`,
                  }
                : null;
            if (
                agent?.terminal !== pin.terminalId ||
                JSON.stringify(occupant) !== JSON.stringify(pin.occupant)
            ) {
                return { code: 9, stdout: "", stderr: "occupant changed" };
            }
            return world.herdr(["agent", "send-keys", worker.name, "ctrl+c"], {
                env: {},
                signal: new AbortController().signal,
            });
        },
        loginStatus: async (harness) => ({
            loggedIn: true,
            detail: `${harness}: logged in (fixture)`,
        }),
        startProxy: (options) =>
            startForwardingProxy({
                ...options,
                now: () => world.clock,
            }),
        upstream: async () => ({ url: provider.baseUrl, key: UPSTREAM_KEY }),
        metadata: async () => ({
            checkedAt: world.now().toISOString(),
            source: "fake catalogue",
            found: true,
            contextWindow: 262144,
            maxTokens: 32768,
            price: { input: 0.225, output: 0.9 },
            drift: [],
        }),
        memory: async () => ({
            url: "http://127.0.0.1:9",
            stop: async () => {},
        }),
        versions: async () => ({ pi: "1.5.0", herdr: "fixture" }),
        alive: async (pid, startedAt) => {
            if (pid === PI_SELF.pid || pid === process.pid) return true;
            return [...world.panes.values()].some(
                (pane) =>
                    pane.agent?.process === pid && startedAt === `boot:${pid}`,
            );
        },
        workerHomeMatches: async () => true,
        occupantStart: async (pid) => `boot:${pid}`,
        self: { pid: process.pid, startedAt: "runner" },
    };
    return { deps, provider };
}

const sorted = (values: string[]) => [...values].sort();

// The panes the runner made: the trial's own workspace, never w9.
const trialPanes = (world: World) =>
    world.created.filter((pane) => !pane.startsWith("w9:"));

async function evidence(out: string) {
    return {
        result: JSON.parse(
            await readFile(join(out, "result.json"), "utf8"),
        ) as TrialResult,
        events: (await readFile(join(out, "events.jsonl"), "utf8"))
            .trim()
            .split("\n")
            .map((line) => JSON.parse(line) as { kind: string }),
    };
}

describe("before anything starts", () => {
    it("leaves the gate pending with the user's checklist when no worker home is signed in", async () => {
        const world = new World();
        const { trial, args } = await trialDir({ homes: false });
        const { deps } = depsFor(world);
        const result = await runTrial(args, deps);
        expect(result.status).toBe("pending");
        expect(result.kind).toBe("not-run");
        expect(result.note).toContain("Not run");
        expect(world.calls).toEqual([]);
        // The checklist returned to the user keeps its paths; the copy
        // left in --out does not.
        expect(result.pending.join("\n")).toContain(trial);
        const kept = await Promise.all(
            ["result.json", "events.jsonl", "report.md"].map((name) =>
                readFile(join(args.out, name), "utf8"),
            ),
        );
        expect(kept.join("\n")).not.toContain(trial);
        expect(kept.join("\n")).not.toContain(args.out);
        const text = result.pending.join("\n");
        expect(text).toContain("CODEX_HOME=");
        expect(text).toContain("codex login");
        expect(text).toContain("CLAUDE_CONFIG_DIR=");
        expect(text).toContain("claude auth login");
        // What the runner fills itself, so the user need not.
        expect(text).toContain("pane");
        expect(text).toContain("expiresAt");
    });

    it("refuses homes it cannot trust, a shared trial directory and an unproven login", async () => {
        const world = new World();
        const { trial, args } = await trialDir();
        await chmod(join(trial, "homes", "claude"), 0o755);
        const { deps } = depsFor(world);
        deps.loginStatus = async (harness) => ({
            loggedIn: harness === "claude",
            detail: "not logged in",
        });
        const checked = await preflight(args, deps);
        expect(checked.ok).toBe(false);
        const problems = checked.ok ? [] : checked.problems;
        expect(problems.join("\n")).toContain("homes/claude");
        expect(problems.join("\n")).toContain("codex");
        await chmod(trial, 0o755);
        const again = await preflight(args, deps);
        expect(again.ok ? [] : again.problems.join("\n")).toContain("private");
        expect(world.calls).toEqual([]);
    });

    it("refuses evidence inside the trial directory and an earlier trial's leftovers", async () => {
        const world = new World();
        const { trial, args } = await trialDir();
        const { deps } = depsFor(world);
        const inside = await preflight(
            { ...args, out: join(trial, "out") },
            deps,
        );
        expect(inside.ok).toBe(false);
        await writeFile(join(trial, "registry.json"), "{}");
        const leftover = await preflight(args, deps);
        expect(leftover.ok ? "" : leftover.problems.join("\n")).toContain(
            "registry.json",
        );
    });

    it("never runs past the caps", async () => {
        const world = new World();
        const { args } = await trialDir();
        const { deps } = depsFor(world);
        const over = await preflight({ ...args, maxTurns: 31 }, deps);
        expect(over.ok).toBe(false);
        const longer = await preflight({ ...args, timeoutMs: 1_800_001 }, deps);
        expect(longer.ok).toBe(false);
        const unpaid = await preflight({ ...args, maxUsd: 0 }, deps);
        expect(unpaid.ok).toBe(false);
    });

    it("checks required executables before loading a key or making panes", async () => {
        const world = new World();
        const { args } = await trialDir();
        const { deps, provider } = depsFor(world);
        deps.preflightAssets = async () => [
            "missing runtime executable: flock",
        ];
        let keys = 0;
        const upstream = deps.upstream;
        deps.upstream = async () => {
            keys++;
            return upstream();
        };
        const result = await runTrial(args, deps);
        expect(result.status).toBe("pending");
        expect(result.pending.join("\n")).toContain("flock");
        expect(keys).toBe(0);
        expect(provider.requests).toEqual([]);
        expect(trialPanes(world)).toEqual([]);
    });

    it("includes preflight in the one absolute wall deadline", async () => {
        const world = new World();
        const { args } = await trialDir();
        const { deps, provider } = depsFor(world);
        deps.loginStatus = async () => {
            world.clock += 6_000;
            return { loggedIn: true, detail: "signed in" };
        };
        let keys = 0;
        const upstream = deps.upstream;
        deps.upstream = async () => {
            keys++;
            return upstream();
        };
        const result = await runTrial({ ...args, timeoutMs: 10_000 }, deps);
        expect(result.status).toBe("pending");
        expect(result.kind).toBe("not-run");
        expect(result.pending.join("\n")).toContain("deadline");
        expect(keys).toBe(0);
        expect(provider.requests).toEqual([]);
        expect(trialPanes(world)).toEqual([]);
    });

    it("refuses missing, drifted or invalid catalogue metadata before spending", async () => {
        for (const mode of ["missing", "drift", "invalid"]) {
            const world = new World();
            const { args } = await trialDir();
            const { deps, provider } = depsFor(world);
            const metadata = await deps.metadata();
            if (!metadata) throw new Error("fixture catalogue missing");
            deps.metadata = async () =>
                mode === "missing"
                    ? null
                    : {
                          ...metadata,
                          drift: mode === "drift" ? ["price changed"] : [],
                          maxTokens: mode === "invalid" ? -1 : 32768,
                      };
            let keys = 0;
            const upstream = deps.upstream;
            deps.upstream = async () => {
                keys++;
                return upstream();
            };
            const result = await runTrial(args, deps);
            expect(result.status).not.toBe("pass");
            expect(result.error).toContain("catalogue refused");
            expect(keys).toBe(0);
            expect(provider.requests).toEqual([]);
            expect(trialPanes(world)).toEqual([]);
        }
    });
});

describe("a trial on fakes", () => {
    it("runs the cycle, cleans up only what it created and records the evidence", async () => {
        const world = new World();
        const { trial, args } = await trialDir();
        const { deps, provider } = depsFor(world);
        const result = await runTrial(args, deps);
        const createdFixturePanes = trialPanes(world);
        const cleanedPanes = world.closed;

        expect(result.checks.filter((c) => c.ok === false)).toEqual([]);
        expect(result.status).toBe("pass");
        // Three panes, all its own; the user's pane untouched.
        expect(createdFixturePanes.length).toBe(3);
        expect(sorted(cleanedPanes)).toEqual(sorted(createdFixturePanes));
        expect(world.panes.has(FOREIGN)).toBe(true);
        expect(world.calls.filter((call) => call.includes(FOREIGN))).toEqual(
            [],
        );

        // The registry it wrote, from the creation replies, with expiry.
        const registry = JSON.parse(
            await readFile(join(trial, "registry.json"), "utf8"),
        );
        expect(
            sorted(registry.workers.map((w: { pane: string }) => w.pane)),
        ).toEqual(sorted(createdFixturePanes.slice(1)));
        for (const worker of registry.workers) {
            const expires =
                Date.parse(worker.expiresAt) - Date.parse(worker.observedAt);
            expect(expires).toBeGreaterThan(args.timeoutMs);
            expect(expires).toBeLessThanOrEqual(60 * 60_000);
        }
        expect((await stat(join(trial, "registry.json"))).mode & 0o077).toBe(0);
        // Each worker's home went to its own pane, as a path alone.
        const envs = [...world.calls]
            .filter((call) => call[0] === "pane" && call[1] === "split")
            .map((call) => call[call.indexOf("--env") + 1]);
        expect(envs).toEqual([
            `CODEX_HOME=${join(trial, "homes", "codex")}`,
            `CLAUDE_CONFIG_DIR=${join(trial, "homes", "claude")}`,
        ]);

        // Briefs: private, immutable, digested before any dispatch.
        for (const brief of result.briefs) {
            const text = await readFile(brief.path);
            expect(
                `sha256:${createHash("sha256").update(text).digest("hex")}`,
            ).toBe(brief.digest);
            expect((await stat(brief.path)).mode & 0o222).toBe(0);
        }

        const firstBrief = await readFile(
            result.briefs.find((brief) => brief.taskId === "fix-1")
                ?.path as string,
            "utf8",
        );
        expect(firstBrief).toContain("TRIAL-ONLY DECLARED PARTIAL CANDIDATE");
        expect(firstBrief).toContain("do not add Unicode normalization");
        expect(firstBrief).toContain("Checkpoint:");
        const finalBrief = await readFile(
            result.briefs.find((brief) => brief.taskId === "fix-2")
                ?.path as string,
            "utf8",
        );
        expect(finalBrief).not.toContain("Checkpoint:");
        expect(
            await stat(
                join(
                    layoutOf(args.registry, args.out).checkpoints,
                    "fix-1.ready",
                ),
            ).catch(() => null),
        ).toBeNull();
        expect(result.checkpoints).toHaveLength(1);
        expect(result.checkpoints[0]).toMatchObject({
            taskId: "fix-1b",
            state: "running",
        });
        expect(
            result.interventions.findIndex(
                (entry) => entry.kind === "compaction",
            ),
        ).toBeLessThan(
            result.interventions.findIndex(
                (entry) => entry.kind === "fixture-checkpoint",
            ),
        );

        // The cycle: an interrupted worker released by the runner, the
        // incomplete fix caught, the review loop and the final fix.
        expect(result.tasks.map((t) => [t.taskId, t.state])).toEqual([
            ["fix-1", "failed"],
            ["fix-1b", "failed"],
            ["review-1", "failed"],
            ["fix-2", "verified"],
            ["review-2", "verified"],
        ]);
        expect(result.interruption?.exited).toBe(true);
        expect(result.interruption?.terminalChanged).toBe(false);
        expect(result.interventions.map((i) => [i.by, i.kind])).toEqual(
            expect.arrayContaining([
                ["runner", "worker-interruption"],
                ["runner", "operator-release"],
                ["runner", "compaction"],
            ]),
        );
        expect(result.compaction?.confirmed).toBe(true);
        expect(result.reviewLoop.status).toBe("exercised");
        expect(result.reviewLoop.incompleteFix).toBe("fix-1b");
        expect(
            result.reviews.map((r) => [r.taskId, r.verdict, r.agree]),
        ).toEqual([
            ["review-1", "changes-requested", true],
            ["review-2", "approved", true],
        ]);
        expect(result.duplicateAssignments).toBe(0);
        expect(result.finalRevision?.taskId).toBe("fix-2");
        expect(result.finalRevision?.examplesPassed).toBe(true);
        expect(result.honesty?.mismatches).toEqual([]);
        // Cost from measured usage, every call accounted.
        expect(result.cost.unmeasuredCalls).toBe(0);
        expect(result.cost.measuredUsd).not.toBeNull();
        expect(result.cost.calls).toBe(provider.requests.length);

        // Pi got the synthetic key alone; no file of the evidence holds
        // the upstream key.
        expect(
            provider.requests.every(
                (r) => r.authorization === `Bearer ${UPSTREAM_KEY}`,
            ),
        ).toBe(true);
        const { events } = await evidence(args.out);
        expect(events.map((e) => e.kind)).toEqual(
            expect.arrayContaining([
                "preflight",
                "created",
                "registry",
                "kickoff",
                "checkpoint",
            ]),
        );
        const all = await Promise.all(
            ["result.json", "events.jsonl", "report.md", "ledger.json"].map(
                (name) => readFile(join(args.out, name), "utf8"),
            ),
        );
        expect(all.join("\n")).not.toContain(UPSTREAM_KEY);
        expect(all.join("\n")).not.toContain(trial);
        expect(await readFile(join(args.out, "report.md"), "utf8")).toContain(
            "not evidence against hostile code",
        );
    }, 120_000);

    it("handles stderr readiness, empty mutations and scoped Codex startup", async () => {
        const world = new World();
        world.stderrNotReady = true;
        world.emptyMutations = true;
        const { args } = await trialDir();
        const result = await runTrial(args, depsFor(world).deps);
        expect(result.status).toBe("pass");
        const start = world.calls.find(
            (call) =>
                call[0] === "agent" &&
                call[1] === "start" &&
                call[2] === "trial-codex",
        );
        expect(start?.slice(-2)).toEqual(["--", "--no-daemon"]);
        const shell = world.calls.find(
            (call) =>
                call[0] === "pane" &&
                call[1] === "send-text" &&
                call[3]?.includes("DOROTHY_WORKER_READY_trial-codex"),
        );
        expect(shell?.[3]).toContain("export HOME=");
        expect(shell?.[3]).toContain("export CODEX_HOME=");
        expect(shell?.[3]).toContain("cd ");
    }, 60_000);

    it("does not mistake an echoed bootstrap command for its output sentinel", async () => {
        const world = new World();
        world.shellEchoOnly = true;
        let starts = 0;
        world.onAgentStart = () => {
            starts++;
        };
        const { args } = await trialDir();
        const { deps, provider } = depsFor(world);
        const result = await runTrial(args, deps);
        expect(result.error).toContain("owned home not confirmed");
        expect(starts).toBe(0);
        expect(result.prompts).toEqual([]);
        expect(provider.requests).toEqual([]);
    }, 60_000);

    it("scrubs worker tokens from screens, sessions, reports and JSON", async () => {
        const world = new World();
        world.secret = "sk-worker-abcdefghijklmnop";
        const { args } = await trialDir();
        const result = await runTrial(args, depsFor(world).deps);
        expect(result.status).toBe("pass");
        const files = [
            "screens/trial-codex.txt",
            "pi-sessions/session.jsonl",
            "reports/fix-1b.md",
            "result.json",
            "events.jsonl",
        ];
        for (const file of files) {
            const text = await readFile(join(args.out, file), "utf8");
            expect(text).not.toContain(world.secret);
            if (file.startsWith("screens/") || file.startsWith("reports/"))
                expect(text).toContain("[secret]");
        }
        expect(
            JSON.parse(await readFile(join(args.out, "result.json"), "utf8"))
                .metadata.maxTokens,
        ).toBe(32768);
    }, 60_000);

    it("never types kickoff when native Pi is not ready and alive", async () => {
        for (const mode of ["banner", "process"]) {
            const world = new World();
            world.piBanner = mode !== "banner";
            world.piLive = mode !== "process";
            const { args } = await trialDir();
            const { deps, provider } = depsFor(world);
            const result = await runTrial({ ...args, timeoutMs: 5000 }, deps);
            expect(result.status).not.toBe("pass");
            expect(result.error).toContain("no kickoff sent");
            expect(result.kind).toBe("not-run");
            expect(result.prompts).toEqual([]);
            expect(provider.requests).toEqual([]);
        }
    }, 60_000);

    it("stops when a checked native prompt write fails", async () => {
        const world = new World();
        world.fail = (args) =>
            args[0] === "pane" &&
            args[1] === "send-text" &&
            args[3]?.includes("fix-1b")
                ? { code: 1, stdout: "", stderr: "write failed" }
                : null;
        const { args } = await trialDir();
        const { deps, provider } = depsFor(world);
        const result = await runTrial(args, deps);
        expect(result.error).toContain("Pi prompt text");
        expect(result.prompts).toHaveLength(1);
        expect(provider.requests).toEqual([]);
    }, 60_000);

    it("refuses a worker whose launched home or cwd is not the trial's", async () => {
        const world = new World();
        const { args } = await trialDir();
        const { deps, provider } = depsFor(world);
        deps.workerHomeMatches = async () => false;
        const result = await runTrial(args, deps);
        expect(result.error).toContain("worker home");
        expect(result.prompts).toEqual([]);
        expect(provider.requests).toEqual([]);
    }, 60_000);

    it("bounds worker home inspection by the remaining trial deadline", async () => {
        const world = new World();
        let advanced = false;
        world.onAgentStart = () => {
            if (!advanced) world.clock += 45_000;
            advanced = true;
        };
        const { args } = await trialDir();
        const { deps } = depsFor(world);
        const timeouts: number[] = [];
        deps.workerHomeMatches = async (_harness, _home, _cwd, _pane, ms) => {
            timeouts.push(ms);
            return true;
        };
        await runTrial({ ...args, timeoutMs: 50_000 }, deps);
        expect(timeouts.length).toBeGreaterThan(0);
        expect(timeouts[0]).toBeGreaterThan(0);
        expect(timeouts[0]).toBeLessThanOrEqual(5_000);
    }, 60_000);

    it("does not interrupt a same-pane process that replaced the pinned worker", async () => {
        const world = new World();
        const { args } = await trialDir();
        const { deps } = depsFor(world);
        world.onInterrupt = () => {
            const agent = world.find("trial-codex")?.agent;
            if (agent) agent.process = 5999;
        };
        const result = await runTrial({ ...args, timeoutMs: 60_000 }, deps);
        expect(result.interruption?.exited).toBe(false);
        expect(result.interruption?.terminalChanged).toBeNull();
        expect(result.interruption?.occupantChanged).toBeNull();
        expect(result.interruption?.guardRefused).toBe(true);
        expect(
            world.calls.filter(
                (call) =>
                    call[0] === "agent" &&
                    call[1] === "start" &&
                    call[2] === "trial-codex",
            ),
        ).toHaveLength(1);
        expect(result.status).not.toBe("pass");
    }, 60_000);

    it("confirms interruption by process exit even if the old name remains", async () => {
        const world = new World();
        world.retainStoppedAgent = true;
        const { args } = await trialDir();
        const result = await runTrial(args, depsFor(world).deps);
        expect(result.status).toBe("pass");
        expect(result.interruption).toMatchObject({
            exited: true,
            occupantChanged: true,
            guardRefused: false,
        });
    }, 60_000);

    it("withholds the retry checkpoint when compaction is unconfirmed", async () => {
        const world = new World();
        world.compactionAcknowledges = false;
        const { args } = await trialDir();
        const { deps } = depsFor(world);
        deps.releaseAfterMs = 0;
        const result = await runTrial({ ...args, timeoutMs: 60_000 }, deps);
        expect(result.compaction?.confirmed).toBe(false);
        expect(result.checkpoints).toEqual([]);
        expect(
            await stat(
                join(
                    layoutOf(args.registry, args.out).checkpoints,
                    "fix-1b.ready",
                ),
            ).catch(() => null),
        ).toBeNull();
        expect(result.reviewLoop.status).not.toBe("exercised");
        expect(result.status).not.toBe("pass");
    }, 60_000);

    it("does not count approval of the owner-failing first fix", async () => {
        const world = new World();
        const { args } = await trialDir();
        world.reviewOverride = (taskId, approved) =>
            taskId === "review-1" ? true : approved;
        const result = await runTrial(args, depsFor(world).deps);
        expect(result.reviewLoop.status).toBe("incomplete");
        expect(result.status).not.toBe("pass");
    }, 60_000);

    it("does not accept a final fix its reviewer rejected", async () => {
        const world = new World();
        const { args } = await trialDir();
        world.reviewOverride = (taskId, approved) =>
            taskId === "review-2" ? false : approved;
        const result = await runTrial(args, depsFor(world).deps);
        expect(result.reviewLoop.status).toBe("incomplete");
        expect(result.finalRevision?.reviewAccepted).toBe(false);
        expect(result.status).not.toBe("pass");
    }, 60_000);

    it("refuses same-worker fleetId and fixtureRoot changes", async () => {
        for (const field of ["fleetId", "fixtureRoot"] as const) {
            const world = new World();
            world.script = "tamper";
            world.tamperField = field;
            const { args } = await trialDir();
            const { deps, provider } = depsFor(world);
            const result = await runTrial(args, deps);
            expect(result.status).toBe("fail");
            expect(
                result.checks.find((c) => c.id === "registry-owned")?.ok,
            ).toBe(false);
            expect(world.jobs.size).toBe(0);
            expect(provider.requests.length).toBe(1);
        }
    }, 60_000);

    it("stops a late worker startup without dispatching new work", async () => {
        const world = new World();
        world.onAgentStart = () => {
            world.clock += 20_000;
        };
        const { args } = await trialDir();
        const { deps, provider } = depsFor(world);
        const result = await runTrial({ ...args, timeoutMs: 10_000 }, deps);
        expect(result.status).not.toBe("pass");
        expect(result.prompts).toEqual([]);
        expect(result.registry).toBeNull();
        expect(provider.requests).toEqual([]);
    }, 60_000);

    it("refuses registry entries outside the fixture and never touches them", async () => {
        const world = new World();
        world.script = "tamper";
        const { args } = await trialDir();
        const { deps } = depsFor(world);
        const result = await runTrial(args, deps);
        expect(result.status).toBe("fail");
        expect(result.checks.find((c) => c.id === "registry-owned")?.ok).toBe(
            false,
        );
        expect(world.calls.filter((call) => call.includes(FOREIGN))).toEqual(
            [],
        );
        expect(world.panes.has(FOREIGN)).toBe(true);
        expect(sorted(world.closed)).toEqual(sorted(trialPanes(world)));
    }, 60_000);

    it("preserves the evidence and cleans up its own panes when a step fails", async () => {
        const world = new World();
        world.fail = (args) =>
            args[0] === "agent" &&
            args[1] === "start" &&
            args[2] === "trial-claude"
                ? herdrError("agent_start_failed")
                : null;
        const { trial, args } = await trialDir();
        const { deps } = depsFor(world);
        const result = await runTrial(args, deps);
        expect(result.status).toBe("incomplete");
        expect(result.error).toContain("trial-claude");
        expect(sorted(world.closed)).toEqual(sorted(trialPanes(world)));
        expect(world.panes.has(FOREIGN)).toBe(true);
        const { result: kept, events } = await evidence(args.out);
        expect(kept.status).toBe("incomplete");
        expect(events.map((e) => e.kind)).toContain("created");
        // The trial directory stays for inspection: clones, owner, homes.
        expect((await stat(join(trial, "fixture"))).isDirectory()).toBe(true);
        expect((await stat(join(trial, "homes", "codex"))).isDirectory()).toBe(
            true,
        );
    }, 60_000);
});

describe("its limits", () => {
    it("reserves each request's worst cost and sends nothing once the budget is spent", async () => {
        const world = new World();
        world.script = "chatter";
        const { args } = await trialDir();
        // Each reply measures 200000 prompt tokens: US$0.045 a call,
        // against a reservation of a full context, about US$0.06.
        const { deps, provider } = depsFor(world, () => replyWith(200_000));
        const result = await runTrial({ ...args, maxUsd: 0.1 }, deps);
        const providerCallsAfterBudgetExhausted =
            provider.requests.length - world.upstreamAtFirstRefusal;
        expect(world.upstreamAtFirstRefusal).toBe(1);
        expect(world.pi?.refused).toBeGreaterThan(0);
        expect(providerCallsAfterBudgetExhausted).toBe(0);
        expect(result.status).toBe("incomplete");
        expect(result.stopped).toContain("budget");
        expect(result.cost.reservedUsd).toBeLessThanOrEqual(0.1);
        expect(sorted(world.closed)).toEqual(sorted(trialPanes(world)));
    }, 60_000);

    it("stops at a reply without usage and calls its cost unknown, never zero", async () => {
        const world = new World();
        world.script = "chatter";
        const { args } = await trialDir();
        const { deps, provider } = depsFor(world, () => [
            said("ok"),
            finish("stop"),
        ]);
        const result = await runTrial(args, deps);
        expect(provider.requests.length).toBe(1);
        expect(result.status).toBe("incomplete");
        expect(result.stopped).toContain("usage unavailable");
        expect(result.cost.measuredUsd).toBeNull();
        expect(result.cost.unmeasuredCalls).toBe(1);
        expect(await readFile(join(args.out, "report.md"), "utf8")).toContain(
            "unknown",
        );
    }, 60_000);

    it("stops at the turn cap", async () => {
        const world = new World();
        world.script = "chatter";
        const { args } = await trialDir();
        const { deps, provider } = depsFor(world);
        const result = await runTrial({ ...args, maxTurns: 3 }, deps);
        expect(provider.requests.length).toBe(3);
        expect(result.status).toBe("incomplete");
        expect(result.stopped).toContain("turn limit 3");
    }, 60_000);

    it("bounds slow cleanup and never passes an overrun", async () => {
        const world = new World();
        world.script = "quiet";
        const { args } = await trialDir();
        const { deps } = depsFor(world);
        deps.memory = async () => ({
            url: "http://127.0.0.1:9",
            stop: () => new Promise<void>(() => {}),
        });
        const result = await runTrial({ ...args, timeoutMs: 20 }, deps);
        expect(result.status).toBe("fail");
        expect(result.cleanup.failed).toContain("memory");
        expect(result.cleanup.overrun).toBe(true);
        expect(result.checks.find((c) => c.id === "within-limits")?.ok).toBe(
            false,
        );
    }, 60_000);

    it("stops at its time limit, on the injected clock", async () => {
        const world = new World();
        world.script = "quiet";
        const { args } = await trialDir();
        const { deps } = depsFor(world);
        const result = await runTrial({ ...args, timeoutMs: 120_000 }, deps);
        expect(result.status).toBe("fail");
        expect(result.stopped).toContain("time limit");
        expect(result.checks.find((c) => c.id === "within-limits")?.ok).toBe(
            false,
        );
        expect(world.clock - START).toBeGreaterThanOrEqual(120_000);
        expect(world.clock - START).toBeLessThan(200_000);
        expect(sorted(world.closed)).toEqual(sorted(trialPanes(world)));
    }, 60_000);
});

describe("the operator's release", () => {
    it("releases only a stranded task the trial owns, and logs it", async () => {
        const world = new World();
        const { trial, args } = await trialDir();
        const env = {
            XDG_STATE_HOME: join(trial, "state-for-release"),
            HOME: trial,
        };
        const fleetId = "00000000-0000-4000-8000-0000000000e1";
        const ledger = openLedger(ledgerPath(env, fleetId), fleetId, world.now);
        await mkdir(join(trial, "briefs"), { recursive: true });
        const brief = {
            workerId: "trial-codex",
            briefPath: join(trial, "briefs", "fix-1.md"),
            reportPath: join(trial, "reports", "fix-1.md"),
            baseOid: "a".repeat(40),
        };
        ledger.reserve(
            { ...brief, taskId: "fix-1" },
            "sha256:x",
            "term_1",
            PI_SELF,
        );
        ledger.reserve(
            { ...brief, taskId: "elsewhere", workerId: "trial-claude" },
            "sha256:y",
            "term_2",
            PI_SELF,
        );
        for (const op of ledger.pending())
            ledger.conclude(op.id, "done", null, {
                from: ["intent"],
                to: "sent",
            });
        ledger.close();
        const log = join(trial, "interventions.jsonl");
        const release = (taskId: string) =>
            operatorRelease({
                env,
                fleetId,
                owned: ["fix-1", "fix-1b"],
                taskId,
                reason: "its worker was interrupted",
                by: "user",
                log,
                now: world.now,
            });
        expect((await release("elsewhere")).code).toBe("RELEASE_NOT_OWNED");
        expect((await release("fix-1b")).code).toBe("RELEASE_NO_TASK");
        const done = await release("fix-1");
        expect(done.code).toBe("TASK_RELEASED");
        expect((await release("fix-1")).code).toBe("RELEASE_FINAL");
        const reopened = openLedger(
            ledgerPath(env, fleetId),
            fleetId,
            world.now,
        );
        expect(reopened.task("fix-1")?.state).toBe("failed");
        expect(reopened.task("fix-1")?.code).toBe("OPERATOR_RELEASED");
        expect(reopened.task("elsewhere")?.state).toBe("sent");
        reopened.close();
        const logged = (await readFile(log, "utf8")).trim().split("\n");
        expect(logged.length).toBe(1);
        expect(JSON.parse(logged[0] as string)).toMatchObject({
            by: "user",
            kind: "operator-release",
            taskId: "fix-1",
            from: "sent",
        });
        void args;
        void layoutOf;
    });
});
