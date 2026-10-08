// vim:set expandtab shiftwidth=4 filetype=typescript:
// SPDX-License-Identifier: GPL-3.0-only

//
//
// ~chewygumxx/dorothy.git
// ::: :/src/history/repo.ts
//
//

import { chmod } from "node:fs/promises";
import { join } from "node:path";
import type { Env } from "@dorothy/core";

export type Engine = "git" | "isomorphic-git";

// A commit as history lists it; at is UTC, to the second.
export type Commit = { sha: string; at: string; message: string };

// Dorothy's data directory as a repository. Both engines read and write
// one on-disk format, so either can take over what the other wrote. Every
// path is relative to root, with / between its parts.
export type MemoryRepo = {
    readonly engine: Engine;
    readonly root: string;
    // Whether root holds a repository.
    exists(): boolean;
    // Makes root a repository on main; root is made if it is missing.
    init(): Promise<void>;
    // Stages the paths as they are on disk (a missing one as deleted) and
    // commits the index; null when that changes nothing.
    commit(paths: readonly string[], message: string): Promise<string | null>;
    // main's commits, newest first, or those touching one path.
    log(path?: string, limit?: number): Promise<Commit[]>;
    // A file as it was at a revision; null when it was not there.
    show(path: string, rev: string): Promise<Uint8Array | null>;
    // Every file at a revision, sorted.
    files(rev: string): Promise<string[]>;
    // Files that differ from the last commit: changed, deleted or new,
    // ignored ones aside.
    changed(): Promise<string[]>;
    // A revision's commit, or null.
    resolve(rev: string): Promise<string | null>;
    setRef(name: string, sha: string): Promise<void>;
    // Removes a ref; nothing happens when there is none.
    deleteRef(name: string): Promise<void>;
    // The commits on main after since (all of them for null) as a git
    // bundle; null when there are none.
    bundle(since: string | null): Promise<Uint8Array | null>;
    // Applies a bundle to main; returns main's new tip.
    unbundle(bundle: Uint8Array): Promise<string>;
    // Adds a file to the sealed branch in a commit of its own, with
    // SEALED at the branch's root; main and the working tree are untouched.
    appendSealed(
        name: string,
        bytes: Uint8Array,
        readme: string,
        message: string,
    ): Promise<string>;
    // The sealed branch's bundles, sorted.
    sealedNames(): Promise<string[]>;
    sealedFile(name: string): Promise<Uint8Array>;
    // Records a remote, replacing one of the same name.
    setRemote(name: string, url: string): Promise<void>;
    remote(name: string): Promise<string | null>;
    // Fast-forward only. token is for an https remote, under either
    // engine; without one, the binary uses the user's credential helpers.
    push(remote: string, branch: string, token: string | null): Promise<void>;
    // Into refs/heads/<branch>.
    fetch(url: string, branch: string, token: string | null): Promise<void>;
    // Makes the working tree main's, as recovery needs.
    checkout(): Promise<void>;
    // Packs loose objects; nothing under isomorphic-git.
    maintain(): Promise<void>;
};

export const AUTHOR = { name: "Dorothy", email: "dorothy@localhost" } as const;
export const MAIN = "refs/heads/main";
export const SEALED = "refs/heads/sealed";
export const SEALED_THROUGH = "refs/dorothy/sealed-through";
export const NEEDS_BINARY = "this mirror needs the git binary";
// The remote the sealed branch is pushed to.
export const MIRROR = "mirror";
// Said at each launch, and by each command, until a mirror is set.
export const NO_MIRROR = "memory has no mirror · dorothy --mirror <url>";

const defined = (env: Env): Record<string, string> =>
    Object.fromEntries(
        Object.entries(env).filter(
            (entry): entry is [string, string] => entry[1] !== undefined,
        ),
    );

export async function hasGitBinary(env: Env = process.env): Promise<boolean> {
    try {
        const proc = Bun.spawn(["git", "--version"], {
            env: defined(env),
            stdout: "ignore",
            stderr: "ignore",
        });
        return (await proc.exited) === 0;
    } catch {
        return false;
    }
}

// The data directory and its repository are the user's alone, whatever
// git init or a recovery's checkout made them.
export async function keepPrivate(root: string): Promise<void> {
    await chmod(root, 0o700);
    await chmod(join(root, ".git"), 0o700);
}
