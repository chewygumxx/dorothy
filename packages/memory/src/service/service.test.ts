// vim:set expandtab shiftwidth=4 filetype=typescript:
// SPDX-License-Identifier: GPL-3.0-only

//
//
// ~chewygumxx/dorothy.git
// ::: :/packages/memory/src/service/service.test.ts
//
//

import { Database } from "bun:sqlite";
import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import {
    existsSync,
    mkdirSync,
    mkdtempSync,
    readdirSync,
    readFileSync,
    rmSync,
    symlinkSync,
    truncateSync,
    utimesSync,
    writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type Config, DEFAULT_CONFIG, type Env } from "@dorothy/core";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { userLine } from "../bodies/fixtures.js";
import { hookLogPath } from "../bodies/log.js";
import { dataRoot } from "../facts/store.js";
import { loadProfiles } from "../hosts/profiles.js";
import { type Entry, indexCatalogue } from "../memory/catalogue.js";
import { isStale } from "../memory/service.js";
import { vocabularyPath } from "../memory/vocabulary.js";
import { indexPath, RecallIndex, SCHEMA_VERSION } from "../recall/store.js";
import { context, message, meta, SESSION } from "../recording/fixtures.js";
import { transcriptDir } from "../transcript.js";
import {
    MAX_BODY,
    type RunningService,
    type ServiceOptions,
    startService,
} from "./service.js";
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

const start = async (
    remote = false,
    settings: Config = config,
    extra: Partial<ServiceOptions> = {},
) => {
    running = await startService({
        env,
        config: settings,
        profiles: await loadProfiles(),
        tokens,
        review: null,
        port: 0,
        listen: [],
        loopback: () => !remote,
        warn: (message) => warned.push(message),
        claudeDir: claude,
        maxTranscript: 4096,
        ...extra,
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

    it("refuses a wrong, revoked or malformed token from beyond loopback", async () => {
        await start(true);
        const body = { host: "codex", session: "s", reason: "startup" };
        const status = async (authorization: string) =>
            (await post("/v1/block", body, { authorization })).status;
        expect(await status(`Bearer ${token}`)).toBe(200);
        expect(await status(`Bearer ${token}x`)).toBe(401);
        expect(await status(`Bearer ${"a".repeat(token.length)}`)).toBe(401);
        expect(await status("Bearer ")).toBe(401);
        expect(await status(token)).toBe(401);
        expect(await status(`bearer ${token}`)).toBe(401);
        await tokens.revoke("laptop");
        expect(await status(`Bearer ${token}`)).toBe(401);
    });

    it("judges loopback by the socket's peer, as the service is run", async () => {
        // No override: the address of a real connection decides.
        running = await startService({
            env,
            config,
            profiles: await loadProfiles(),
            tokens,
            review: null,
            port: 0,
            listen: [],
            warn: (message) => warned.push(message),
        });
        const response = await post("/v1/block", {
            host: "codex",
            session: "s",
            reason: "startup",
        });
        expect(response.status).toBe(200);
    });

    it("answers a POST to a name it does not answer to with 421", async () => {
        await start();
        const response = await post(
            "/v1/record",
            {
                host: "codex",
                session: "s1",
                events: [{ sourceId: "a", at: AT, kind: "user", text: "Hi" }],
            },
            { host: "evil.example" },
        );
        expect(response.status).toBe(421);
        // Nothing was recorded.
        const block = await post("/v1/block", {
            host: "codex",
            session: "s2",
            reason: "startup",
        });
        expect((await block.json()).items).toEqual([]);
        expect(existsSync(transcriptDir(env))).toBe(false);
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

    it("says to restart it once a newer Dorothy has rebuilt the index", async () => {
        await start();
        // As a newer Dorothy's first open does: its own schema, in place.
        const newer = new Database(indexPath(env));
        newer.run("DROP TABLE conversations");
        newer.run(`PRAGMA user_version = ${SCHEMA_VERSION + 1}`);
        newer.close();
        const record = {
            host: "codex",
            session: "s1",
            events: [{ sourceId: "a", at: AT, kind: "user", text: "Hi" }],
        };
        expect((await post("/v1/record", record)).status).toBe(500);
        expect((await post("/v1/record", record)).status).toBe(500);
        const said = `the recall index is schema ${SCHEMA_VERSION + 1}, newer than this service knows (${SCHEMA_VERSION}): a newer Dorothy is installed; stop this service and start it again (dorothy --serve)`;
        expect(warned.filter((message) => message === said)).toHaveLength(1);
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

    it("bounds a body that declares no length, on every route", async () => {
        await start();
        for (const path of ["/v1/block", "/mcp"]) {
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
            const large = await fetch(`${running?.url}${path}`, {
                method: "POST",
                headers: {
                    "content-type": "application/json",
                    accept: "application/json, text/event-stream",
                },
                body,
                duplex: "half",
            } as RequestInit);
            expect({ path, status: large.status }).toEqual({
                path,
                status: 413,
            });
            expect(await large.json()).toEqual({
                error: "the body is over 8 MiB",
            });
        }
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

    it("does no history work when its port is taken", async () => {
        const first = await start();
        const second = mkdtempSync(join(tmpdir(), "dorothy-service-"));
        try {
            const other = {
                HOME: second,
                XDG_DATA_HOME: join(second, "data"),
                XDG_CACHE_HOME: join(second, "cache"),
                XDG_STATE_HOME: join(second, "state"),
                XDG_CONFIG_HOME: join(second, "config"),
            };
            await expect(
                startService({
                    env: other,
                    config: DEFAULT_CONFIG,
                    profiles: await loadProfiles(),
                    tokens,
                    review: null,
                    port: first.ports[0] as number,
                    listen: [],
                    warn: () => {},
                }),
            ).rejects.toThrow();
            // Not even the data directory was made, let alone a repository.
            expect(existsSync(join(second, "data"))).toBe(false);
            expect(existsSync(join(second, "cache"))).toBe(false);
        } finally {
            rmSync(second, { recursive: true, force: true });
        }
    });

    it("quotes a host's version in its warning, and remembers few", async () => {
        await start();
        const block = (hostVersion: string) =>
            post("/v1/block", {
                host: "codex",
                hostVersion,
                session: `s-${hostVersion}`,
                reason: "startup",
            });
        await block("9.9\nwarn: forged");
        expect(warned).toEqual([
            'codex "9.9\\nwarn: forged" is not a version its profile was checked against',
        ]);
        warned.length = 0;
        // Said once while recent; many others push it out of the memory.
        await block("1.0.0");
        await block("1.0.0");
        expect(warned).toHaveLength(1);
        for (let at = 0; at < 130; at++) {
            await block(`2.${at}`);
        }
        warned.length = 0;
        await block("1.0.0");
        expect(warned).toHaveLength(1);
    });

    it("leaves nothing bound when its start fails", async () => {
        const probe = Bun.serve({
            port: 0,
            hostname: "127.0.0.1",
            fetch: () => new Response("x"),
        });
        const port = probe.port as number;
        probe.stop(true);
        const failing: Config = {
            ...config,
            service: {
                ...config.service,
                get claudeDirs(): string[] {
                    throw new Error("injected failure");
                },
            },
        };
        await expect(
            startService({
                env,
                config: failing,
                profiles: await loadProfiles(),
                tokens,
                review: null,
                port,
                listen: [],
                warn: () => {},
            }),
        ).rejects.toThrow("injected failure");
        // The port is free again, so no request waits on a service that
        // will never be ready.
        const again = Bun.serve({
            port,
            hostname: "127.0.0.1",
            fetch: () => new Response("x"),
        });
        again.stop(true);
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

    describe("with reviews off", () => {
        const eager: Config = {
            ...config,
            memory: { ...config.memory, idleSeconds: 0 },
        };
        const sleep = (ms: number) =>
            new Promise((resolve) => setTimeout(resolve, ms));

        it("writes why to its log, which a detached service has", async () => {
            await start(false, config, { noReviews: "no key was found" });
            const log = await Bun.file(hookLogPath(env)).text();
            expect(log).toMatch(
                / warn \d+ reviews are off: no key was found\n/,
            );
        });

        it("leaves the conversation stale for her chat's catch-up", async () => {
            const service = await start(false, eager, { tickMs: 10 });
            await post("/v1/record", {
                host: "codex",
                session: "s1",
                events: [{ sourceId: "a", at: AT, kind: "user", text: "Tea?" }],
            });
            for (let tries = 0; service.waiting() > 0 && tries < 100; tries++) {
                await sleep(10);
            }
            // Dropped from the idle list unreviewed, it has no notes; the
            // catalogue her chat's launch reads finds it, and the catch-up
            // takes the stale ones, most recent first.
            const index = RecallIndex.open(indexPath(env));
            try {
                const { entries } = await indexCatalogue(
                    index,
                    transcriptDir(env),
                    vocabularyPath(env),
                    dataRoot(env),
                ).load();
                expect(entries).toHaveLength(1);
                expect(entries[0]?.sidecar.kind).toBe("none");
                expect(isStale(entries[0] as Entry, Date.now(), false)).toBe(
                    true,
                );
            } finally {
                index.close();
            }
        });

        it("lets an idle conversation go, as with reviews on", async () => {
            const service = await start(false, eager, { tickMs: 10 });
            const sent = await post("/v1/record", {
                host: "codex",
                session: "s1",
                events: [{ sourceId: "a", at: AT, kind: "user", text: "Tea?" }],
            });
            expect(sent.status).toBe(200);
            for (let tries = 0; service.waiting() > 0 && tries < 100; tries++) {
                await sleep(10);
            }
            expect(service.waiting()).toBe(0);
            expect(warned).toEqual([]);
        });
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

        it("reads one inside a further directory of [service] claude-dirs", async () => {
            const second = join(home, "claude-2");
            mkdirSync(join(second, "projects", "-work"), { recursive: true });
            const at = join(second, "projects", "-work", "c1.jsonl");
            writeFileSync(at, `${userLine("u1", 0, "hi")}\n`);
            await start(false, {
                ...config,
                service: { ...config.service, claudeDirs: [second] },
            });
            const response = await named(at);
            expect(response.status).toBe(200);
        });

        it("warns once of a refusal, naming the setting", async () => {
            await start();
            await refused(join(home, "elsewhere", "a.jsonl"));
            await refused(join(home, "elsewhere", "b.jsonl"));
            const said = warned.filter((line) => line.includes("claude-dirs"));
            expect(said).toHaveLength(1);
        });
    });

    describe("recording other harnesses", () => {
        const swept: Config = {
            ...config,
            recording: { hosts: ["codex"], sweepSeconds: 300 },
        };
        // Events of 2026-10-20: after the service's start, before the
        // watermark's mark for a later one.
        const rollout = (name: string, session = SESSION) => {
            const path = join(home, ".codex/sessions/2026/10/20", name);
            mkdirSync(join(home, ".codex/sessions/2026/10/20"), {
                recursive: true,
            });
            writeFileSync(
                path,
                `${[meta(), context(), message("user", "Synthetic question.", 1), message("assistant", "Synthetic answer.", 2)].join("\n")}\n`.replaceAll(
                    SESSION,
                    session,
                ),
            );
            const when = new Date("2026-10-20T10:00:00.000Z");
            utimesSync(path, when, when);
        };
        const started = () => new Date("2026-10-14T00:00:00.000Z");
        const conversations = () => {
            try {
                return readdirSync(transcriptDir(env)).filter((name) =>
                    name.endsWith(".jsonl"),
                );
            } catch {
                return [];
            }
        };
        const waitFor = async (done: () => boolean) => {
            for (let tries = 0; !done() && tries < 200; tries++) {
                await new Promise((resolve) => setTimeout(resolve, 10));
            }
        };

        it("sweeps the hosts it is set to at its start, and logs the counts", async () => {
            rollout("rollout-one.jsonl");
            await start(false, swept, { now: started });
            await waitFor(() => conversations().length > 0);
            expect(conversations()).toHaveLength(1);
            await waitFor(() => existsSync(hookLogPath(env)));
            await waitFor(() =>
                readFileSync(hookLogPath(env), "utf8").includes("swept"),
            );
            expect(readFileSync(hookLogPath(env), "utf8")).toContain(
                "recording: swept codex: 2 events in 1 session",
            );
            // Its conversation waits to be extracted from.
            expect(running?.waiting()).toBe(1);
        });

        it("sweeps again on its interval, recording what is new", async () => {
            rollout("rollout-one.jsonl");
            await start(false, swept, { now: started, sweepMs: 20 });
            await waitFor(() => conversations().length > 0);
            rollout(
                "rollout-two.jsonl",
                "99999999-2222-4333-8444-555555555555",
            );
            await waitFor(() => conversations().length > 1);
            expect(conversations()).toHaveLength(2);
        });

        it("sweeps no host that is not set", async () => {
            rollout("rollout-one.jsonl");
            await start(false, config, { now: started, sweepMs: 20 });
            await new Promise((resolve) => setTimeout(resolve, 100));
            expect(conversations()).toEqual([]);
        });
    });
});
