// vim:set expandtab shiftwidth=4 filetype=typescript:
// SPDX-License-Identifier: GPL-3.0-only

//
//
// ~chewygumxx/dorothy.git
// ::: :/packages/orchestra/src/fixtures/fake-agent.ts
//
//

// A fake ACP agent for tests, in place of an adapter: newline-delimited
// JSON-RPC on stdio, no dependency, so that a box can run it from its
// own directory. It answers initialize, session/new, session/load,
// session/set_mode and session/prompt, imitating claude-agent-acp or
// codex-acp (--as): their modes, reported as the "mode" config option,
// their permission options in their order, and their key variables, all
// as the installed adapters give them. Each prompt first calls its
// model as the real agent would, at the gateway where its base URL is
// set, else at the provider's host through the proxy variables. A
// command in backticks then asks permission, and runs on an allow
// option; the reply names the optionId it got and the command's result.
//
//     bun fake-agent.ts [--as codex] [--ignore-answers] [--pin-mode <id>]
//         [--exit-after-prompt]
//
// --ignore-answers runs the command whatever the answer; --pin-mode
// reports that mode whatever is set; --exit-after-prompt exits once its
// first prompt is answered, as a crashing agent would.

import { randomUUID } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createInterface } from "node:readline";

type Option = { optionId: string; name: string; kind: string };

const AGENTS = {
    claude: {
        modes: ["default", "acceptEdits", "plan", "bypassPermissions"],
        initial: "default",
        options: [
            ["allow-with-updates", "allow_always"],
            ["allow-once", "allow_once"],
            ["reject", "reject_once"],
        ],
        base: "ANTHROPIC_BASE_URL",
        key: "ANTHROPIC_API_KEY",
        api: "https://api.anthropic.com",
        path: "/v1/messages",
    },
    codex: {
        modes: ["read-only", "workspace-write", "agent", "agent-full-access"],
        initial: "agent",
        // Codex lists Decline before Cancel, both reject_once.
        options: [
            ["allow_once", "allow_once"],
            ["allow_for_session", "allow_always"],
            ["decline", "reject_once"],
            ["cancel", "reject_once"],
        ],
        base: "OPENAI_BASE_URL",
        key: "OPENAI_API_KEY",
        api: "https://api.openai.com/v1",
        path: "/responses",
    },
} as const;

const args = process.argv.slice(2);
const flag = (name: string) => {
    const at = args.indexOf(name);
    return at < 0 ? undefined : (args[at + 1] ?? "");
};
const agent = AGENTS[flag("--as") === "codex" ? "codex" : "claude"];
const ignoreAnswers = args.includes("--ignore-answers");
const pinned = flag("--pin-mode");
const exitAfterPrompt = args.includes("--exit-after-prompt");
const options: Option[] = agent.options.map(([optionId, kind]) => ({
    optionId,
    name: optionId,
    kind,
}));

// Each session's directory.
const sessions = new Map<string, string>();
const cancelled = new Set<string>();
const waiting = new Map<number, (message: Message) => void>();
let lastId = 0;

type Message = {
    id?: number | string;
    method?: string;
    params?: Record<string, unknown>;
    result?: Record<string, unknown>;
    error?: unknown;
};

const send = (message: object) =>
    process.stdout.write(`${JSON.stringify({ jsonrpc: "2.0", ...message })}\n`);

const request = (method: string, params: object) =>
    new Promise<Message>((resolve) => {
        const id = ++lastId;
        waiting.set(id, resolve);
        send({ id, method, params });
    });

const update = (sessionId: string, value: object) =>
    send({ method: "session/update", params: { sessionId, update: value } });

const modeState = (mode: string) => ({
    modes: {
        currentModeId: mode,
        availableModes: agent.modes.map((id) => ({ id, name: id })),
    },
    configOptions: [
        {
            id: "mode",
            name: "Mode",
            category: "mode",
            type: "select",
            currentValue: mode,
            options: agent.modes.map((value) => ({ value, name: value })),
        },
    ],
});

// Each session's mode, kept in its directory so that a load in a later
// process restores it, as a real agent's stored session does; a session
// it has no record of fails to load.
const saved = (cwd: string): Record<string, string> => {
    try {
        return JSON.parse(readFileSync(join(cwd, ".fake-agent.json"), "utf8"));
    } catch {
        return {};
    }
};

const open = (sessionId: string, cwd: string, mode: string) => {
    const shown = pinned ?? mode;
    sessions.set(sessionId, cwd);
    writeFileSync(
        join(cwd, ".fake-agent.json"),
        JSON.stringify({ ...saved(cwd), [sessionId]: shown }),
    );
    return { sessionId, ...modeState(shown) };
};

// The model call: its status, or "unreachable".
const callModel = () =>
    fetch(`${process.env[agent.base] ?? agent.api}${agent.path}`, {
        method: "POST",
        headers: {
            "x-api-key": process.env[agent.key] ?? "",
            authorization: `Bearer ${process.env[agent.key] ?? ""}`,
        },
        body: "{}",
        signal: AbortSignal.timeout(10_000),
    }).then(
        (response) => String(response.status),
        () => "unreachable",
    );

async function prompt(sessionId: string, text: string) {
    const cwd = sessions.get(sessionId);
    if (cwd === undefined) {
        throw new Error(`unknown session ${sessionId}`);
    }
    cancelled.delete(sessionId);
    const lines = [`model: ${await callModel()}`];
    const command = text.match(/`([^`]+)`/)?.[1];
    if (command !== undefined) {
        const toolCallId = randomUUID();
        const toolCall = {
            toolCallId,
            title: command,
            kind: "execute",
            rawInput: { command },
        };
        update(sessionId, {
            sessionUpdate: "tool_call",
            status: "pending",
            ...toolCall,
        });
        const answer = args.includes("--never-ask")
            ? {
                  result: {
                      outcome: {
                          outcome: "selected",
                          optionId: options.find((o) => o.kind === "allow_once")
                              ?.optionId,
                      },
                  },
              }
            : await request("session/request_permission", {
                  sessionId,
                  toolCall,
                  options,
              });
        const outcome = answer.result?.outcome as
            | { outcome: string; optionId?: string }
            | undefined;
        const chosen = options.find(
            (option) =>
                outcome?.outcome === "selected" &&
                option.optionId === outcome.optionId,
        );
        lines.push(
            `permission: ${outcome?.optionId ?? outcome?.outcome ?? "error"}`,
        );
        if (chosen?.kind.startsWith("allow") || ignoreAnswers) {
            const run = Bun.spawnSync(["sh", "-c", command], {
                cwd,
                stderr: "pipe",
            });
            update(sessionId, {
                sessionUpdate: "tool_call_update",
                toolCallId,
                status: run.exitCode === 0 ? "completed" : "failed",
            });
            lines.push(
                `exit ${run.exitCode}`,
                `${run.stdout}${run.stderr}`.trim(),
            );
        } else {
            update(sessionId, {
                sessionUpdate: "tool_call_update",
                toolCallId,
                status: "failed",
            });
            lines.push("not run");
            if (outcome?.outcome !== "selected") {
                cancelled.add(sessionId);
            }
        }
    }
    update(sessionId, {
        sessionUpdate: "agent_message_chunk",
        content: { type: "text", text: lines.join("\n") },
    });
    return { stopReason: cancelled.has(sessionId) ? "cancelled" : "end_turn" };
}

function setMode(sessionId: string, modeId: string) {
    const cwd = sessions.get(sessionId);
    if (cwd === undefined || !agent.modes.some((id) => id === modeId)) {
        throw new Error(`cannot set mode ${modeId}`);
    }
    const { modes, configOptions } = open(sessionId, cwd, modeId);
    update(sessionId, {
        sessionUpdate: "current_mode_update",
        currentModeId: modes.currentModeId,
    });
    update(sessionId, { sessionUpdate: "config_option_update", configOptions });
    return {};
}

async function answer(message: Message) {
    const params = message.params ?? {};
    const sessionId = String(params.sessionId ?? "");
    switch (message.method) {
        case "initialize":
            return {
                protocolVersion: 1,
                agentCapabilities: { loadSession: true },
                authMethods: [],
            };
        case "session/new":
            return open(randomUUID(), String(params.cwd), agent.initial);
        case "session/load": {
            const cwd = String(params.cwd);
            const mode = saved(cwd)[sessionId];
            if (mode === undefined) {
                throw new Error(`no session ${sessionId}`);
            }
            const { modes, configOptions } = open(sessionId, cwd, mode);
            return { modes, configOptions };
        }
        case "session/set_mode":
            return setMode(sessionId, String(params.modeId));
        case "session/prompt": {
            const blocks = (params.prompt ?? []) as { text?: string }[];
            return prompt(sessionId, blocks.map((b) => b.text ?? "").join(""));
        }
        default:
            throw new Error(`no method ${message.method}`);
    }
}

for await (const line of createInterface({ input: process.stdin })) {
    if (line.trim() === "") {
        continue;
    }
    const message = JSON.parse(line) as Message;
    if (message.method === undefined && message.id !== undefined) {
        waiting.get(Number(message.id))?.(message);
        waiting.delete(Number(message.id));
    } else if (message.method === "session/cancel") {
        cancelled.add(String(message.params?.sessionId));
    } else if (message.id !== undefined) {
        const id = message.id;
        answer(message).then(
            (result) => {
                send({ id, result });
                if (exitAfterPrompt && message.method === "session/prompt") {
                    process.stdout.write("", () => process.exit(0));
                }
            },
            (error: Error) =>
                send({ id, error: { code: -32603, message: error.message } }),
        );
    }
}
