// vim:set expandtab shiftwidth=4 filetype=typescript:
// SPDX-License-Identifier: GPL-3.0-only

//
//
// ~chewygumxx/dorothy.git
// ::: :/packages/memory/src/history/mirror.ts
//
//

import { REAL_TIMERS, type Timers } from "@dorothy/core";
import type { Lock } from "../memory/sidecar.js";
import {
    keepPrivate,
    MAIN,
    type MemoryRepo,
    MIRROR,
    SEALED,
    SEALED_THROUGH,
} from "./repo.js";
import { SEALED_README, seal, sealedName, unseal } from "./seal.js";

const describeError = (error: unknown) =>
    error instanceof Error ? error.message : String(error);

// Said when the key would start a bundle no recovery could open.
export const WRONG_KEY =
    "history: DOROTHY_MIRROR_KEY does not open the sealed bundles; set the key they were sealed with";

// Why the newest sealed bundle cannot be opened; null when it opens or
// nothing is sealed yet.
export async function sealedProblem(
    repo: MemoryRepo,
    key: Uint8Array,
): Promise<string | null> {
    const newest = (await repo.sealedNames()).at(-1);
    if (newest === undefined) return null;
    const opened = await unseal(await repo.sealedFile(newest), key);
    return opened.ok ? null : opened.reason;
}

export async function opensSealed(
    repo: MemoryRepo,
    key: Uint8Array,
): Promise<boolean> {
    return (await sealedProblem(repo, key)) === null;
}

export type Sealed = "sealed" | "nothing" | "wrong-key";

// The commits on main since the last sealed one, sealed as the next bundle
// on the sealed branch: "nothing" when there were none, "wrong-key" when
// the key does not open the bundles before it, since recovery would stop
// at the first sealed under another. Only snapshot and append hold the lock.
export async function sealPending(
    repo: MemoryRepo,
    key: Uint8Array,
    lock: Lock = (work) => work(),
): Promise<Sealed> {
    for (;;) {
        const snapshot = await lock(async () => {
            const since = await repo.resolve(SEALED_THROUGH);
            const tip = await repo.resolve(MAIN);
            if (tip === null || tip === since) return "nothing" as const;
            if (!(await opensSealed(repo, key))) return "wrong-key" as const;
            return {
                since,
                tip,
                head: await repo.resolve(SEALED),
                sequence: (await repo.sealedNames()).length + 1,
            };
        });
        if (typeof snapshot === "string") return snapshot;
        // Both main's tip and its prerequisite are immutable commits.
        const bundle = await repo.bundle(snapshot.since, snapshot.tip);
        if (bundle === null) return "nothing";
        const bytes = await seal(bundle, key);
        const appended = await lock(async () => {
            if (
                (await repo.resolve(SEALED_THROUGH)) !== snapshot.since ||
                (await repo.resolve(SEALED)) !== snapshot.head
            )
                return false;
            await repo.appendSealed(
                sealedName(snapshot.sequence),
                bytes,
                SEALED_README,
                `seal ${snapshot.sequence}`,
            );
            await repo.setRef(SEALED_THROUGH, snapshot.tip);
            return true;
        });
        if (appended) return "sealed";
    }
}

// Whether main has commits not yet sealed.
export async function waiting(repo: MemoryRepo): Promise<boolean> {
    const tip = await repo.resolve(MAIN);
    return tip !== null && tip !== (await repo.resolve(SEALED_THROUGH));
}

export type PushOutcome =
    | { kind: "no-mirror" }
    | { kind: "nothing" }
    | { kind: "no-key" }
    | { kind: "pushed"; sealed: boolean }
    // Nothing new was sealed; what was sealed before is pushed.
    | { kind: "wrong-key" }
    // Stopped before it sealed anything.
    | { kind: "stopped" }
    | { kind: "failed"; reason: string };

export type MirrorOptions = {
    repo: MemoryRepo;
    lock: Lock;
    key: () => Uint8Array | null;
    // For an https mirror under isomorphic-git.
    token: () => string | null;
    warn: (message: string) => void;
    pushMs: number;
    timers?: Timers;
};

// Pushes the sealed branch to the mirror, at most once a period after
// commits. Bundle construction and network work are outside the lock;
// only the snapshot and append take it. One push runs at a time.
export class Mirror {
    readonly #options: MirrorOptions;
    readonly #timers: Timers;
    #timer: unknown = null;
    #stopped = false;
    #running: Promise<PushOutcome> | null = null;
    #again = false;
    // A seal under way, which stopping waits for; it never rejects.
    #sealing: Promise<unknown> | null = null;

    constructor(options: MirrorOptions) {
        this.#options = options;
        this.#timers = options.timers ?? REAL_TIMERS;
    }

    schedule(): void {
        if (this.#stopped || this.#timer !== null) {
            return;
        }
        this.#timer = this.#timers.set(() => {
            this.#timer = null;
            void this.push();
        }, this.#options.pushMs);
    }

    push(): Promise<PushOutcome> {
        if (this.#running !== null) {
            this.#again = true;
            return this.#running;
        }
        this.#running ??= this.#push().finally(() => {
            this.#running = null;
            if (this.#again) {
                this.#again = false;
                this.schedule();
            }
        });
        return this.#running;
    }

    // Quitting waits for a seal under way, which holds the lock and writes
    // the repository, but never for a push: what is left goes at the next
    // launch. Nothing is sealed after.
    async stop(): Promise<void> {
        this.#stopped = true;
        if (this.#timer !== null) {
            this.#timers.clear(this.#timer);
            this.#timer = null;
        }
        await this.#sealing;
    }

    async #push(): Promise<PushOutcome> {
        const { repo, lock, warn } = this.#options;
        try {
            if ((await repo.remote(MIRROR)) === null) {
                return { kind: "no-mirror" };
            }
            const key = this.#options.key();
            if (key === null) {
                warn(
                    "history: the mirror needs DOROTHY_MIRROR_KEY (32 bytes, base64) in .env; set it with dotenvx set",
                );
                return { kind: "no-key" };
            }
            if (this.#stopped) {
                return { kind: "stopped" };
            }
            const problem = await sealedProblem(repo, key);
            if (this.#stopped) return { kind: "stopped" };
            const sealing =
                problem === null
                    ? sealPending(repo, key, lock)
                    : Promise.resolve("wrong-key" as const);
            this.#sealing = sealing.then(
                () => {},
                () => {},
            );
            let sealed: Sealed;
            try {
                sealed = await sealing;
            } finally {
                this.#sealing = null;
            }
            if (sealed === "wrong-key") {
                warn(
                    problem === null ||
                        problem.startsWith("it does not open with this key")
                        ? WRONG_KEY
                        : `history: the newest sealed bundle cannot be opened (${problem}); nothing new was sealed`,
                );
            }
            if ((await repo.resolve(SEALED)) === null)
                return { kind: "nothing" };
            await repo.push(MIRROR, "sealed", this.#options.token());
            return sealed === "wrong-key"
                ? { kind: "wrong-key" }
                : { kind: "pushed", sealed: sealed === "sealed" };
        } catch (error) {
            const detail = describeError(error);
            const reason =
                /non-fast-forward|fetch first|not fast forward/i.test(detail)
                    ? `${detail}; the mirror already holds sealed history: use its original key and --recover into an empty directory, or choose a new empty mirror`
                    : detail;
            warn(`history: couldn't push to the mirror (${reason})`);
            this.schedule();
            return { kind: "failed", reason };
        }
    }
}

export type Recovered = {
    applied: number;
    of: number;
    tip: string | null;
    // The bundle recovery stopped at and why, or why it could not start.
    stopped: string | null;
};

// Rebuilds an empty repository from a mirror: each sealed bundle opened
// and applied in order. It stops at the first that fails, keeping what
// came before it. After a full recovery the mirror becomes the repository's
// remote; after a stop there is neither a remote nor a local sealed branch,
// so the next mirror starts a chain of its own, whose push fails loudly
// rather than extending the broken one.
export async function recover({
    repo,
    url,
    key,
    token,
}: {
    repo: MemoryRepo;
    url: string;
    key: Uint8Array;
    token: string | null;
}): Promise<Recovered> {
    await repo.init();
    await keepPrivate(repo.root);
    let names: string[];
    try {
        await repo.fetch(url, "sealed", token);
        names = await repo.sealedNames();
    } catch (error) {
        await repo.deleteRef(SEALED);
        return { applied: 0, of: 0, tip: null, stopped: describeError(error) };
    }
    let applied = 0;
    let tip: string | null = null;
    let stopped: string | null = null;
    for (const name of names) {
        try {
            const opened = await unseal(await repo.sealedFile(name), key);
            if (!opened.ok) {
                stopped = `${name}: ${opened.reason}`;
                break;
            }
            tip = await repo.unbundle(opened.bundle);
        } catch (error) {
            stopped = `${name}: ${describeError(error)}`;
            break;
        }
        applied += 1;
    }
    if (tip !== null) {
        await repo.checkout();
    }
    if (stopped !== null) {
        await repo.deleteRef(SEALED);
    } else {
        if (tip !== null) {
            await repo.setRef(SEALED_THROUGH, tip);
        }
        await repo.setRemote(MIRROR, url);
    }
    await keepPrivate(repo.root);
    return { applied, of: names.length, tip, stopped };
}
