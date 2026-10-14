// vim:set expandtab shiftwidth=4 filetype=typescript:
// SPDX-License-Identifier: GPL-3.0-only

//
//
// ~chewygumxx/dorothy.git
// ::: :/packages/cli/src/claude-dump.test.ts
//
//

import { describe, expect, it } from "bun:test";
import { captureServer } from "@dorothy/agent";
import { MARKER, startGateway } from "@dorothy/gateway";
import { type ClaudeDumpDeps, runClaudeDump } from "./claude-dump.js";

// A capture whose bodies the fake claude below sends straight in.
function fakeCapture() {
    const first = Promise.withResolvers<unknown>();
    const capture = {
        url: "http://127.0.0.1:9",
        bodies: [] as unknown[],
        first: first.promise,
        stopped: false,
        receive: (body: unknown) => {
            capture.bodies.push(body);
            first.resolve(body);
        },
        stop: () => {
            capture.stopped = true;
        },
    };
    return capture;
}

function harness(send: unknown[] = [{ system: "S" }]) {
    const capture = fakeCapture();
    const stats = { injected: send.length, drift: 0 };
    const calls = {
        cmd: [] as string[],
        env: {} as Record<string, string | undefined>,
        upstream: "",
        stopped: false,
        killed: false,
        out: "",
        err: "",
    };
    const deps: ClaudeDumpDeps = {
        env: { PATH: "/bin" },
        which: () => "/bin/claude",
        capture: () => capture,
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
        // Sends its requests, then runs until killed, as claude retries.
        spawn: (cmd, env) => {
            calls.cmd = cmd;
            calls.env = env;
            for (const body of send) {
                capture.receive(body);
            }
            const exited = Promise.withResolvers<number>();
            if (send.length === 0) {
                exited.resolve(1);
            }
            return {
                exited: exited.promise,
                kill: () => {
                    calls.killed = true;
                    exited.resolve(143);
                },
            };
        },
        out: (text) => {
            calls.out += text;
        },
        write: (text) => {
            calls.err += text;
        },
    };
    return { calls, capture, deps, stats };
}

describe("runClaudeDump", () => {
    it("prints the first request claude sends, through the gateway to the capture", async () => {
        const { calls, capture, deps } = harness([{ n: 1 }, { n: 2 }]);
        expect(
            await runClaudeDump(["--model", "sonnet"], "Who are you?", deps),
        ).toBe(0);
        expect(calls.cmd).toEqual([
            "/bin/claude",
            "--append-system-prompt",
            MARKER,
            "--model",
            "sonnet",
            "-p",
            "--no-session-persistence",
            "--",
            "Who are you?",
        ]);
        expect(calls.upstream).toBe(capture.url);
        expect(calls.env.ANTHROPIC_BASE_URL).toBe("http://127.0.0.1:4321");
        expect(calls.out).toBe(`${JSON.stringify({ n: 1 }, null, 2)}\n`);
        expect(calls.err).toBe("");
        expect(calls.killed).toBe(true);
        expect(calls.stopped).toBe(true);
        expect(capture.stopped).toBe(true);
    });

    it("warns when the gateway put no identity in", async () => {
        const { calls, deps, stats } = harness();
        stats.injected = 0;
        expect(await runClaudeDump([], "hi", deps)).toBe(0);
        expect(calls.out).not.toBe("");
        expect(calls.err).toBe(
            "dorothy: the request carried no identity marker; it is as Claude Code sent it\n",
        );
    });

    it("warns of drift", async () => {
        const { calls, deps, stats } = harness();
        stats.drift = 1;
        await runClaudeDump([], "hi", deps);
        expect(calls.err).toContain(
            "dorothy: 1 request carried the identity marker but could not be rewritten",
        );
    });

    it("exits 1 when claude sends nothing", async () => {
        const { calls, capture, deps } = harness([]);
        expect(await runClaudeDump([], "hi", deps)).toBe(1);
        expect(calls.out).toBe("");
        expect(calls.err).toBe(
            "dorothy: claude sent no request to dump (it exited 1)\n",
        );
        expect(calls.stopped).toBe(true);
        expect(capture.stopped).toBe(true);
    });

    it("exits 127 when claude is not on PATH, the capture stopped", async () => {
        const { calls, capture, deps } = harness();
        deps.which = () => null;
        expect(await runClaudeDump([], "hi", deps)).toBe(127);
        expect(calls.err).toBe("dorothy: claude is not on PATH\n");
        expect(calls.cmd).toEqual([]);
        expect(capture.stopped).toBe(true);
    });

    // The real gateway and capture, a script in claude's place.
    it("prints the request with Dorothy's identity in the marker's place", async () => {
        const script = `await fetch(process.env.ANTHROPIC_BASE_URL + "/v1/messages", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
                model: "m",
                system: [
                    { type: "text", text: "x-anthropic-billing-header: cc=1;" },
                    { type: "text", text: "You are Claude Code." },
                    { type: "text", text: ${JSON.stringify(`Rules.\n\n${MARKER}`)} },
                ],
                messages: [{ role: "user", content: process.argv.at(-1) }],
            }),
        });
        await Bun.sleep(60_000);`;
        let out = "";
        let err = "";
        const code = await runClaudeDump([], "Who are you?", {
            env: { PATH: process.env.PATH },
            which: () => process.execPath,
            capture: captureServer,
            startGateway,
            spawn: (cmd, env) =>
                Bun.spawn([process.execPath, "-e", script, ...cmd.slice(1)], {
                    env,
                    stdout: "ignore",
                    stderr: "ignore",
                }),
            out: (text) => {
                out += text;
            },
            write: (text) => {
                err += text;
            },
        });
        expect(err).toBe("");
        expect(code).toBe(0);
        expect(out).not.toContain(MARKER);
        const body = JSON.parse(out);
        expect(body.system).toHaveLength(4);
        expect(body.system[2].text).toContain("Dorothy");
        expect(body.system[3]).toEqual({ type: "text", text: "Rules." });
        expect(body.messages).toEqual([
            { role: "user", content: "Who are you?" },
        ]);
    });
});
