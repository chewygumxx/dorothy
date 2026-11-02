// vim:set expandtab shiftwidth=4 filetype=typescript:
// SPDX-License-Identifier: GPL-3.0-only

//
//
// ~chewygumxx/dorothy.git
// ::: :/packages/orchestra/scripts/real-agent-gate.test.ts
//
//

// The gate's own logic, on the fake agent in a real box: every check
// passing where the fake behaves, and failing where it misbehaves. No
// test reaches a real agent, a provider or the network.

import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { mkdir, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { boxAvailable } from "../src/box/box.js";
import type { Adapter } from "../src/box/worker-box.js";
import {
    type Check,
    type GateOptions,
    processTree,
    runGate,
    survivors,
} from "./real-agent-gate.js";

const FAKE = join(import.meta.dir, "..", "src", "fixtures", "fake-agent.ts");

const statuses = (checks: Check[]) =>
    Object.fromEntries(checks.map(({ name, status }) => [name, status]));

const detail = (checks: Check[], name: string) =>
    checks.find((check) => check.name === name)?.detail ?? "";

const PASSING: Record<string, Check["status"]> = {
    "boxed start": "PASS",
    mode: "PASS",
    "subprocess traffic through the proxy": "PASS",
    "permission allowed once by exact option": "PASS",
    "box admits and withholds": "PASS",
    "nested sandbox": "PASS",
    "escalation stays in the box": "PASS",
    "permission denied by exact option": "PASS",
    "permission cancelled": "PASS",
    "session reloaded": "PASS",
    "process tree gone after stop": "PASS",
    "process tree gone after the server is killed": "PASS",
};

const available = await boxAvailable();

describe.if(available)("the real-agent gate, on the fake agent", () => {
    let root: string;
    let adapter: Adapter;
    let upstream: ReturnType<typeof Bun.serve>;
    let runs = 0;

    // A fresh root each run; the proxy resolves nothing, so no request
    // leaves the host, and the gateway's upstream is a fake on loopback.
    const gate = async (over: Partial<GateOptions> = {}) => {
        const run = join(root, `run-${++runs}`);
        await mkdir(run);
        return runGate({
            agent: "claude",
            login: "subscription",
            loginSource: join(root, "claude"),
            root: run,
            adapter,
            resolve: async () => {
                throw new Error("offline");
            },
            upstream: `http://127.0.0.1:${upstream.port}`,
            ...over,
        });
    };

    beforeAll(async () => {
        root = await realpath(await mkdtemp(join(tmpdir(), "gate-")));
        const runtime = await realpath(process.execPath);
        adapter = {
            runtime,
            entry: FAKE,
            readOnly: [dirname(runtime), dirname(FAKE)],
        };
        await mkdir(join(root, "claude"));
        await writeFile(
            join(root, "claude", ".credentials.json"),
            JSON.stringify({ claudeAiOauth: { expiresAt: 4102444800000 } }),
        );
        upstream = Bun.serve({
            port: 0,
            hostname: "127.0.0.1",
            fetch: () => Response.json({ usage: { input_tokens: 1 } }),
        });
    });

    afterAll(async () => {
        upstream.stop(true);
        await rm(root, { recursive: true, force: true });
    });

    it("passes every check where the fake behaves, signed in by subscription", async () => {
        const checks = await gate();
        expect(statuses(checks)).toEqual({
            ...PASSING,
            "model traffic through the proxy": "PASS",
            "login refresh under a read-only mount": "PASS",
            "login persists for the next box": "PASS",
        });
        expect(detail(checks, "model traffic through the proxy")).toContain(
            "api.anthropic.com",
        );
        expect(detail(checks, "nested sandbox")).toStartWith("inactive");
    }, 60_000);

    it("passes Codex by its API key, answering Decline before Cancel", async () => {
        const checks = await gate({
            agent: "codex",
            login: "api-key",
            key: "sk-test",
            agentArgs: ["--as", "codex"],
        });
        expect(statuses(checks)).toEqual({
            ...PASSING,
            "API key through the gateway": "PASS",
        });
        expect(detail(checks, "mode")).toBe("reports workspace-write");
        expect(detail(checks, "permission denied by exact option")).toStartWith(
            "answered decline;",
        );
    }, 60_000);

    it("fails at each misbehaviour: a denial or cancellation ignored, another mode, no model", async () => {
        const checks = await gate({
            login: "api-key",
            key: "sk-test",
            agentArgs: ["--ignore-answers", "--pin-mode", "plan"],
            upstream: "http://127.0.0.1:1",
        });
        expect(statuses(checks)).toEqual({
            ...PASSING,
            mode: "FAIL",
            "API key through the gateway": "FAIL",
            "permission denied by exact option": "FAIL",
            "permission cancelled": "FAIL",
            "session reloaded": "FAIL",
        });
        expect(detail(checks, "mode")).toBe("reports plan");
        expect(detail(checks, "permission denied by exact option")).toEndWith(
            "the command ran",
        );
    }, 60_000);

    it("stops at a box that cannot start", async () => {
        const checks = await gate({
            adapter: { ...adapter, entry: join(root, "missing.ts") },
        });
        expect(statuses(checks)).toEqual({ "boxed start": "FAIL" });
    }, 60_000);
});

describe("survivors", () => {
    it("names a process its tree left behind, and none once it is gone", async () => {
        // A shell killed outright leaves its background child running.
        const shell = Bun.spawn(["sh", "-c", "sleep 30 & wait"]);
        await Bun.sleep(200);
        const tree = await processTree(shell.pid);
        expect(tree).toHaveLength(2);
        shell.kill("SIGKILL");
        await shell.exited;
        const left = await survivors(tree, 500);
        expect(left.map(({ pid }) => pid)).not.toContain(shell.pid);
        expect(left).toHaveLength(1);
        for (const { pid } of left) {
            process.kill(pid, "SIGKILL");
        }
        expect(await survivors(tree, 2000)).toEqual([]);
    });
});
