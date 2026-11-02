// vim:set expandtab shiftwidth=4 filetype=typescript:
// SPDX-License-Identifier: GPL-3.0-only

//
//
// ~chewygumxx/dorothy.git
// ::: :/packages/orchestra/src/box/worker-box.ts
//
//

// A worker's box: its adapter behind the bridge, the proxy and, for an
// API key, the key gateway on loopback ports, and its agent's own login
// alone. The engine and the real-agent gate both build boxes here.

import { realpath } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { Agent } from "../config.js";
import { PLACEHOLDER_KEY } from "../net/key-gateway.js";
import { BOX_HOME, BOX_SOCKETS, type BoxSpec, BRIDGE_PATH } from "./box.js";

// The loopback ports the bridge listens on inside a box.
export const PROXY_PORT = 3128;
export const KEY_PORT = 3129;

// The sockets in a box's sockets directory.
export const PROXY_SOCKET = "proxy.sock";
export const KEY_SOCKET = "key.sock";

// subscription: the agent's own stored login, mounted read-only from
// source (Claude's config directory, Codex's home). api-key: the key
// stays with the gateway. admitted-key: the gate found the agent ignores
// the gateway, so its key enters the box as a subscription's login does.
export type WorkerLogin =
    | { kind: "subscription"; source: string }
    | { kind: "api-key" }
    | { kind: "admitted-key"; key: string };

export type Adapter = {
    runtime: string;
    entry: string;
    // The runtime's directory and the store the adapter runs from.
    readOnly: string[];
};

const PACKAGES: Readonly<Record<Agent, string>> = {
    claude: "@agentclientprotocol/claude-agent-acp",
    codex: "@agentclientprotocol/codex-acp",
};

// The installed adapter's entry point, the runtime that runs it, and the
// directories a box must mount for both, each by its resolved path.
export async function adapterFor(agent: Agent): Promise<Adapter> {
    const manifest = await realpath(
        Bun.resolveSync(`${PACKAGES[agent]}/package.json`, import.meta.dir),
    );
    const { bin } = (await Bun.file(manifest).json()) as {
        bin: Record<string, string>;
    };
    const entry = join(
        dirname(manifest),
        Object.values(bin)[0] ?? "dist/index.js",
    );
    const marker = "/node_modules/.bun/";
    const store = entry.slice(0, entry.indexOf(marker) + marker.length - 1);
    const runtime = await realpath(process.execPath);
    return { runtime, entry, readOnly: [dirname(runtime), store] };
}

// The hosts the proxy admits for the agent's provider. With an API key
// the gateway alone reaches it, so the proxy admits none of them.
export function providerHosts(
    agent: Agent,
    login: WorkerLogin["kind"],
): string[] {
    if (login === "api-key") {
        return [];
    }
    if (login === "admitted-key") {
        return agent === "claude" ? ["api.anthropic.com"] : ["api.openai.com"];
    }
    return agent === "claude"
        ? [
              "api.anthropic.com",
              "console.anthropic.com",
              "platform.claude.com",
              "claude.ai",
          ]
        : ["api.openai.com", "chatgpt.com", "auth.openai.com"];
}

export type WorkerBoxInput = {
    agent: Agent;
    login: WorkerLogin;
    clone: string;
    // The broker repository's object store, which the clone borrows.
    objects: string;
    // The box's sockets directory, holding proxy.sock and key.sock.
    sockets: string;
    // The bridge's source, written for this box.
    bridge: string;
    adapter: Adapter;
};

// Each agent's config home in the box, and the login file it holds.
export const CONFIG_HOMES: Readonly<
    Record<Agent, { variable: string; dir: string; login: string }>
> = {
    claude: {
        variable: "CLAUDE_CONFIG_DIR",
        dir: `${BOX_HOME}/.claude`,
        login: ".credentials.json",
    },
    codex: {
        variable: "CODEX_HOME",
        dir: `${BOX_HOME}/.codex`,
        login: "auth.json",
    },
};

const KEY_VARIABLES: Readonly<
    Record<Agent, { base: string; key: string; root: string }>
> = {
    claude: { base: "ANTHROPIC_BASE_URL", key: "ANTHROPIC_API_KEY", root: "" },
    codex: { base: "OPENAI_BASE_URL", key: "OPENAI_API_KEY", root: "/v1" },
};

export function workerBox(input: WorkerBoxInput): BoxSpec {
    const { agent, login, adapter } = input;
    const home = CONFIG_HOMES[agent];
    const keys = KEY_VARIABLES[agent];
    const proxy = `http://127.0.0.1:${PROXY_PORT}`;
    const env: Record<string, string> = {
        PATH: `${adapter.readOnly[0]}:/usr/bin:/bin`,
        HOME: BOX_HOME,
        LANG: "C.UTF-8",
        TERM: "dumb",
        HTTPS_PROXY: proxy,
        HTTP_PROXY: proxy,
        https_proxy: proxy,
        http_proxy: proxy,
        NO_PROXY: "127.0.0.1,localhost",
        no_proxy: "127.0.0.1,localhost",
        [home.variable]: home.dir,
    };
    const files = [{ source: input.bridge, target: BRIDGE_PATH }];
    const forwards = [`${PROXY_PORT}=${BOX_SOCKETS}/${PROXY_SOCKET}`];
    if (login.kind === "subscription") {
        files.push({
            source: join(login.source, home.login),
            target: `${home.dir}/${home.login}`,
        });
    } else if (login.kind === "api-key") {
        env[keys.base] = `http://127.0.0.1:${KEY_PORT}${keys.root}`;
        env[keys.key] = PLACEHOLDER_KEY;
        forwards.push(`${KEY_PORT}=${BOX_SOCKETS}/${KEY_SOCKET}`);
    } else {
        env[keys.key] = login.key;
    }
    return {
        clone: input.clone,
        readOnly: [...adapter.readOnly, input.objects],
        files,
        sockets: input.sockets,
        env,
        command: [
            adapter.runtime,
            BRIDGE_PATH,
            ...forwards,
            "--",
            adapter.runtime,
            adapter.entry,
        ],
    };
}
