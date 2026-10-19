// vim:set expandtab shiftwidth=4 filetype=typescript:
// SPDX-License-Identifier: GPL-3.0-only

//
//
// ~chewygumxx/dorothy.git
// ::: :/packages/cli/src/claude-dump.ts
//
//

import { captureServer } from "@dorothy/agent";
import type { Env } from "@dorothy/core";
import {
    type ClaudeDeps,
    launchClaude,
    runAll,
    type Spawned,
    warnDrift,
} from "./claude.js";

export type ClaudeDumpDeps = Omit<ClaudeDeps, "signals"> & {
    capture?: () => Pick<
        ReturnType<typeof captureServer>,
        "url" | "bodies" | "first" | "stop"
    >;
    out?: (text: string) => void;
};

const spawnQuiet = (cmd: string[], env: Env, cwd?: string): Spawned =>
    Bun.spawn(cmd, {
        env,
        cwd,
        stdin: "ignore",
        stdout: "ignore",
        stderr: "ignore",
    });

// The first request `dorothy --claude` would send, as the gateway
// rewrites it, caught by a stand-in for the API: claude runs in print
// mode, without saving its session, and is stopped once the request is
// in, so nothing reaches the API and its retries go unsent.
export async function runClaudeDump(
    args: readonly string[],
    message: string,
    deps: ClaudeDumpDeps = {},
): Promise<number> {
    const {
        capture: startCapture = captureServer,
        spawn = spawnQuiet,
        out = (text) => {
            process.stdout.write(text);
        },
        write = (text) => {
            process.stderr.write(text);
        },
    } = deps;
    const capture = startCapture();
    try {
        const launch = await launchClaude(
            args,
            capture.url,
            { ...deps, write },
            "dump",
        );
        if (typeof launch === "number") {
            return launch;
        }
        let code: number;
        try {
            const child = spawn(
                [
                    ...launch.cmd,
                    "-p",
                    "--no-session-persistence",
                    "--",
                    message,
                ],
                launch.env,
                launch.cwd,
            );
            try {
                await Promise.race([capture.first, child.exited]);
            } finally {
                child.kill();
                code = await child.exited;
            }
        } finally {
            // Whether claude started, or its spawn threw.
            runAll([() => launch.gateway.stop(), launch.cleanup]);
        }
        const [body] = capture.bodies;
        if (body === undefined) {
            write(
                `dorothy: claude sent no request to dump (it exited ${code})\n`,
            );
            return 1;
        }
        if (launch.gateway.stats.injected === 0) {
            write(
                "dorothy: the request carried no identity marker; it is as Claude Code sent it\n",
            );
        }
        warnDrift(launch.gateway.stats, write);
        out(`${JSON.stringify(body, null, 2)}\n`);
        return 0;
    } finally {
        capture.stop();
    }
}
