// vim:set expandtab shiftwidth=4 filetype=typescript:
// SPDX-License-Identifier: GPL-3.0-only

//
//
// ~xxdorothy/dorothy.git
// ::: :/packages/cli/src/hosts/pi/wire.test.ts
//
//

// The published Pi 1.5.0, under a real Node, with Dorothy's extension and
// a launch manifest, against a scripted Chat Completions endpoint on
// loopback: what reaches the wire, and what Pi saves. No network beyond
// loopback, no paid inference, a synthetic key alone.

import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { existsSync } from "node:fs";
import { readdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { readPi } from "@dorothy/memory/host-hook";
import {
    archive,
    type Conversation,
    deliveryEnv,
    KEYS,
    launchNative,
    type NativePi,
    SELF,
    startMemoryService,
    sweepOnce,
} from "./delivery-testing.js";
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

    // Her provider guard stops a run on a model outside the launch with
    // ctx.abort() in before_agent_start (assets/pi/provider.ts): Pi 1.5.0
    // must then send nothing.
    it("sends nothing for a run aborted before it starts", async () => {
        const aborting = join(roots.fake, "abort-extension.ts");
        await writeFile(
            aborting,
            [
                "export default (pi: any) => {",
                '    pi.on("before_agent_start", (_event: unknown, ctx: any) => {',
                "        ctx.abort();",
                "    });",
                "};",
                "",
            ].join("\n"),
        );
        provider = startFakeProvider([reply("Never asked.")]);
        const { path } = await fixtureManifest(roots, provider.baseUrl);
        const run = await runPi(roots, path, ["-e", aborting, "hello"]);
        expect(provider.requests).toEqual([]);
        expect(run.stdout).not.toContain("Never asked.");
        expect(run.code).toBe(0);
        // The prompt was taken, and the run stopped before any reply.
        const events = (await savedSession()).segments.flatMap(
            (segment) => segment.events,
        );
        expect(events.map((event) => event.kind)).toEqual(["user"]);
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

// The prompt a request answers: its latest human words, the memory layer
// before them aside.
const promptOf = (request: Captured) =>
    textOf(
        messagesOf(request).findLast((message) => message.role === "user") ?? {
            role: "user",
        },
    );
const lastRole = (request: Captured) => messagesOf(request).at(-1)?.role;

// Waits for a condition, 20 s at most, failing with what Pi showed.
async function until(done: () => boolean, what: string, pi: NativePi) {
    const deadline = Date.now() + 20_000;
    while (!done()) {
        if (Date.now() > deadline)
            throw new Error(
                `${what}; the screen ends:\n${pi.screen().slice(-1500)}`,
            );
        await Bun.sleep(50);
    }
}

describe("Pi in its own terminal", () => {
    // `dorothy --pi` in a pseudo-terminal, the native interface throughout:
    // her real `--pi-hook` and `--mcp` against her memory service on the
    // roots, tool calls, one interrupted, a reload, a resume, compaction
    // and a fork from past it, then
    // the launcher killed mid-turn, before anything of hers can catch up,
    // and `dorothy --sweep` twice, the second with every cache lost.
    it("records a native session once each, through a killed launcher", async () => {
        const service = await startMemoryService(roots);
        const started = join(roots.root, "bash-started");
        let release = () => {};
        const held = new Promise<void>((done) => {
            release = done;
        });
        provider = startFakeProvider(async (request) => {
            const prompt = promptOf(request);
            // Compaction's summaries: Pi asks with no tools.
            if (toolsOf(request).length === 0)
                return reply("SYNTHETIC SUMMARY");
            if (prompt === "look up moss" && lastRole(request) === "user")
                return [
                    reasoning("synthetic thought"),
                    called("call-moss", "mcp__dorothy_memory__search", {
                        query: "moss",
                    }),
                    finish("tool_calls"),
                    usage,
                ];
            if (prompt === "run slow" && lastRole(request) === "user")
                return [
                    called("call-slow", "bash", {
                        command: `touch ${started} && sleep 30`,
                    }),
                    finish("tool_calls"),
                    usage,
                ];
            if (prompt === "run quick" && lastRole(request) === "user")
                return [
                    called("call-quick", "bash", { command: "echo QUICK" }),
                    finish("tool_calls"),
                    usage,
                ];
            // The turn the launcher dies in: never answered.
            if (prompt === "run quick") {
                await held;
                return undefined;
            }
            return reply(`Answer to ${prompt}.`);
        });
        const env = deliveryEnv(roots, service.url);
        const plan = { env, self: SELF, baseUrl: provider.baseUrl };
        const launched: NativePi[] = [];
        try {
            const first = await launchNative(roots, { ...plan, args: [] });
            launched.push(first);
            await first.waitFor("v1.5.0");
            await first.send("look up moss");
            await first.waitFor("Answer to look up moss.");
            // A reload builds her extension again, key and all.
            await first.send("/reload");
            await first.waitFor("Reloaded keybindings");
            await first.send("after reload");
            await first.waitFor("Answer to after reload.");
            // A call the person interrupts, with escape, as it runs.
            await first.send("run slow");
            // Escape once bash is running, as its marker shows: drawn
            // alone, the call may not have started yet.
            await until(() => existsSync(started), "bash never started", first);
            first.type(KEYS.escape);
            await first.waitFor("Command aborted");
            await first.send("/quit");
            expect(await first.exited).toBe(0);
            // Her real hook recorded it as it went, through the service.
            for (let tries = 0; ; tries++) {
                const said = (await archive(env)).flatMap((c) => c.events);
                if (said.some((event) => event.text === "run slow")) break;
                if (tries > 100) throw new Error("the hook never recorded");
                await Bun.sleep(100);
            }

            // A preference of the user's: compact all but the latest.
            const settings = join(roots.agentDir, "settings.json");
            const kept = JSON.parse(
                await readFile(settings, "utf8").catch(() => "{}"),
            );
            await writeFile(
                settings,
                JSON.stringify({
                    ...kept,
                    compaction: { keepRecentTokens: 1 },
                }),
            );

            const second = await launchNative(roots, {
                ...plan,
                args: ["--resume"],
            });
            launched.push(second);
            await second.waitFor("Resume Session");
            await second.waitFor("look up moss");
            const picked = second.mark();
            second.type(KEYS.enter);
            // The resumed session, drawn again to its latest entry.
            await second.waitFor("Command aborted", picked);
            await second.send("second prompt");
            await second.waitFor("Answer to second prompt.");
            await second.send("/compact");
            await second.waitFor("Compacted from");
            await second.send("third prompt");
            await second.waitFor("Answer to third prompt.");
            // A fork from the latest message: past the compaction.
            await second.send("/fork");
            await second.waitFor("Fork from Message");
            second.type(KEYS.enter);
            await second.waitFor("Forked to new session");
            await second.send(" (forked)");
            await second.waitFor("Answer to third prompt (forked).");
            const asked = provider.requests.length;
            await second.send("run quick");
            await second.waitFor("QUICK");
            await until(
                () => provider?.requests.length === asked + 2,
                "the killed turn's second request never came",
                second,
            );
            await second.kill();
        } finally {
            // Nothing a failed step left running outlives the test.
            for (const pi of launched) await pi.kill();
            release();
            await service.stop();
        }

        // What reached the model: her identity, the declared loadout, the
        // memory layer from her service, on every turn and after a reload.
        const turns = provider.requests.filter(
            (request) => toolsOf(request).length > 0,
        );
        for (const request of turns) {
            expect(request.authorization).toBe(`Bearer ${SYNTHETIC_KEY}`);
            const system = textOf(messagesOf(request)[0] as Message);
            expect(messagesOf(request)[0]?.role).toBe("system");
            expect(system).toContain("<dorothy-identity>");
            expect(system).toContain("<dorothy-capabilities>");
            expect(toolsOf(request).sort()).toEqual([
                "bash",
                "edit",
                "mcp__dorothy_memory__brief",
                "mcp__dorothy_memory__open",
                "mcp__dorothy_memory__remember",
                "mcp__dorothy_memory__search",
                "read",
                "write",
            ]);
            expect(
                messagesOf(request).filter(
                    (message) =>
                        message.role === "user" &&
                        textOf(message).startsWith("<memory>"),
                ),
            ).toHaveLength(1);
        }
        expect(turns.map(promptOf)).toContain("after reload");

        // Killed mid-turn: the hooks never told memory of the last turn.
        const ids = (conversations: Conversation[]) =>
            conversations.flatMap((c) => c.events.map((e) => e.sourceUuid));
        const before = await archive(env);
        expect(
            before.flatMap((c) => c.events).map((e) => e.text),
        ).not.toContain("run quick");

        const swept = await sweepOnce(env);
        expect(swept).toMatchObject({ code: 0, err: "" });
        const recovered = await archive(env);
        // The sweep added what the hooks had not, and said so: at least
        // the killed turn's prompt and call.
        const added = ids(recovered).length - ids(before).length;
        expect(added).toBeGreaterThanOrEqual(2);
        expect(swept.out).toContain(`pi: ${added} events in`);
        // Every cache lost, the second sweep reads all again: nothing new.
        await rm(join(roots.root, "state", "dorothy", "sweep.json"));
        await rm(join(roots.root, "state", "dorothy", "pi"), {
            recursive: true,
        });
        const again = await sweepOnce(env);
        expect(again).toMatchObject({ code: 0, err: "" });
        expect(again.out).toContain("pi: 0 events in 0 sessions");
        expect(await archive(env)).toEqual(recovered);
        // It did read them again: their sidecars are back.
        expect(
            await readdir(join(roots.root, "state", "dorothy", "pi")),
        ).not.toEqual([]);

        // Two conversations, the fork's linked to the session it left;
        // resume and compaction kept the first one's, nothing copied.
        expect(recovered).toHaveLength(2);
        const [original, fork] = [...recovered]
            .sort((a, b) => a.events.length - b.events.length)
            .reverse() as [Conversation, Conversation];
        const ofKind = (conversation: Conversation, kind: string) =>
            conversation.events
                .filter((event) => event.kind === kind)
                .map((event) => event.text ?? event.name);
        expect(ofKind(original, "user")).toEqual([
            "look up moss",
            "after reload",
            "run slow",
            "second prompt",
            "third prompt",
        ]);
        // The interrupted call once, failed, with Pi's own saved result:
        // no final of hers stands in for it.
        expect(
            original.events
                .filter((event) => event.kind === "tool")
                .map((event) => [event.name, event.ok, event.output]),
        ).toEqual([
            ["mcp__dorothy_memory__search", true, "[]"],
            ["bash", false, "Command aborted"],
        ]);
        expect(ofKind(fork, "user")).toEqual([
            "third prompt (forked)",
            "run quick",
        ]);
        expect(fork.events.filter((event) => event.kind === "tool")).toEqual([
            expect.objectContaining({
                name: "bash",
                output: "QUICK\n",
                ok: true,
            }),
        ]);
        expect(fork.headers[0]?.parentSession).toBe(
            original.headers[0]?.sourceSession,
        );
        expect(new Set(ids(recovered)).size).toBe(ids(recovered).length);
        // No summary, system prompt or memory layer was taken for speech.
        const text = JSON.stringify(recovered);
        expect(text).not.toContain("SYNTHETIC SUMMARY");
        expect(text).not.toContain("<memory>");
        expect(text).not.toContain("dorothy-identity");
        const saved = await everything(join(roots.root, "data"));
        expect(saved).not.toContain("dorothy.tool-final");
        expect(await everything(roots.root)).not.toContain(SYNTHETIC_KEY);
    }, 180_000);
});
