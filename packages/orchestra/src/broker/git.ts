// vim:set expandtab shiftwidth=4 filetype=typescript:
// SPDX-License-Identifier: GPL-3.0-only

//
//
// ~chewygumxx/dorothy.git
// ::: :/packages/orchestra/src/broker/git.ts
//
//

// Sealed git: the one runner of every host-side git process. Each reads
// the broker's own global config and no system one, with hooks,
// maintenance, gc and submodules off on its command line; it keeps the
// user's HOME and SSH_AUTH_SOCK, for ssh and gh, and no other GIT_*
// variable. Each runs in a session of its own, so with no terminal to
// prompt on, and its whole process group is killed at its deadline, or
// when its operation is abandoned.

import { type Env, REAL_TIMERS, type Timers } from "@dorothy/core";
import { serverEnvironment } from "../environment.js";

// A clone, a fetch or a push; every other git process has as long.
export const GIT_DEADLINE = 120_000;

const SEALS = [
    "core.hooksPath=/dev/null",
    "maintenance.auto=false",
    "gc.auto=0",
    "submodule.recurse=false",
].flatMap((seal) => ["-c", seal]);

// git from PATH, resolved once, at the server's start.
export function resolveGit(env: Env): string {
    const git = Bun.which("git", { PATH: env.PATH ?? "" });
    if (git === null) {
        throw new Error("no git on PATH");
    }
    return git;
}

// The server's environment holds no GIT_* variable already.
export const sealedEnvironment = (
    env: Env,
    config: string,
): Record<string, string> => ({
    ...serverEnvironment(env),
    GIT_CONFIG_NOSYSTEM: "1",
    GIT_CONFIG_GLOBAL: config,
});

export type RunResult = {
    code: number;
    stdout: string;
    stderr: string;
    timedOut: boolean;
};

export type GroupOptions = {
    cwd: string;
    env: Record<string, string>;
    deadline: number;
    timers?: Timers;
    // Its operation abandoned, at the server's close.
    signal?: AbortSignal;
};

// A process leading a session of its own, its group killed at the
// deadline or on the signal. gh runs here too.
export async function runGroup(
    argv: readonly string[],
    { cwd, env, deadline, timers = REAL_TIMERS, signal }: GroupOptions,
): Promise<RunResult> {
    const proc = Bun.spawn([...argv], {
        cwd,
        env,
        detached: true,
        stdin: "ignore",
        stdout: "pipe",
        stderr: "pipe",
    });
    let timedOut = false;
    const kill = () => {
        try {
            process.kill(-proc.pid, "SIGKILL");
        } catch {}
    };
    const timer = timers.set(() => {
        timedOut = true;
        kill();
    }, deadline);
    signal?.addEventListener("abort", kill);
    if (signal?.aborted) {
        kill();
    }
    const [stdout, stderr, code] = await Promise.all([
        new Response(proc.stdout).text(),
        new Response(proc.stderr).text(),
        proc.exited,
    ]);
    timers.clear(timer);
    signal?.removeEventListener("abort", kill);
    return { code, stdout, stderr, timedOut };
}

export type GitDeps = {
    git: string;
    env: Env;
    // GIT_CONFIG_GLOBAL: the broker's own file.
    config: string;
    // Where it runs: the broker repository, but for the steps that make
    // a clone, which name their own.
    cwd: string;
    deadline?: number;
    timers?: Timers;
};

export type Git = {
    run(
        args: readonly string[],
        cwd?: string,
        signal?: AbortSignal,
    ): Promise<RunResult>;
    // Its trimmed output, or an error naming the command.
    out(args: readonly string[], cwd?: string): Promise<string>;
};

export function sealedGit(deps: GitDeps): Git {
    const env = sealedEnvironment(deps.env, deps.config);
    const deadline = deps.deadline ?? GIT_DEADLINE;
    const run = (
        args: readonly string[],
        cwd = deps.cwd,
        signal?: AbortSignal,
    ) =>
        runGroup([deps.git, ...SEALS, ...args], {
            cwd,
            env,
            deadline,
            timers: deps.timers,
            signal,
        });
    return {
        run,
        out: async (args, cwd) => {
            const result = await run(args, cwd);
            if (result.code !== 0 || result.timedOut) {
                const why = result.timedOut
                    ? "passed its deadline"
                    : (result.stderr.trim().split("\n").at(-1) ?? "");
                throw new Error(`git ${args.join(" ")}: ${why}`);
            }
            return result.stdout.trim();
        },
    };
}
