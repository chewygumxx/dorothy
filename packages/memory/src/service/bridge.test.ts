// vim:set expandtab shiftwidth=4 filetype=typescript:
// SPDX-License-Identifier: GPL-3.0-only

//
//
// ~chewygumxx/dorothy.git
// ::: :/packages/memory/src/service/bridge.test.ts
//
//

import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
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
