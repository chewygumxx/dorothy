// vim:set expandtab shiftwidth=4 filetype=typescript:
// SPDX-License-Identifier: GPL-3.0-only

//
//
// ~chewygumxx/dorothy.git
// ::: :/packages/cli/src/hosts/pi/wire.test.ts
//
//

// The published Pi 1.5.0, under a real Node, with Dorothy's extension and
// a launch manifest, against a scripted Chat Completions endpoint on
// loopback: what reaches the wire, and what Pi saves. No network beyond
// loopback, no paid inference, a synthetic key alone.

import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { readdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { readPi } from "@dorothy/memory/host-hook";
import {
    type Captured,
    called,
    type FakeProvider,
    finish,
    fixtureManifest,
    hookRequests,
    KEY_NAME,
    mcpEvents,
    piRoots,
    type Roots,
    reasoning,
    reply,
    runPi,
    SYNTHETIC_KEY,
    startFakeProvider,
    usage,
} from "./testing.js";

let roots: Roots;
let provider: FakeProvider | null = null;
beforeEach(async () => {
    roots = await piRoots();
});
afterEach(async () => {
    await provider?.close();
    provider = null;
    await roots.close();
});

type Message = {
    role: string;
    content?: unknown;
    tool_call_id?: string;
    reasoning_content?: string;
    tool_calls?: { id: string }[];
};
const messagesOf = (request: Captured | undefined) =>
    (request?.body.messages ?? []) as Message[];
const toolsOf = (request: Captured | undefined) =>
    ((request?.body.tools ?? []) as { function: { name: string } }[]).map(
        (tool) => tool.function.name,
    );
const textOf = (message: Message) =>
    typeof message.content === "string"
        ? message.content
        : ((message.content ?? []) as { text?: string }[])
              .map((part) => part.text ?? "")
              .join("");
const memoryLayers = (request: Captured | undefined) =>
    messagesOf(request).filter(
        (message) =>
            message.role === "user" &&
            textOf(message).includes("SYNTHETIC BLOCK"),
    );

// Every file below the roots, as text, and the saved session's reading.
async function everything(dir: string): Promise<string> {
    let text = "";
    for (const name of await readdir(dir, { recursive: true })) {
        text += await readFile(join(dir, name), "utf8").catch(() => "");
    }
    return text;
}
async function savedSession() {
    const [name] = await readdir(roots.sessionDir);
    const lines = (
        await readFile(join(roots.sessionDir, name ?? ""), "utf8")
    ).split("\n");
    return readPi(lines, { parent: null, ended: true });
}

describe("Pi on the wire", () => {
    it("pairs a tool call and replays reasoning, with memory as one layer", async () => {
        provider = startFakeProvider([
            [
                reasoning("synthetic thought"),
                called("call-1", "mcp__dorothy_memory__search", {
                    query: "moss",
                }),
                finish("tool_calls"),
                usage,
            ],
            reply("Found it."),
        ]);
        const { path } = await fixtureManifest(roots, provider.baseUrl);
        const run = await runPi(roots, path, [
            "--thinking",
            "high",
            "the actual user prompt",
        ]);
        expect(run.stderr).toBe("");
        expect(run.code).toBe(0);
        const [firstRequest, secondRequest] = provider.requests;
        expect(provider.requests).toHaveLength(2);
        expect(firstRequest?.path).toBe("/v1/chat/completions");
        // Authenticated from the key Pi holds, the first time and after.
        for (const request of provider.requests)
            expect(request.authorization).toBe(`Bearer ${SYNTHETIC_KEY}`);
        expect(firstRequest?.body.chat_template_kwargs).toEqual({
            thinking: true,
        });
        expect(firstRequest?.body).not.toHaveProperty("reasoning_effort");
        // Her tools are declared directly, and nothing reaches others.
        expect(toolsOf(firstRequest).sort()).toEqual(
            [
                "bash",
                "edit",
                "mcp__dorothy_memory__search",
                "read",
                "write",
            ].sort(),
        );
        const system = textOf(messagesOf(firstRequest)[0] as Message);
        expect(system).toContain("<dorothy-capabilities>");
        expect(secondRequest?.body.messages).toContainEqual(
            expect.objectContaining({ role: "tool", tool_call_id: "call-1" }),
        );
        const replayedAssistant = messagesOf(secondRequest).find(
            (message) => message.role === "assistant",
        );
        expect(replayedAssistant?.reasoning_content).toBe("synthetic thought");
        expect(replayedAssistant?.tool_calls?.map((call) => call.id)).toEqual([
            "call-1",
        ]);
        for (const request of provider.requests) {
            const activeMemoryLayers = memoryLayers(request);
            expect(activeMemoryLayers).toHaveLength(1);
            expect(textOf(activeMemoryLayers[0] as Message)).toContain(
                "SYNTHETIC RECALL",
            );
        }
        // The saved session holds the person's words alone, and the call
        // with its result, once.
        const saved = await savedSession();
        const events = saved.segments.flatMap((segment) => segment.events);
        const recordedHumanPrompts = events
            .filter((event) => event.kind === "user")
            .map((event) => (event.kind === "user" ? event.text : ""));
        expect(recordedHumanPrompts).toEqual(["the actual user prompt"]);
        expect(events.filter((event) => event.kind === "tool")).toEqual([
            expect.objectContaining({
                name: "mcp__dorothy_memory__search",
                output: "SYNTHETIC HIT",
                ok: true,
            }),
        ]);
        // The helper heard each lifecycle event, for this project.
        const heard = (await hookRequests(roots.fake)).map((h) => h.request);
        expect(heard.map((request) => request.event)).toEqual([
            "start",
            "prompt",
            "settled",
            "end",
        ]);
        expect(heard.every((request) => request.cwd === roots.project)).toBe(
            true,
        );
        expect(heard[1]?.prompt).toBe("the actual user prompt");
        // The key went to the endpoint and nowhere else.
        const mcp = await mcpEvents(roots.fake);
        const started = mcp.find((event) => event.kind === "start");
        expect(started?.kind === "start" && started.env[KEY_NAME]).toBe("");
        expect(started?.kind === "start" && started.cwd).toBe(roots.project);
        expect(mcp.filter((event) => event.kind === "call")).toHaveLength(1);
        for (const text of [
            run.argv.join(" "),
            run.stdout,
            run.stderr,
            await everything(roots.root),
        ])
            expect(text).not.toContain(SYNTHETIC_KEY);
    }, 60_000);

    it("records unknown and invalid calls once each, failed", async () => {
        provider = startFakeProvider([
            [
                called("call-1", "no_such_tool", {}),
                called("call-2", "mcp__dorothy_memory__search", {}, 1),
                finish("tool_calls"),
                usage,
            ],
            reply("Both failed."),
        ]);
        const { path } = await fixtureManifest(roots, provider.baseUrl);
        const run = await runPi(roots, path, ["hello"]);
        expect(run.code).toBe(0);
        const answered = messagesOf(provider.requests[1])
            .filter((message) => message.role === "tool")
            .map((message) => message.tool_call_id);
        expect(answered).toEqual(["call-1", "call-2"]);
        const saved = await savedSession();
        const tools = saved.segments
            .flatMap((segment) => segment.events)
            .filter((event) => event.kind === "tool");
        expect(tools.map((event) => event.kind === "tool" && event.ok)).toEqual(
            [false, false],
        );
        // Pi saved both results, so no final of hers stands in for one.
        const [name] = await readdir(roots.sessionDir);
        expect(
            await readFile(join(roots.sessionDir, name ?? ""), "utf8"),
        ).not.toContain("dorothy.tool-final");
        expect(
            (await mcpEvents(roots.fake)).filter(
                (event) => event.kind === "call",
            ),
        ).toEqual([]);
    }, 60_000);

    it("blocks the tools of a profile server that shadows hers", async () => {
        const node = Bun.which("node", { PATH: roots.env.PATH ?? "" });
        await writeFile(
            join(roots.agentDir, "mcp.json"),
            JSON.stringify({
                mcpServers: {
                    "dorothy-memory": {
                        command: node,
                        args: [join(roots.fake, "fake-dorothy.mjs"), "--mcp"],
                        env: { FAKE_DOROTHY_DIR: roots.fake },
                        exposure: "direct",
                    },
                },
            }),
        );
        provider = startFakeProvider([
            [
                called("call-1", "mcp__dorothy_memory__search", { query: "q" }),
                finish("tool_calls"),
                usage,
            ],
            reply("Refused."),
        ]);
        const { path } = await fixtureManifest(roots, provider.baseUrl);
        const run = await runPi(roots, path, ["hello"]);
        expect(run.code).toBe(0);
        const mcp = await mcpEvents(roots.fake);
        // Hers was never registered beside it, and its tool never ran.
        expect(
            mcp
                .filter((event) => event.kind === "start")
                .map((event) => (event.kind === "start" ? event.argv : [])),
        ).toEqual([["--mcp"]]);
        expect(mcp.filter((event) => event.kind === "call")).toEqual([]);
        // The shadow, any server but hers, never inherits the key.
        const shadow = mcp.find((event) => event.kind === "start");
        expect(shadow?.kind === "start" && shadow.envNames).not.toContain(
            KEY_NAME,
        );
        expect(JSON.stringify(mcp)).not.toContain(SYNTHETIC_KEY);
        expect(await everything(roots.root)).not.toContain(SYNTHETIC_KEY);
        const result = messagesOf(provider.requests[1]).find(
            (message) => message.role === "tool",
        );
        expect(textOf(result as Message)).toContain("pi_mcp_collision");
    }, 60_000);

    it("keeps the key from what the model's shell sees", async () => {
        provider = startFakeProvider([
            [
                called("call-1", "bash", { command: "env" }),
                finish("tool_calls"),
                usage,
            ],
            reply("Listed."),
        ]);
        const { path } = await fixtureManifest(roots, provider.baseUrl);
        const run = await runPi(roots, path, ["list the environment"]);
        expect(run.code).toBe(0);
        const output = messagesOf(provider.requests[1]).find(
            (message) => message.role === "tool",
        );
        // The shell ran, with Pi's environment less the key.
        expect(textOf(output as Message)).toContain("PI_CODING_AGENT_DIR=");
        expect(textOf(output as Message)).not.toContain(KEY_NAME);
        expect(textOf(output as Message)).not.toContain(SYNTHETIC_KEY);
        expect(provider.requests).toHaveLength(2);
        for (const request of provider.requests)
            expect(request.authorization).toBe(`Bearer ${SYNTHETIC_KEY}`);
        for (const text of [
            run.stdout,
            run.stderr,
            await everything(roots.root),
        ])
            expect(text).not.toContain(SYNTHETIC_KEY);
    }, 60_000);

    it("sends thinking off as false", async () => {
        provider = startFakeProvider([reply("Plain.")]);
        const { path } = await fixtureManifest(roots, provider.baseUrl);
        const run = await runPi(roots, path, ["--thinking", "off", "hello"]);
        expect(run.code).toBe(0);
        expect(provider.requests[0]?.body.chat_template_kwargs).toEqual({
            thinking: false,
        });
    }, 60_000);

    it("retries a rate limit and a broken stream, never a finished call", async () => {
        await writeFile(
            join(roots.agentDir, "settings.json"),
            JSON.stringify({
                retry: { enabled: true, baseDelayMs: 1, maxRetries: 3 },
            }),
        );
        provider = startFakeProvider([
            { status: 429, body: '{"error":{"message":"rate limited"}}' },
            [
                called("call-1", "mcp__dorothy_memory__search", { query: "q" }),
                finish("tool_calls"),
                usage,
            ],
            { cut: [reasoning("partial")] },
            reply("Recovered."),
        ]);
        const { path } = await fixtureManifest(roots, provider.baseUrl);
        const run = await runPi(roots, path, ["--thinking", "high", "hello"]);
        expect(run.code).toBe(0);
        expect(provider.requests).toHaveLength(4);
        const calls = (await mcpEvents(roots.fake)).filter(
            (event) => event.kind === "call",
        );
        expect(calls).toHaveLength(1);
        // Pi reports each failure in its event stream.
        const errors = run.stdout
            .split("\n")
            .filter(Boolean)
            .map((line) => JSON.parse(line))
            .filter((event) => event.type === "auto_retry_start");
        expect(errors.length).toBeGreaterThanOrEqual(2);
        const saved = await savedSession();
        const tools = saved.segments
            .flatMap((segment) => segment.events)
            .filter((event) => event.kind === "tool");
        expect(tools).toHaveLength(1);
    }, 60_000);
});
