// vim:set expandtab shiftwidth=4 filetype=typescript:
// SPDX-License-Identifier: GPL-3.0-only

//
//
// ~chewygumxx/dorothy.git
// ::: :/packages/orchestra/src/box/worker-box.test.ts
//
//

import { describe, expect, it } from "bun:test";
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import {
    BOX_HOME,
    BOX_SOCKETS,
    BRIDGE_PATH,
    boxArgs,
    boxAvailable,
    bridgeSource,
    systemLayout,
} from "./box.js";
import {
    type Adapter,
    adapterFor,
    KEY_PORT,
    PROXY_PORT,
    providerHosts,
    type WorkerBoxInput,
    workerBox,
} from "./worker-box.js";

const ADAPTER: Adapter = {
    runtime: "/opt/bun/bin/bun",
    entry: "/repo/node_modules/.bun/x/node_modules/codex-acp/dist/index.js",
    readOnly: ["/opt/bun/bin", "/repo/node_modules/.bun"],
};

const input = (over: Partial<WorkerBoxInput> = {}): WorkerBoxInput => ({
    agent: "codex",
    login: { kind: "subscription", source: "/h/.codex" },
    clone: "/w/s1/codex-1",
    objects: "/state/repos/o/n.git/objects",
    sockets: "/state/boxes/s1/codex-1",
    bridge: "/state/boxes/s1/codex-1.bridge.ts",
    adapter: ADAPTER,
    ...over,
});

const mounted = (spec: Awaited<ReturnType<typeof workerBox>>, target: string) =>
    spec.files.find((file) => file.target === target)?.source;

describe("workerBox", () => {
    it("runs the adapter behind the bridge, the proxy on its port", async () => {
        const spec = await workerBox(input());
        expect(spec.command).toEqual([
            ADAPTER.runtime,
            BRIDGE_PATH,
            `${PROXY_PORT}=${BOX_SOCKETS}/proxy.sock`,
            "--",
            ADAPTER.runtime,
            ADAPTER.entry,
        ]);
        expect(spec.clone).toBe("/w/s1/codex-1");
        expect(spec.sockets).toBe("/state/boxes/s1/codex-1");
        expect(mounted(spec, BRIDGE_PATH)).toBe(
            "/state/boxes/s1/codex-1.bridge.ts",
        );
    });

    it("mounts the runtime, the store and the borrowed objects read-only", async () => {
        expect((await workerBox(input())).readOnly).toEqual([
            "/opt/bun/bin",
            "/repo/node_modules/.bun",
            "/state/repos/o/n.git/objects",
        ]);
    });

    it("admits Codex's subscription login alone, read-only, in its home", async () => {
        const spec = await workerBox(input());
        expect(mounted(spec, `${BOX_HOME}/.codex/auth.json`)).toBe(
            "/h/.codex/auth.json",
        );
        expect(spec.files).toHaveLength(2);
        expect(spec.env.CODEX_HOME).toBe(`${BOX_HOME}/.codex`);
        expect(spec.env.OPENAI_API_KEY).toBeUndefined();
    });

    it("admits Claude's subscription login alone, read-only, in its home", async () => {
        const spec = await workerBox(
            input({
                agent: "claude",
                login: { kind: "subscription", source: "/h/.config/claude" },
            }),
        );
        expect(mounted(spec, `${BOX_HOME}/.claude/.credentials.json`)).toBe(
            "/h/.config/claude/.credentials.json",
        );
        expect(spec.env.CLAUDE_CONFIG_DIR).toBe(`${BOX_HOME}/.claude`);
        expect(spec.env.ANTHROPIC_API_KEY).toBeUndefined();
    });

    it("points an API key's agent at the gateway, with the placeholder", async () => {
        const claude = await workerBox(
            input({ agent: "claude", login: { kind: "api-key" } }),
        );
        expect(claude.env.ANTHROPIC_BASE_URL).toBe(
            `http://127.0.0.1:${KEY_PORT}`,
        );
        expect(claude.env.ANTHROPIC_API_KEY).toBe("dorothy-gateway");
        expect(claude.command).toContain(`${KEY_PORT}=${BOX_SOCKETS}/key.sock`);
        expect(claude.files).toHaveLength(1);
        const codex = await workerBox(input({ login: { kind: "api-key" } }));
        expect(codex.env.OPENAI_BASE_URL).toBe(
            `http://127.0.0.1:${KEY_PORT}/v1`,
        );
        expect(codex.env.OPENAI_API_KEY).toBe("dorothy-gateway");
    });

    it("sends the proxy variables, both cases, and spares loopback", async () => {
        const { env } = await workerBox(input());
        for (const name of [
            "HTTPS_PROXY",
            "HTTP_PROXY",
            "https_proxy",
            "http_proxy",
        ]) {
            expect(env[name]).toBe(`http://127.0.0.1:${PROXY_PORT}`);
        }
        expect(env.NO_PROXY).toBe("127.0.0.1,localhost");
        expect(env.no_proxy).toBe("127.0.0.1,localhost");
        expect(env.HOME).toBe(BOX_HOME);
        expect(env.PATH).toBe("/opt/bun/bin:/usr/bin:/bin");
    });
});

describe("providerHosts", () => {
    it("admits a subscription's provider and sign-in hosts", () => {
        expect(providerHosts("claude", "subscription")).toEqual([
            "api.anthropic.com",
            "console.anthropic.com",
            "platform.claude.com",
            "claude.ai",
        ]);
        expect(providerHosts("codex", "subscription")).toEqual([
            "api.openai.com",
            "chatgpt.com",
            "auth.openai.com",
        ]);
    });

    it("leaves an API key's provider to the gateway alone", () => {
        expect(providerHosts("claude", "api-key")).toEqual([]);
        expect(providerHosts("codex", "api-key")).toEqual([]);
    });

    it("admits the provider's API host for a key admitted into the box", () => {
        expect(providerHosts("codex", "admitted-key")).toEqual([
            "api.openai.com",
        ]);
    });
});

describe("adapterFor", () => {
    it("finds each installed adapter, and the store it runs from", async () => {
        for (const agent of ["claude", "codex"] as const) {
            const adapter = await adapterFor(agent);
            expect(existsSync(adapter.entry)).toBe(true);
            expect(adapter.readOnly).toContain(
                adapter.runtime.slice(0, adapter.runtime.lastIndexOf("/")),
            );
            expect(
                adapter.readOnly.some((path) =>
                    path.endsWith("/node_modules/.bun"),
                ),
            ).toBe(true);
            expect(adapter.entry.startsWith(adapter.readOnly[1] ?? "?")).toBe(
                true,
            );
        }
    });
});

it("delivers an admitted key privately with no secret in argv or launch records", async () => {
    const root = await mkdtemp(join(tmpdir(), "admitted-key-"));
    try {
        const sockets = join(root, "sockets");
        await mkdir(sockets, { mode: 0o700 });
        const runtime = await realpath(process.execPath);
        const entry = join(root, "agent.ts");
        await writeFile(
            entry,
            'import { createHash } from "node:crypto"; console.log(createHash("sha256").update(process.env.OPENAI_API_KEY ?? "").digest("hex"));',
        );
        const bridge = join(root, "bridge.ts");
        await writeFile(bridge, bridgeSource());
        const key = "synthetic-r1-private-key";
        const spec = await workerBox(
            input({
                login: { kind: "admitted-key", key },
                clone: root,
                sockets,
                bridge,
                objects: root,
                adapter: { runtime, entry, readOnly: [dirname(runtime)] },
            }),
        );
        const argv = boxArgs(spec, await systemLayout());
        expect(JSON.stringify({ argv, spec })).not.toContain(key);
        if (await boxAvailable()) {
            const child = Bun.spawn(argv, {
                env: {},
                stdout: "pipe",
                stderr: "pipe",
            });
            const output = await new Response(child.stdout).text();
            expect(await child.exited).toBe(0);
            expect(output.trim()).toBe(
                createHash("sha256").update(key).digest("hex"),
            );
        }
    } finally {
        await rm(root, { recursive: true, force: true });
    }
});
