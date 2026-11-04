// vim:set expandtab shiftwidth=4 filetype=typescript:
// SPDX-License-Identifier: GPL-3.0-only

//
//
// ~chewygumxx/dorothy.git
// ::: :/packages/cli/src/hosts/pi/steward/herdr.ts
//
//

// The herdr adapter: an argv process runner with bounded output and a kill
// on timeout, and the read-only observation of one declared worker through
// `herdr agent get <name>` (installed 0.9.5: `{id, result: {agent, type:
// "agent_info"}}`, or `{error: {code, message}}` with exit 1). It sends
// nothing to any pane, and takes no failure for a ready worker.

import type { Env } from "@dorothy/core";
import { isWorkerWord } from "./registry.js";
import {
    StewardError,
    type Worker,
    type WorkerObservation,
    type WorkerState,
} from "./types.js";

export type HerdrRun = (
    args: string[],
    options: { env: Env; signal: AbortSignal; stdin?: string },
) => Promise<{ code: number; stdout: string; stderr: string }>;

// A read is at most 200 lines of at most 32 KiB; the adapter reads no more
// than 32 KiB of any process output, and a metadata call lasts 2 seconds.
export const MAX_READ_LINES = 200;
export const MAX_OUTPUT_BYTES = 32 * 1024;
export const METADATA_TIMEOUT_MS = 2000;

// A terminal id is herdr's own word (`term_` and hex), bounded to 64.
const TERMINAL = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,63}$/;

const STATES: readonly WorkerState[] = [
    "idle",
    "working",
    "blocked",
    "done",
    "unknown",
];

async function bounded(
    stream: ReadableStream<Uint8Array>,
    limit: number,
    over: () => void,
): Promise<string> {
    const chunks: Uint8Array[] = [];
    let size = 0;
    const reader = stream.getReader();
    for (;;) {
        const { done, value } = await reader.read();
        if (done) {
            break;
        }
        size += value.byteLength;
        if (size > limit) {
            over();
            await reader.cancel().catch(() => {});
            throw new StewardError("HERDR_OUTPUT_LIMIT", `over ${limit} bytes`);
        }
        chunks.push(value);
    }
    return Buffer.concat(chunks).toString("utf8");
}

// Runs `bin` on `args` directly (no shell) with exactly the given
// environment. An abort or an output past `maxBytes` kills the process and
// rejects; a process that cannot start rejects. Only an exit is a reply.
export function createHerdrRun(
    config: { bin?: string; maxBytes?: number } = {},
): HerdrRun {
    const bin = config.bin ?? "herdr";
    const limit = config.maxBytes ?? MAX_OUTPUT_BYTES;
    return async (args, { env, signal, stdin }) => {
        if (signal.aborted) {
            throw new StewardError("HERDR_ABORTED", "before start");
        }
        const child = Bun.spawn([bin, ...args], {
            env,
            stdin: stdin === undefined ? "ignore" : new Blob([stdin]),
            stdout: "pipe",
            stderr: "pipe",
        });
        const kill = () => child.kill("SIGKILL");
        signal.addEventListener("abort", kill, { once: true });
        try {
            const [stdout, stderr, code] = await Promise.all([
                bounded(child.stdout, limit, kill),
                bounded(child.stderr, limit, kill),
                child.exited,
            ]);
            if (signal.aborted) {
                throw new StewardError("HERDR_ABORTED", "while running");
            }
            return { code, stdout, stderr };
        } catch (error) {
            kill();
            if (signal.aborted && !(error instanceof StewardError)) {
                throw new StewardError("HERDR_ABORTED", "while running");
            }
            throw error;
        } finally {
            signal.removeEventListener("abort", kill);
        }
    };
}

export type ObserveOptions = {
    // The environment herdr runs with: `HERDR_ENV=1` is required.
    env: Env;
    now: () => Date;
    timeoutMs?: number;
};

type Reply = { code: number; stdout: string; stderr: string };

// Races the call against its deadline, so a runner that ignores its signal
// still ends the wait; the signal tells one that honours it to kill.
export async function timed(
    run: HerdrRun,
    args: string[],
    env: Env,
    timeoutMs: number,
    stdin?: string,
): Promise<Reply> {
    const control = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const deadline = new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
            control.abort();
            reject(new StewardError("HERDR_TIMEOUT", `${timeoutMs} ms`));
        }, timeoutMs);
    });
    const call = run(args, {
        env,
        signal: control.signal,
        ...(stdin === undefined ? {} : { stdin }),
    });
    call.catch(() => {});
    try {
        return await Promise.race([call, deadline]);
    } finally {
        clearTimeout(timer);
    }
}

function parse(text: string): Record<string, unknown> | null {
    try {
        const value: unknown = JSON.parse(text);
        return value && typeof value === "object" && !Array.isArray(value)
            ? (value as Record<string, unknown>)
            : null;
    } catch {
        return null;
    }
}

function record(value: unknown): Record<string, unknown> | null {
    return value && typeof value === "object" && !Array.isArray(value)
        ? (value as Record<string, unknown>)
        : null;
}

// What `herdr agent get <name>` gives for `worker`, or the code for why not.
function compare(
    worker: Worker,
    reply: Reply,
):
    | { state: WorkerState; code: string | null; terminalId: string | null }
    | { fail: string } {
    const body = parse(reply.stdout);
    if (reply.code !== 0) {
        return {
            fail:
                record(body?.error)?.code === "agent_not_found"
                    ? "HERDR_AGENT_NOT_FOUND"
                    : "HERDR_FAILED",
        };
    }
    const result = record(body?.result);
    const agent = record(result?.agent);
    if (result?.type !== "agent_info" || !agent) {
        return { fail: "HERDR_REPLY_INVALID" };
    }
    if (agent.name === undefined) {
        return { fail: "HERDR_NAME_MISMATCH" };
    }
    if (
        typeof agent.name !== "string" ||
        typeof agent.pane_id !== "string" ||
        typeof agent.agent !== "string" ||
        typeof agent.cwd !== "string"
    ) {
        return { fail: "HERDR_REPLY_INVALID" };
    }
    if (agent.name !== worker.name) {
        return { fail: "HERDR_NAME_MISMATCH" };
    }
    if (agent.pane_id !== worker.pane) {
        return { fail: "HERDR_PANE_MOVED" };
    }
    if (agent.agent !== worker.harness) {
        return { fail: "HERDR_HARNESS_MISMATCH" };
    }
    if (agent.cwd !== worker.cwd) {
        return { fail: "HERDR_CWD_MISMATCH" };
    }
    const status = agent.agent_status;
    const id = agent.terminal_id;
    const terminalId = typeof id === "string" && TERMINAL.test(id) ? id : null;
    return STATES.includes(status as WorkerState)
        ? { state: status as WorkerState, code: null, terminalId }
        : { state: "unknown", code: "HERDR_STATE_UNRECOGNIZED", terminalId };
}

// Observes one declared worker, now and read-only. It matches only where
// herdr names the agent, its pane, harness and cwd as declared; any other
// answer, a failure or a timeout is unmatched and `unknown`, never idle.
// Callers observe again immediately before acting.
export async function observeWorker(
    worker: Worker,
    run: HerdrRun,
    options: ObserveOptions,
): Promise<WorkerObservation> {
    const at = options.now();
    const unmatched = (code: string): WorkerObservation => ({
        id: worker.id,
        matches: false,
        state: "unknown",
        observedAt: at.toISOString(),
        code,
        terminalId: null,
    });
    if (options.env.HERDR_ENV !== "1") {
        return unmatched("HERDR_ENV_MISSING");
    }
    if (at.getTime() >= Date.parse(worker.expiresAt)) {
        return unmatched("REGISTRY_EXPIRED");
    }
    if (!isWorkerWord(worker.name)) {
        return unmatched("WORKER_NAME_INVALID");
    }
    let reply: Reply;
    try {
        reply = await timed(
            run,
            ["agent", "get", worker.name],
            options.env,
            options.timeoutMs ?? METADATA_TIMEOUT_MS,
        );
    } catch (error) {
        return unmatched(
            error instanceof StewardError && error.code === "HERDR_TIMEOUT"
                ? "HERDR_TIMEOUT"
                : error instanceof StewardError &&
                    error.code === "HERDR_OUTPUT_LIMIT"
                  ? "HERDR_REPLY_TOO_LARGE"
                  : "HERDR_UNAVAILABLE",
        );
    }
    if (
        Buffer.byteLength(reply.stdout) > MAX_OUTPUT_BYTES ||
        Buffer.byteLength(reply.stderr) > MAX_OUTPUT_BYTES
    ) {
        return unmatched("HERDR_REPLY_TOO_LARGE");
    }
    const found = compare(worker, reply);
    if ("fail" in found) {
        return unmatched(found.fail);
    }
    return {
        id: worker.id,
        matches: true,
        state: found.state,
        observedAt: at.toISOString(),
        code: found.code,
        terminalId: found.terminalId,
    };
}
