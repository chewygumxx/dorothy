// vim:set expandtab shiftwidth=4 filetype=typescript:
// SPDX-License-Identifier: GPL-3.0-only

//
//
// ~chewygumxx/dorothy.git
// ::: :/packages/memory/src/history/iso.ts
//
//

import fs, { existsSync } from "node:fs";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { join, resolve as resolvePath } from "node:path";
import * as git from "isomorphic-git";
import http from "isomorphic-git/http/node";
import {
    AUTHOR,
    type Commit,
    MAIN,
    type MemoryRepo,
    NEEDS_BINARY,
    SEALED,
} from "./repo.js";

const encoder = new TextEncoder();
const decoder = new TextDecoder();

type StatusRow = [string, 0 | 1, 0 | 1 | 2, 0 | 1 | 2 | 3];

// A staged path differs from HEAD: added, deleted or changed in the index.
const staged = ([, head, , stage]: StatusRow) =>
    head === 0 ? stage !== 0 : stage !== 1;

const firstLine = (message: string) => message.trim().split("\n")[0] ?? "";

// Where the blank line that ends a bundle's header sits.
function headerEnd(bundle: Uint8Array): number {
    for (let index = 0; index + 1 < bundle.length; index++) {
        if (bundle[index] === 0x0a && bundle[index + 1] === 0x0a) {
            return index;
        }
    }
    throw new Error("not a git bundle");
}

const https = (url: string) => /^https:\/\//.test(url);

// The engine for a machine without git. It reads and writes the same
// repository the binary does; it cannot repack, and pushes only over
// https.
export function isoRepo(location: string): MemoryRepo {
    // Absolute, as the binary's is, so that root means one thing.
    const root = resolvePath(location);
    const dir = root;
    const auth = (token: string | null) =>
        token === null
            ? {}
            : { onAuth: () => ({ username: "dorothy", password: token }) };

    const hasCommit = async (oid: string): Promise<boolean> => {
        try {
            await git.readCommit({ fs, dir, oid });
            return true;
        } catch {
            return false;
        }
    };

    // resolveRef takes any 40 hex digits on trust: read the commit.
    const resolve = async (rev: string): Promise<string | null> => {
        let oid: string;
        try {
            oid = await git.resolveRef({ fs, dir, ref: rev });
        } catch {
            try {
                oid = await git.expandOid({ fs, dir, oid: rev });
            } catch {
                return null;
            }
        }
        return (await hasCommit(oid)) ? oid : null;
    };

    // History moves only forward: a ref takes a tip that descends from
    // what it holds, as the binary's fetch without a + does.
    const advance = async (ref: string, tip: string): Promise<void> => {
        if (!(await hasCommit(tip))) {
            throw new Error(`the pack left ${tip} missing`);
        }
        const current = await resolve(ref);
        if (
            current !== null &&
            current !== tip &&
            !(await git.isDescendent({ fs, dir, oid: tip, ancestor: current }))
        ) {
            throw new Error(`${ref} would not move forward to ${tip}`);
        }
        await git.writeRef({ fs, dir, ref, value: tip, force: true });
    };

    const remote = async (name: string): Promise<string | null> => {
        const remotes = await git.listRemotes({ fs, dir });
        return remotes.find((entry) => entry.remote === name)?.url ?? null;
    };

    // Every tree and blob under a tree, less those already known.
    const collect = async (
        tree: string,
        into: Set<string>,
        known: ReadonlySet<string>,
    ): Promise<void> => {
        if (known.has(tree) || into.has(tree)) {
            return;
        }
        into.add(tree);
        for (const entry of (await git.readTree({ fs, dir, oid: tree })).tree) {
            if (entry.type === "tree") {
                await collect(entry.oid, into, known);
            } else if (entry.type === "blob" && !known.has(entry.oid)) {
                into.add(entry.oid);
            }
        }
    };

    // The sealed branch's bundles directory, as entries.
    const sealedEntries = async (tip: string | null) => {
        if (tip === null) {
            return [];
        }
        const { commit } = await git.readCommit({ fs, dir, oid: tip });
        const bundles = (
            await git.readTree({ fs, dir, oid: commit.tree })
        ).tree.find((entry) => entry.path === "bundles");
        return bundles === undefined
            ? []
            : (await git.readTree({ fs, dir, oid: bundles.oid })).tree;
    };

    return {
        engine: "isomorphic-git",
        root,
        exists: () => existsSync(join(root, ".git", "HEAD")),
        async init() {
            await mkdir(root, { recursive: true, mode: 0o700 });
            await git.init({ fs, dir, defaultBranch: "main" });
        },
        async commit(paths, message) {
            if (paths.length === 0) {
                return null;
            }
            for (const filepath of paths) {
                if (existsSync(join(dir, filepath))) {
                    await git.add({ fs, dir, filepath });
                } else {
                    await git.remove({ fs, dir, filepath });
                }
            }
            // The whole index, as the binary decides: a change the user
            // staged by hand rides along.
            const rows = (await git.statusMatrix({ fs, dir })) as StatusRow[];
            if (!rows.some(staged)) {
                return null;
            }
            return git.commit({
                fs,
                dir,
                message,
                author: AUTHOR,
                committer: AUTHOR,
            });
        },
        async log(path, limit = 20) {
            if ((await resolve(MAIN)) === null) {
                return [];
            }
            let entries: Awaited<ReturnType<typeof git.log>>;
            try {
                // force: a file missing at the tip (deleted) still has its
                // history listed, as the binary lists it.
                entries = await git.log({
                    fs,
                    dir,
                    ref: MAIN,
                    ...(path === undefined
                        ? { depth: limit }
                        : { filepath: path, force: true }),
                });
            } catch (error) {
                if (error instanceof git.Errors.NotFoundError) {
                    return [];
                }
                throw error;
            }
            return entries.slice(0, limit).map(
                (entry): Commit => ({
                    sha: entry.oid,
                    at: new Date(
                        entry.commit.committer.timestamp * 1000,
                    ).toISOString(),
                    message: firstLine(entry.commit.message),
                }),
            );
        },
        async show(path, rev) {
            const oid = await resolve(rev);
            if (oid === null) {
                return null;
            }
            try {
                return (await git.readBlob({ fs, dir, oid, filepath: path }))
                    .blob;
            } catch {
                return null;
            }
        },
        async files(rev) {
            const oid = await resolve(rev);
            if (oid === null) {
                throw new Error(`no revision ${rev}`);
            }
            return (await git.listFiles({ fs, dir, ref: oid })).sort();
        },
        async changed() {
            const rows = (await git.statusMatrix({ fs, dir })) as StatusRow[];
            return rows
                .filter(
                    ([, head, workdir, stage]) =>
                        !(head === 1 && workdir === 1 && stage === 1),
                )
                .map(([path]) => path);
        },
        resolve,
        async setRef(name, sha) {
            await git.writeRef({ fs, dir, ref: name, value: sha, force: true });
        },
        async deleteRef(name) {
            await git.deleteRef({ fs, dir, ref: name });
        },
        async bundle(since) {
            const tip = await resolve(MAIN);
            if (tip === null || tip === since) {
                return null;
            }
            // main is a line: walk back from the tip to since.
            const commits: string[] = [];
            let at: string | null = tip;
            while (at !== null && at !== since) {
                commits.push(at);
                const { commit } = await git.readCommit({ fs, dir, oid: at });
                at = commit.parent[0] ?? null;
            }
            if (since !== null && at === null) {
                throw new Error(`${since} is not in main's history`);
            }
            const known = new Set<string>();
            if (since !== null) {
                const { commit } = await git.readCommit({
                    fs,
                    dir,
                    oid: since,
                });
                await collect(commit.tree, known, new Set());
            }
            const oids = new Set<string>();
            for (const oid of commits) {
                oids.add(oid);
                const { commit } = await git.readCommit({ fs, dir, oid });
                await collect(commit.tree, oids, known);
            }
            const { packfile } = await git.packObjects({
                fs,
                dir,
                oids: [...oids],
            });
            if (packfile === undefined) {
                throw new Error("isomorphic-git made no pack");
            }
            const header = encoder.encode(
                `# v2 git bundle\n${since === null ? "" : `-${since} prerequisite\n`}${tip} ${MAIN}\n\n`,
            );
            const out = new Uint8Array(header.length + packfile.length);
            out.set(header);
            out.set(packfile, header.length);
            return out;
        },
        async unbundle(bundle) {
            const end = headerEnd(bundle);
            const lines = decoder.decode(bundle.subarray(0, end)).split("\n");
            if (lines[0] !== "# v2 git bundle") {
                throw new Error("not a v2 git bundle");
            }
            for (const line of lines.slice(1)) {
                const oid = line.slice(1, 41);
                if (line.startsWith("-") && !(await hasCommit(oid))) {
                    throw new Error(
                        `the bundle needs ${oid}, which is missing`,
                    );
                }
            }
            const tip = lines
                .find((line) => line.endsWith(` ${MAIN}`))
                ?.slice(0, 40);
            if (tip === undefined) {
                throw new Error("the bundle has no main");
            }
            const filepath = join(
                ".git",
                "objects",
                "pack",
                `pack-${crypto.randomUUID().replaceAll("-", "")}.pack`,
            );
            await mkdir(join(dir, ".git", "objects", "pack"), {
                recursive: true,
            });
            await writeFile(join(dir, filepath), bundle.subarray(end + 2));
            try {
                await git.indexPack({ fs, dir, filepath });
            } catch (error) {
                await rm(join(dir, filepath), { force: true });
                throw error;
            }
            await advance(MAIN, tip);
            return tip;
        },
        async appendSealed(name, bytes, readme, message) {
            const tip = await resolve(SEALED);
            const leaf = name.slice("bundles/".length);
            const blob = await git.writeBlob({ fs, dir, blob: bytes });
            const note = await git.writeBlob({
                fs,
                dir,
                blob: encoder.encode(readme),
            });
            const bundles = await git.writeTree({
                fs,
                dir,
                tree: [
                    ...(await sealedEntries(tip)).filter(
                        (entry) => entry.path !== leaf,
                    ),
                    { mode: "100644", path: leaf, oid: blob, type: "blob" },
                ],
            });
            const tree = await git.writeTree({
                fs,
                dir,
                tree: [
                    { mode: "100644", path: "SEALED", oid: note, type: "blob" },
                    {
                        mode: "040000",
                        path: "bundles",
                        oid: bundles,
                        type: "tree",
                    },
                ],
            });
            return git.commit({
                fs,
                dir,
                message,
                author: AUTHOR,
                committer: AUTHOR,
                tree,
                parent: tip === null ? [] : [tip],
                ref: SEALED,
            });
        },
        async sealedNames() {
            return (await sealedEntries(await resolve(SEALED)))
                .map((entry) => `bundles/${entry.path}`)
                .sort();
        },
        async sealedFile(name) {
            const tip = await resolve(SEALED);
            if (tip === null) {
                throw new Error("there is no sealed branch");
            }
            return (await git.readBlob({ fs, dir, oid: tip, filepath: name }))
                .blob;
        },
        async setRemote(name, url) {
            await git.addRemote({ fs, dir, remote: name, url, force: true });
        },
        remote,
        async push(name, branch, token) {
            const url = await remote(name);
            if (url === null || !https(url)) {
                throw new Error(NEEDS_BINARY);
            }
            const result = await git.push({
                fs,
                http,
                dir,
                remote: name,
                ref: `refs/heads/${branch}`,
                remoteRef: `refs/heads/${branch}`,
                ...auth(token),
            });
            if (!result.ok) {
                throw new Error(result.error ?? "the push was refused");
            }
        },
        async fetch(url, branch, token) {
            if (!https(url)) {
                throw new Error(NEEDS_BINARY);
            }
            const result = await git.fetch({
                fs,
                http,
                dir,
                url,
                ref: branch,
                singleBranch: true,
                tags: false,
                ...auth(token),
            });
            if (result.fetchHead === null) {
                throw new Error(`the mirror has no ${branch}`);
            }
            await advance(`refs/heads/${branch}`, result.fetchHead);
        },
        async checkout() {
            await git.checkout({ fs, dir, ref: "main", force: true });
        },
        async maintain() {},
    };
}
