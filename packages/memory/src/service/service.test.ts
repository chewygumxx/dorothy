// vim:set expandtab shiftwidth=4 filetype=typescript:
// SPDX-License-Identifier: GPL-3.0-only

//
//
// ~chewygumxx/dorothy.git
// ::: :/packages/memory/src/service/service.test.ts
//
//

import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import {
    mkdirSync,
    mkdtempSync,
    rmSync,
    symlinkSync,
    truncateSync,
    writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type Config, DEFAULT_CONFIG, type Env } from "@dorothy/core";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { userLine } from "../bodies/fixtures.js";
import { loadProfiles } from "../hosts/profiles.js";
import { MAX_BODY, type RunningService, startService } from "./service.js";
import { type TokenStore, tokenStore } from "./tokens.js";

const AT = "2026-10-18T09:30:00.000Z";
let home: string;
let env: Env;
let tokens: TokenStore;
let token: string;
let running: RunningService | null = null;
let claude: string;
let warned: string[] = [];
const config: Config = {
    ...DEFAULT_CONFIG,
    history: { ...DEFAULT_CONFIG.history, enabled: false },
};

beforeEach(async () => {
    home = mkdtempSync(join(tmpdir(), "dorothy-service-"));
    env = {
        HOME: home,
        XDG_DATA_HOME: join(home, "data"),
        XDG_CACHE_HOME: join(home, "cache"),
        XDG_STATE_HOME: join(home, "state"),
        XDG_CONFIG_HOME: join(home, "config"),
    };
    warned = [];
    claude = join(home, "claude");
    mkdirSync(join(claude, "projects", "-work"), { recursive: true });
    tokens = tokenStore(join(home, "tokens.json"));
    token = await tokens.add("laptop");
});
afterEach(async () => {
    await running?.stop();
    running = null;
    rmSync(home, { recursive: true, force: true });
});

const start = async (remote = false) => {
    running = await startService({
        env,
        config,
        profiles: await loadProfiles(),
        tokens,
        review: null,
        port: 0,
        listen: [],
        loopback: () => !remote,
        warn: (message) => warned.push(message),
        claudeDir: claude,
        maxTranscript: 4096,
    });
    return running;
};
const post = (path: string, body: unknown, headers: HeadersInit = {}) =>
    fetch(`${running?.url}${path}`, {
        method: "POST",
        headers: { "content-type": "application/json", ...headers },
        body: typeof body === "string" ? body : JSON.stringify(body),
    });

describe("the memory service", () => {
    it("answers loopback without a token", async () => {
        await start();
        const response = await fetch(`${running?.url}/v1/health`);
        expect(response.status).toBe(200);
        expect(await response.json()).toEqual({ ok: true });
    });

    it("wants a device token from beyond loopback", async () => {
        await start(true);
        expect((await fetch(`${running?.url}/v1/health`)).status).toBe(401);
        const ok = await fetch(`${running?.url}/v1/health`, {
            headers: { authorization: `Bearer ${token}` },
        });
        expect(ok.status).toBe(200);
    });

    it("refuses a transcript path from beyond loopback, token or not", async () => {
        await start(true);
        const response = await post(
            "/v1/record",
            { host: "claude-code", session: "s", transcript: "/etc/passwd" },
            { authorization: `Bearer ${token}` },
        );
        expect(response.status).toBe(403);
    });

    it("names a host with no profile", async () => {
        await start();
        const response = await post("/v1/block", {
            host: "nobody",
            session: "s",
            reason: "startup",
        });
        expect(response.status).toBe(400);
        expect((await response.json()).error).toContain(
            "no profile for host nobody",
        );
    });

    it("answers a body that is not JSON, or too large, in the contract's shape", async () => {
        await start();
        const bad = await post("/v1/block", "{not json");
        expect(bad.status).toBe(400);
        expect(await bad.json()).toEqual({ error: "the body is not JSON" });
        const large = await post("/v1/record", "x".repeat(MAX_BODY + 1024));
        expect(large.status).toBe(413);
        expect((await fetch(`${running?.url}/v1/health`)).status).toBe(200);
    });

    it("bounds a body that declares no length", async () => {
        await start();
        const chunk = new TextEncoder().encode("x".repeat(1024 * 1024));
        let sent = 0;
        const body = new ReadableStream<Uint8Array>({
            pull(controller) {
                if (sent++ < 9) {
                    controller.enqueue(chunk);
                } else {
                    controller.close();
                }
            },
        });
        const large = await fetch(`${running?.url}/v1/block`, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body,
            duplex: "half",
        } as RequestInit);
        expect(large.status).toBe(413);
        expect((await fetch(`${running?.url}/v1/health`)).status).toBe(200);
    });

    it("refuses what a web page could send", async () => {
        await start();
        const record = {
            host: "codex",
            session: "s1",
            events: [{ sourceId: "a", at: AT, kind: "user", text: "Hi" }],
        };
        const fromPage = await post("/v1/record", record, {
            origin: "https://evil.example",
        });
        expect(fromPage.status).toBe(403);
        const plain = await fetch(`${running?.url}/v1/record`, {
            method: "POST",
            headers: { "content-type": "text/plain" },
            body: JSON.stringify(record),
        });
        expect(plain.status).toBe(415);
    });

    it("answers a request to another name with 421, warning once", async () => {
        await start(true);
        for (let again = 0; again < 2; again++) {
            const rebound = await fetch(`${running?.url}/v1/health`, {
                headers: {
                    host: "evil.example",
                    authorization: `Bearer ${token}`,
                },
            });
            expect(rebound.status).toBe(421);
            expect(await rebound.json()).toEqual({
                error: "this service does not answer to that name",
            });
        }
        const named = warned.filter((line) => line.includes("evil.example"));
        expect(named).toHaveLength(1);
        expect(named.join("\n")).not.toContain(token);
    });

    it("answers a GET on /mcp with 405, holding nothing open", async () => {
        await start();
        const response = await fetch(`${running?.url}/mcp`, {
            headers: { accept: "text/event-stream" },
        });
        expect(response.status).toBe(405);
    });

    it("listens on loopback when a further address cannot be had", async () => {
        const said: string[] = [];
        running = await startService({
            env,
            config,
            profiles: await loadProfiles(),
            tokens,
            review: null,
            port: 0,
            listen: ["192.0.2.55"],
            warn: (message) => said.push(message),
        });
        expect((await fetch(`${running.url}/v1/health`)).status).toBe(200);
        expect(said.some((message) => message.includes("192.0.2.55"))).toBe(
            true,
        );
    });

    it("recalls for a prompt", async () => {
        await start();
        const response = await post("/v1/recall", {
            host: "codex",
            session: "s1",
            prompt: "tea",
        });
        expect(response.status).toBe(200);
        expect(Object.keys(await response.json()).sort()).toEqual([
            "ids",
            "text",
            "used",
        ]);
    });

    it("records a session and opens the next with a block", async () => {
        await start();
        const recorded = await post("/v1/record", {
            host: "codex",
            session: "s1",
            events: [{ sourceId: "a", at: AT, kind: "user", text: "Tea?" }],
        });
        expect(await recorded.json()).toEqual({
            accepted: 1,
            duplicates: 0,
            through: "a",
        });
        const block = await post("/v1/block", {
            host: "codex",
            session: "s2",
            reason: "startup",
        });
        expect(block.status).toBe(200);
        expect((await block.json()).digest).toMatch(/^xxh3:/);
    });

    it("serves the four tools over MCP", async () => {
        await start();
        const client = new Client({ name: "test", version: "1.0.0" });
        await client.connect(
            new StreamableHTTPClientTransport(new URL(`${running?.url}/mcp`)),
        );
        const { tools } = await client.listTools();
        expect(tools.map((tool) => tool.name).sort()).toEqual([
            "brief",
            "open",
            "remember",
            "search",
        ]);
        await client.close();
    });

    describe("a transcript path from loopback", () => {
        const FIXED = "that transcript cannot be read";
        const named = (transcript: string) =>
            post("/v1/record", {
                host: "claude-code",
                session: "c1",
                transcript,
            });
        const refused = async (transcript: string) => {
            const response = await named(transcript);
            expect(response.status).toBe(403);
            expect(await response.json()).toEqual({ error: FIXED });
        };
        const inside = (name: string) =>
            join(claude, "projects", "-work", name);

        it("reads one inside Claude's projects directory", async () => {
            await start();
            writeFileSync(inside("c1.jsonl"), `${userLine("u1", 0, "hi")}\n`);
            const response = await named(inside("c1.jsonl"));
            expect(response.status).toBe(200);
            expect(await response.json()).toMatchObject({ accepted: 1 });
        });

        it("refuses a path that climbs out of it", async () => {
            await start();
            const outside = join(home, "outside.jsonl");
            writeFileSync(outside, `${userLine("u1", 0, "hi")}\n`);
            await refused(inside("../../../outside.jsonl"));
            await refused(outside);
        });

        it("refuses a symlink pointing out of it", async () => {
            await start();
            const outside = join(home, "outside.jsonl");
            writeFileSync(outside, `${userLine("u1", 0, "hi")}\n`);
            symlinkSync(outside, inside("link.jsonl"));
            await refused(inside("link.jsonl"));
        });

        it("refuses a directory and a file not named .jsonl", async () => {
            await start();
            mkdirSync(inside("dir.jsonl"));
            writeFileSync(inside("notes.txt"), "x\n");
            await refused(inside("dir.jsonl"));
            await refused(inside("notes.txt"));
        });

        it("refuses a file over the cap", async () => {
            await start();
            writeFileSync(inside("big.jsonl"), "");
            truncateSync(inside("big.jsonl"), 4097);
            await refused(inside("big.jsonl"));
        });

        it("refuses a missing file as it does any other", async () => {
            await start();
            await refused(inside("gone.jsonl"));
        });
    });
});
