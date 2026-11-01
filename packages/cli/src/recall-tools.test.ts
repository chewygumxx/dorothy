// vim:set expandtab shiftwidth=4 filetype=typescript:
// SPDX-License-Identifier: GPL-3.0-only

//
//
// ~chewygumxx/dorothy.git
// ::: :/packages/cli/src/recall-tools.test.ts
//
//

import { describe, expect, it } from "bun:test";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { connectRecall, recallEnv } from "@dorothy/agent";
import { defaultRoutes } from "@dorothy/core";
import { recallLaunch } from "./recall-launch.js";

type Execute = (
    input: unknown,
    options: unknown,
) => Promise<{ isError?: boolean }>;

// Whether a process of this machine has the marker in its arguments.
async function running(marker: string): Promise<boolean> {
    const ps = Bun.spawn(["ps", "-axo", "args"], { stdout: "pipe" });
    const listing = await new Response(ps.stdout).text();
    await ps.exited;
    return listing.includes(marker);
}

describe("her recall server, through the agent's client", () => {
    it("serves her tools on the root it is given, seeing no key", async () => {
        const root = mkdtempSync(join(tmpdir(), "dorothy-recall-"));
        const env = {
            ...process.env,
            XDG_DATA_HOME: join(root, "d"),
            XDG_CACHE_HOME: join(root, "c"),
            XDG_STATE_HOME: join(root, "s"),
            XDG_CONFIG_HOME: join(root, "cfg"),
            ANTHROPIC_API_KEY: "must-not-reach-the-server",
        };
        // The root, unique, marks the server's process, to see it end.
        const launch = {
            command: process.execPath,
            args: [
                join(import.meta.dir, "index.ts"),
                "--recall-server",
                "--project",
                root,
            ],
        };
        const recall = await connectRecall(
            launch,
            false,
            recallEnv(env, defaultRoutes().chat),
        );
        try {
            expect(Object.keys(recall.tools).sort()).toEqual([
                "mcp__memory__open",
                "mcp__memory__remember",
                "mcp__memory__search",
                "mcp__memory__tags",
            ]);
            const search = recall.tools.mcp__memory__search as unknown as {
                execute: Execute;
            };
            expect(
                await search.execute(
                    { query: "teapot" },
                    { toolCallId: "1", messages: [] },
                ),
            ).toMatchObject({ isError: false });
            expect(
                existsSync(join(root, "c", "dorothy", "recall.sqlite")),
            ).toBe(true);
            expect(await running(root)).toBe(true);
        } finally {
            await recall.close();
            // close() only sends SIGTERM: give the process its moment.
            const deadline = Date.now() + 5000;
            while ((await running(root)) && Date.now() < deadline) {
                await Bun.sleep(50);
            }
            expect(await running(root)).toBe(false);
            rmSync(root, { recursive: true, force: true });
        }
    });

    it("hands the server no key, and Bun no project .env", () => {
        const env = { ANTHROPIC_API_KEY: "k", PATH: "/bin" };
        expect(
            recallEnv(env, defaultRoutes().chat).ANTHROPIC_API_KEY,
        ).toBeUndefined();
        expect(recallLaunch("phrase", null).args[0]).toBe("--no-env-file");
    });
});
