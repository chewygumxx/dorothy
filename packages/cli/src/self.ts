// vim:set expandtab shiftwidth=4 filetype=typescript:
// SPDX-License-Identifier: GPL-3.0-only

//
//
// ~chewygumxx/dorothy.git
// ::: :/packages/cli/src/self.ts
//
//

import { dirname, join, relative, resolve } from "node:path";
import type { Env } from "@dorothy/core";

export type Spawned = {
    exited: Promise<number>;
    kill: (signal?: NodeJS.Signals) => void;
};

// Claude Code runs a hook's command through a shell: each word quoted.
export const shellWord = (word: string) => `'${word.replaceAll("'", "'\\''")}'`;

// This program as a command: the interpreter and the entry script it
// was started with, so bun run dev records too. Claude Code runs hooks
// and servers in the user's project, whose .env Bun would load into
// their environment, a key of the project's among it, kept over
// Dorothy's: --no-env-file, for the recall server too.
export const selfCommand = () => [
    process.execPath,
    "--no-env-file",
    resolve(process.argv[1] ?? ""),
];

// This program as a command, as --claude's hooks run it: --no-env-file,
// so a project's .env never reaches the service.
export const selfServe = () => [
    process.execPath,
    "--no-env-file",
    resolve(process.argv[1] ?? ""),
    "--serve",
];

// Bun otherwise uses its startup environment, losing runtime credentials.
export const spawnInherited = (
    cmd: string[],
    env: Env,
    cwd?: string,
): Spawned =>
    Bun.spawn(cmd, {
        env,
        cwd,
        stdin: "inherit",
        stdout: "inherit",
        stderr: "inherit",
    });

// The entry script as it sits in the repository's main checkout, for
// what outlives a session: a worktree may be removed, its path with it.
// null outside a repository.
export function mainEntry(
    entry: string,
    git: (args: string[], cwd: string) => string | null = runGit,
): string | null {
    const dir = dirname(entry);
    const top = git(["rev-parse", "--show-toplevel"], dir);
    const common = git(
        ["rev-parse", "--path-format=absolute", "--git-common-dir"],
        dir,
    );
    if (top === null || common === null) {
        return null;
    }
    return join(dirname(common), relative(top, entry));
}

function runGit(args: string[], cwd: string): string | null {
    const result = Bun.spawnSync(["git", ...args], { cwd, stderr: "ignore" });
    const out = result.stdout.toString().trim();
    return result.exitCode === 0 && out !== "" ? out : null;
}
