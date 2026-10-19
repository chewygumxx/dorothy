// vim:set expandtab shiftwidth=4 filetype=typescript:
// SPDX-License-Identifier: GPL-3.0-only

//
//
// ~chewygumxx/dorothy.git
// ::: :/packages/memory/src/service/bridge.test.ts
//
//

import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PassThrough } from "node:stream";
import { DEFAULT_CONFIG, type Env } from "@dorothy/core";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { loadProfiles } from "../hosts/profiles.js";
import { runBridge } from "./bridge.js";
import { type RunningService, startService } from "./service.js";
import { tokenStore } from "./tokens.js";

let home: string;
let env: Env;
let running: RunningService;

beforeEach(async () => {
    home = mkdtempSync(join(tmpdir(), "dorothy-bridge-"));
    env = {
        HOME: home,
        XDG_DATA_HOME: join(home, "data"),
        XDG_CACHE_HOME: join(home, "cache"),
        XDG_STATE_HOME: join(home, "state"),
    };
    running = await startService({
        env,
        config: {
            ...DEFAULT_CONFIG,
            history: { ...DEFAULT_CONFIG.history, enabled: false },
        },
        profiles: await loadProfiles(),
        tokens: tokenStore(join(home, "tokens.json")),
        review: null,
        port: 0,
        listen: [],
        warn: () => {},
    });
});
afterEach(async () => {
    await running.stop();
    rmSync(home, { recursive: true, force: true });
});

describe("runBridge", () => {
    it("passes MCP between a host's stdio and the service", async () => {
        const [near, far] = InMemoryTransport.createLinkedPair();
        const bridged = runBridge({
            env,
            url: running.url,
            token: null,
            cwd: home,
            local: far,
            serve: null,
        });
        const client = new Client({ name: "host", version: "1.0.0" });
        await client.connect(near);
        const { tools } = await client.listTools();
        expect(tools).toHaveLength(4);
        await client.close();
        expect(await bridged).toBe(0);
    });

    it("answers a request with an error when the service is down", async () => {
        const [near, far] = InMemoryTransport.createLinkedPair();
        const bridged = runBridge({
            env,
            url: "http://127.0.0.1:9",
            token: null,
            cwd: home,
            local: far,
            serve: null,
        });
        const client = new Client({ name: "host", version: "1.0.0" });
        await expect(client.connect(near)).rejects.toThrow("unreachable");
        await near.close();
        expect(await bridged).toBe(0);
    });

    it("ends when the host closes its stdin", async () => {
        const stdin = new PassThrough();
        const bridged = runBridge({
            env,
            url: "http://127.0.0.1:9",
            token: null,
            cwd: home,
            stdin,
            serve: null,
        });
        await Bun.sleep(50);
        stdin.end();
        const outcome = await Promise.race([
            bridged,
            Bun.sleep(2000).then(() => "hung"),
        ]);
        expect(outcome).toBe(0);
    });
});

// A service of its own that records what it is sent and answers with a
// status, for what the bridge passes on.
describe("runBridge, against a service that answers as told", () => {
    let seen: { url: string; authorization: string | null }[] = [];
    let status = 200;
    let delay = 0;
    let stub: ReturnType<typeof Bun.serve>;
    beforeEach(() => {
        seen = [];
        status = 200;
        delay = 0;
        stub = Bun.serve({
            port: 0,
            hostname: "127.0.0.1",
            fetch: async (request) => {
                seen.push({
                    url: request.url,
                    authorization: request.headers.get("authorization"),
                });
                await Bun.sleep(delay);
                const message = (await request.json()) as {
                    id?: number;
                    method?: string;
                };
                if (status !== 200 || message.id === undefined) {
                    return new Response("no", { status });
                }
                return Response.json({
                    jsonrpc: "2.0",
                    id: message.id,
                    result: {
                        protocolVersion: "2025-06-18",
                        capabilities: {},
                        serverInfo: { name: "stub", version: "1" },
                    },
                });
            },
        });
    });
    afterEach(() => stub.stop(true));

    const start = (more: Partial<Parameters<typeof runBridge>[0]> = {}) => {
        const [near, far] = InMemoryTransport.createLinkedPair();
        const bridged = runBridge({
            env,
            url: `http://127.0.0.1:${stub.port}`,
            token: "dmt_secret",
            cwd: home,
            local: far,
            serve: null,
            ...more,
        });
        return {
            near,
            bridged,
            client: new Client({ name: "h", version: "1" }),
        };
    };

    it("passes the host, and the token as a bearer alone", async () => {
        const { near, bridged, client } = start({ host: "hermes" });
        await client.connect(near);
        const first = seen[0];
        expect(new URL(first?.url ?? "").searchParams.get("host")).toBe(
            "hermes",
        );
        expect(first?.authorization).toBe("Bearer dmt_secret");
        expect(first?.url).not.toContain("dmt_secret");
        await client.close();
        await bridged;
    });

    it("passes the project of the directory it runs in", async () => {
        const repo = join(home, "repo");
        mkdirSync(repo);
        for (const args of [
            ["init", "-q"],
            ["remote", "add", "origin", "https://github.com/me/app.git"],
        ]) {
            Bun.spawnSync(["git", "-C", repo, ...args], {
                env: { PATH: process.env.PATH ?? "", HOME: home },
            });
        }
        const { near, bridged, client } = start({ cwd: repo });
        await client.connect(near);
        expect(new URL(seen[0]?.url ?? "").searchParams.get("project")).toBe(
            "github.com/me/app",
        );
        await client.close();
        await bridged;
    });

    it("says a refusal is a refusal, not an unreachable service", async () => {
        status = 401;
        const { near, bridged, client } = start();
        await expect(client.connect(near)).rejects.toThrow(
            /refused the request \(401\)/,
        );
        await near.close();
        await bridged;
    });

    it("answers a request the service leaves hanging, within a time", async () => {
        delay = 2000;
        const { near, bridged, client } = start({ timeoutMs: 100 });
        const started = Date.now();
        await expect(client.connect(near)).rejects.toThrow(/in time/);
        expect(Date.now() - started).toBeLessThan(1000);
        await near.close();
        await bridged;
    });

    it("times a request the service accepted and never answered", async () => {
        // A 202 settles the send, but is no answer.
        status = 202;
        const { near, bridged, client } = start({ timeoutMs: 100 });
        const started = Date.now();
        await expect(client.connect(near)).rejects.toThrow(/in time/);
        expect(Date.now() - started).toBeLessThan(5000);
        await near.close();
        await bridged;
    });

    it("answers rather than rejects when its setup fails", async () => {
        const { near, bridged, client } = start({ url: "not a url" });
        await expect(client.connect(near)).rejects.toThrow(
            /Invalid URL|unreachable/,
        );
        await near.close();
        expect(await bridged).toBe(0);
    });

    it("answers a request sent just before the input ends", async () => {
        delay = 150;
        const stdin = new PassThrough();
        const out = new PassThrough();
        const bridged = runBridge({
            env,
            url: `http://127.0.0.1:${stub.port}`,
            token: null,
            cwd: home,
            stdin,
            stdout: out,
            serve: null,
        });
        let text = "";
        out.on("data", (chunk) => {
            text += String(chunk);
        });
        await Bun.sleep(50);
        stdin.write(
            `${JSON.stringify({
                jsonrpc: "2.0",
                id: 1,
                method: "initialize",
                params: {
                    protocolVersion: "2025-06-18",
                    capabilities: {},
                    clientInfo: { name: "h", version: "1" },
                },
            })}\n`,
        );
        stdin.end();
        expect(await bridged).toBe(0);
        expect(text).toContain('"id":1');
        expect(text).toContain('"serverInfo"');
    });
});
