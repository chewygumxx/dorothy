// vim:set expandtab shiftwidth=4 filetype=typescript:
// SPDX-License-Identifier: GPL-3.0-only

//
//
// ~chewygumxx/dorothy.git
// ::: :/packages/orchestra/src/engine/engine.ts
//
//

// The engine: the workers, each with a session of its own on acpx's
// embedded runtime (session.ts), kept for its life, so one agent process,
// one box and its home: its agent exiting, or starting again, loses the
// session, and the worker fails, its clone kept. Its turns are its
// operations, queued under its name, run in order, each after its
// session reports the box's mode. The tools' functions are here.

import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import type { Clock, Env, StructuredCall, Timers } from "@dorothy/core";
import {
    type Adapter,
    adapterFor,
    KEY_VARIABLES,
    MODES,
} from "../box/worker-box.js";
import { fetchBase } from "../broker/base.js";
import { makeClone } from "../broker/clone.js";
import { drainGroups, sealedGit } from "../broker/git.js";
import { readIdentity } from "../broker/identity.js";
import type { Outcome } from "../broker/push.js";
import { openBroker } from "../broker/repository.js";
import { reserveBranch } from "../broker/reservation.js";
import type { Agent, OrchestraConfig } from "../config.js";
import { type Ask, createGate, type GateLog } from "../gate.js";
import type { Log } from "../log.js";
import type { ProxyOptions } from "../net/proxy.js";
import { type OperationRecord, Operations } from "../operations.js";
import { type Access, openSession, type Session } from "./session.js";

// wait_worker's longest wait, within a tool's 50 seconds.
export const WAIT_SECONDS = 45;
// What read_worker shows since the last read: the latest events, each
// cut to its first characters.
const EVENTS_KEPT = 50;
const EVENT_CHARS = 1000;
// The tail of a worker's replies the judge sees.
const RECENT_CHARS = 16_000;

export type WorkerStatus =
    | "starting"
    | "working"
    | "idle"
    | "waiting-on-user"
    | "failed"
    | "stopped";

// The statuses a wait ends on, besides an operation's outcome.
const WAKES = new Set<WorkerStatus>([
    "idle",
    "waiting-on-user",
    "failed",
    "stopped",
]);

export type WorkerSummary = {
    worker: string;
    agent: Agent;
    branch: string;
    // Its clone, once made.
    clone: string | null;
    status: WorkerStatus;
    // Why it failed.
    reason: string;
};

export type WorkerReport = WorkerSummary & {
    // What happened since the last read, condensed: replies, tools
    // called, permission decisions with their source.
    events: string[];
    // Its questions waiting on the user, by their ids.
    questions: string[];
    operations: OperationRecord[];
};

export type StartInput = {
    agent: Agent;
    // A main checkout whose origin names a GitHub repository.
    repo: string;
    branch: string;
    task: string;
    operationId: string;
};

export type Started = { worker: string; operation: OperationRecord };

export type Waited = { timedOut: boolean; workers: WorkerSummary[] };

// createQuestions' own.
export type Questions = {
    ask: Ask;
    stop: (worker: string) => Promise<void>;
    pending: (worker: string) => string[];
};

export type EngineDeps = {
    // The server's id: its workers' clones go in <worktree-root>/<server>.
    server: string;
    config: OrchestraConfig;
    // The server's environment, which host git runs in.
    env: Env;
    // $XDG_STATE_HOME/dorothy/orchestra.
    state: string;
    // resolveGit's.
    git: string;
    // Dorothy's secrets by name, an API key login's key among them.
    secrets: Readonly<Record<string, string | undefined>>;
    // Each agent's subscription login: Claude's config directory, Codex's
    // home.
    logins: Readonly<Record<Agent, string>>;
    // The judge's, on the approval route.
    call: StructuredCall;
    questions: Questions;
    log: Log;
    clock: Clock;
    timers: Timers;
    // Tests alone: a local bare remote as origin, the fake agent and its
    // flags in place of the adapters, a resolver keeping the proxy off
    // the network, the gateway's upstream.
    localRemotes?: boolean;
    adapter?: (agent: Agent) => Promise<Adapter>;
    agentArgs?: Partial<Record<Agent, string[]>>;
    resolve?: ProxyOptions["resolve"];
    upstream?: string;
};

type Worker = {
    name: string;
    agent: Agent;
    identity: string;
    branch: string;
    task: string;
    clone: string | null;
    // Set once, when it fails or stops.
    ended: { status: "failed" | "stopped"; reason: string } | null;
    // Aborted when it ends, denying its gate's pending requests.
    end: AbortController;
    session: Session | null;
    // Its turns queued or running, and its questions to the user.
    turns: number;
    asking: number;
    events: string[];
    cut: number;
    recent: string;
    operations: Set<string>;
    // What its close undoes, the latest first.
    closers: (() => Promise<unknown>)[];
    closing: Promise<void> | null;
    preparing: Promise<void>;
    prepared: () => void;
};

const errorText = (error: unknown) =>
    error instanceof Error ? error.message : String(error);

const statusOf = (worker: Worker): WorkerStatus =>
    worker.ended?.status ??
    (worker.asking > 0
        ? "waiting-on-user"
        : worker.session === null
          ? "starting"
          : worker.turns > 0
            ? "working"
            : "idle");

const summary = (worker: Worker): WorkerSummary => ({
    worker: worker.name,
    agent: worker.agent,
    branch: worker.branch,
    clone: worker.clone,
    status: statusOf(worker),
    reason: worker.ended?.reason ?? "",
});

export class Engine {
    // Every operation, the workers' turns among them; its close stops
    // every worker.
    readonly operations: Operations;
    readonly #deps: EngineDeps;
    readonly #gate: ReturnType<typeof createGate>;
    readonly #workers = new Map<string, Worker>();
    readonly #startup = new AbortController();
    readonly #named: Record<Agent, number> = { claude: 0, codex: 0 };
    readonly #waiters = new Set<{ worker?: string; wake: () => void }>();

    constructor(deps: EngineDeps) {
        this.#deps = deps;
        const { config, call, clock, timers } = deps;
        this.operations = new Operations({
            // Every change to an operation is logged; the engine reads its
            // workers' from the same feed, to list them and wake waits.
            log: (entry) => {
                deps.log(entry);
                this.#operation(entry);
            },
            clock,
            timers,
            stopWorkers: () => this.#stopAll(),
        });
        this.#gate = createGate({
            config,
            call,
            clock,
            timers,
            ask: async (question, signal) => {
                const worker = this.#get(question.workerId);
                worker.asking += 1;
                this.#changed(worker);
                try {
                    return await deps.questions.ask(question, signal);
                } finally {
                    worker.asking -= 1;
                    this.#changed(worker);
                }
            },
            log: (entry) => this.#decision(entry),
        });
    }

    // start_worker's: refused at once, or the worker named and its start
    // begun: its base, its branch reserved, its clone, box and session,
    // then its task as its first turn.
    async start(input: StartInput): Promise<Started> {
        const { agent, repo, branch, task, operationId } = input;
        const { config, git, env, state } = this.#deps;
        const tool = { operationId, tool: "start_worker", worker: null };
        const args = { agent, repo, branch, task };
        const repeat = () => {
            const found = this.operations.find({ ...tool, args });
            return found && { worker: found.worker ?? "", operation: found };
        };
        const first = repeat();
        if (first) {
            return first;
        }
        if (!config.agents.includes(agent)) {
            throw new Error(`${agent} is not among [orchestra] agents`);
        }
        if (this.#startup.signal.aborted) {
            throw new Error("the server is closing");
        }
        const access = this.#access(agent);
        await mkdir(state, { recursive: true });
        const reader = sealedGit({ git, env, config: "/dev/null", cwd: state });
        const { identity } = await readIdentity(
            reader,
            repo,
            this.#deps.localRemotes,
            this.#startup.signal,
        );
        const again = repeat();
        if (again) {
            return again;
        }
        const live = [...this.#workers.values()].filter((w) => !w.ended);
        if (live.some((w) => w.identity === identity && w.branch === branch)) {
            throw new Error(`${branch} is reserved already`);
        }
        if (live.length >= config.maxWorkers) {
            throw new Error(
                `max-workers is ${config.maxWorkers}, and as many run already`,
            );
        }
        this.#named[agent] += 1;
        const preparation = Promise.withResolvers<void>();
        const worker: Worker = {
            name: `${agent}-${this.#named[agent]}`,
            agent,
            identity,
            branch,
            task,
            clone: null,
            ended: null,
            end: new AbortController(),
            session: null,
            turns: 1,
            asking: 0,
            events: [],
            cut: 0,
            recent: "",
            operations: new Set(),
            closers: [],
            closing: null,
            preparing: preparation.promise,
            prepared: preparation.resolve,
        };
        this.#workers.set(worker.name, worker);
        try {
            const operation = this.operations.begin(
                { ...tool, args, worker: worker.name, queue: worker.name },
                (run) => this.#begin(worker, repo, access, run.signal),
            );
            return { worker: worker.name, operation };
        } catch (error) {
            // Refused as the server closes: no worker was started.
            this.#workers.delete(worker.name);
            throw error;
        }
    }

    // prompt_worker's: a turn queued behind the worker's others.
    prompt(name: string, text: string, operationId: string): OperationRecord {
        const input = {
            operationId,
            tool: "prompt_worker",
            args: { worker: name, text },
            worker: name,
            queue: name,
        };
        const repeat = this.operations.find(input);
        if (repeat) {
            return repeat;
        }
        const worker = this.#get(name);
        this.#live(worker);
        worker.turns += 1;
        this.#changed(worker);
        return this.operations.begin(input, () =>
            this.#turn(worker, text).finally(() => {
                worker.turns -= 1;
                this.#changed(worker);
            }),
        );
    }

    // read_worker's: its events are shown once.
    read(name: string): WorkerReport {
        const worker = this.#get(name);
        const events = worker.cut
            ? [`[${worker.cut} earlier events cut]`, ...worker.events]
            : worker.events;
        worker.events = [];
        worker.cut = 0;
        return {
            ...summary(worker),
            events,
            questions: this.#deps.questions.pending(name),
            operations: [...worker.operations].map((id) =>
                this.operations.read(id),
            ),
        };
    }

    // wait_worker's: until the worker, or any, goes idle, fails, stops or
    // needs the user, or an operation of its ends. A named worker already
    // so returns at once.
    async wait(name: string | undefined, seconds: number): Promise<Waited> {
        const named = name === undefined ? undefined : this.#get(name);
        const ready = named !== undefined && WAKES.has(statusOf(named));
        const timedOut =
            !ready &&
            (await new Promise<boolean>((resolve) => {
                const { timers } = this.#deps;
                const finish = (late: boolean) => {
                    timers.clear(timer);
                    this.#waiters.delete(waiter);
                    resolve(late);
                };
                const waiter = { worker: name, wake: () => finish(false) };
                const timer = timers.set(
                    () => finish(true),
                    Math.min(seconds, WAIT_SECONDS) * 1000,
                );
                this.#waiters.add(waiter);
            }));
        return { timedOut, workers: named ? [summary(named)] : this.list() };
    }

    // list_workers'.
    list(): WorkerSummary[] {
        return [...this.#workers.values()].map(summary);
    }

    // stop_worker's: its pending operations cancelled, its session and box
    // closed; its clone and branch stay.
    stop(name: string, operationId: string): OperationRecord {
        const worker = this.#get(name);
        return this.operations.begin(
            {
                operationId,
                tool: "stop_worker",
                args: { worker: name },
                worker: name,
            },
            async () => {
                await this.#stop(worker);
                return {
                    status: "succeeded",
                    detail: `${name} has ${worker.ended?.status}`,
                };
            },
        );
    }

    // At the client's EOF or a signal: every worker stopped, running
    // operations given their grace.
    async close(): Promise<void> {
        this.#startup.abort();
        await Promise.all([
            this.operations.close(),
            drainGroups(this.#startup.signal),
        ]);
    }

    async #begin(
        worker: Worker,
        repo: string,
        access: Access,
        operation: AbortSignal,
    ) {
        const signal = AbortSignal.any([operation, worker.end.signal]);
        const deps = this.#deps;
        const { config, server } = deps;
        const { name, agent, branch } = worker;
        try {
            const broker = await openBroker({
                git: deps.git,
                env: deps.env,
                state: deps.state,
                checkout: repo,
                timers: deps.timers,
                localRemotes: deps.localRemotes,
                signal,
            });
            const base = await fetchBase(broker, server, name, signal);
            await reserveBranch(
                broker,
                {
                    server,
                    worker: name,
                    branch,
                    base: base.oid,
                },
                signal,
            ).catch(async (error) => {
                await broker.git.run(
                    ["update-ref", "-d", base.ref],
                    undefined,
                    signal,
                );
                throw error;
            });
            const clone = await makeClone(
                broker,
                {
                    root: config.worktreeRoot,
                    server,
                    worker: name,
                    branch,
                    base: base.oid,
                },
                signal,
            );
            worker.clone = clone;
            this.#live(worker);
            const session = await openSession({
                agent,
                name,
                clone,
                objects: join(broker.repo, "objects"),
                sockets: join(deps.state, "boxes", server, name),
                access,
                networkAllow: config.networkAllow,
                adapter: await (deps.adapter ?? adapterFor)(agent),
                log: deps.log,
                // The worker's real paths, never its output's; its end
                // denies what it has pending.
                gate: (request, signal) =>
                    this.#gate(
                        request,
                        {
                            id: name,
                            clone,
                            cwd: clone,
                            task: worker.task,
                            recentOutput: worker.recent,
                        },
                        AbortSignal.any([signal, worker.end.signal]),
                    ),
                lost: (reason) =>
                    this.#fail(worker, `${reason}; its session is lost`),
                hold: (close) => {
                    worker.closers.push(close);
                    this.#live(worker);
                },
                agentArgs: deps.agentArgs?.[agent],
                resolve: deps.resolve,
                upstream: deps.upstream,
            });
            this.#live(worker);
            worker.session = session;
            worker.prepared();
            this.#changed(worker);
            return await this.#turn(worker, worker.task);
        } catch (error) {
            worker.prepared();
            await this.#fail(worker, errorText(error));
            throw error;
        } finally {
            worker.turns -= 1;
            this.#changed(worker);
        }
    }

    // A turn, once its session reports the box's mode: its replies and
    // tools recorded; a failed turn has lost its box, and fails the worker.
    async #turn(worker: Worker, text: string): Promise<Outcome> {
        this.#live(worker);
        const { session, agent } = worker;
        if (session === null) {
            throw new Error(`${worker.name} has no session`);
        }
        const mode = await session.mode();
        if (mode !== MODES[agent]) {
            const reason = `its session reports mode ${mode}, not ${MODES[agent]}`;
            await this.#fail(worker, reason);
            throw new Error(reason);
        }
        let reply = "";
        const end = await session.turn(text, (heard) => {
            if ("tool" in heard) {
                this.#event(worker, `called ${heard.tool}`);
            } else {
                reply += heard.text;
                worker.recent = (worker.recent + heard.text).slice(
                    -RECENT_CHARS,
                );
            }
        });
        if (reply.trim() !== "") {
            this.#event(worker, `reply: ${reply.trim()}`);
        }
        if (end.status === "failed") {
            const reason = `its turn failed: ${end.error}; its session is lost`;
            await this.#fail(worker, reason);
            return { status: "failed", detail: reason };
        }
        return end.status === "completed"
            ? { status: "succeeded", detail: "its turn completed" }
            : { status: "failed", detail: "its turn was cancelled" };
    }

    #decision(entry: GateLog) {
        this.#deps.log({ ...entry, at: new Date(entry.at).toISOString() });
        const worker = this.#workers.get(entry.workerId);
        if (worker && entry.event === "decision") {
            const { title, toolCallId } = entry.request.toolCall;
            this.#event(
                worker,
                `permission for ${title ?? toolCallId}: ${entry.decision} by ${entry.source}, ${entry.reason}`,
            );
        }
    }

    #operation({ worker, operationId, status }: Record<string, unknown>) {
        const name = typeof worker === "string" ? worker : undefined;
        if (name !== undefined) {
            this.#workers.get(name)?.operations.add(String(operationId));
        }
        if (status !== "pending" && status !== "running") {
            this.#wake(name);
        }
    }

    #event(worker: Worker, text: string) {
        worker.events.push(
            text.length > EVENT_CHARS
                ? `${text.slice(0, EVENT_CHARS)} [cut]`
                : text,
        );
        if (worker.events.length > EVENTS_KEPT) {
            worker.events.shift();
            worker.cut += 1;
        }
    }

    #access(agent: Agent): Access {
        const { config, secrets, logins } = this.#deps;
        const kind =
            agent === "claude" ? config.claudeLogin : config.codexLogin;
        if (kind === "subscription") {
            return { login: { kind, source: logins[agent] }, key: null };
        }
        const name = KEY_VARIABLES[agent].key;
        const key = secrets[name];
        if (!key) {
            throw new Error(
                `${agent}-login is api-key, but ${name} is not in Dorothy's secrets`,
            );
        }
        return { login: { kind }, key };
    }

    #get(name: string): Worker {
        const worker = this.#workers.get(name);
        if (worker === undefined) {
            throw new Error(`no worker ${name}`);
        }
        return worker;
    }

    #live({ name, ended }: Worker) {
        if (ended) {
            throw new Error(
                `${name} has ${ended.status}${ended.reason ? `: ${ended.reason}` : ""}`,
            );
        }
    }

    #changed(worker: Worker) {
        if (WAKES.has(statusOf(worker))) {
            this.#wake(worker.name);
        }
    }

    #wake(name: string | undefined) {
        for (const waiter of [...this.#waiters]) {
            if (waiter.worker === undefined || waiter.worker === name) {
                waiter.wake();
            }
        }
    }

    // Once, failed or stopped: its gate's pending requests denied.
    #end(worker: Worker, status: "failed" | "stopped", reason: string) {
        if (worker.ended) {
            return false;
        }
        worker.ended = { status, reason };
        worker.end.abort();
        const at = new Date(this.#deps.clock.now()).toISOString();
        this.#deps.log({
            at,
            event: "worker",
            worker: worker.name,
            status,
            reason,
        });
        this.#changed(worker);
        return true;
    }

    #fail(worker: Worker, reason: string): Promise<void> {
        this.#end(worker, "failed", reason);
        return this.#close(worker);
    }

    async #stop(worker: Worker) {
        this.#end(worker, "stopped", "");
        this.operations.cancel(worker.name);
        await this.#close(worker);
    }

    async #stopAll() {
        await Promise.all(
            [...this.#workers.values()].map((w) => this.#stop(w)),
        );
    }

    // Its questions settled, its turn cancelled, then whatever it holds
    // closed, its session, runtime and box first.
    #close(worker: Worker): Promise<void> {
        worker.closing ??= this.#cleanup(worker);
        return worker.closing;
    }

    async #cleanup(worker: Worker) {
        await this.#deps.questions.stop(worker.name);
        await worker.session?.cancel().catch(() => {});
        const drain = async () => {
            while (worker.closers.length > 0) {
                await worker.closers
                    .pop()?.()
                    .catch(() => {});
            }
        };
        await drain();
        // Startup can acquire a resource while an earlier close is waiting.
        // hold registers it before observing that the worker has ended.
        await worker.preparing;
        await drain();
    }
}
