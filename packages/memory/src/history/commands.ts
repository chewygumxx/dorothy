// vim:set expandtab shiftwidth=4 filetype=typescript:
// SPDX-License-Identifier: GPL-3.0-only

//
//
// ~chewygumxx/dorothy.git
// ::: :/packages/memory/src/history/commands.ts
//
//

import { existsSync, readdirSync, statSync } from "node:fs";
import { readFile, rm } from "node:fs/promises";
import { homedir } from "node:os";
import { isAbsolute, join, relative, resolve, sep } from "node:path";
import { type Env, readConfig } from "@dorothy/core";
import { set } from "@dotenvx/dotenvx";
import { unreadReport } from "../bodies/unread.js";
import { type Lock, type OpenHistory, writeAtomic } from "../memory/sidecar.js";
import { indexPath, RecallIndex } from "../recall/store.js";
import { goodVersion, putBack, type Version } from "./heal.js";
import {
    type HookCommand,
    historyRoot,
    localTime,
    type MemoryHistory,
    openHistory,
} from "./history.js";
import { fileKind, lint } from "./lint.js";
import { Mirror, recover, sealedProblem, waiting } from "./mirror.js";
import { openRepo } from "./open.js";
import {
    definedEnv,
    type Engine,
    MAIN,
    type MemoryRepo,
    MIRROR,
    NO_MIRROR,
    SEALED_THROUGH,
} from "./repo.js";
import { newKey, parseKey } from "./seal.js";

export type Output = { write(text: string): unknown };

export type CommandOptions = {
    env?: Env;
    out?: Output;
    err?: Output;
    engine?: Engine;
    hook?: HookCommand | null;
    now?: () => Date;
    // Where a relative local mirror path is resolved from.
    cwd?: string;
};

const describeError = (error: unknown) =>
    error instanceof Error ? error.message : String(error);
const short = (sha: string) => sha.slice(0, 7);
const sameBytes = (a: Uint8Array, b: Uint8Array) => Buffer.compare(a, b) === 0;

// How the pre-commit hook runs this Dorothy: the same bun, the same entry
// script.
export function entryHook(): HookCommand | null {
    const script = process.argv[1];
    return script === undefined
        ? null
        : { exec: process.execPath, script: resolve(script) };
}

// For memory's commands: history under the index's lock (or its own),
// swept before the command reads anything. Null when the config turns it
// off, or when it can't be used, which is said on err.
export function commandHistory({
    env = process.env,
    err = process.stderr,
    hook = entryHook(),
    // false for a short-lived process, which leaves the mirror to chat's launch.
    remindMirror = true,
}: {
    env?: Env;
    err?: Output;
    hook?: HookCommand | null;
    remindMirror?: boolean;
} = {}): OpenHistory {
    return async (index) => {
        const { config } = await readConfig(env);
        if (!config.history.enabled) {
            return null;
        }
        const opened = await openSwept({ env, err, hook }, index, remindMirror);
        if (opened === null) return null;
        return opened.history.handle(async () => {
            try {
                if (remindMirror) await pushForCommand(opened.history, env);
            } finally {
                opened.close();
            }
        });
    };
}

async function openSwept(
    {
        env = process.env,
        err = process.stderr,
        hook = entryHook(),
        engine,
        now,
    }: CommandOptions,
    index: { lock: Lock } | null,
    remind: boolean,
) {
    const warn = (message: string) => err.write(`dorothy: ${message}\n`);
    const opened = await openHistory({
        root: historyRoot(env),
        index,
        hook,
        warn,
        ...(engine === undefined ? {} : { engine }),
        ...(now === undefined ? {} : { now }),
    });
    if (!opened.ok) {
        warn(opened.reason);
        return null;
    }
    await opened.history.sweep();
    if (remind) await remindOfMirror(opened.history, warn);
    return opened;
}

async function pushForCommand(history: MemoryHistory, env: Env): Promise<void> {
    try {
        if ((await history.repo.remote(MIRROR)) === null) return;
        const mirror = new Mirror({
            repo: history.repo,
            lock: history.lock,
            key: () => parseKey(env.DOROTHY_MIRROR_KEY),
            token: () => env.DOROTHY_MIRROR_TOKEN ?? null,
            warn: (message) => history.warn(message),
            pushMs: 0,
        });
        try {
            await mirror.push();
        } finally {
            await mirror.stop();
        }
    } catch (error) {
        history.warn(
            `history: couldn't push command changes (${describeError(error)})`,
        );
    }
}

async function remindOfMirror(
    history: MemoryHistory,
    warn: (message: string) => unknown,
): Promise<void> {
    try {
        if ((await history.repo.remote(MIRROR)) === null) warn(NO_MIRROR);
    } catch (error) {
        warn(`history: couldn't inspect the mirror (${describeError(error)})`);
    }
}

// History for one of its own commands: under the index's lock when the
// index opens, swept first. Null, said on err, when it is off or broken.
async function session(options: CommandOptions, remind = true) {
    try {
        return await openSession(options, remind);
    } catch (error) {
        (options.err ?? process.stderr).write(
            `dorothy: couldn't open history: ${describeError(error)}\n`,
        );
        return null;
    }
}

async function openSession(
    {
        env = process.env,
        err = process.stderr,
        engine,
        hook = entryHook(),
        now,
    }: CommandOptions,
    // Whether to remind of a missing mirror: not when one is being set.
    remind = true,
): Promise<{ history: MemoryHistory; close(): Promise<void> } | null> {
    const { config } = await readConfig(env);
    if (!config.history.enabled) {
        err.write("dorothy: history is off in config.toml\n");
        return null;
    }
    let index: RecallIndex | null = null;
    try {
        index = RecallIndex.open(indexPath(env));
    } catch {
        // History takes a lock of its own.
    }
    const opened = await openSwept(
        {
            env,
            err,
            hook,
            ...(engine === undefined ? {} : { engine }),
            ...(now === undefined ? {} : { now }),
        },
        index,
        remind,
    );
    if (opened === null) {
        index?.close();
        return null;
    }
    return {
        history: opened.history,
        close: async () => {
            try {
                if (remind) await pushForCommand(opened.history, env);
            } finally {
                opened.close();
                index?.close();
            }
        },
    };
}

// A path the user typed, as history names it: relative to the data
// directory, with /. Null when it lies outside.
function named(root: string, path: string): string | null {
    const inside = relative(root, resolve(root, path));
    return inside === "" ||
        inside === ".." ||
        inside.startsWith(`..${sep}`) ||
        isAbsolute(inside)
        ? null
        : inside.split(sep).join("/");
}

// Who made a commit, from its message.
export function authorOf(message: string): string {
    if (message.endsWith("(user)")) {
        return "user";
    }
    switch (message.slice(0, message.indexOf(":"))) {
        case "review":
        case "compaction":
        case "title":
        case "catch-up":
            return "dorothy";
        case "turn":
            return "turn";
        case "outside":
            return "outside";
        case "restore":
        case "broken":
            return "restore";
        case "adopt":
            return "adopt";
        default:
            return "other";
    }
}

export async function runHistory(
    options: CommandOptions & { path?: string | null; count?: number },
): Promise<number> {
    const { out = process.stdout, err = process.stderr } = options;
    const opened = await session(options);
    if (opened === null) {
        return 1;
    }
    try {
        const { history } = opened;
        let path: string | undefined;
        if (options.path !== undefined && options.path !== null) {
            const inside = named(history.root, options.path);
            if (inside === null) {
                err.write(
                    `dorothy: ${options.path} is not in ${history.root}\n`,
                );
                return 1;
            }
            path = inside;
        }
        for (const commit of await history.repo.log(
            path,
            options.count ?? 20,
        )) {
            out.write(
                `${short(commit.sha)}  ${localTime(commit.at)}  ${authorOf(commit.message).padEnd(7)}  ${commit.message}\n`,
            );
        }
        return 0;
    } catch (error) {
        err.write(`dorothy: couldn't history: ${describeError(error)}\n`);
        return 1;
    } finally {
        await opened.close();
    }
}

export async function runRestore(
    path: string,
    rev: string | null,
    options: CommandOptions = {},
): Promise<number> {
    const { out = process.stdout, err = process.stderr } = options;
    const now = options.now ?? (() => new Date());
    const opened = await session(options);
    if (opened === null) {
        return 1;
    }
    const { history } = opened;
    const repo = history.repo;
    try {
        const inside = named(history.root, path);
        if (inside === null) {
            err.write(`dorothy: ${path} is not in ${history.root}\n`);
            return 1;
        }
        return await history.lock(async () => {
            const version = await versionAt(repo, inside, rev);
            if (typeof version === "string") {
                err.write(`dorothy: ${version}\n`);
                return 1;
            }
            const full = join(history.root, inside);
            if (
                existsSync(full) &&
                sameBytes(await readFile(full), version.bytes)
            ) {
                out.write(
                    `${inside} is already as it was at ${short(version.sha)}\n`,
                );
                return 0;
            }
            const copy = await putBack(
                repo,
                history.root,
                inside,
                version,
                now(),
            );
            out.write(
                `Restored ${inside} from ${short(version.sha)}${copy === null ? "" : `; what it replaced is in ${copy}`}\n`,
            );
            return 0;
        });
    } catch (error) {
        err.write(`dorothy: couldn't restore: ${describeError(error)}\n`);
        return 1;
    } finally {
        await opened.close();
    }
}

// The version of a file to restore: the one at rev, or its last good one;
// else why there is none.
async function versionAt(
    repo: MemoryRepo,
    path: string,
    rev: string | null,
): Promise<Version | string> {
    if (rev === null) {
        return (
            (await goodVersion(repo, path)) ??
            `${path} has no good version in its history`
        );
    }
    const sha = await repo.resolve(rev);
    const bytes = sha === null ? null : await repo.show(path, sha);
    if (sha === null || bytes === null) {
        return `no ${path} at ${rev}`;
    }
    const problem = lint(path, bytes, null);
    if (problem !== null) {
        return `${path} at ${rev} is broken too (${problem})`;
    }
    return { sha, at: "", bytes };
}

// Notes and tags as they were at a revision, in one commit. Transcripts
// are never rolled back: rolling back returns to an earlier judgement of
// the conversations, never an earlier record of them.
export async function runRollback(
    rev: string,
    options: CommandOptions = {},
): Promise<number> {
    const { out = process.stdout, err = process.stderr } = options;
    const opened = await session(options);
    if (opened === null) {
        return 1;
    }
    const { history } = opened;
    const repo = history.repo;
    try {
        return await history.lock(async () => {
            const sha = await repo.resolve(rev);
            if (sha === null) {
                err.write(`dorothy: no revision ${rev}\n`);
                return 1;
            }
            const changed: string[] = [];
            for (const path of await repo.files(sha)) {
                const bytes = await rollbackBytes(repo, path, sha, err);
                if (
                    bytes !== null &&
                    (await writeIfChanged(join(history.root, path), bytes))
                ) {
                    changed.push(path);
                }
            }
            if (changed.length === 0) {
                out.write(
                    `Nothing to roll back: notes and tags are as at ${short(sha)}\n`,
                );
                return 0;
            }
            await repo.commit(changed, `rollback: to ${short(sha)} (user)`);
            out.write(
                `Rolled back ${changed.length} ${changed.length === 1 ? "file" : "files"} to ${short(sha)}\n`,
            );
            return 0;
        });
    } catch (error) {
        err.write(`dorothy: couldn't rollback: ${describeError(error)}\n`);
        return 1;
    } finally {
        await opened.close();
    }
}

// A note's or the vocabulary's bytes at a revision; null for any other
// file, and for one broken there, which is said and left as it is.
async function rollbackBytes(
    repo: MemoryRepo,
    path: string,
    sha: string,
    err: Output,
): Promise<Uint8Array | null> {
    const kind = fileKind(path);
    const bytes =
        kind === "vocabulary" || kind === "sidecar"
            ? await repo.show(path, sha)
            : null;
    const problem = bytes === null ? null : lint(path, bytes, null);
    if (problem !== null) {
        err.write(
            `dorothy: ${path} at ${short(sha)} is broken (${problem}); it is left as it is\n`,
        );
        return null;
    }
    return bytes;
}

// Writes bytes over a file that does not hold them yet; whether it did.
async function writeIfChanged(
    path: string,
    bytes: Uint8Array,
): Promise<boolean> {
    if (existsSync(path) && sameBytes(await readFile(path), bytes)) {
        return false;
    }
    await writeAtomic(path, bytes);
    return true;
}

type Checked = { path: string; problem: string | null };

// Every file in the data directory, linted: against its last commit when
// there is a history, on its own when there is none.
async function checkTree(
    root: string,
    repo: MemoryRepo | null,
): Promise<Checked[]> {
    let paths: string[];
    if (repo !== null) {
        paths = [
            ...new Set([
                ...(await repo.files("HEAD")),
                ...(await repo.changed()),
            ]),
        ].sort();
    } else if (existsSync(root)) {
        paths = (readdirSync(root, { recursive: true }) as string[])
            .map((path) => path.split(sep).join("/"))
            .filter(
                (path) =>
                    !path.startsWith(".git/") &&
                    path !== ".git" &&
                    statSync(join(root, path)).isFile(),
            )
            .sort();
    } else {
        paths = [];
    }
    const checked: Checked[] = [];
    for (const path of paths) {
        const full = join(root, path);
        if (!existsSync(full)) {
            continue;
        }
        const committed =
            repo !== null && fileKind(path) === "transcript"
                ? await repo.show(path, "HEAD")
                : null;
        checked.push({
            path,
            problem: lint(path, await readFile(full), committed),
        });
    }
    return checked;
}

function report(checked: readonly Checked[], out: Output): number {
    const broken = checked.filter((file) => file.problem !== null);
    for (const file of broken) {
        out.write(`${file.path}: ${file.problem}\n`);
    }
    out.write(
        broken.length === 0
            ? `All ${checked.length} files pass.\n`
            : `${broken.length} of ${checked.length} files broken.\n`,
    );
    return broken.length === 0 ? 0 : 1;
}

async function gitIn(
    root: string,
    env: Env,
    args: string[],
): Promise<{ code: number; stdout: Uint8Array }> {
    const proc = Bun.spawn(["git", ...args], {
        cwd: root,
        env: definedEnv(env),
        stdout: "pipe",
        stderr: "ignore",
    });
    const [stdout, code] = await Promise.all([
        new Response(proc.stdout).bytes(),
        proc.exited,
    ]);
    return { code, stdout };
}

// What a commit in progress would hold, for the pre-commit hook: the
// environment is git's own, so a commit's temporary index is the one read.
async function checkStaged(root: string, env: Env): Promise<Checked[]> {
    const names = await gitIn(root, env, [
        "diff",
        "--cached",
        "--name-only",
        "-z",
        "--no-renames",
    ]);
    if (names.code !== 0) {
        throw new Error(`${root} is not a repository git can read`);
    }
    const checked: Checked[] = [];
    for (const path of new TextDecoder()
        .decode(names.stdout)
        .split("\0")
        .filter((name) => name !== "")) {
        const staged = await gitIn(root, env, ["cat-file", "blob", `:${path}`]);
        if (staged.code !== 0) {
            continue;
        }
        const head = await gitIn(root, env, [
            "cat-file",
            "blob",
            `HEAD:${path}`,
        ]);
        checked.push({
            path,
            problem: lint(
                path,
                staged.stdout,
                head.code === 0 ? head.stdout : null,
            ),
        });
    }
    return checked;
}

export async function runCheck(
    options: CommandOptions & { staged?: boolean; root?: string },
): Promise<number> {
    const {
        env = process.env,
        out = process.stdout,
        err = process.stderr,
    } = options;
    try {
        if (options.staged) {
            return report(
                await checkStaged(options.root ?? process.cwd(), env),
                out,
            );
        }
        const root = options.root ?? historyRoot(env);
        const repo = await openRepo(
            root,
            options.engine === undefined ? {} : { engine: options.engine },
        );
        const { config } = await readConfig(env);
        const committed =
            config.history.enabled &&
            repo.exists() &&
            (await repo.resolve(MAIN)) !== null;
        const code = report(
            await checkTree(root, committed ? repo : null),
            out,
        );
        // What recording kept aside, and errors in its hook's log: not
        // memory's files, so the exit code is the lint's alone, and a
        // report that fails is said, not counted.
        try {
            for (const line of await unreadReport(env)) {
                out.write(`${line}\n`);
            }
        } catch (error) {
            out.write(`unread: couldn't be listed (${describeError(error)})\n`);
        }
        return code;
    } catch (error) {
        err.write(`dorothy: couldn't check: ${describeError(error)}\n`);
        return 1;
    }
}

// A mirror on this machine, as against one on a host: a host's is a url
// (other than file://) or scp-like, a colon before the first slash, as in
// git@host:repo.git; anything else is a path.
export const isLocal = (url: string) =>
    url !== "" &&
    (url.startsWith("file://") ||
        !(url.includes("://") || /^[^/]*:/.test(url)));

// A mirror as git is to be given it: a local path made absolute from the
// user's directory (git runs in the data directory), with ~ expanded. Null,
// said on err, for what git would read as an option.
function mirrorUrl(
    url: string,
    {
        env = process.env,
        err = process.stderr,
        cwd = process.cwd(),
    }: CommandOptions,
): string | null {
    if (url.trim() === "" || url.startsWith("-")) {
        err.write(`dorothy: ${url} is not a url or path\n`);
        return null;
    }
    if (!isLocal(url) || url.startsWith("file://") || isAbsolute(url)) {
        return url;
    }
    const home = env.HOME ?? homedir();
    if (url === "~") {
        return home;
    }
    return resolve(cwd, url.startsWith("~/") ? join(home, url.slice(2)) : url);
}

// dotenvx's set, which encrypts the value into .env.
async function saveSecret(name: string, value: string): Promise<void> {
    const result = await set(name, value);
    for (const processed of result.processedEnvs) {
        if (processed.error !== undefined) {
            throw processed.error;
        }
    }
}

export async function runMirror(
    url: string | null,
    options: CommandOptions & {
        setSecret?: (name: string, value: string) => Promise<void>;
    } = {},
): Promise<number> {
    const {
        env = process.env,
        out = process.stdout,
        err = process.stderr,
        setSecret = saveSecret,
        cwd = process.cwd(),
    } = options;
    const target = url === null ? null : mirrorUrl(url, options);
    if (url !== null && target === null) {
        return 1;
    }
    const opened = await session(options, false);
    if (opened === null) {
        return 1;
    }
    const { history } = opened;
    const repo = history.repo;
    try {
        if (target === null) {
            if ((await repo.remote(MIRROR)) !== null) {
                const problem = await keyProblem(
                    env.DOROTHY_MIRROR_KEY,
                    repo,
                    cwd,
                );
                if (problem !== null) {
                    err.write(`dorothy: ${problem}\n`);
                    return 1;
                }
            }
            return await showMirror(repo, out);
        }
        const existing = env.DOROTHY_MIRROR_KEY;
        const problem = await keyProblem(existing, repo, cwd);
        if (problem !== null) {
            err.write(`dorothy: ${problem}\n`);
            return 1;
        }
        await repo.setRemote(MIRROR, target);
        const key = parseKey(existing) ?? (await makeKey(setSecret, out));
        if (!isLocal(target)) {
            out.write(
                `Your conversations will be stored at ${target}, encrypted.\n`,
            );
        }
        const outcome = await new Mirror({
            repo,
            lock: history.lock,
            key: () => key,
            token: () => env.DOROTHY_MIRROR_TOKEN ?? null,
            warn: (message) => err.write(`dorothy: ${message}\n`),
            pushMs: 0,
        }).push();
        if (outcome.kind !== "pushed") {
            return 1;
        }
        out.write(`Pushed to ${target}\n`);
        return 0;
    } catch (error) {
        err.write(
            `dorothy: couldn't set the mirror: ${describeError(error)}\n`,
        );
        return 1;
    } finally {
        await opened.close();
    }
}

async function showMirror(repo: MemoryRepo, out: Output): Promise<number> {
    const current = await repo.remote(MIRROR);
    if (current === null) {
        out.write(
            "No mirror yet; set one with dorothy --mirror <url-or-path>\n",
        );
        return 0;
    }
    const through = await repo.resolve(SEALED_THROUGH);
    out.write(
        `Mirror: ${current}\nSealed through: ${through === null ? "nothing yet" : short(through)}\nWaiting: ${(await waiting(repo)) ? "yes" : "no"}\n`,
    );
    return 0;
}

// Why the mirror's key can't seal, so that no mirror is set; null when it
// can, or when one can be made. Bundles sealed under a key are lost with
// it: one already set is never replaced, even one that does not read. A
// bundle sealed under another key would stop every recovery there; a key
// is made only where the entry guard will read it.
async function keyProblem(
    existing: string | undefined,
    repo: MemoryRepo,
    cwd: string,
): Promise<string | null> {
    if (existing?.startsWith("encrypted:"))
        return "DOROTHY_MIRROR_KEY is still encrypted; load the decrypted environment before setting the mirror. Nothing was changed";
    const key = parseKey(existing);
    if (existing !== undefined && existing !== "" && key === null) {
        return "DOROTHY_MIRROR_KEY is set but is not 32 bytes of base64; it is left as it is, and no mirror is set";
    }
    if (key !== null) {
        const problem = await sealedProblem(repo, key);
        if (problem === null) return null;
        return problem.startsWith("it does not open with this key")
            ? "DOROTHY_MIRROR_KEY does not open the bundles already sealed; set the key they were sealed with. Nothing was changed"
            : `the newest sealed bundle cannot be opened (${problem}); nothing was changed`;
    }
    if ((await repo.sealedNames()).length > 0) {
        return "DOROTHY_MIRROR_KEY is not set, and the bundles already sealed need the key they were sealed with; set that one with dotenvx set. Nothing was changed";
    }
    return existsSync(join(cwd, ".env"))
        ? null
        : `there is no .env in ${cwd} to keep DOROTHY_MIRROR_KEY in; run --mirror from the checkout whose .env holds Dorothy's credentials. Nothing was changed`;
}

// A new mirror key, saved with dotenvx.
async function makeKey(
    setSecret: (name: string, value: string) => Promise<void>,
    out: Output,
): Promise<ReturnType<typeof parseKey>> {
    const made = newKey();
    await setSecret("DOROTHY_MIRROR_KEY", made);
    out.write(
        "Made DOROTHY_MIRROR_KEY and saved it with dotenvx. Keep a copy somewhere else (dotenvx get DOROTHY_MIRROR_KEY): without it the mirror can't be read.\n",
    );
    return parseKey(made);
}

export async function runRecover(
    url: string,
    options: CommandOptions = {},
): Promise<number> {
    const {
        env = process.env,
        out = process.stdout,
        err = process.stderr,
    } = options;
    try {
        const target = mirrorUrl(url, options);
        if (target === null) {
            return 1;
        }
        const root = historyRoot(env);
        if (existsSync(root) && readdirSync(root).length > 0) {
            err.write(
                `dorothy: ${root} is not empty; --recover only fills an empty data directory\n`,
            );
            return 1;
        }
        const key = parseKey(env.DOROTHY_MIRROR_KEY);
        if (key === null) {
            err.write(
                "dorothy: --recover needs DOROTHY_MIRROR_KEY, the key the mirror was sealed with\n",
            );
            return 1;
        }
        const repo = await openRepo(
            root,
            options.engine === undefined ? {} : { engine: options.engine },
        );
        const recovered = await recover({
            repo,
            url: target,
            key,
            token: env.DOROTHY_MIRROR_TOKEN ?? null,
        });
        if (recovered.applied === 0) {
            // The directory was empty or missing, so what is there is what
            // recover made; leaving it would make every retry refuse it.
            await rm(join(root, ".git"), { recursive: true, force: true });
        }
        out.write(
            `Recovered ${recovered.applied} of ${recovered.of} bundles${recovered.tip === null ? "" : `; main is at ${short(recovered.tip)}`}\n`,
        );
        if (recovered.stopped !== null) {
            err.write(`dorothy: recovery stopped: ${recovered.stopped}\n`);
            return 1;
        }
        return report(
            await checkTree(root, recovered.applied === 0 ? null : repo),
            out,
        );
    } catch (error) {
        err.write(`dorothy: couldn't recover: ${describeError(error)}\n`);
        return 1;
    }
}
