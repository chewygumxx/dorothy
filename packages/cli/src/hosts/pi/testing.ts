// vim:set expandtab shiftwidth=4 filetype=typescript:
// SPDX-License-Identifier: GPL-3.0-only

//
//
// ~chewygumxx/dorothy.git
// ::: :/packages/cli/src/hosts/pi/testing.ts
//
//

// What the Pi integration tests share: a scripted OpenAI-compatible
// provider on loopback, private roots for every directory Pi or Dorothy
// would touch, a stand-in for `dorothy` (its `--pi-hook` and `--mcp`) and
// the published Pi run under a real Node. No global setup, no network
// beyond loopback and no credential but a synthetic one.

import {
    chmod,
    mkdir,
    mkdtemp,
    readFile,
    realpath,
    rm,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import type { Env, RouteEntry } from "@dorothy/core";
import type { PiLaunchManifest, PiModelSpec } from "./models.js";
import { resolvePiRuntime } from "./runtime.js";

export const CLI_DIR = resolve(import.meta.dir, "../../..");
export const EXTENSION = join(CLI_DIR, "assets/pi/index.ts");
export const SYNTHETIC_KEY = "synthetic-featherless-key-0123456789";
export const KEY_NAME = "FIXTURE_FEATHERLESS_KEY";
export const MODEL = "deepseek-ai/DeepSeek-V4.1-Flash-1017";
export const PROVIDER = "fixture-featherless";

// One streamed reply: Chat Completions chunks, each sent as an SSE data
// line and followed by [DONE]; `cut` sends its chunks and then ends the
// stream with no finish reason or [DONE]; `status` answers with that
// failure instead.
export type Chunk = Record<string, unknown>;
export type Scripted =
    | Chunk[]
    | { cut: Chunk[] }
    | { status: number; body: string };
export type Captured = {
    path: string;
    authorization: string | null;
    body: Record<string, unknown>;
};
export type FakeProvider = {
    baseUrl: string;
    requests: Captured[];
    close(): Promise<void>;
};

const chunk = (
    delta: Record<string, unknown>,
    finish: string | null = null,
) => ({
    id: "chatcmpl-fixture",
    object: "chat.completion.chunk",
    created: 0,
    model: MODEL,
    choices: [{ index: 0, delta, finish_reason: finish }],
});
export const reasoning = (text: string) =>
    chunk({ role: "assistant", reasoning_content: text });
export const said = (text: string) => chunk({ content: text });
export const called = (id: string, name: string, args: unknown, index = 0) =>
    chunk({
        tool_calls: [
            {
                index,
                id,
                type: "function",
                function: { name, arguments: JSON.stringify(args) },
            },
        ],
    });
export const finish = (reason: "stop" | "tool_calls") => chunk({}, reason);
export const usage = {
    id: "chatcmpl-fixture",
    object: "chat.completion.chunk",
    created: 0,
    model: MODEL,
    choices: [],
    usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
};
// A reply of text alone, finished.
export const reply = (text: string): Chunk[] => [
    said(text),
    finish("stop"),
    usage,
];

const encoder = new TextEncoder();
const frame = (data: unknown) =>
    encoder.encode(
        `data: ${typeof data === "string" ? data : JSON.stringify(data)}\n\n`,
    );

// A loopback endpoint answering each request with the next scripted reply,
// and capturing what Pi sent. Past the script it answers 500.
export function startFakeProvider(script: readonly Scripted[]): FakeProvider {
    const requests: Captured[] = [];
    let next = 0;
    const server = Bun.serve({
        hostname: "127.0.0.1",
        port: 0,
        async fetch(request) {
            const path = new URL(request.url).pathname;
            const body = (await request.json().catch(() => ({}))) as Record<
                string,
                unknown
            >;
            requests.push({
                path,
                authorization: request.headers.get("authorization"),
                body,
            });
            const step = script[next++];
            if (step === undefined)
                return new Response("script exhausted", { status: 500 });
            if (!Array.isArray(step) && "status" in step)
                return new Response(step.body, {
                    status: step.status,
                    headers: { "content-type": "application/json" },
                });
            const chunks = Array.isArray(step) ? step : step.cut;
            const cut = !Array.isArray(step);
            const stream = new ReadableStream({
                start(controller) {
                    for (const data of chunks) controller.enqueue(frame(data));
                    // A cut stream stops mid-reply: no finish, no [DONE].
                    if (cut) {
                        controller.close();
                        return;
                    }
                    controller.enqueue(frame("[DONE]"));
                    controller.close();
                },
            });
            return new Response(stream, {
                headers: { "content-type": "text/event-stream" },
            });
        },
    });
    return {
        baseUrl: `http://127.0.0.1:${server.port}/v1`,
        requests,
        close: async () => {
            await server.stop(true);
        },
    };
}

// The PATH with Bun's own `node` alias left out: `bun run test` prepends
// one, and Pi must run under a real Node.
export async function nodePath(path = process.env.PATH ?? ""): Promise<string> {
    const bun = await realpath(process.execPath);
    const kept: string[] = [];
    for (const directory of path.split(":")) {
        const node = Bun.which("node", { PATH: directory });
        if (node && (await realpath(node)) === bun) continue;
        kept.push(directory);
    }
    return kept.join(":");
}

// Every root Pi and Dorothy would use, private to one test.
export type Roots = {
    root: string;
    project: string;
    agentDir: string;
    sessionDir: string;
    launchDir: string;
    fake: string;
    env: Env;
    close(): Promise<void>;
};
export async function piRoots(): Promise<Roots> {
    const root = await realpath(
        await mkdtemp(join(tmpdir(), "dorothy-pi-ext-")),
    );
    const at = (...parts: string[]) => join(root, ...parts);
    const roots = {
        root,
        project: at("project-a"),
        agentDir: at("config", "dorothy", "pi"),
        sessionDir: at("data", "dorothy", "pi", "sessions", "fixture"),
        launchDir: at("runtime", "dorothy", "pi-fixture"),
        fake: at("fake"),
    };
    for (const dir of Object.values(roots))
        await mkdir(dir, { recursive: true, mode: 0o700 });
    await mkdir(at("project-b"), { recursive: true });
    const env: Env = {
        PATH: await nodePath(),
        HOME: root,
        XDG_CONFIG_HOME: at("config"),
        XDG_DATA_HOME: at("data"),
        XDG_STATE_HOME: at("state"),
        XDG_CACHE_HOME: at("cache"),
        XDG_RUNTIME_DIR: at("runtime"),
        PI_CODING_AGENT_DIR: roots.agentDir,
        PI_OFFLINE: "1",
        TERM: "dumb",
    };
    return {
        ...roots,
        env,
        close: () => rm(root, { recursive: true, force: true }),
    };
}

export const spec: PiModelSpec = {
    id: MODEL,
    contextWindow: 262144,
    maxTokens: 32768,
    reasoning: true,
    input: ["text"],
    price: { input: 0.225, output: 0.9, cacheRead: 0.006 },
    checkedAt: "2026-11-03",
    sources: ["fixture"],
};
export const entry = (baseUrl: string): RouteEntry => ({
    provider: PROVIDER,
    kind: "featherless",
    model: MODEL,
    baseUrl,
    key: KEY_NAME,
    price: null,
});

// A launch manifest whose `self` is the stand-in below, under Node, and
// whose helper environment carries its log directory and nothing else
// but the roots.
export async function fixtureManifest(
    roots: Roots,
    baseUrl: string,
    over: Partial<PiLaunchManifest> = {},
): Promise<{ manifest: PiLaunchManifest; path: string }> {
    const node = Bun.which("node", { PATH: roots.env.PATH ?? "" });
    if (!node) throw new Error("fixture: no Node on PATH");
    const self = [node, await writeFakeDorothy(roots.fake)];
    const helperEnv: Env = {
        PATH: roots.env.PATH ?? "",
        HOME: roots.root,
        XDG_DATA_HOME: roots.env.XDG_DATA_HOME ?? "",
        XDG_STATE_HOME: roots.env.XDG_STATE_HOME ?? "",
        FAKE_DOROTHY_DIR: roots.fake,
    };
    const manifest: PiLaunchManifest = {
        version: 1,
        launchId: "fixture",
        cwd: roots.project,
        self,
        entry: entry(baseUrl),
        models: [spec],
        extensions: [EXTENSION],
        skills: [],
        helperEnv,
        ...over,
    };
    const path = join(roots.launchDir, "manifest.json");
    await Bun.write(path, `${JSON.stringify(manifest, null, 2)}\n`);
    await chmod(path, 0o600);
    return { manifest, path };
}

// What the stand-in heard: each hook request with its process's
// environment names, and each MCP session's start and calls.
export type HookSeen = {
    request: Record<string, unknown>;
    envNames: string[];
    cwd: string;
};
export type McpSeen =
    | {
          kind: "start";
          envNames: string[];
          env: Env;
          cwd: string;
          argv: string[];
      }
    | { kind: "call"; name: string; args: unknown };
const lines = async (path: string) =>
    (await readFile(path, "utf8").catch(() => ""))
        .split("\n")
        .filter(Boolean)
        .map((line) => JSON.parse(line));
export const hookRequests = (fake: string): Promise<HookSeen[]> =>
    lines(join(fake, "hook.jsonl"));
export const mcpEvents = (fake: string): Promise<McpSeen[]> =>
    lines(join(fake, "mcp.jsonl"));
// Scripted hook replies by event, or by `event:reason` first: a reply
// object, `{ raw }` text to print as it is, or `{ sleepMs }` before the
// default reply.
export type HookScript = Record<
    string,
    Record<string, unknown> | { raw: string } | { sleepMs: number }
>;
export const scriptHook = (fake: string, script: HookScript) =>
    Bun.write(join(fake, "replies.json"), JSON.stringify(script));

// `dorothy --pi-hook` answers one JSON request on stdin; `dorothy --mcp
// --host pi` is a stdio MCP server with one tool, `search`. Plain Node.
const FAKE_DOROTHY = String.raw`
import { appendFileSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { createInterface } from "node:readline";
const dir = process.env.FAKE_DOROTHY_DIR;
const log = (name, value) =>
    appendFileSync(join(dir, name), JSON.stringify(value) + "\n");
const args = process.argv.slice(2);
if (args.includes("--pi-hook")) {
    let input = "";
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (part) => (input += part));
    process.stdin.on("end", async () => {
        const request = JSON.parse(input);
        log("hook.jsonl", {
            request,
            envNames: Object.keys(process.env).sort(),
            cwd: process.cwd(),
        });
        let script = {};
        try {
            script = JSON.parse(readFileSync(join(dir, "replies.json"), "utf8"));
        } catch {}
        const step =
            script[request.event + ":" + (request.reason ?? "")] ??
            script[request.event] ??
            {};
        if (step.sleepMs) {
            log("hook-pid.jsonl", { pid: process.pid });
            await new Promise((done) => setTimeout(done, step.sleepMs));
        }
        if (typeof step.raw === "string") {
            process.stdout.write(step.raw);
            return;
        }
        const context =
            request.event === "start"
                ? "SYNTHETIC BLOCK for " + request.cwd
                : request.event === "prompt"
                  ? "SYNTHETIC RECALL"
                  : "";
        const reply = {
            session: null,
            context,
            recording: "pending",
            warning: null,
            ...(step.sleepMs ? {} : step),
        };
        process.stdout.write(JSON.stringify(reply));
    });
} else if (args.includes("--mcp")) {
    log("mcp.jsonl", {
        kind: "start",
        envNames: Object.keys(process.env).sort(),
        env: process.env,
        cwd: process.cwd(),
        argv: args,
    });
    const send = (message) =>
        process.stdout.write(JSON.stringify({ jsonrpc: "2.0", ...message }) + "\n");
    const rl = createInterface({ input: process.stdin });
    rl.on("line", (line) => {
        if (!line.trim()) return;
        const message = JSON.parse(line);
        if (message.id === undefined) return;
        if (message.method === "initialize")
            return send({
                id: message.id,
                result: {
                    protocolVersion: message.params.protocolVersion,
                    capabilities: { tools: {} },
                    serverInfo: { name: "fake-dorothy-memory", version: "0" },
                },
            });
        if (message.method === "tools/list")
            return send({
                id: message.id,
                result: {
                    tools: [
                        {
                            name: "search",
                            description: "Search past conversations.",
                            inputSchema: {
                                type: "object",
                                properties: { query: { type: "string" } },
                                required: ["query"],
                            },
                        },
                    ],
                },
            });
        if (message.method === "tools/call") {
            log("mcp.jsonl", {
                kind: "call",
                name: message.params.name,
                args: message.params.arguments,
            });
            return send({
                id: message.id,
                result: { content: [{ type: "text", text: "SYNTHETIC HIT" }] },
            });
        }
        if (message.method === "ping") return send({ id: message.id, result: {} });
        send({
            id: message.id,
            error: { code: -32601, message: "method not found" },
        });
    });
}
`;
export async function writeFakeDorothy(dir: string): Promise<string> {
    const path = join(dir, "fake-dorothy.mjs");
    await mkdir(dirname(path), { recursive: true });
    await Bun.write(path, FAKE_DOROTHY);
    return path;
}

// The published Pi, under the roots' Node, in JSON mode with Dorothy's
// extension and the launch's manifest, as the launcher composes it.
export async function runPi(
    roots: Roots,
    manifestPath: string,
    args: readonly string[],
    over: Env = {},
): Promise<{ code: number; stdout: string; stderr: string; argv: string[] }> {
    const runtime = await resolvePiRuntime(CLI_DIR, roots.env);
    const argv = [
        ...runtime.command,
        "--offline",
        "--session-dir",
        roots.sessionDir,
        "--no-extensions",
        "--no-skills",
        "--no-context-files",
        "-e",
        "builtin:mcp",
        "-e",
        EXTENSION,
        "--model",
        `${PROVIDER}/${MODEL}`,
        "--mode",
        "json",
        ...args,
    ];
    const child = Bun.spawn(argv, {
        cwd: roots.project,
        env: {
            ...roots.env,
            [KEY_NAME]: SYNTHETIC_KEY,
            DOROTHY_PI_MANIFEST: manifestPath,
            ...over,
        },
        stdin: "ignore",
        stdout: "pipe",
        stderr: "pipe",
    });
    const timer = setTimeout(() => child.kill("SIGKILL"), 60_000);
    const [stdout, stderr, code] = await Promise.all([
        new Response(child.stdout).text(),
        new Response(child.stderr).text(),
        child.exited,
    ]);
    clearTimeout(timer);
    return { code, stdout, stderr, argv };
}
