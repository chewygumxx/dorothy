// vim:set expandtab shiftwidth=4 filetype=typescript:
// SPDX-License-Identifier: GPL-3.0-only

//
//
// ~chewygumxx/dorothy.git
// ::: :/packages/agent/src/recall-tools.test.ts
//
//

import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { anthropicEntry } from "@dorothy/core";
import { connectRecall, recallCwd, recallEnv } from "./recall-tools.js";

const launch = {
    command: process.execPath,
    args: [join(import.meta.dir, "fake-mcp.ts")],
};

// A root made for this run and removed after it, never a fixed path.
let root = "";
let ENV: Record<string, string> = {};

beforeAll(() => {
    root = mkdtempSync(join(tmpdir(), "dorothy-recall-tools-test-"));
    ENV = {
        PATH: process.env.PATH ?? "",
        XDG_DATA_HOME: join(root, "data"),
        XDG_CACHE_HOME: join(root, "cache"),
    };
});

afterAll(() => {
    rmSync(root, { recursive: true, force: true });
});

type Execute = (
    input: unknown,
    options: unknown,
) => Promise<{ content: { text: string }[]; isError: boolean }>;
const run = (tool: unknown, input: unknown) =>
    (tool as { execute: Execute }).execute(input, {
        toolCallId: "1",
        messages: [],
    });

describe("recallEnv", () => {
    it("passes the caller's environment on, less every credential", () => {
        const route = [{ ...anthropicEntry("m"), key: "MY_ROUTE_KEY" }];
        expect(
            recallEnv(
                {
                    PATH: "/bin",
                    XDG_DATA_HOME: "/d",
                    DOROTHY_MEMORY_URL: "http://127.0.0.1:1",
                    MY_ROUTE_KEY: "a",
                    ANTHROPIC_API_KEY: "b",
                    OPENROUTER_API_KEY: "c",
                    CLAUDE_CODE_OAUTH_TOKEN: "d",
                    CLAUDE_CODE_OAUTH_TOKEN_CLAUDE2: "e",
                    UNSET: undefined,
                },
                route,
            ),
        ).toEqual({
            PATH: "/bin",
            XDG_DATA_HOME: "/d",
            DOROTHY_MEMORY_URL: "http://127.0.0.1:1",
        });
    });
});

describe("connectRecall", () => {
    it("offers her tools by the names the model calls, and no others", async () => {
        const recall = await connectRecall(launch, false, ENV);
        try {
            expect(Object.keys(recall.tools).sort()).toEqual([
                "mcp__memory__open",
                "mcp__memory__remember",
                "mcp__memory__search",
                "mcp__memory__tags",
            ]);
        } finally {
            await recall.close();
        }
    });

    it("offers recollect when asked, starting the server with --recollect", async () => {
        const recall = await connectRecall(launch, true, ENV);
        try {
            expect(Object.keys(recall.tools)).toContain(
                "mcp__memory__recollect",
            );
            const out = await run(recall.tools.mcp__memory__recollect, {
                cluster: 1,
            });
            expect(JSON.parse(out.content[0]?.text ?? "").args).toEqual([
                "--recollect",
            ]);
        } finally {
            await recall.close();
        }
    });

    it("starts the server in the environment it is given", async () => {
        const recall = await connectRecall(launch, false, ENV);
        try {
            const out = await run(recall.tools.mcp__memory__search, {
                query: "x",
            });
            expect(JSON.parse(out.content[0]?.text ?? "")).toMatchObject({
                tool: "search",
                data: ENV.XDG_DATA_HOME,
                key: null,
            });
        } finally {
            await recall.close();
        }
    });

    it("fails when the server does not start", async () => {
        await expect(
            connectRecall(
                { command: process.execPath, args: ["-e", "process.exit(3)"] },
                false,
                ENV,
            ),
        ).rejects.toThrow();
    });

    it("gives up on a server that never answers", async () => {
        const silent = {
            command: process.execPath,
            args: ["-e", "setInterval(() => {}, 1000)"],
        };
        const began = Date.now();
        await expect(connectRecall(silent, false, ENV, 200)).rejects.toThrow();
        expect(Date.now() - began).toBeLessThan(2_000);
    });

    it("runs the server in a directory of Dorothy's, not the caller's", async () => {
        const cache = mkdtempSync(join(tmpdir(), "dorothy-recall-cwd-"));
        try {
            expect(recallCwd({ XDG_CACHE_HOME: cache })).toBe(
                join(cache, "dorothy"),
            );
            expect(existsSync(join(cache, "dorothy"))).toBe(true);
        } finally {
            rmSync(cache, { recursive: true, force: true });
        }
    });
});
