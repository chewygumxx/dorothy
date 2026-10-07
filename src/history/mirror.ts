// vim:set expandtab shiftwidth=4 filetype=typescript:
// SPDX-License-Identifier: GPL-3.0-only

//
//
// ~chewygumxx/dorothy.git
// ::: :/src/history/mirror.ts
//
//

import type { Lock } from "../memory/sidecar.js";
import { REAL_TIMERS, type Timers } from "../timers.js";
import {
    MAIN,
    type MemoryRepo,
    MIRROR,
    SEALED,
    SEALED_THROUGH,
} from "./repo.js";
import { SEALED_README, seal, sealedName, unseal } from "./seal.js";

const describeError = (error: unknown) =>
    error instanceof Error ? error.message : String(error);

// The commits on main since the last sealed one, sealed as the next bundle
// on the sealed branch; false when there were none. The caller holds the
// lock.
export async function sealPending(
    repo: MemoryRepo,
    key: Uint8Array,
): Promise<boolean> {
    const since = await repo.resolve(SEALED_THROUGH);
    const tip = await repo.resolve(MAIN);
    if (tip === null || tip === since) {
        return false;
    }
    const bundle = await repo.bundle(since);
    if (bundle === null) {
        return false;
    }
    const sequence = (await repo.sealedNames()).length + 1;
    await repo.appendSealed(
        sealedName(sequence),
        await seal(bundle, key),
        SEALED_README,
        `seal ${sequence}`,
    );
    await repo.setRef(SEALED_THROUGH, tip);
    return true;
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

    // Quitting never waits on a push; what is left goes at the next launch.
    stop(): void {
        this.#stopped = true;
        if (this.#timer !== null) {
            this.#timers.clear(this.#timer);
            this.#timer = null;
        }
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
                    "history: the mirror needs DOROTHY_MIRROR_KEY; set it with dorothy --mirror",
                );
                return { kind: "no-key" };
            }
            const sealed = await lock(() => sealPending(repo, key));
            if ((await repo.resolve(SEALED)) === null) {
                return { kind: "pushed", sealed: false };
            }
            await repo.push(MIRROR, "sealed", this.#options.token());
            return { kind: "pushed", sealed };
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
// came before it.
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
    await repo.setRemote(MIRROR, url);
    let names: string[];
    try {
        await repo.fetch(url, "sealed", token);
        names = await repo.sealedNames();
    } catch (error) {
        return { applied: 0, of: 0, tip: null, stopped: describeError(error) };
    }
    let applied = 0;
    let tip: string | null = null;
    let stopped: string | null = null;
    for (const name of names) {
        const opened = await unseal(await repo.sealedFile(name), key);
        if (!opened.ok) {
            stopped = `${name}: ${opened.reason}`;
            break;
        }
        try {
            tip = await repo.unbundle(opened.bundle);
        } catch (error) {
            stopped = `${name}: ${describeError(error)}`;
            break;
        }
        applied += 1;
    }
    if (tip !== null) {
        await repo.checkout();
        await repo.setRef(SEALED_THROUGH, tip);
    }
    return { applied, of: names.length, tip, stopped };
}
