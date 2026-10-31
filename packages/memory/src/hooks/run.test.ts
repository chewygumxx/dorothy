// vim:set expandtab shiftwidth=4 filetype=typescript:
// SPDX-License-Identifier: GPL-3.0-only

//
//
// ~chewygumxx/dorothy.git
// ::: :/packages/memory/src/hooks/run.test.ts
//
//

import { afterAll, beforeAll, expect, it } from "bun:test";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CODEX_PROMPT, CODEX_SESSION_START } from "./fixtures.js";
import { runHostHook } from "./run.js";

let seen: { path: string; body: Record<string, unknown> }[] = [];
let server: ReturnType<typeof Bun.serve>;
let env: Record<string, string>;

beforeAll(async () => {
    const root = await mkdtemp(join(tmpdir(), "host-hook-"));
    server = Bun.serve({
        port: 0,
        async fetch(request) {
            const path = new URL(request.url).pathname;
            if (path === "/v1/health") {
                return Response.json({ ok: true });
            }
            const body = (await request.json()) as Record<string, unknown>;
            seen.push({ path, body });
            if (path === "/v1/block") {
                return Response.json({
                    text: "BLOCK",
                    digest: "xxh3:0000000000000000",
                    items: [],
                    used: 5,
                });
            }
            return Response.json({ text: "RECALL", ids: [], used: 6 });
        },
    });
    env = {
        DOROTHY_MEMORY_URL: `http://127.0.0.1:${server.port}`,
        XDG_STATE_HOME: join(root, "state"),
        XDG_CONFIG_HOME: join(root, "config"),
        HOME: root,
    };
});

afterAll(() => server.stop(true));

let warned: string[] = [];
const deps = () => ({
    client: { env },
    serve: [] as string[],
    identify: async () => ({ id: "github.com/me/app" }),
    log: {
        info: () => {},
        warn: (message: string) => warned.push(message),
        error: (message: string) => warned.push(message),
    },
});

it("answers a session start with the block", async () => {
    seen = [];
    const out = await runHostHook(
        "codex",
        "session-start",
        JSON.stringify(CODEX_SESSION_START),
        deps(),
    );
    expect(JSON.parse(out)).toEqual({
        hookSpecificOutput: {
            hookEventName: "SessionStart",
            additionalContext: "BLOCK",
        },
    });
    expect(seen[0]).toEqual({
        path: "/v1/block",
        body: {
            host: "codex",
            session: CODEX_SESSION_START.session_id,
            project: "github.com/me/app",
            reason: "startup",
        },
    });
});

it("answers a prompt with recall", async () => {
    seen = [];
    const out = await runHostHook(
        "codex",
        "prompt",
        JSON.stringify(CODEX_PROMPT),
        deps(),
    );
    expect(JSON.parse(out).hookSpecificOutput).toEqual({
        hookEventName: "UserPromptSubmit",
        additionalContext: "RECALL",
    });
    expect(seen[0]?.body.prompt).toBe(CODEX_PROMPT.prompt);
});

it("answers nothing to an unreadable payload", async () => {
    seen = [];
    expect(await runHostHook("codex", "prompt", "not json", deps())).toBe("");
    expect(seen).toEqual([]);
});

it("fails open when the service is gone, and says so", async () => {
    warned = [];
    const gone = {
        ...deps(),
        client: { env: { ...env, DOROTHY_MEMORY_URL: "http://127.0.0.1:9" } },
    };
    expect(
        await runHostHook(
            "codex",
            "prompt",
            JSON.stringify(CODEX_PROMPT),
            gone,
        ),
    ).toBe("");
    expect(warned.join(" ")).toContain("codex prompt");
});

it("leaves the project out where none is found", async () => {
    seen = [];
    await runHostHook(
        "codex",
        "session-start",
        JSON.stringify(CODEX_SESSION_START),
        {
            ...deps(),
            identify: async () => null,
        },
    );
    expect(seen[0]?.body).not.toHaveProperty("project");
});
