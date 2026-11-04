// vim:set expandtab shiftwidth=4 filetype=typescript:
// SPDX-License-Identifier: GPL-3.0-only

//
//
// ~chewygumxx/dorothy.git
// ::: :/packages/cli/src/hosts/pi/steward/fixtures.ts
//
//

// Synthetic stewardship fixtures: a registry on disk and a fake herdr whose
// replies have the structure of the installed 0.9.5 `herdr agent get`, every
// name, pane, terminal and session invented. The fake serves `agent get`
// alone and refuses anything else, so a test can never send input to a pane;
// asked to, it also serves a read, recording it. The fake sender stands in
// for `send-prompt.sh` or `send-interrupt.sh`, recording what it is given.

import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { HerdrRun } from "./herdr.js";
import type { Worker, WorkerState } from "./types.js";

export const NOW = new Date("2026-11-03T12:00:00.000Z");
export const FLEET_ID = "00000000-0000-4000-8000-0000000000f1";

// What herdr 0.9.5 gives for an agent: `claude` carries a session and, while
// working, `interactive_ready`; an agent that has finished a turn, idle or
// done, a completion sequence. Compared to the installed output on
// 2026-11-03; only the values are invented.
export type HerdrAgent = {
    agent: string;
    agent_session?: {
        agent: string;
        kind: "id";
        source: string;
        value: string;
    };
    agent_status: string;
    completion_seq?: number;
    cwd: string;
    focused: boolean;
    foreground_cwd: string;
    interactive_ready?: boolean;
    name?: string;
    pane_id: string;
    revision: number;
    state_change_seq: number;
    tab_id: string;
    terminal_id: string;
    terminal_title: string;
    terminal_title_stripped: string;
    workspace_id: string;
};

export type Reply = { code: number; stdout: string; stderr: string };

export function agentInfoReply(agent: HerdrAgent): Reply {
    const body = { id: "cli:agent:get", result: { agent, type: "agent_info" } };
    return { code: 0, stdout: `${JSON.stringify(body)}\n`, stderr: "" };
}

export function errorReply(code: string, message: string): Reply {
    const body = { error: { code, message }, id: "cli:agent:get" };
    return { code: 1, stdout: `${JSON.stringify(body)}\n`, stderr: "" };
}

export function notFoundReply(target: string): Reply {
    return errorReply("agent_not_found", `agent target ${target} not found`);
}

// The agent herdr would report for a worker, in the worker's declared pane.
export function herdrAgentOf(
    worker: Worker,
    status: WorkerState | string = "idle",
): HerdrAgent {
    const slot = worker.pane.split(":")[0] ?? "w1";
    const agent: HerdrAgent = {
        agent: worker.harness,
        agent_status: status,
        cwd: worker.cwd,
        focused: false,
        foreground_cwd: worker.cwd,
        name: worker.name,
        pane_id: worker.pane,
        revision: 1,
        state_change_seq: 1,
        tab_id: `${slot}:t1`,
        terminal_id: "term_0000000000000a1",
        terminal_title: "Trial task | trial-fixture",
        terminal_title_stripped: "Trial task | trial-fixture",
        workspace_id: slot,
    };
    if (worker.harness === "claude") {
        agent.agent_session = {
            agent: "claude",
            kind: "id",
            source: "herdr:claude",
            value: "00000000-0000-4000-8000-0000000000a1",
        };
        if (status === "working") {
            agent.interactive_ready = true;
        }
    }
    if (status === "idle" || status === "done") {
        agent.completion_seq = 1;
    }
    return agent;
}

export type FakeCall = {
    args: string[];
    env: Record<string, string | undefined>;
};

export type FakeHerdr = {
    run: HerdrRun;
    calls: FakeCall[];
    agents: Map<string, HerdrAgent>;
    // What `agent read <name>` shows, by name, where a read is served.
    screens: Map<string, string>;
    // The next call gets this reply, or hangs until its signal aborts.
    queue: (reply: Reply | "hang" | Error) => void;
};

const ok = (stdout = ""): Reply => ({ code: 0, stdout, stderr: "" });

// A herdr holding the workers, each idle in its declared pane. `agent get`
// finds an agent by name or pane, as herdr does. With `steward`, it also
// serves `agent read <name> --lines <n> --format text`, recorded in
// `calls`, and still refuses any other command.
export function fakeHerdr(
    workers: Worker[],
    options: { steward?: boolean } = {},
): FakeHerdr {
    const agents = new Map<string, HerdrAgent>();
    for (const worker of workers) {
        agents.set(worker.name, herdrAgentOf(worker));
    }
    const screens = new Map<string, string>();
    const calls: FakeCall[] = [];
    const queued: (Reply | "hang" | Error)[] = [];
    const find = (target: string) =>
        [...agents.values()].find(
            (agent) => agent.name === target || agent.pane_id === target,
        );
    const served = (args: string[]): Reply | null => {
        const [noun, verb, target] = args as [string, string, string];
        if (args.length === 3 && noun === "agent" && verb === "get") {
            const found = find(target);
            return found ? agentInfoReply(found) : notFoundReply(target);
        }
        if (!options.steward) {
            return null;
        }
        if (
            args.length === 7 &&
            noun === "agent" &&
            verb === "read" &&
            args[3] === "--lines" &&
            args[5] === "--format" &&
            args[6] === "text"
        ) {
            return find(target)
                ? ok(screens.get(target) ?? "")
                : notFoundReply(target);
        }
        return null;
    };
    const run: HerdrRun = async (args, options) => {
        calls.push({ args: [...args], env: { ...options.env } });
        const next = queued.shift();
        if (next instanceof Error) {
            throw next;
        }
        if (next === "hang") {
            await new Promise<void>((resolve) => {
                options.signal.addEventListener("abort", () => resolve());
            });
            throw new Error("aborted");
        }
        if (next) {
            return next;
        }
        const reply = served(args);
        if (!reply) {
            throw new Error(`fake herdr refuses: ${args.join(" ")}`);
        }
        return reply;
    };
    return {
        run,
        calls,
        agents,
        screens,
        queue: (reply) => queued.push(reply),
    };
}

export type SendCall = { args: string[]; stdin: string | undefined };

export type FakeSender = {
    run: HerdrRun;
    calls: SendCall[];
    // The next send gets this exit, error or hang; by default, exit 0.
    queue: (reply: Reply | "hang" | Error) => void;
    // Runs as each send starts, before its reply: a test's observation.
    onSend: (hook: (call: SendCall) => void | Promise<void>) => void;
};

// A `send-prompt.sh` or `send-interrupt.sh` that writes to no pane: each
// call recorded, its exit scripted.
export function fakeSender(): FakeSender {
    const calls: SendCall[] = [];
    const queued: (Reply | "hang" | Error)[] = [];
    let hook: (call: SendCall) => void | Promise<void> = () => {};
    const run: HerdrRun = async (args, options) => {
        const call = { args: [...args], stdin: options.stdin };
        calls.push(call);
        await hook(call);
        const next = queued.shift();
        if (next instanceof Error) {
            throw next;
        }
        if (next === "hang") {
            await new Promise<void>((resolve) => {
                options.signal.addEventListener("abort", () => resolve());
            });
            throw new Error("aborted");
        }
        return next ?? ok();
    };
    return {
        run,
        calls,
        queue: (reply) => queued.push(reply),
        onSend: (next) => {
            hook = next;
        },
    };
}

// The registry's JSON as a test may edit it: two workers, as written.
type Entry = Record<string, unknown>;
export type Raw = {
    fixtureRoot: string;
    workers: [Entry, Entry, ...Entry[]];
    [key: string]: unknown;
};

export type Registry = {
    path: string;
    root: string;
    fixtureRoot: string;
    workers: Worker[];
    raw: Raw;
    cleanup: () => Promise<void>;
};

// A private root with a fixture root and one directory per worker, and a
// registry for them (rewritten through `edit`, which may make it invalid).
export async function writeRegistry(
    edit?: (raw: Raw) => void,
    now: Date = NOW,
): Promise<Registry> {
    const root = await mkdtemp(join(tmpdir(), "dorothy-steward-"));
    const fixtureRoot = join(root, "fixture");
    const observedAt = new Date(now.getTime() - 10 * 60_000).toISOString();
    const expiresAt = new Date(now.getTime() + 40 * 60_000).toISOString();
    const workers: Worker[] = [
        ["trial-codex", "codex", "implementer", "w1:p1"],
        ["trial-claude", "claude", "reviewer", "w1:p2"],
    ].map(([name, harness, role, pane]) => ({
        id: name as string,
        name: name as string,
        pane: pane as string,
        harness: harness as Worker["harness"],
        role: role as Worker["role"],
        cwd: join(fixtureRoot, name as string),
        accountLabel: `${harness}-trial`,
        availability: "available",
        observedAt,
        expiresAt,
    }));
    for (const worker of workers) {
        await mkdir(worker.cwd, { recursive: true });
    }
    const raw: Raw = {
        version: 1,
        fleetId: FLEET_ID,
        fixtureRoot,
        workers: structuredClone(workers) as unknown as Raw["workers"],
    };
    edit?.(raw);
    const path = join(root, "registry.json");
    await Bun.write(path, JSON.stringify(raw));
    return {
        path,
        root,
        fixtureRoot,
        workers,
        raw,
        cleanup: () => rm(root, { recursive: true, force: true }),
    };
}
