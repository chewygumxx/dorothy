// vim:set expandtab shiftwidth=4 filetype=typescript:
// SPDX-License-Identifier: GPL-3.0-only

//
//
// ~chewygumxx/dorothy.git
// ::: :/packages/cli/src/claude.test.ts
//
//

import { describe, expect, it } from "bun:test";
import { EventEmitter } from "node:events";
import { MARKER } from "@dorothy/gateway";
import { type ClaudeDeps, claudeArgs, runClaude } from "./claude.js";

function harness(exit: number | Promise<number> = 0) {
    const calls = {
        cmd: [] as string[],
        env: {} as Record<string, string | undefined>,
        upstream: "",
        stopped: false,
        killed: [] as string[],
        err: "",
    };
    const signals = new EventEmitter();
    const stats = { injected: 0, drift: 0 };
    const deps: ClaudeDeps = {
        env: { PATH: "/bin", HOME: "/home/u" },
        which: (command, { PATH }) =>
            command === "claude" && PATH === "/bin" ? "/bin/claude" : null,
        startGateway: ({ upstream }) => {
            calls.upstream = upstream;
            return {
                url: "http://127.0.0.1:4321",
                stats,
                stop: () => {
                    calls.stopped = true;
                },
            };
        },
        spawn: (cmd, env) => {
            calls.cmd = cmd;
            calls.env = env;
            return {
                exited: Promise.resolve(exit),
                kill: (signal) => {
                    calls.killed.push(String(signal));
                },
            };
        },
        write: (text) => {
            calls.err += text;
        },
        signals,
    };
    return { calls, deps, signals, stats };
}

describe("runClaude", () => {
    it("runs claude through the gateway, the marker first", async () => {
        const { calls, deps } = harness();
        expect(await runClaude(["-p", "hi"], deps)).toBe(0);
        expect(calls.cmd).toEqual([
            "/bin/claude",
            "--append-system-prompt",
            MARKER,
            "-p",
            "hi",
        ]);
        expect(calls.env).toEqual({
            PATH: "/bin",
            HOME: "/home/u",
            ANTHROPIC_BASE_URL: "http://127.0.0.1:4321",
            ENABLE_TOOL_SEARCH: "1",
        });
        expect(calls.upstream).toBe("https://api.anthropic.com");
        expect(calls.stopped).toBe(true);
        expect(calls.err).toBe("");
    });

    it("chains onto the user's own base URL", async () => {
        const { calls, deps } = harness();
        deps.env = { ...deps.env, ANTHROPIC_BASE_URL: "http://proxy/x" };
        await runClaude([], deps);
        expect(calls.upstream).toBe("http://proxy/x");
        expect(calls.env.ANTHROPIC_BASE_URL).toBe("http://127.0.0.1:4321");
    });

    it("exits as claude did, a signal's code included", async () => {
        expect(await runClaude([], harness(3).deps)).toBe(3);
        expect(await runClaude([], harness(143).deps)).toBe(143);
    });

    it("says so, and exits 127, when claude is not on PATH", async () => {
        const { calls, deps } = harness();
        deps.env = { PATH: "/nowhere" };
        expect(await runClaude([], deps)).toBe(127);
        expect(calls.err).toBe("dorothy: claude is not on PATH\n");
        expect(calls.cmd).toEqual([]);
    });

    it("exits 1 without claude when the gateway cannot start", async () => {
        const { calls, deps } = harness();
        deps.startGateway = () => {
            throw new Error("EADDRINUSE");
        };
        expect(await runClaude([], deps)).toBe(1);
        expect(calls.err).toBe(
            "dorothy: the gateway could not start: EADDRINUSE\n",
        );
        expect(calls.cmd).toEqual([]);
    });

    it("forwards TERM and HUP, and leaves INT to the terminal", async () => {
        let finish = (_: number) => {};
        const { calls, deps, signals } = harness(
            new Promise<number>((resolve) => {
                finish = resolve;
            }),
        );
        const running = runClaude([], deps);
        await Bun.sleep(0);
        signals.emit("SIGINT");
        signals.emit("SIGTERM");
        signals.emit("SIGHUP");
        expect(calls.killed).toEqual(["SIGTERM", "SIGHUP"]);
        expect(signals.listenerCount("SIGINT")).toBe(1);
        finish(0);
        await running;
        for (const name of ["SIGINT", "SIGTERM", "SIGHUP"]) {
            expect(signals.listenerCount(name)).toBe(0);
        }
    });

    it("warns after claude exits if any marked request slipped through", async () => {
        const { calls, deps, stats } = harness();
        // The fake gateway's stats, read once claude has exited.
        stats.drift = 2;
        await runClaude([], deps);
        expect(calls.err).toBe(
            "dorothy: 2 requests carried the identity marker but could not be rewritten; Claude Code may have changed how it sends its prompt\n",
        );
    });
});

describe("claudeArgs", () => {
    const FLAG = "--append-system-prompt";

    it("appends the marker before the user's arguments", () => {
        expect(claudeArgs(["-p", "hi"])).toEqual([FLAG, MARKER, "-p", "hi"]);
    });

    // Claude Code keeps only the last --append-system-prompt, so the
    // user's own would drop the marker; it goes in the same one.
    it("carries the user's own appended text with the marker", () => {
        expect(claudeArgs(["-p", FLAG, "Be brief.", "hi"])).toEqual([
            FLAG,
            `Be brief.\n\n${MARKER}`,
            "-p",
            "hi",
        ]);
        expect(claudeArgs([`${FLAG}=Be brief.`, "-p"])).toEqual([
            FLAG,
            `Be brief.\n\n${MARKER}`,
            "-p",
        ]);
    });

    it("keeps only the last, as Claude Code would", () => {
        expect(claudeArgs([FLAG, "First.", `${FLAG}=Second.`])).toEqual([
            FLAG,
            `Second.\n\n${MARKER}`,
        ]);
    });

    it("leaves what follows -- and a flag without a value alone", () => {
        expect(claudeArgs(["--", FLAG, "x"])).toEqual([
            FLAG,
            MARKER,
            "--",
            FLAG,
            "x",
        ]);
        expect(claudeArgs(["-p", FLAG])).toEqual([FLAG, MARKER, "-p", FLAG]);
    });
});
