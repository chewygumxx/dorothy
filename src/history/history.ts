// vim:set expandtab shiftwidth=4 filetype=typescript:
// SPDX-License-Identifier: GPL-3.0-only

//
//
// ~chewygumxx/dorothy.git
// ::: :/src/history/history.ts
//
//

import { existsSync } from "node:fs";
import { chmod, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { basename, dirname, isAbsolute, join, relative, sep } from "node:path";
import type { HistoryHandle, Lock, Recorder } from "../memory/sidecar.js";
import { transcriptDir } from "../transcript.js";
import type { Env } from "../xdg.js";
import { recoverFile, stamp } from "./heal.js";
import { fileKind, lint } from "./lint.js";
import { FileLock } from "./lock.js";
import { openRepo } from "./open.js";
import { type Engine, MAIN, type MemoryRepo } from "./repo.js";

export type HistoryNotice = { type: "warning"; message: string };
export type HookCommand = { exec: string; script: string };

const describeError = (error: unknown) =>
    error instanceof Error ? error.message : String(error);

// The data directory: transcripts/, tags.json and, now, .git/.
export const historyRoot = (env: Env = process.env) =>
    dirname(transcriptDir(env));

// A hook carrying this line is Dorothy's to rewrite; one without it is the
// user's, and never replaced.
export const HOOK_MARK = "# dorothy pre-commit";

const quote = (text: string) => `'${text.replaceAll("'", `'\\''`)}'`;

// The pre-commit hook: the user's own commits in the data directory are
// linted as Dorothy's are. When Dorothy is gone it steps aside, rather
// than block every commit.
export function hookScript(exec: string, script: string): string {
    return [
        "#!/bin/sh",
        HOOK_MARK,
        "# Lints what is staged, as Dorothy lints her own commits.",
        `if [ ! -f ${quote(script)} ]; then`,
        "    echo 'dorothy: its entry script is gone; not linted' >&2",
        "    exit 0",
        "fi",
        `exec ${quote(exec)} ${quote(script)} --check --staged`,
        "",
    ].join("\n");
}

export type HistoryOptions = {
    repo: MemoryRepo;
    lock: Lock;
    now?: () => Date;
    // Where warnings go; without it they wait for a subscriber.
    warn?: (message: string) => void;
    // The command the pre-commit hook runs Dorothy with.
    hook?: HookCommand | null;
};

// Dorothy's memory as a history of commits. Each logical change is one
// commit, made under the lock the change was written under; whatever
// else changed is committed first, alone, or restored when it fails the
// lint. Nothing here throws at a writer: failures are warnings.
export class MemoryHistory {
    readonly repo: MemoryRepo;
    readonly root: string;
    readonly lock: Lock;
    readonly #now: () => Date;
    readonly #warnTo: ((message: string) => void) | undefined;
    readonly #listeners = new Set<(notice: HistoryNotice) => void>();
    readonly #waiting: string[] = [];
    readonly #warned = new Set<string>();
    readonly #catchUp = new Set<string>();
    #afterCommit: () => void = () => {};

    private constructor(options: HistoryOptions) {
        this.repo = options.repo;
        this.root = options.repo.root;
        this.lock = options.lock;
        this.#now = options.now ?? (() => new Date());
        this.#warnTo = options.warn;
    }

    // Adopts the directory first when it holds no commits yet. Throws when
    // the repository can't be used at all.
    static async open(options: HistoryOptions): Promise<MemoryHistory> {
        const history = new MemoryHistory(options);
        await history.lock(async () => {
            if (
                !history.repo.exists() ||
                (await history.repo.resolve(MAIN)) === null
            ) {
                await history.#adopt();
            }
        });
        if (options.hook) {
            await history.#installHook(options.hook);
        }
        return history;
    }

    // For memory's writers, which call it inside the lock.
    readonly recorder: Recorder = (paths, message) =>
        this.record(paths, message);

    // What memory sees of history; close is whoever opened it's.
    handle(close: () => void = () => {}): HistoryHandle {
        return {
            recorder: this.recorder,
            lock: this.lock,
            sweep: () => this.sweep(),
            heal: (path) => this.heal(path),
            close,
        };
    }

    afterCommit(fn: () => void): void {
        this.#afterCommit = fn;
    }

    // One logical change. The caller holds the lock. Paths may be absolute
    // or relative to the root; ones outside it are passed over.
    async record(paths: readonly string[], message: string): Promise<void> {
        const named = this.#relative(paths);
        if (named.length === 0) {
            return;
        }
        try {
            await this.#settle(new Set(named));
            await this.#commitChecked(named, message);
        } catch (error) {
            for (const path of named) {
                this.#catchUp.add(path);
            }
            this.warn(
                `history: couldn't commit (${describeError(error)}); it will be committed with the next change`,
            );
        }
    }

    // At launch: whatever changed while Dorothy was away.
    sweep(): Promise<void> {
        return this.lock(async () => {
            try {
                await this.#settle(new Set());
            } catch (error) {
                this.warn(
                    `history: couldn't look for changes (${describeError(error)})`,
                );
            }
        }).catch((error) => {
            this.warn(
                `history: couldn't look for changes (${describeError(error)})`,
            );
        });
    }

    // A turn of the live conversation, once its transcript is flushed.
    turn(path: string, count: number): Promise<void> {
        return this.lock(() =>
            this.record([path], `turn: ${basename(path, ".jsonl")} #${count}`),
        ).catch((error) => {
            this.warn(
                `history: couldn't commit (${describeError(error)}); it will be committed with the next change`,
            );
        });
    }

    // A file found broken mid-run, outside the lock; true when it was
    // restored and may be read again.
    heal(path: string): Promise<boolean> {
        const [named] = this.#relative([path]);
        if (named === undefined) {
            return Promise.resolve(false);
        }
        return this.lock(async () => {
            try {
                const problem = await this.#problem(named);
                return (
                    problem !== null && (await this.#recover(named, problem))
                );
            } catch (error) {
                this.warn(
                    `history: couldn't restore ${named} (${describeError(error)})`,
                );
                return false;
            }
        }).catch((error) => {
            this.warn(
                `history: couldn't restore ${named} (${describeError(error)})`,
            );
            return false;
        });
    }

    warn(message: string): void {
        if (this.#warned.has(message)) {
            return;
        }
        this.#warned.add(message);
        if (this.#warnTo !== undefined) {
            this.#warnTo(message);
        } else if (this.#listeners.size > 0) {
            for (const listener of this.#listeners) {
                listener({ type: "warning", message });
            }
        } else {
            this.#waiting.push(message);
        }
    }

    // Warnings no one has heard yet, for a screen that shows them at once.
    takeWarnings(): string[] {
        return this.#waiting.splice(0);
    }

    subscribe(listener: (notice: HistoryNotice) => void): () => void {
        this.#listeners.add(listener);
        for (const message of this.#waiting.splice(0)) {
            listener({ type: "warning", message });
        }
        return () => {
            this.#listeners.delete(listener);
        };
    }

    #relative(paths: readonly string[]): string[] {
        const named = new Set<string>();
        for (const path of paths) {
            const inside = isAbsolute(path) ? relative(this.root, path) : path;
            if (
                inside !== "" &&
                !inside.startsWith("..") &&
                !isAbsolute(inside)
            ) {
                named.add(inside.split(sep).join("/"));
            }
        }
        return [...named];
    }

    // Why a file may not be committed as it is, or null; a missing file is
    // a deletion, which may.
    async #problem(path: string): Promise<string | null> {
        const full = join(this.root, path);
        if (!existsSync(full)) {
            return null;
        }
        const committed =
            fileKind(path) === "transcript"
                ? await this.repo.show(path, "HEAD")
                : null;
        return lint(path, await readFile(full), committed);
    }

    async #commit(paths: readonly string[], message: string): Promise<void> {
        if ((await this.repo.commit(paths, message)) !== null) {
            this.#afterCommit();
        }
    }

    // Commits the paths that pass the lint; the rest are restored.
    async #commitChecked(
        paths: readonly string[],
        message: string,
    ): Promise<void> {
        const clean: string[] = [];
        for (const path of paths) {
            const problem = await this.#problem(path);
            if (problem === null) {
                clean.push(path);
            } else {
                await this.#recover(path, problem);
            }
        }
        await this.#commit(clean, message);
    }

    // Before a change of Dorothy's: what an earlier failed commit left,
    // then whatever else changed, each in a commit of its own. A
    // transcript that grew is a conversation's own turns, whoever wrote
    // them, never an outside change.
    async #settle(except: ReadonlySet<string>): Promise<void> {
        if (this.#catchUp.size > 0) {
            const paths = [...this.#catchUp];
            await this.#commitChecked(paths, `catch-up: ${paths.join(", ")}`);
            this.#catchUp.clear();
        }
        for (const path of await this.repo.changed()) {
            if (except.has(path)) {
                continue;
            }
            const problem = await this.#problem(path);
            if (problem !== null) {
                await this.#recover(path, problem);
                continue;
            }
            await this.#commit(
                [path],
                fileKind(path) === "transcript"
                    ? `turn: ${basename(path, ".jsonl")}`
                    : `outside: ${path}`,
            );
        }
    }

    async #recover(path: string, reason: string): Promise<boolean> {
        const healed = await recoverFile(
            this.repo,
            this.root,
            path,
            this.#now(),
        );
        this.#afterCommit();
        if (healed.kind === "restored") {
            this.warn(
                `Restored ${path} from ${healed.from.slice(0, 7)} (${healed.at.slice(0, 10)}); the broken copy is in broken/`,
            );
            return true;
        }
        this.warn(
            `history: ${path} is broken (${reason}) and has no good version; a copy is in broken/`,
        );
        return false;
    }

    async #adopt(): Promise<void> {
        if (!this.repo.exists()) {
            await this.repo.init();
        }
        const ignore = join(this.root, ".gitignore");
        if (!existsSync(ignore)) {
            await writeFile(ignore, "*.tmp\n", { mode: 0o600 });
        }
        const kept: string[] = [];
        for (const path of await this.repo.changed()) {
            const full = join(this.root, path);
            const problem = lint(path, await readFile(full), null);
            if (problem === null) {
                kept.push(path);
                continue;
            }
            // A transcript is the only copy of its conversation, and a
            // crash-torn line in its middle is one the reader skips: it is
            // adopted as it stands, never moved out of the catalogue.
            if (fileKind(path) === "transcript") {
                kept.push(path);
                this.warn(
                    `history: ${path} has a damaged line (${problem}); adopted as it is`,
                );
                continue;
            }
            const copy = `broken/${path}.${stamp(this.#now())}`;
            await mkdir(dirname(join(this.root, copy)), {
                recursive: true,
                mode: 0o700,
            });
            await rename(full, join(this.root, copy));
            kept.push(copy);
            this.warn(
                `history: ${path} was broken (${problem}); it is kept in ${copy}`,
            );
        }
        await this.#commit(kept, `adopt: ${kept.length} files`);
    }

    async #installHook({ exec, script }: HookCommand): Promise<void> {
        const path = join(this.root, ".git", "hooks", "pre-commit");
        const wanted = hookScript(exec, script);
        let current: string | null = null;
        try {
            current = await readFile(path, "utf8");
        } catch {
            // No hook yet.
        }
        if (
            current === wanted ||
            (current !== null && !current.includes(HOOK_MARK))
        ) {
            return;
        }
        try {
            await mkdir(dirname(path), { recursive: true, mode: 0o700 });
            await writeFile(path, wanted, { mode: 0o700 });
            await chmod(path, 0o700);
        } catch (error) {
            this.warn(
                `history: couldn't write the pre-commit hook (${describeError(error)})`,
            );
        }
    }
}

export type OpenedHistory =
    | { ok: true; history: MemoryHistory; close(): void }
    | { ok: false; reason: string };

// History under the index's lock when the index is open, otherwise under
// a lock of its own in .git; not ok, with the reason, when it can't be
// used at all.
export async function openHistory({
    root,
    index,
    engine,
    hook = null,
    warn,
    now,
}: {
    root: string;
    index: { lock: Lock } | null;
    engine?: Engine;
    hook?: HookCommand | null;
    warn?: (message: string) => void;
    now?: () => Date;
}): Promise<OpenedHistory> {
    let file: FileLock | null = null;
    try {
        const repo = await openRepo(
            root,
            engine === undefined ? {} : { engine },
        );
        if (index === null) {
            file = FileLock.open(join(root, ".git", "dorothy.lock"));
        }
        const history = await MemoryHistory.open({
            repo,
            lock: index?.lock ?? (file as FileLock).lock,
            hook,
            ...(warn === undefined ? {} : { warn }),
            ...(now === undefined ? {} : { now }),
        });
        const held = file;
        return { ok: true, history, close: () => held?.close() };
    } catch (error) {
        file?.close();
        return { ok: false, reason: `history is off: ${describeError(error)}` };
    }
}
