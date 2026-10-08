// vim:set expandtab shiftwidth=4 filetype=typescript:
// SPDX-License-Identifier: GPL-3.0-only

//
//
// ~chewygumxx/dorothy.git
// ::: :/src/history/binary.ts
//
//

import { existsSync } from "node:fs";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve as resolvePath } from "node:path";
import type { Env } from "../xdg.js";
import { AUTHOR, type Commit, MAIN, type MemoryRepo, SEALED } from "./repo.js";

// Before every command: the user's signing, hooks and automatic garbage
// collection never reach Dorothy's repository, and paths print as they
// are rather than quoted.
const ISOLATION = [
    "-c",
    "commit.gpgsign=false",
    "-c",
    "tag.gpgsign=false",
    "-c",
    "core.hooksPath=/dev/null",
    "-c",
    "init.defaultBranch=main",
    "-c",
    "core.quotePath=false",
    "-c",
    "gc.auto=0",
    "-c",
    "maintenance.auto=false",
];

// Variables that would point git at another repository, or carry
// configuration of their own.
const LOCATING = new Set([
    "GIT_DIR",
    "GIT_WORK_TREE",
    "GIT_INDEX_FILE",
    "GIT_OBJECT_DIRECTORY",
    "GIT_ALTERNATE_OBJECT_DIRECTORIES",
    "GIT_COMMON_DIR",
    "GIT_NAMESPACE",
    "GIT_CONFIG",
    "GIT_CONFIG_PARAMETERS",
    "GIT_CONFIG_COUNT",
]);

// The environment every command runs in: the caller's, less what locates
// a repository or configures git, with the user's global and system
// configuration shut out and Dorothy as the author.
export function isolatedEnv(env: Env): Record<string, string> {
    const isolated: Record<string, string> = {};
    for (const [key, value] of Object.entries(env)) {
        if (
            value !== undefined &&
            !LOCATING.has(key) &&
            !/^GIT_CONFIG_(KEY|VALUE)_\d+$/.test(key)
        ) {
            isolated[key] = value;
        }
    }
    return {
        ...isolated,
        GIT_CONFIG_GLOBAL: "/dev/null",
        GIT_CONFIG_NOSYSTEM: "1",
        GIT_TERMINAL_PROMPT: "0",
        GIT_AUTHOR_NAME: AUTHOR.name,
        GIT_AUTHOR_EMAIL: AUTHOR.email,
        GIT_COMMITTER_NAME: AUTHOR.name,
        GIT_COMMITTER_EMAIL: AUTHOR.email,
    };
}

// The user's own credential helpers: the one setting carried over from
// their global configuration, for pushing and fetching only.
export async function credentialHelpers(
    env: Env = process.env,
): Promise<string[]> {
    try {
        const proc = Bun.spawn(
            ["git", "config", "--global", "--get-all", "credential.helper"],
            {
                env: Object.fromEntries(
                    Object.entries(env).filter(
                        (entry): entry is [string, string] =>
                            entry[1] !== undefined,
                    ),
                ),
                stdout: "pipe",
                stderr: "ignore",
            },
        );
        const [out, code] = await Promise.all([
            new Response(proc.stdout).text(),
            proc.exited,
        ]);
        return code === 0 ? out.split("\n").filter((line) => line !== "") : [];
    } catch {
        return [];
    }
}

// A push or fetch over ssh must fail rather than prompt on the terminal,
// which GIT_TERMINAL_PROMPT does not stop; a user's own ssh command stands.
export function sshBatch(env: Env): Record<string, string> {
    return env.GIT_SSH_COMMAND === undefined && env.GIT_SSH === undefined
        ? { GIT_SSH_COMMAND: "ssh -o BatchMode=yes" }
        : {};
}

type Ran = { code: number; stdout: Uint8Array; stderr: string };

const decoder = new TextDecoder();
const text = (ran: Ran) => decoder.decode(ran.stdout);

export function binaryRepo(
    location: string,
    { env = process.env }: { env?: Env } = {},
): MemoryRepo {
    // Absolute, since git runs with root as its working directory.
    const root = resolvePath(location);
    // Git never looks above the data directory for a repository, so a
    // parent that is one (a dotfiles repository over $HOME) is not
    // written to when root has none of its own; and a path is a name,
    // never a pattern, so a file named a*.txt stages only itself.
    const base = {
        ...isolatedEnv(env),
        GIT_CEILING_DIRECTORIES: dirname(root),
        GIT_LITERAL_PATHSPECS: "1",
    };
    let helpers: Promise<string[]> | null = null;

    const run = async (
        args: readonly string[],
        {
            input,
            extra = {},
        }: { input?: Uint8Array; extra?: Record<string, string> } = {},
    ): Promise<Ran> => {
        const proc = Bun.spawn(["git", ...ISOLATION, ...args], {
            cwd: root,
            env: { ...base, ...extra },
            stdin: input ?? "ignore",
            stdout: "pipe",
            stderr: "pipe",
        });
        const [stdout, stderr, code] = await Promise.all([
            new Response(proc.stdout).bytes(),
            new Response(proc.stderr).text(),
            proc.exited,
        ]);
        return { code, stdout, stderr };
    };
    const must = async (
        args: readonly string[],
        options?: { input?: Uint8Array; extra?: Record<string, string> },
    ): Promise<Ran> => {
        const ran = await run(args, options);
        if (ran.code !== 0) {
            throw new Error(
                `git ${args[0]}: ${ran.stderr.trim() || `exit ${ran.code}`}`,
            );
        }
        return ran;
    };
    const resolve = async (rev: string): Promise<string | null> => {
        const ran = await run([
            "rev-parse",
            "--verify",
            "-q",
            `${rev}^{commit}`,
        ]);
        return ran.code === 0 ? text(ran).trim() : null;
    };
    // The helpers (and ssh's batch mode) as configuration in the
    // environment, where a command's
    // own -c would not reach them past ISOLATION's.
    const credentials = async (): Promise<Record<string, string>> => {
        helpers ??= credentialHelpers(env);
        const found = await helpers;
        const extra: Record<string, string> = {
            ...sshBatch(env),
            GIT_CONFIG_COUNT: String(found.length),
        };
        found.forEach((helper, index) => {
            extra[`GIT_CONFIG_KEY_${index}`] = "credential.helper";
            extra[`GIT_CONFIG_VALUE_${index}`] = helper;
        });
        return extra;
    };

    return {
        engine: "git",
        root,
        exists: () => existsSync(join(root, ".git", "HEAD")),
        async init() {
            await mkdir(root, { recursive: true, mode: 0o700 });
            await must(["init", "-q", "-b", "main"]);
        },
        async commit(paths, message) {
            if (paths.length === 0) {
                return null;
            }
            const present = paths.filter((path) =>
                existsSync(join(root, path)),
            );
            const missing = paths.filter((path) => !present.includes(path));
            if (present.length > 0) {
                await must(["add", "--", ...present]);
            }
            if (missing.length > 0) {
                await must([
                    "rm",
                    "--cached",
                    "--ignore-unmatch",
                    "-q",
                    "--",
                    ...missing,
                ]);
            }
            if ((await run(["diff", "--cached", "--quiet"])).code === 0) {
                return null;
            }
            await must(["commit", "-q", "--no-verify", "-m", message]);
            return resolve("HEAD");
        },
        async log(path, limit = 20) {
            if ((await resolve(MAIN)) === null) {
                return [];
            }
            const ran = await must([
                "log",
                MAIN,
                `--max-count=${limit}`,
                "--format=%H%x00%cI%x00%s%x1e",
                ...(path === undefined ? [] : ["--", path]),
            ]);
            return text(ran)
                .split("\x1e")
                .map((entry) => entry.trim())
                .filter((entry) => entry !== "")
                .map((entry): Commit => {
                    const [sha = "", at = "", message = ""] = entry.split("\0");
                    return { sha, at: new Date(at).toISOString(), message };
                });
        },
        async show(path, rev) {
            const ran = await run(["cat-file", "blob", `${rev}:${path}`]);
            return ran.code === 0 ? ran.stdout : null;
        },
        async files(rev) {
            return text(await must(["ls-tree", "-r", "-z", "--name-only", rev]))
                .split("\0")
                .filter((path) => path !== "")
                .sort();
        },
        async changed() {
            const entries = text(
                await must([
                    "status",
                    "--porcelain=v1",
                    "-z",
                    "--untracked-files=all",
                ]),
            ).split("\0");
            const paths: string[] = [];
            for (let index = 0; index < entries.length; index++) {
                const entry = entries[index] ?? "";
                if (entry === "") {
                    continue;
                }
                paths.push(entry.slice(3));
                // A rename or copy is followed by the path it came from.
                if (entry[0] === "R" || entry[0] === "C") {
                    index++;
                }
            }
            return paths;
        },
        resolve,
        async setRef(name, sha) {
            await must(["update-ref", name, sha]);
        },
        async deleteRef(name) {
            await must(["update-ref", "-d", name]);
        },
        async bundle(since) {
            const tip = await resolve(MAIN);
            if (tip === null || tip === since) {
                return null;
            }
            const ran = await must([
                "bundle",
                "create",
                "-q",
                "-",
                since === null ? "main" : `${since}..main`,
            ]);
            return ran.stdout;
        },
        async unbundle(bundle) {
            const file = join(root, ".git", "dorothy-incoming.bundle");
            await writeFile(file, bundle);
            try {
                await must(["bundle", "verify", "-q", file]);
                await must([
                    "fetch",
                    "-q",
                    "--update-head-ok",
                    file,
                    `${MAIN}:${MAIN}`,
                ]);
            } finally {
                await rm(file, { force: true });
            }
            const tip = await resolve(MAIN);
            if (tip === null) {
                throw new Error("the bundle left main empty");
            }
            return tip;
        },
        async appendSealed(name, bytes, readme, message) {
            // A private index, so the working tree's is never touched.
            const index = join(root, ".git", "dorothy-sealed.index");
            const extra = { GIT_INDEX_FILE: index };
            await rm(index, { force: true });
            try {
                const tip = await resolve(SEALED);
                await must(
                    tip === null
                        ? ["read-tree", "--empty"]
                        : ["read-tree", tip],
                    {
                        extra,
                    },
                );
                const blob = text(
                    await must(["hash-object", "-w", "--stdin"], {
                        input: bytes,
                    }),
                ).trim();
                const note = text(
                    await must(["hash-object", "-w", "--stdin"], {
                        input: new TextEncoder().encode(readme),
                    }),
                ).trim();
                for (const [sha, path] of [
                    [blob, name],
                    [note, "SEALED"],
                ] as const) {
                    await must(
                        [
                            "update-index",
                            "--add",
                            "--cacheinfo",
                            `100644,${sha},${path}`,
                        ],
                        { extra },
                    );
                }
                const tree = text(await must(["write-tree"], { extra })).trim();
                const commit = text(
                    await must([
                        "commit-tree",
                        tree,
                        ...(tip === null ? [] : ["-p", tip]),
                        "-m",
                        message,
                    ]),
                ).trim();
                await must(["update-ref", SEALED, commit]);
                return commit;
            } finally {
                await rm(index, { force: true });
            }
        },
        async sealedNames() {
            const tip = await resolve(SEALED);
            if (tip === null) {
                return [];
            }
            return text(
                await must([
                    "ls-tree",
                    "-r",
                    "-z",
                    "--name-only",
                    tip,
                    "--",
                    "bundles",
                ]),
            )
                .split("\0")
                .filter((path) => path !== "")
                .sort();
        },
        async sealedFile(name) {
            return (await must(["cat-file", "blob", `${SEALED}:${name}`]))
                .stdout;
        },
        async setRemote(name, url) {
            await run(["remote", "remove", name]);
            await must(["remote", "add", name, url]);
        },
        async remote(name) {
            const ran = await run(["remote", "get-url", name]);
            return ran.code === 0 ? text(ran).trim() : null;
        },
        async push(remote, branch, _token) {
            await must(
                [
                    "push",
                    "-q",
                    remote,
                    `refs/heads/${branch}:refs/heads/${branch}`,
                ],
                { extra: await credentials() },
            );
        },
        async fetch(url, branch, _token) {
            await must(
                [
                    "fetch",
                    "-q",
                    "--update-head-ok",
                    url,
                    `refs/heads/${branch}:refs/heads/${branch}`,
                ],
                { extra: await credentials() },
            );
        },
        async checkout() {
            await must(["reset", "-q", "--hard", MAIN]);
        },
        async maintain() {
            await must(["gc", "-q"]);
        },
    };
}
