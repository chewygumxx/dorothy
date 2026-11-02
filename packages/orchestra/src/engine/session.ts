// vim:set expandtab shiftwidth=4 filetype=typescript:
// SPDX-License-Identifier: GPL-3.0-only

//
//
// ~chewygumxx/dorothy.git
// ::: :/packages/orchestra/src/engine/session.ts
//
//

// A worker's box and session: its proxy and, for an API key, its gateway,
// each on a socket of its own; its adapter boxed; an acpx runtime of its
// own, whose agent command is that box, with no tool policy, filesystem
// or terminal of acpx's, so that every action the agent takes asks
// through the gate; and one persistent session, in the box's mode, kept
// for the worker's life. acpx's types stay here.

import { randomUUID } from "node:crypto";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
    type AcpProcessLifecycle,
    type AcpRuntimeTurn,
    type AcpSessionRecord,
    type AcpSessionStore,
    createAcpRuntime,
    createAgentRegistry,
} from "acpx/runtime";
import { boxArgs, bridgeSource, systemLayout } from "../box/box.js";
import {
    type Adapter,
    KEY_SOCKET,
    MODES,
    PROXY_SOCKET,
    providerHosts,
    type WorkerLogin,
    workerBox,
} from "../box/worker-box.js";
import type { Agent } from "../config.js";
import type { GateDecision } from "../gate.js";
import type { Log } from "../log.js";
import { startKeyGateway } from "../net/key-gateway.js";
import { type ProxyOptions, startProxy } from "../net/proxy.js";
import type { PermissionRequest } from "../rules.js";

// A subscription's login, or an API key the gateway holds.
export type Access = { login: WorkerLogin; key: string | null };

export type SessionInput = {
    agent: Agent;
    name: string;
    clone: string;
    // The broker repository's objects, which the clone borrows.
    objects: string;
    // The box's own directory, for its sockets and bridge.
    sockets: string;
    access: Access;
    networkAllow: string[];
    adapter: Adapter;
    log: Log;
    // The gate, given the worker's real paths by the engine.
    gate: (
        request: PermissionRequest,
        signal: AbortSignal,
    ) => Promise<GateDecision>;
    // Its agent's process gone, or started again: the session is lost.
    lost: (reason: string) => void;
    // Each thing opened, for the worker's close to undo, the latest first.
    hold: (close: () => Promise<unknown>) => void;
    // Tests alone: the fake agent's flags, the proxy's resolver, the
    // gateway's upstream.
    agentArgs?: string[];
    resolve?: ProxyOptions["resolve"];
    upstream?: string;
};

// What a turn says as it runs: its reply's text, a tool it calls.
export type Heard = { text: string } | { tool: string };

export type TurnEnd =
    | { status: "completed" | "cancelled" }
    | { status: "failed"; error: string };

export type Session = {
    // The mode the session reports, as the agent's "mode" config option.
    mode(): Promise<unknown>;
    turn(text: string, heard: (event: Heard) => void): Promise<TurnEnd>;
    cancel(): Promise<void>;
};

// A worker's agent runs in one box for its life: a second spawn means the
// first is gone, and its session with it, so it is refused; the agent's
// exit is reported too.
export function oneBox(lost: (reason: string) => void): AcpProcessLifecycle {
    let spawned = false;
    let pid: number | undefined;
    return {
        onBeforeSpawn: () => {
            if (spawned) {
                lost("its agent started again");
                throw new Error("its agent started again");
            }
            spawned = true;
        },
        onSpawned: (started) => {
            pid = started.pid;
        },
        onExit: ({ pid: exited, exitCode, signal }) => {
            if (exited === pid) {
                lost(
                    `its agent exited ${signal === null ? `with ${exitCode}` : `on ${signal}`}`,
                );
            }
        },
    };
}

// Session records in memory: a session lives no longer than the server.
function memoryStore(): AcpSessionStore {
    const records = new Map<string, AcpSessionRecord>();
    return {
        load: async (id) => structuredClone(records.get(id)),
        save: async (record) => {
            records.set(record.acpxRecordId, structuredClone(record));
        },
    };
}

export async function openSession(input: SessionInput): Promise<Session> {
    const { agent, name, clone, sockets, access, log, hold } = input;
    await mkdir(sockets, { recursive: true, mode: 0o700 });
    hold(() => rm(sockets, { recursive: true, force: true }));
    await writeFile(join(sockets, "bridge.ts"), bridgeSource());
    const proxy = await startProxy({
        socket: join(sockets, PROXY_SOCKET),
        hosts: new Set([
            ...providerHosts(agent, access.login.kind),
            ...input.networkAllow,
        ]),
        log: (entry) => log({ ...entry, event: "proxy", worker: name }),
        resolve: input.resolve,
    });
    hold(() => proxy.close());
    if (access.key !== null) {
        const gateway = await startKeyGateway({
            socket: join(sockets, KEY_SOCKET),
            provider: agent === "claude" ? "anthropic" : "openai",
            key: access.key,
            log: (entry) => log({ ...entry, event: "gateway", worker: name }),
            upstream: input.upstream,
        });
        hold(() => gateway.close());
    }
    const spec = workerBox({
        agent,
        login: access.login,
        clone,
        objects: input.objects,
        sockets,
        bridge: join(sockets, "bridge.ts"),
        adapter: input.adapter,
    });
    spec.command.push(...(input.agentArgs ?? []));
    const runtime = createAcpRuntime({
        cwd: clone,
        sessionStore: memoryStore(),
        agentRegistry: createAgentRegistry({
            overrides: { [agent]: boxArgs(spec, await systemLayout()) },
        }),
        permissionMode: "deny-all",
        fs: false,
        terminal: false,
        agentProcessEnvAllow: [],
        processLifecycle: oneBox(input.lost),
        onPermissionRequest: (request, { signal }) =>
            input.gate(request.raw, signal),
    });
    hold(() => runtime.shutdown());
    const handle = await runtime.ensureSession({
        sessionKey: name,
        agent,
        mode: "persistent",
        cwd: clone,
    });
    hold(() => runtime.close({ handle, reason: "its worker ended" }));
    await runtime.setMode({ handle, mode: MODES[agent] });

    let active: AcpRuntimeTurn | null = null;
    return {
        mode: async () => {
            const { details } = await runtime.getStatus({ handle });
            const options = (details?.configOptions ?? []) as {
                id: string;
                currentValue?: unknown;
            }[];
            return options.find(({ id }) => id === "mode")?.currentValue;
        },
        // With no timeout: a turn that fails loses its box.
        turn: async (text, heard) => {
            const turn = runtime.startTurn({
                handle,
                text,
                mode: "prompt",
                requestId: randomUUID(),
            });
            active = turn;
            const tools = new Set<string | undefined>();
            try {
                for await (const event of turn.events) {
                    if (
                        event.type === "text_delta" &&
                        event.stream !== "thought"
                    ) {
                        heard({ text: event.text });
                    } else if (
                        event.type === "tool_call" &&
                        !tools.has(event.toolCallId)
                    ) {
                        tools.add(event.toolCallId);
                        heard({ tool: event.title ?? event.text });
                    }
                }
                const result = await turn.result;
                return result.status === "failed"
                    ? { status: "failed", error: result.error.message }
                    : { status: result.status };
            } finally {
                active = null;
            }
        },
        cancel: async () => {
            await active?.cancel({ reason: "its worker ended" });
        },
    };
}
