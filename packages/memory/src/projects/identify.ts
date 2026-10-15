// vim:set expandtab shiftwidth=4 filetype=typescript:
// SPDX-License-Identifier: GPL-3.0-only

//
//
// ~chewygumxx/dorothy.git
// ::: :/packages/memory/src/projects/identify.ts
//
//

// Which project a path belongs to: the git repository it is in, named by
// its origin remote. The origin is read from the repository's config
// file rather than from git, so Dorothy needs no git installed and no
// rewrite (insteadOf) in the user's configuration changes an id.

import { createHash } from "node:crypto";
import { readFile, realpath, stat } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";
import { isProjectId } from "../facts/store.js";

export type Project = { root: string; id: string; name: string };

const codeOf = (error: unknown) => (error as { code?: unknown }).code;

// The origin as an id: scheme, user, credentials, port and .git dropped,
// the host lowercased. Null for a remote that names no host, such as a
// local path or a file:// URL.
export function normaliseRemote(url: string): string | null {
    const trimmed = url.trim();
    let host: string;
    let path: string;
    if (/^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed)) {
        let parsed: URL;
        try {
            parsed = new URL(trimmed);
        } catch {
            return null;
        }
        if (parsed.protocol === "file:" || parsed.hostname === "") {
            return null;
        }
        host = parsed.hostname;
        try {
            path = decodeURIComponent(parsed.pathname);
        } catch {
            return null;
        }
    } else {
        // scp-like: [user[:password]@]host:path
        const scp = /^(?:[^@/]+@)?([^@/:]+):(.+)$/.exec(trimmed);
        if (scp === null) {
            return null;
        }
        host = scp[1] as string;
        path = scp[2] as string;
    }
    const parts = path.split("/").filter((part) => part !== "");
    const last = parts.length - 1;
    if (last < 0) {
        return null;
    }
    parts[last] = (parts[last] as string).replace(/\.git$/, "");
    const id = [host.toLowerCase(), ...parts].join("/");
    return isProjectId(id) ? id : null;
}

export const localId = (root: string) =>
    `local-${createHash("sha256").update(root).digest("hex").slice(0, 12)}`;

// The nearest directory up from path that holds .git.
async function findRoot(
    path: string,
): Promise<{ root: string; git: string } | null> {
    let dir = await realpath(path);
    for (;;) {
        const git = join(dir, ".git");
        try {
            await stat(git);
            return { root: dir, git };
        } catch (error) {
            if (codeOf(error) !== "ENOENT") {
                throw error;
            }
        }
        const up = dirname(dir);
        if (up === dir) {
            return null;
        }
        dir = up;
    }
}

// The config file a .git directory, or a worktree's or submodule's .git
// file, leads to.
async function configPath(git: string): Promise<string> {
    if ((await stat(git)).isDirectory()) {
        return join(git, "config");
    }
    const found = /^gitdir:\s*(.+?)\s*$/m.exec(await readFile(git, "utf8"));
    if (found === null) {
        throw new Error(`${git} names no gitdir`);
    }
    const gitdir = resolve(dirname(git), found[1] as string);
    try {
        const common = (
            await readFile(join(gitdir, "commondir"), "utf8")
        ).trim();
        return join(resolve(gitdir, common), "config");
    } catch (error) {
        if (codeOf(error) !== "ENOENT") {
            throw error;
        }
        return join(gitdir, "config");
    }
}

// [remote "origin"]'s url in a git config file.
export function originUrl(config: string): string | null {
    let inOrigin = false;
    for (const raw of config.split("\n")) {
        const line = raw.trim();
        if (line === "" || line.startsWith("#") || line.startsWith(";")) {
            continue;
        }
        const section = /^\[\s*([^\s\]"]+)(?:\s+"([^"]*)")?\s*\]/.exec(line);
        if (section !== null) {
            inOrigin =
                section[1]?.toLowerCase() === "remote" &&
                section[2] === "origin";
            continue;
        }
        const url = /^url\s*=\s*(.*)$/i.exec(line);
        if (inOrigin && url !== null) {
            const value = (url[1] as string).replace(/\s+[#;].*$/, "").trim();
            return value.replace(/^"(.*)"$/, "$1");
        }
    }
    return null;
}

export async function identify(path: string): Promise<Project | null> {
    const found = await findRoot(path);
    if (found === null) {
        return null;
    }
    let config = "";
    try {
        config = await readFile(await configPath(found.git), "utf8");
    } catch (error) {
        if (codeOf(error) !== "ENOENT") {
            throw error;
        }
    }
    const url = originUrl(config);
    const remote = url === null ? null : normaliseRemote(url);
    return {
        root: found.root,
        id: remote ?? localId(found.root),
        name: remote?.split("/").at(-1) ?? basename(found.root),
    };
}
