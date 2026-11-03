// vim:set expandtab shiftwidth=4 filetype=typescript:
// SPDX-License-Identifier: GPL-3.0-only

//
//
// ~chewygumxx/dorothy.git
// ::: :/packages/cli/src/hosts/pi/extension.test.ts
//
//

// Dorothy's Pi extension against a fake ExtensionAPI: the handlers Pi
// would call, in Pi's order, with its context, and the stand-in
// `dorothy` executable as the helper. The published CLI's own run is
// wire.test.ts.

import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type {
    PiHookReply as MemoryReply,
    PiHookRequest as MemoryRequest,
} from "@dorothy/memory/host-hook";
import type {
    ExtensionAPI,
    ProviderConfig,
} from "@earendil-works/pi-coding-agent";
import type * as Helper from "../../../assets/pi/helper.js";
import { hookInvoker } from "../../../assets/pi/helper.js";
import type * as Extension from "../../../assets/pi/index.js";
import { dorothyExtension } from "../../../assets/pi/index.js";
import type { PiLaunchManifest } from "./models.js";
import {
    fixtureManifest,
    hookRequests,
    KEY_NAME,
    MODEL,
    PROVIDER,
    piRoots,
    type Roots,
    SYNTHETIC_KEY,
    scriptHook,
} from "./testing.js";

// The helper speaks memory's contract, re-declared on Node's side.
const request: MemoryRequest = {} as Helper.PiHookRequest;
const helperRequest: Helper.PiHookRequest = {} as MemoryRequest;
const reply: MemoryReply = {} as Helper.PiHookReply;
const helperReply: Helper.PiHookReply = {} as MemoryReply;
const manifestShape: Extension.PiManifest = {} as PiLaunchManifest;
void [request, helperRequest, reply, helperReply, manifestShape];

type Server = ReturnType<typeof Extension.memoryServer>;
type Handler = (event: never, ctx: never) => unknown;
type Bag = Record<string, unknown>;
type Entry = Bag;
type Model = { provider: string; id: string };
type Message = Bag & { role?: string; customType?: string; content?: unknown };
// What a handler returned: a context's messages, a decision or a block,
// read by each test as the one it expects.
type Emitted = Bag & { messages: Message[] };
type Tool = { name: string; sourceInfo: { source: string; path: string } };
type Session = {
    id: string;
    file: string | null;
    cwd: string;
    entries: Entry[];
    trusted?: boolean;
    // Torn down, as a replaced runtime's context is: reading it throws.
    stale?: boolean;
};

// The parts of ExtensionAPI Dorothy's extension uses, recording what it
// asked of Pi. One per extension instance, as Pi builds one per runtime.
function fakePi(session: Session) {
    const handlers = new Map<string, Handler[]>();
    const seen = {
        providers: [] as { name: string; config: ProviderConfig }[],
        servers: [] as { name: string; config: Server }[],
        appended: [] as { customType: string; data: Bag }[],
        models: [] as unknown[],
        notices: [] as { text: string; level: string }[],
        aborted: 0,
        tools: [] as Tool[],
        active: ["read", "bash", "edit", "write"],
    };
    let model: Model | undefined = { provider: PROVIDER, id: MODEL };
    const ctx = () => ({
        cwd: session.cwd,
        hasUI: true,
        mode: "tui",
        model,
        isProjectTrusted: () => session.trusted ?? false,
        abort: () => {
            seen.aborted++;
        },
        modelRegistry: {
            find: (provider: string, id: string) => ({ provider, id }),
        },
        ui: {
            notify: (text: string, level = "info") =>
                seen.notices.push({ text, level }),
        },
        sessionManager: {
            getSessionId: () => {
                if (session.stale) throw new Error("stale context");
                return session.id;
            },
            getSessionFile: () => session.file ?? undefined,
            getLeafId: () => (session.entries.at(-1)?.id as string) ?? null,
            getBranch: () => session.entries,
            getEntries: () => session.entries,
            getCwd: () => session.cwd,
        },
    });
    const api = {
        on(event: string, handler: Handler) {
            handlers.set(event, [...(handlers.get(event) ?? []), handler]);
            return () => {};
        },
        registerProvider(name: string, config: ProviderConfig) {
            seen.providers.push({ name, config });
        },
        registerMcpServer(name: string, config: Server) {
            seen.servers.push({ name, config });
        },
        appendEntry(customType: string, data: Bag) {
            seen.appended.push({ customType, data });
            session.entries.push({
                type: "custom",
                id: `cust${session.entries.length}`,
                parentId: session.entries.at(-1)?.id ?? null,
                customType,
                data,
            });
        },
        async setModel(next: Model) {
            seen.models.push(next);
            model = next;
            return true;
        },
        getAllTools: () => seen.tools,
        getActiveTools: () => seen.active,
    };
    // Pi runs handlers in registration order; a context result chains.
    const emit = async (event: string, payload: Bag = {}): Promise<Emitted> => {
        let result: unknown;
        for (const handler of handlers.get(event) ?? []) {
            const value = await (
                handler as (event: Bag, ctx: unknown) => unknown
            )({ type: event, ...payload }, ctx());
            if (value !== undefined) {
                result = value;
                if (event === "context")
                    payload = { ...payload, ...(value as object) };
            }
        }
        return result as Emitted;
    };
    return {
        api: api as unknown as ExtensionAPI,
        emit,
        seen,
        setModel: (next: Model) => {
            model = next;
        },
    };
}

let roots: Roots;
let manifestPath = "";
let manifest: PiLaunchManifest;
let session: Session;
const BASE = "https://api.featherless.fixture/v1";
const envOf = (over: Record<string, string> = {}) => ({
    ...roots.env,
    [KEY_NAME]: SYNTHETIC_KEY,
    DOROTHY_PI_MANIFEST: manifestPath,
    ...over,
});
const start = (over: Partial<Session> = {}, env = envOf()) => {
    session = { ...session, ...over };
    const pi = fakePi(session);
    dorothyExtension(env)(pi.api);
    return pi;
};
const user = (text: string) => ({
    role: "user",
    content: [{ type: "text", text }],
    timestamp: 0,
});
const layers = (messages: readonly Message[]) =>
    messages.filter(
        (message) =>
            message.role === "custom" &&
            message.customType === "dorothy.memory",
    );
const heard = async () =>
    (await hookRequests(roots.fake)).map((h) => h.request);

beforeEach(async () => {
    roots = await piRoots();
    ({ manifest, path: manifestPath } = await fixtureManifest(roots, BASE));
    session = {
        id: "01a1a260-0000-7000-8000-00000000000a",
        file: join(roots.sessionDir, "a.jsonl"),
        cwd: roots.project,
        entries: [],
    };
});
afterEach(async () => {
    await roots.close();
});

describe("the provider", () => {
    it("registers the manifest's models, the key held from Pi's env", () => {
        const env = envOf();
        const pi = start({}, env);
        expect(pi.seen.providers).toHaveLength(1);
        const [{ name, config }] = pi.seen.providers as [
            (typeof pi.seen.providers)[number],
        ];
        expect(name).toBe(PROVIDER);
        expect(config).toMatchObject({
            api: "openai-completions",
            baseUrl: BASE,
            apiKey: SYNTHETIC_KEY,
        });
        // Gone from the environment bash and MCP servers inherit.
        expect(env).not.toHaveProperty(KEY_NAME);
        expect(config.models).toEqual([
            {
                id: MODEL,
                name: MODEL,
                reasoning: true,
                input: ["text"],
                cost: {
                    input: 0.225,
                    output: 0.9,
                    cacheRead: 0.006,
                    cacheWrite: 0,
                },
                contextWindow: 262144,
                maxTokens: 32768,
                // Featherless's template takes thinking on or off alone.
                thinkingLevelMap: { minimal: null, low: null, medium: null },
                compat: {
                    thinkingFormat: "chat-template",
                    chatTemplateKwargs: {
                        thinking: { $var: "thinking.enabled" },
                    },
                    supportsDeveloperRole: false,
                    supportsStore: false,
                },
            },
        ]);
        const { providers: _, ...rest } = pi.seen;
        expect(JSON.stringify(rest)).not.toContain(SYNTHETIC_KEY);
    });

    it("keeps the key it took for a replaced runtime, literally", () => {
        const env = envOf({ [KEY_NAME]: "!run $HOME" });
        const first = start({}, env);
        // Pi loads the extension again into the same process.
        const again = start({}, env);
        for (const pi of [first, again])
            expect(pi.seen.providers[0]?.config.apiKey).toBe("$!run $$HOME");
        // Another launch's manifest has no key taken for it.
        expect(() =>
            start(
                {},
                { ...env, DOROTHY_PI_MANIFEST: join(roots.root, "x.json") },
            ),
        ).toThrow("dorothy_pi_manifest");
    });

    it("refuses to load without its key, naming the variable alone", async () => {
        const other = join(roots.launchDir, "other.json");
        await writeFile(other, JSON.stringify(manifest));
        const env = { ...envOf({ DOROTHY_PI_MANIFEST: other }) };
        delete (env as Record<string, string | undefined>)[KEY_NAME];
        expect(() => start({}, env)).toThrow(`dorothy_pi_key: ${KEY_NAME}`);
    });

    it("refuses to load without a sound manifest", async () => {
        const missing = envOf({
            DOROTHY_PI_MANIFEST: join(roots.root, "none"),
        });
        expect(() => start({}, missing)).toThrow("dorothy_pi_manifest");
        expect(() =>
            start({}, { ...envOf(), DOROTHY_PI_MANIFEST: "" }),
        ).toThrow("dorothy_pi_manifest");
        await writeFile(
            manifestPath,
            JSON.stringify({
                ...manifest,
                entry: { ...manifest.entry, key: "$X" },
            }),
        );
        expect(() => start()).toThrow("dorothy_pi_manifest");
    });

    it("refuses a model outside the manifest and restores the prior one", async () => {
        const pi = start();
        const ours = { provider: PROVIDER, id: MODEL };
        await pi.emit("model_select", {
            model: { provider: "anthropic", id: "claude-x" },
            previousModel: ours,
            source: "set",
        });
        expect(pi.seen.models).toEqual([ours]);
        expect(pi.seen.notices.at(-1)).toMatchObject({ level: "error" });
        expect(pi.seen.notices.at(-1)?.text).toContain("anthropic/claude-x");
        // A restored session's foreign model has no prior: the manifest's.
        await pi.emit("model_select", {
            model: { provider: PROVIDER, id: "other-model" },
            previousModel: undefined,
            source: "restore",
        });
        expect(pi.seen.models).toEqual([ours, ours]);
        await pi.emit("model_select", { model: ours, source: "cycle" });
        expect(pi.seen.models).toHaveLength(2);
        // Nothing foreign reaches inference.
        pi.setModel({ provider: "openai", id: "gpt-x" });
        await pi.emit("before_agent_start", {
            messageType: "user",
            prompt: "hello",
            systemPromptOptions: { sections: {} },
        });
        expect(pi.seen.aborted).toBe(1);
    });
});

describe("her identity", () => {
    const options = () => ({
        messageType: "user",
        prompt: "hello",
        systemPromptOptions: {
            sections: { addendum: "THE USER'S APPEND" } as Record<
                string,
                string
            >,
        },
    });

    it("adds the persona as a section of its own, after Pi's", async () => {
        const persona = join(roots.launchDir, "persona.md");
        await writeFile(persona, "PERSONA MARKER\n");
        await writeFile(manifestPath, JSON.stringify({ ...manifest, persona }));
        const env = envOf();
        const first = start({}, env);
        const seen = options();
        await first.emit("before_agent_start", seen);
        const { sections } = seen.systemPromptOptions;
        expect(sections["dorothy-identity"]).toBe("PERSONA MARKER");
        // Nothing of Pi's is replaced.
        expect(sections.addendum).toBe("THE USER'S APPEND");
        expect(Object.keys(sections)).toEqual([
            "addendum",
            "dorothy-identity",
            "dorothy-capabilities",
        ]);
        // A replaced runtime loads her again and has it still.
        const again = start({}, env);
        const later = options();
        await again.emit("before_agent_start", later);
        expect(later.systemPromptOptions.sections["dorothy-identity"]).toBe(
            "PERSONA MARKER",
        );
    });

    it("refuses to load without the persona its manifest names", async () => {
        const persona = join(roots.launchDir, "gone.md");
        await writeFile(manifestPath, JSON.stringify({ ...manifest, persona }));
        expect(() => start()).toThrow(`dorothy_pi_persona: ${persona}`);
        await writeFile(
            manifestPath,
            JSON.stringify({ ...manifest, persona: 7 }),
        );
        expect(() => start()).toThrow("dorothy_pi_manifest");
    });
});

describe("the memory layer", () => {
    const prompt = (text: string) => ({
        messageType: "user",
        prompt: text,
        systemPromptOptions: { sections: {} as Record<string, string> },
    });

    it("delivers one layer, superseded, never as a human prompt", async () => {
        const pi = start();
        await pi.emit("session_start", { reason: "startup" });
        const options = prompt("the actual user prompt");
        await pi.emit("before_agent_start", options);
        expect(
            options.systemPromptOptions.sections["dorothy-capabilities"],
        ).toContain("mcp__dorothy_memory__");
        const first = await pi.emit("context", {
            messages: [user("the actual user prompt")],
        });
        expect(layers(first.messages)).toHaveLength(1);
        expect(first.messages.at(-1)).toEqual(user("the actual user prompt"));
        expect(layers(first.messages)[0]?.content).toBe(
            `SYNTHETIC BLOCK for ${roots.project}\n\nSYNTHETIC RECALL`,
        );
        // A layer already present, persisted by anything, is replaced.
        const again = await pi.emit("context", { messages: first.messages });
        const activeMemoryLayers = layers(again.messages);
        expect(activeMemoryLayers).toHaveLength(1);
        // A run an extension message started asks for no recall.
        await pi.emit("before_agent_start", {
            messageType: "custom",
            message: { customType: "other" },
            systemPromptOptions: { sections: {} },
        });
        expect(
            (await heard()).map((r) => [r.event, r.reason, r.prompt]),
        ).toEqual([
            ["start", "startup", undefined],
            ["prompt", undefined, "the actual user prompt"],
        ]);
        const [opening] = await heard();
        expect(opening).toEqual({
            event: "start",
            sessionId: session.id,
            sessionFile: session.file,
            leafId: null,
            cwd: roots.project,
            private: false,
            reason: "startup",
        });
    });

    it("refreshes the block after compaction and on reload, never twice", async () => {
        const pi = start();
        await pi.emit("session_start", { reason: "startup" });
        await pi.emit("before_agent_start", prompt("first"));
        await scriptHook(roots.fake, { start: { context: "COMPACTED BLOCK" } });
        await pi.emit("session_compact", { reason: "threshold" });
        const after = await pi.emit("context", { messages: [user("first")] });
        expect(layers(after.messages).map((m) => m.content)).toEqual([
            "COMPACTED BLOCK\n\nSYNTHETIC RECALL",
        ]);
        // Reload builds a new instance; it starts from its own block alone.
        const reloaded = start();
        await reloaded.emit("session_start", { reason: "reload" });
        const fresh = await reloaded.emit("context", {
            messages: [...after.messages, user("second")],
        });
        expect(layers(fresh.messages).map((m) => m.content)).toEqual([
            "COMPACTED BLOCK",
        ]);
        expect((await heard()).map((r) => r.reason ?? r.event)).toEqual([
            "startup",
            "prompt",
            "compact",
            "resume",
        ]);
    });

    it("keeps the latest block when an older opening answers last", async () => {
        await scriptHook(roots.fake, {
            "start:startup": { sleepMs: 600 },
            "start:compact": { context: "COMPACTED BLOCK" },
        });
        const pi = start();
        await pi.emit("session_start", { reason: "startup" });
        await pi.emit("session_compact", { reason: "manual" });
        const contents = async () =>
            layers(
                (await pi.emit("context", { messages: [user("hi")] })).messages,
            ).map((message) => message.content);
        expect(await contents()).toEqual(["COMPACTED BLOCK"]);
        await Bun.sleep(900);
        expect(await contents()).toEqual(["COMPACTED BLOCK"]);
    });

    it("warns, never rejects, when Pi's context is gone", async () => {
        const pi = start({ stale: true });
        await pi.emit("session_start", { reason: "startup" });
        await pi.emit("before_agent_start", prompt("hello"));
        await pi.emit("agent_settled", { aborted: false });
        await pi.emit("session_shutdown", { reason: "quit" });
        expect(pi.seen.notices.map((n) => n.text)).toEqual([
            "Dorothy's memory: pi_hook_failed",
        ]);
        expect(await heard()).toEqual([]);
    });

    it("fails open on a slow helper, killing it", async () => {
        await scriptHook(roots.fake, { prompt: { sleepMs: 20_000 } });
        const pi = start();
        await pi.emit("session_start", { reason: "startup" });
        const began = Date.now();
        await pi.emit("before_agent_start", prompt("hello"));
        const took = Date.now() - began;
        expect(took).toBeGreaterThanOrEqual(2400);
        expect(took).toBeLessThan(4500);
        const result = await pi.emit("context", { messages: [user("hello")] });
        expect(layers(result.messages).map((m) => m.content)).toEqual([
            `SYNTHETIC BLOCK for ${roots.project}`,
        ]);
        expect(pi.seen.notices.map((n) => n.text).join("\n")).toContain(
            "pi_hook_timeout",
        );
        const [{ pid }] = (
            await readFile(join(roots.fake, "hook-pid.jsonl"), "utf8")
        )
            .trim()
            .split("\n")
            .map((line) => JSON.parse(line));
        // SIGKILLed; gone once Node has reaped it.
        const gone = async () => {
            for (let tries = 0; tries < 40; tries++) {
                try {
                    process.kill(pid, 0);
                } catch {
                    return true;
                }
                await Bun.sleep(50);
            }
            return false;
        };
        expect(await gone()).toBe(true);
    }, 10_000);

    it("turns an invalid or oversized reply into a warning alone", async () => {
        const huge = JSON.stringify({
            session: null,
            context: "x".repeat(70 * 1024),
            recording: "pending",
            warning: null,
        });
        for (const [step, code] of [
            [{ raw: "not json SYNTHETIC-HELPER-TEXT" }, "pi_reply_invalid"],
            [{ raw: huge }, "pi_reply_too_large"],
            [
                { warning: "Not A Code: SYNTHETIC-HELPER-TEXT" },
                "pi_reply_invalid",
            ],
            [{ context: 7 }, "pi_reply_invalid"],
        ] as const) {
            await scriptHook(roots.fake, { start: step });
            const pi = start();
            await pi.emit("session_start", { reason: "startup" });
            await pi.emit("before_agent_start", prompt("hello"));
            const result = await pi.emit("context", {
                messages: [user("hello")],
            });
            const text = JSON.stringify(result.messages);
            expect(text).not.toContain("SYNTHETIC-HELPER-TEXT");
            expect(text).not.toContain("xxxx");
            expect(pi.seen.notices.map((n) => n.text).join("\n")).toContain(
                code,
            );
            expect(JSON.stringify(pi.seen.notices)).not.toContain(
                "SYNTHETIC-HELPER-TEXT",
            );
        }
    });

    it("refuses an oversized request without running the helper", async () => {
        const invoke = hookInvoker(manifest, roots.launchDir);
        const answer = await invoke(
            {
                event: "prompt",
                sessionId: session.id,
                sessionFile: null,
                leafId: null,
                cwd: roots.project,
                private: true,
                prompt: "y".repeat(129 * 1024),
            },
            AbortSignal.timeout(2500),
        );
        expect(answer).toEqual({
            session: null,
            context: "",
            recording: "pending",
            warning: "pi_request_too_large",
        });
        expect(await heard()).toEqual([]);
    });

    it("rebinds memory, helper and server to a resumed session's project", async () => {
        const projectB = join(roots.root, "project-b");
        const a = start();
        await a.emit("session_start", { reason: "startup" });
        await a.emit("before_agent_start", prompt("in A"));
        await a.emit("session_shutdown", {
            reason: "resume",
            targetSessionFile: join(roots.sessionDir, "b.jsonl"),
        });
        // Pi tears the runtime down and loads the extension anew there.
        const b = start({
            id: "01a1a260-0000-7000-8000-00000000000b",
            file: join(roots.sessionDir, "b.jsonl"),
            cwd: projectB,
            entries: [],
        });
        await b.emit("session_start", { reason: "resume" });
        await b.emit("before_agent_start", prompt("in B"));
        const result = await b.emit("context", { messages: [user("in B")] });
        expect(layers(result.messages).map((m) => m.content)).toEqual([
            `SYNTHETIC BLOCK for ${projectB}\n\nSYNTHETIC RECALL`,
        ]);
        expect(a.seen.servers.map((s) => s.config.cwd)).toEqual([
            roots.project,
        ]);
        expect(b.seen.servers.map((s) => s.config.cwd)).toEqual([projectB]);
        const requests = await heard();
        expect(requests.map((r) => [r.event, r.cwd])).toEqual([
            ["start", roots.project],
            ["prompt", roots.project],
            ["end", roots.project],
            ["start", projectB],
            ["prompt", projectB],
        ]);
        expect(requests[3]).toMatchObject({
            reason: "resume",
            sessionId: "01a1a260-0000-7000-8000-00000000000b",
        });
    });

    it("keeps a session without a file off the record", async () => {
        const pi = start({ file: null });
        await pi.emit("session_start", { reason: "startup" });
        await pi.emit("agent_settled", { aborted: false });
        await pi.emit("session_shutdown", { reason: "quit" });
        expect(
            (await heard()).map((r) => [r.event, r.private, r.sessionFile]),
        ).toEqual([
            ["start", true, null],
            ["settled", true, null],
            ["end", true, null],
        ]);
    });
});

describe("the memory server", () => {
    it("is hers alone, direct, in the current directory, filtered", async () => {
        await writeFile(
            manifestPath,
            JSON.stringify({
                ...manifest,
                helperEnv: {
                    ...manifest.helperEnv,
                    LITERAL: "$HOME and $" + "{PATH}",
                    BANG: "!not-a-command",
                },
            }),
        );
        const pi = start({}, envOf({ NODE_OPTIONS: "--require=/x.js" }));
        await pi.emit("session_start", { reason: "startup" });
        expect(pi.seen.servers).toHaveLength(1);
        const [{ name, config }] = pi.seen.servers as [
            (typeof pi.seen.servers)[number],
        ];
        expect(name).toBe("dorothy-memory");
        expect(config).toMatchObject({
            command: manifest.self[0],
            args: [...manifest.self.slice(1), "--mcp", "--host", "pi"],
            cwd: roots.project,
            exposure: "direct",
        });
        // Pi starts a server with its own environment beneath this one.
        expect(config.env[KEY_NAME]).toBe("");
        expect(config.env.NODE_OPTIONS).toBe("");
        expect(config.env.LITERAL).toBe("$$HOME and $${PATH}");
        expect(config.env.BANG).toBe("$!not-a-command");
        expect(config.env.FAKE_DOROTHY_DIR).toBe(roots.fake);
        expect(JSON.stringify(config)).not.toContain(SYNTHETIC_KEY);
    });

    it("gives the helper the manifest's environment alone", async () => {
        const pi = start();
        await pi.emit("session_start", { reason: "startup" });
        await pi.emit("session_shutdown", { reason: "quit" });
        const [seen] = await hookRequests(roots.fake);
        // Names a Node wrapper on PATH adds may join; none of Pi's do.
        const names = seen?.envNames ?? [];
        for (const name of Object.keys(manifest.helperEnv))
            expect(names).toContain(name);
        for (const name of Object.keys(envOf()))
            if (!(name in manifest.helperEnv))
                expect(names).not.toContain(name);
        expect(seen?.cwd).toBe(roots.launchDir);
    });

    it("refuses a project server that would shadow hers", async () => {
        const project = join(roots.project, ".pi");
        await mkdir(project, { recursive: true });
        await writeFile(
            join(project, "mcp.json"),
            JSON.stringify({
                mcpServers: { dorothy_memory: { command: "x" } },
            }),
        );
        const pi = start();
        const decision = await pi.emit("project_trust", { cwd: roots.project });
        expect(decision as Bag).toEqual({ trusted: "no" });
        expect(pi.seen.notices.at(-1)?.text).toContain("pi_mcp_collision");
        // Trusted anyway, by another decision: hers is not registered and
        // its name is never called.
        const trusted = start({ trusted: true });
        await trusted.emit("session_start", { reason: "startup" });
        expect(trusted.seen.servers).toEqual([]);
        expect(
            await trusted.emit("tool_call", {
                toolName: "mcp__dorothy_memory__search",
                toolCallId: "call-1",
                input: {},
            }),
        ).toMatchObject({ block: true });
        await writeFile(
            join(project, "mcp.json"),
            JSON.stringify({ mcpServers: { tools: { command: "x" } } }),
        );
        expect(
            (await start().emit("project_trust", {
                cwd: roots.project,
            })) as Bag,
        ).toEqual({
            trusted: "undecided",
        });
    });

    it("refuses a profile server that would shadow hers", async () => {
        await writeFile(
            join(roots.agentDir, "mcp.json"),
            JSON.stringify({
                mcpServers: { "dorothy-memory": { url: "http://x" } },
            }),
        );
        const pi = start();
        await pi.emit("session_start", { reason: "startup" });
        expect(pi.seen.servers).toEqual([]);
        expect(pi.seen.notices.at(-1)).toMatchObject({ level: "error" });
    });

    it("reports what joined her tested loadout, once", async () => {
        await mkdir(join(roots.project, ".pi"), { recursive: true });
        await writeFile(
            join(roots.project, ".pi", "mcp.json"),
            JSON.stringify({ mcpServers: { tools: { command: "x" } } }),
        );
        const pi = start({ trusted: true });
        pi.seen.tools.push(
            {
                name: "read",
                sourceInfo: { source: "builtin", path: "builtin:read" },
            },
            {
                name: "foreign",
                sourceInfo: { source: "local", path: "/x/ext.ts" },
            },
        );
        pi.seen.active.push("codemode");
        await pi.emit("session_start", { reason: "startup" });
        await pi.emit("before_agent_start", {
            messageType: "user",
            prompt: "hello",
            systemPromptOptions: { sections: {} },
        });
        await pi.emit("before_agent_start", {
            messageType: "user",
            prompt: "again",
            systemPromptOptions: { sections: {} },
        });
        const deviations = pi.seen.notices.filter((n) =>
            n.text.includes("tested loadout"),
        );
        expect(deviations).toHaveLength(1);
        for (const name of ["tools", "foreign", "codemode"])
            expect(deviations[0]?.text).toContain(name);
        expect(deviations[0]?.text).not.toContain("read");
    });
});

describe("recording", () => {
    const assistantWith = (
        id: string,
        parentId: string | null,
        callId: string,
    ) => ({
        type: "message",
        id,
        parentId,
        timestamp: "2026-11-03T09:00:02.000Z",
        message: {
            role: "assistant",
            content: [
                { type: "toolCall", id: callId, name: "read", arguments: {} },
            ],
            stopReason: "toolUse",
        },
    });
    const resultOf = (id: string, parentId: string, callId: string) => ({
        type: "message",
        id,
        parentId,
        timestamp: "2026-11-03T09:00:03.000Z",
        message: {
            role: "toolResult",
            toolCallId: callId,
            toolName: "read",
            content: [{ type: "text", text: "ok" }],
            isError: false,
        },
    });
    const ended = (
        toolCallId: string,
        extra: Record<string, unknown> = {},
    ) => ({
        toolCallId,
        toolName: "read",
        result: {
            content: [
                { type: "text", text: "Operation aborted" },
                { type: "image", data: "c3ludGhldGlj", mimeType: "image/png" },
            ],
        },
        isError: true,
        ...extra,
    });

    it("writes one tool-final for a finalized call Pi saved no result for", async () => {
        const pi = start({
            entries: [assistantWith("asst0001", null, "call-1")],
        });
        await pi.emit("session_start", { reason: "startup" });
        await pi.emit("tool_execution_end", ended("call-1"));
        await pi.emit(
            "tool_execution_end",
            ended("call-1/1", { parentToolCallId: "call-1" }),
        );
        await pi.emit("agent_settled", { aborted: true });
        await pi.emit("agent_settled", { aborted: false });
        expect(pi.seen.appended).toEqual([
            {
                customType: "dorothy.tool-final",
                data: {
                    entryId: "asst0001",
                    toolCallId: "call-1",
                    content: [
                        { type: "text", text: "Operation aborted" },
                        { type: "image" },
                    ],
                    isError: true,
                },
            },
        ]);
        await pi.emit("session_shutdown", { reason: "quit" });
        const events = (await heard()).map((r) => [r.event, r.leafId]);
        expect(events).toEqual([
            ["start", "asst0001"],
            ["settled", "cust1"],
            ["settled", "cust1"],
            ["end", "cust1"],
        ]);
    });

    it("writes none where Pi saved the result, or before the call is saved", async () => {
        const pi = start({
            entries: [
                assistantWith("asst0001", null, "call-1"),
                resultOf("rslt0001", "asst0001", "call-1"),
            ],
        });
        await pi.emit("session_start", { reason: "startup" });
        await pi.emit("tool_execution_end", ended("call-1"));
        await pi.emit("tool_execution_end", ended("call-2"));
        await pi.emit("agent_settled", { aborted: false });
        expect(pi.seen.appended).toEqual([]);
        // The call's identity is persisted later: then, and only then.
        session.entries.push(assistantWith("asst0002", "rslt0001", "call-2"));
        await pi.emit("agent_settled", { aborted: false });
        expect(pi.seen.appended.map((a) => a.data.entryId)).toEqual([
            "asst0002",
        ]);
    });

    it("waits for pending records before the final notice", async () => {
        await scriptHook(roots.fake, { settled: { sleepMs: 300 } });
        const pi = start();
        await pi.emit("session_start", { reason: "startup" });
        await pi.emit("agent_settled", { aborted: false });
        await pi.emit("session_shutdown", { reason: "quit" });
        expect((await heard()).map((r) => r.event)).toEqual([
            "start",
            "settled",
            "end",
        ]);
    });
});

describe("the extension's assets", () => {
    it("import only Node's built-ins, each other and Pi's types", async () => {
        const dir = join(import.meta.dir, "../../../assets/pi");
        const sources = (await readdir(dir)).filter((name) =>
            name.endsWith(".ts"),
        );
        expect(sources.sort()).toEqual(
            ["context.ts", "helper.ts", "index.ts", "provider.ts"].sort(),
        );
        for (const name of sources) {
            const text = await readFile(join(dir, name), "utf8");
            for (const [, statement, from] of text.matchAll(
                /^(import[^;]*?)from\s+"([^"]+)"/gms,
            )) {
                const typeOnly = /^import\s+type\b/.test(statement ?? "");
                const allowed =
                    from?.startsWith("node:") ||
                    from?.startsWith("./") ||
                    (typeOnly && from === "@earendil-works/pi-coding-agent");
                expect({ name, from, allowed }).toEqual({
                    name,
                    from,
                    allowed: true,
                });
            }
            expect(text).not.toMatch(/\bBun\.|"bun:/);
        }
    });
});
