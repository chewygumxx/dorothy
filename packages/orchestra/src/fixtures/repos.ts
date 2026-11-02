// vim:set expandtab shiftwidth=4 filetype=typescript:
// SPDX-License-Identifier: GPL-3.0-only

//
//
// ~chewygumxx/dorothy.git
// ::: :/packages/orchestra/src/fixtures/repos.ts
//
//

// Repositories for the broker's tests, under one temporary root: a bare
// remote, acme/widget.git, whose main has one commit; a main checkout of
// it, origin its path, with one more commit on its local main; and a
// user's home whose global configuration names the user through an
// include. Its git runs with that home alone, never the user's own.

import { writeFileSync } from "node:fs";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

export type Repos = {
    root: string;
    // What the server's environment would hold: PATH, HOME, the roots.
    env: Record<string, string>;
    // $XDG_STATE_HOME/dorothy/orchestra.
    state: string;
    worktrees: string;
    remote: string;
    checkout: string;
    // The remote's main and the checkout's local main, one ahead.
    remoteMain: string;
    localMain: string;
    git: (args: string[], cwd: string) => string;
    commit: (dir: string, file: string) => string;
};

export async function makeRepos(): Promise<Repos> {
    const root = await mkdtemp(join(tmpdir(), "orchestra-broker-"));
    const home = join(root, "home");
    await mkdir(home);
    await writeFile(
        join(home, ".gitconfig"),
        `[include]\n\tpath = ${join(home, "who.gitconfig")}\n`,
    );
    await writeFile(
        join(home, "who.gitconfig"),
        "[user]\n\tname = Ada Lovelace\n\temail = ada@example.test\n",
    );
    const env = {
        PATH: process.env.PATH ?? "/usr/bin",
        HOME: home,
        XDG_STATE_HOME: join(root, "state"),
    };
    const git = (args: string[], cwd: string) => {
        const proc = Bun.spawnSync(["git", ...args], {
            cwd,
            env: { ...env, GIT_CONFIG_NOSYSTEM: "1" },
            stdout: "pipe",
            stderr: "pipe",
        });
        if (proc.exitCode !== 0) {
            throw new Error(`git ${args.join(" ")}: ${proc.stderr}`);
        }
        return proc.stdout.toString().trim();
    };
    const commit = (dir: string, file: string) => {
        writeFileSync(join(dir, file), `${file}\n`);
        git(["add", file], dir);
        git(["commit", "-q", "-m", file], dir);
        return git(["rev-parse", "HEAD"], dir);
    };
    const remote = join(root, "remotes", "acme", "widget.git");
    const checkout = join(root, "checkout");
    await mkdir(remote, { recursive: true });
    git(["init", "-q", "--bare", "-b", "main", remote], root);
    git(["clone", "-q", remote, checkout], root);
    const remoteMain = commit(checkout, "one");
    git(["push", "-q", "origin", "main"], checkout);
    const localMain = commit(checkout, "two");
    const state = join(root, "state", "dorothy", "orchestra");
    const worktrees = join(root, "worktrees");
    await mkdir(state, { recursive: true });
    await mkdir(worktrees);
    return {
        root,
        env,
        state,
        worktrees,
        remote,
        checkout,
        remoteMain,
        localMain,
        git,
        commit,
    };
}
