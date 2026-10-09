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

// Whether the key opens the newest sealed bundle, as every bundle in the
// chain must; true when nothing is sealed yet.
export async function opensSealed(
    repo: MemoryRepo,
    key: Uint8Array,
): Promise<boolean> {
    const newest = (await repo.sealedNames()).at(-1);
    return (
        newest === undefined ||
        (await unseal(await repo.sealedFile(newest), key)).ok
    );
}

export type Sealed = "sealed" | "nothing" | "wrong-key";

// The commits on main since the last sealed one, sealed as the next bundle
// on the sealed branch: "nothing" when there were none, "wrong-key" when
// the key does not open the bundles before it, since recovery would stop
// at the first sealed under another. The caller holds the lock.
export async function sealPending(
    repo: MemoryRepo,
    key: Uint8Array,
): Promise<Sealed> {
    const since = await repo.resolve(SEALED_THROUGH);
    const tip = await repo.resolve(MAIN);
    if (tip === null || tip === since) {
        return "nothing";
    }
    if (!(await opensSealed(repo, key))) {
        return "wrong-key";
    }
    const bundle = await repo.bundle(since);
    if (bundle === null) {
        return "nothing";
    }
    const sequence = (await repo.sealedNames()).length + 1;
    await repo.appendSealed(
        sealedName(sequence),
        await seal(bundle, key),
        SEALED_README,
        `seal ${sequence}`,
    );
    await repo.setRef(SEALED_THROUGH, tip);
    return "sealed";
}

// Whether main has commits not yet sealed.
export async function waiting(repo: MemoryRepo): Promise<boolean> {
    const tip = await repo.resolve(MAIN);
    return tip !== null && tip !== (await repo.resolve(SEALED_THROUGH));
}

export type PushOutcome =
    | { kind: "no-mirror" }
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
// commits. Sealing happens under the lock; the push, which may take a
// while, does not. One push runs at a time.
export class Mirror {
    readonly #options: MirrorOptions;
    readonly #timers: Timers;
    #timer: unknown = null;
    #stopped = false;
    #running: Promise<PushOutcome> | null = null;
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
        this.#running ??= this.#push().finally(() => {
            this.#running = null;
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
            const sealing = lock(() => sealPending(repo, key));
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
                warn(WRONG_KEY);
            }
            if ((await repo.resolve(SEALED)) !== null) {
                await repo.push(MIRROR, "sealed", this.#options.token());
            }
            return sealed === "wrong-key"
                ? { kind: "wrong-key" }
                : { kind: "pushed", sealed: sealed === "sealed" };
        } catch (error) {
            const reason = describeError(error);
            warn(`history: couldn't push to the mirror (${reason})`);
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
