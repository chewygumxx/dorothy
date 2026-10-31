// vim:set expandtab shiftwidth=4 filetype=typescript:
// SPDX-License-Identifier: GPL-3.0-only

//
//
// ~chewygumxx/dorothy.git
// ::: :/packages/memory/src/memory/review-backfill.test.ts
//
//

import { afterEach, beforeEach, describe, expect, it, spyOn } from "bun:test";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import {
    configPath,
    type Env,
    newPhrase,
    type StructuredCall,
} from "@dorothy/core";
import { openRepo } from "../history/open.js";
import { runReviewBackfill } from "../index.js";
import { indexPath, RecallIndex } from "../recall/store.js";
import { transcriptDir } from "../transcript.js";
import {
    EMPTY_SIDECAR,
    mergeEdit,
    readSidecar,
    reviewDue,
    type Sidecar,
    sidecarPath,
} from "./sidecar.js";
import { readVocabulary, vocabularyPath } from "./vocabulary.js";

const NOW = new Date("2026-10-29T12:00:00.000Z");
const NOTES = {
    title: "Tea",
    description: "About tea.",
    abstract: "Tea at four.",
};
const output = { ...NOTES, tags: [], coined: [] };
const phrase = (seed: number) =>
    newPhrase(() => Uint8Array.from([seed, 1, 2, 3, 4, 5, 6, 7]));
const emptyCounts = {
    reviewed: 0,
    marked: 0,
    unchanged: 0,
    held: 0,
    failed: 0,
};
let root: string;
let env: Env;
let dir: string;
beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "dorothy-review-backfill-"));
    env = {
        HOME: root,
        XDG_DATA_HOME: join(root, "data"),
        XDG_CACHE_HOME: join(root, "cache"),
        XDG_CONFIG_HOME: join(root, "config"),
        XDG_STATE_HOME: join(root, "state"),
    };
    dir = transcriptDir(env);
    await mkdir(dir, { recursive: true });
    await mkdir(dirname(configPath(env)), { recursive: true });
    await writeFile(configPath(env), "[history]\nenabled = false\n");
});
afterEach(async () => {
    await rm(root, { recursive: true, force: true });
});

async function conversation(
    seed: number,
    at: number,
    sidecar: Partial<Sidecar> = {},
    lastAt = at,
) {
    const id = phrase(seed);
    const events = [
        {
            v: 1,
            kind: "user",
            at: new Date(at).toISOString(),
            text: `Question ${seed}?`,
        },
        {
            v: 1,
            kind: "assistant",
            at: new Date(lastAt).toISOString(),
            text: "Tea at four.",
            interrupted: false,
        },
    ];
    await writeFile(
        join(dir, `${id}.jsonl`),
        `${events.map((event) => JSON.stringify(event)).join("\n")}\n`,
    );
    await writeFile(
        sidecarPath(dir, id),
        `${JSON.stringify({ ...EMPTY_SIDECAR, backfilled: true, ...sidecar })}\n`,
    );
    return id;
}
const notes = async (id: string) => {
    const read = await readSidecar(dir, id);
    if (read.kind !== "ok") throw new Error("fixture notes missing");
    return read.sidecar;
};
// Runs mutate once the batch has taken its claim on a conversation,
// which is after it chose the batch and before it takes the lock.
function afterClaim(mutate: () => Promise<void>) {
    const claim = RecallIndex.prototype.claim;
    return spyOn(RecallIndex.prototype, "claim").mockImplementation(
        async function (this: RecallIndex, ...args) {
            const taken = await claim.apply(this, args);
            await mutate();
            return taken;
        },
    );
}
const options = (call: StructuredCall) => ({
    env,
    call,
    persona: "You are Dorothy. Fixture persona.",
    now: () => NOW,
    warn: () => {},
});
const good: StructuredCall = async () => ({
    ok: true,
    output,
    model: "fixture-model",
    costUsd: 0.25,
});

describe("runReviewBackfill", () => {
    it("reviews the newest capped sidecars by the transcript's last event", async () => {
        const older = await conversation(1, NOW.getTime() - 4000);
        const recentAssistant = await conversation(
            2,
            NOW.getTime() - 5000,
            {},
            NOW.getTime() - 2000,
        );
        const recentEvent = await conversation(3, NOW.getTime() - 6000);
        await writeFile(
            join(dir, `${recentEvent}.jsonl`),
            `${await readFile(join(dir, `${recentEvent}.jsonl`), "utf8")}${JSON.stringify({ v: 1, kind: "stats", at: NOW.toISOString(), costUsd: 0 })}\n`,
        );
        const live = await conversation(4, NOW.getTime() + 1000, {
            backfilled: false,
        });
        const untouched = await Promise.all(
            [older, live].map((id) => readFile(sidecarPath(dir, id), "utf8")),
        );
        const progress: [string, string][] = [];
        let calls = 0;
        const result = await runReviewBackfill({
            ...options(async (request) => {
                const id = [recentEvent, recentAssistant][calls++];
                expect(
                    JSON.parse(
                        await readFile(sidecarPath(dir, id as string), "utf8"),
                    ).backfilled,
                ).toBe(false);
                expect(request.system).toContain("Fixture persona.");
                expect(request.prompt).toContain(
                    id === recentEvent ? "Question 3?" : "Question 2?",
                );
                expect(request.schema.required).toContain("tags");
                return good(request);
            }),
            count: 2,
            progress: (id, outcome) => progress.push([id, outcome]),
        });
        expect(result).toEqual({ ...emptyCounts, reviewed: 2 });
        expect(progress).toEqual([
            [recentEvent, "reviewed"],
            [recentAssistant, "reviewed"],
        ]);
        expect(
            await Promise.all(
                [older, live].map((id) =>
                    readFile(sidecarPath(dir, id), "utf8"),
                ),
            ),
        ).toEqual(untouched);
        expect(await notes(recentAssistant)).toMatchObject({
            ...NOTES,
            reviewedThrough: 2,
            reviewCostUsd: 0.25,
        });
    });

    it("defaults to the newest 25 and leaves the rest marked", async () => {
        const ids: string[] = [];
        for (let n = 1; n <= 26; n++)
            ids.push(await conversation(n, NOW.getTime() + n));
        let calls = 0;
        expect(
            await runReviewBackfill(
                options(async (request) => {
                    calls++;
                    return good(request);
                }),
            ),
        ).toEqual({ ...emptyCounts, reviewed: 25 });
        expect(calls).toBe(25);
        expect((await notes(ids[0] as string)).backfilled).toBe(true);
        expect((await notes(ids[25] as string)).backfilled).not.toBe(true);
    });

    it("skips a held claim within the cap and preserves its backfill mark", async () => {
        const old = await conversation(1, NOW.getTime() - 1);
        const held = await conversation(2, NOW.getTime());
        const index = RecallIndex.open(indexPath(env));
        try {
            expect(await index.claim(held, "service", Date.now(), 60_000)).toBe(
                true,
            );
            let calls = 0;
            const progress: [string, string][] = [];
            expect(
                await runReviewBackfill({
                    ...options(async (request) => {
                        calls++;
                        return good(request);
                    }),
                    count: 1,
                    progress: (id, outcome) => progress.push([id, outcome]),
                }),
            ).toEqual({ ...emptyCounts, held: 1 });
            expect(calls).toBe(0);
            expect(progress).toEqual([[held, "held"]]);
            expect((await notes(held)).backfilled).toBe(true);
            expect((await notes(old)).backfilled).toBe(true);
            expect(await index.renew(held, "service", Date.now(), 60_000)).toBe(
                true,
            );
        } finally {
            index.close();
        }
    });

    it("leaves skipped phrases out before the cap, which fills from the rest", async () => {
        const first = await conversation(1, NOW.getTime() + 3);
        const second = await conversation(2, NOW.getTime() + 2);
        const third = await conversation(3, NOW.getTime() + 1);
        const progress: [string, string][] = [];
        expect(
            await runReviewBackfill({
                ...options(good),
                count: 2,
                skip: new Set([first]),
                progress: (id, outcome) => progress.push([id, outcome]),
            }),
        ).toEqual({ ...emptyCounts, reviewed: 2 });
        expect(progress).toEqual([
            [second, "reviewed"],
            [third, "reviewed"],
        ]);
        expect((await notes(first)).backfilled).toBe(true);
    });

    it("holds the claim during the call, releases it afterwards and lets user edits win", async () => {
        const id = await conversation(1, NOW.getTime());
        const index = RecallIndex.open(indexPath(env));
        try {
            expect(
                await runReviewBackfill(
                    options(async (request) => {
                        expect(
                            await index.claim(
                                id,
                                "service",
                                Date.now(),
                                60_000,
                            ),
                        ).toBe(false);
                        // This takes the real write lock during the model call;
                        // the runner must not hold that lock across the call.
                        await index.lock(async () => {
                            await writeFile(
                                sidecarPath(dir, id),
                                JSON.stringify(
                                    mergeEdit(
                                        await notes(id),
                                        { title: "User's title" },
                                        NOW.toISOString(),
                                    ),
                                ),
                            );
                        });
                        return good(request);
                    }),
                ),
            ).toEqual({ ...emptyCounts, reviewed: 1 });
            expect((await notes(id)).title).toBe("User's title");
            expect(await index.claim(id, "next", Date.now(), 60_000)).toBe(
                true,
            );
        } finally {
            index.close();
        }
    });

    it("reports an invalid review as failed, backs it off and goes on", async () => {
        const first = await conversation(1, NOW.getTime());
        const second = await conversation(2, NOW.getTime() - 1);
        const index = RecallIndex.open(indexPath(env));
        try {
            const progress: [string, string][] = [];
            let calls = 0;
            const stopped: string[] = [];
            const result = await runReviewBackfill({
                ...options(async (request) => {
                    calls++;
                    return calls === 1
                        ? { ok: true, output: {}, model: "fixture", costUsd: 0 }
                        : good(request);
                }),
                progress: (id, outcome) => progress.push([id, outcome]),
                stopped: (reason) => stopped.push(reason),
            });
            expect(result).toEqual({ ...emptyCounts, failed: 1, reviewed: 1 });
            expect(progress).toEqual([
                [first, "failed"],
                [second, "reviewed"],
            ]);
            expect(stopped).toEqual([]);
            expect((await notes(first)).backfilled).not.toBe(true);
            expect((await notes(first)).failures).toEqual({
                count: 1,
                at: NOW.toISOString(),
            });
            expect(
                reviewDue(
                    await notes(first),
                    NOW.getTime() + 8 * 24 * 3_600_000,
                ),
            ).toBe(true);
            expect(
                await index.claim(first, "service", Date.now(), 60_000),
            ).toBe(true);
            expect(await runReviewBackfill(options(good))).toEqual(emptyCounts);
        } finally {
            index.close();
        }
    });

    it("warns of a thrown call by phrase and first line, restores the mark and stops", async () => {
        const id = await conversation(1, NOW.getTime());
        await writeFile(
            sidecarPath(dir, id),
            `${JSON.stringify({ ...EMPTY_SIDECAR, backfilled: true, title: "Secret title" })}\n`,
        );
        const before = await notes(id);
        const index = RecallIndex.open(indexPath(env));
        try {
            const warnings: string[] = [];
            const stopped: string[] = [];
            expect(
                await runReviewBackfill({
                    ...options(async () => {
                        throw new Error("fixture failure\nsecond line");
                    }),
                    warn: (message) => warnings.push(message),
                    stopped: (reason) => stopped.push(reason),
                }),
            ).toEqual({ ...emptyCounts, failed: 1 });
            expect(warnings).toHaveLength(1);
            expect(warnings[0]).toContain(id);
            expect(warnings[0]).toContain("fixture failure");
            expect(warnings[0]).not.toContain("second line");
            expect(warnings[0]).not.toContain("Secret title");
            expect(stopped).toEqual(["fixture failure"]);
            const restored = await notes(id);
            expect(restored).toEqual({ ...before, rev: before.rev + 2 });
            expect(await index.claim(id, "service", Date.now(), 60_000)).toBe(
                true,
            );
        } finally {
            index.close();
        }
    });

    it("restores the mark and the earlier failures of a refused call, which a later batch can review", async () => {
        const earlier = { count: 2, at: "2026-10-01T00:00:00.000Z" };
        const id = await conversation(1, NOW.getTime(), {
            failures: earlier,
        });
        const progress: string[] = [];
        const stopped: string[] = [];
        expect(
            await runReviewBackfill({
                ...options(async () => ({
                    ok: false,
                    reason: "fixture refusal\nsecond line",
                    costUsd: 0,
                })),
                progress: (_id, outcome) => progress.push(outcome),
                stopped: (reason) => stopped.push(reason),
            }),
        ).toEqual({ ...emptyCounts, failed: 1 });
        expect(progress).toEqual(["failed"]);
        expect(stopped).toEqual(["fixture refusal"]);
        expect(await notes(id)).toMatchObject({
            backfilled: true,
            failures: earlier,
        });
        expect(await runReviewBackfill(options(good))).toEqual({
            ...emptyCounts,
            reviewed: 1,
        });
        expect(await notes(id)).toMatchObject(NOTES);
        expect((await notes(id)).backfilled).not.toBe(true);
    });

    it.each([
        ["throws", async () => Promise.reject(new Error("limit reached"))],
        [
            "is refused",
            async () => ({ ok: false as const, reason: "limit", costUsd: 0 }),
        ],
    ])(
        "stops a batch at a call that %s, leaving the rest marked",
        async (_title, failing) => {
            const newest = await conversation(1, NOW.getTime() + 2);
            const middle = await conversation(2, NOW.getTime() + 1);
            const oldest = await conversation(3, NOW.getTime());
            const oldestBefore = await readFile(
                sidecarPath(dir, oldest),
                "utf8",
            );
            const progress: [string, string][] = [];
            const stopped: string[] = [];
            let calls = 0;
            expect(
                await runReviewBackfill({
                    ...options(async (request) => {
                        calls++;
                        return calls === 1 ? good(request) : failing();
                    }),
                    progress: (id, outcome) => progress.push([id, outcome]),
                    stopped: (reason) => stopped.push(reason),
                }),
            ).toEqual({ ...emptyCounts, reviewed: 1, failed: 1 });
            expect(calls).toBe(2);
            expect(progress).toEqual([
                [newest, "reviewed"],
                [middle, "failed"],
            ]);
            expect(stopped).toHaveLength(1);
            expect((await notes(newest)).backfilled).not.toBe(true);
            expect((await notes(middle)).backfilled).toBe(true);
            expect((await notes(middle)).failures).toBeNull();
            expect(await readFile(sidecarPath(dir, oldest), "utf8")).toBe(
                oldestBefore,
            );
        },
    );

    it("warns of a failure under the lock by phrase and reason", async () => {
        const id = await conversation(1, NOW.getTime(), {
            title: "Secret title",
        });
        const warnings: string[] = [];
        let calls = 0;
        const claim = afterClaim(() =>
            writeFile(sidecarPath(dir, id), "{broken"),
        );
        try {
            expect(
                await runReviewBackfill({
                    ...options(async (request) => {
                        calls++;
                        return good(request);
                    }),
                    warn: (message) => warnings.push(message),
                }),
            ).toEqual({ ...emptyCounts, failed: 1 });
        } finally {
            claim.mockRestore();
        }
        expect(calls).toBe(0);
        expect(warnings).toHaveLength(1);
        expect(warnings[0]).toContain(id);
        expect(warnings[0]).toContain("cannot be read");
        expect(warnings[0]).not.toContain("Secret title");
    });

    it.each([
        ["a live append", { backfilled: false }],
        ["the user hiding it", { hidden: true }],
    ])(
        "leaves notes changed by %s since selection alone",
        async (_title, change) => {
            const id = await conversation(1, NOW.getTime());
            const written = `${JSON.stringify({ ...EMPTY_SIDECAR, backfilled: true, ...change })}\n`;
            let calls = 0;
            const claim = afterClaim(() =>
                writeFile(sidecarPath(dir, id), written),
            );
            try {
                expect(
                    await runReviewBackfill(
                        options(async (request) => {
                            calls++;
                            return good(request);
                        }),
                    ),
                ).toEqual({ ...emptyCounts, unchanged: 1 });
            } finally {
                claim.mockRestore();
            }
            expect(calls).toBe(0);
            expect(await readFile(sidecarPath(dir, id), "utf8")).toBe(written);
        },
    );

    it("renews the claim after the lock, before the call", async () => {
        await conversation(1, NOW.getTime());
        const renew = spyOn(RecallIndex.prototype, "renew");
        try {
            let renewals = 0;
            await runReviewBackfill(
                options(async (request) => {
                    renewals = renew.mock.calls.length;
                    return good(request);
                }),
            );
            // Taking the claim renews once; so does the renewal.
            expect(renewals).toBe(2);
        } finally {
            renew.mockRestore();
        }
    });

    it("keeps the counts when releasing a claim throws", async () => {
        const first = await conversation(1, NOW.getTime());
        const second = await conversation(2, NOW.getTime() - 1);
        const progress: [string, string][] = [];
        const warnings: string[] = [];
        const release = spyOn(
            RecallIndex.prototype,
            "release",
        ).mockRejectedValue(new Error("fixture release failure"));
        try {
            expect(
                await runReviewBackfill({
                    ...options(good),
                    progress: (id, outcome) => progress.push([id, outcome]),
                    warn: (message) => warnings.push(message),
                }),
            ).toEqual({ ...emptyCounts, reviewed: 2 });
        } finally {
            release.mockRestore();
        }
        expect(progress).toEqual([
            [first, "reviewed"],
            [second, "reviewed"],
        ]);
        expect(warnings).toHaveLength(2);
        expect(warnings[0]).toContain(first);
        expect(warnings[0]).toContain("fixture release failure");
    });

    it("reports a declined review as unchanged, not marked", async () => {
        // A recent failure backs the conversation off: nothing is written.
        const id = await conversation(1, NOW.getTime(), {
            failures: { count: 1, at: NOW.toISOString() },
        });
        let calls = 0;
        const progress: string[] = [];
        expect(
            await runReviewBackfill({
                ...options(async (request) => {
                    calls++;
                    return good(request);
                }),
                progress: (_id, outcome) => progress.push(outcome),
            }),
        ).toEqual({ ...emptyCounts, unchanged: 1 });
        expect(calls).toBe(0);
        expect(progress).toEqual(["unchanged"]);
        expect((await notes(id)).backfilled).not.toBe(true);
    });

    it("reports a missing transcript as failed after clearing the mark", async () => {
        const id = await conversation(1, NOW.getTime());
        await rm(join(dir, `${id}.jsonl`));
        const warnings: string[] = [];
        let calls = 0;
        expect(
            await runReviewBackfill({
                ...options(async (request) => {
                    calls++;
                    return good(request);
                }),
                warn: (message) => warnings.push(message),
            }),
        ).toEqual({ ...emptyCounts, failed: 1 });
        expect(calls).toBe(0);
        expect((await notes(id)).backfilled).not.toBe(true);
        expect(
            warnings.some((message) => message.includes("couldn't review")),
        ).toBe(true);
    });

    it("marks fully user-owned notes without paying for a review", async () => {
        const owned = mergeEdit(
            EMPTY_SIDECAR,
            { ...NOTES, tags: [] },
            NOW.toISOString(),
        );
        const id = await conversation(1, NOW.getTime(), owned);
        let calls = 0;
        expect(
            await runReviewBackfill(
                options(async (request) => {
                    calls++;
                    return good(request);
                }),
            ),
        ).toEqual({ ...emptyCounts, marked: 1 });
        expect(calls).toBe(0);
        expect((await notes(id)).backfilled).not.toBe(true);
        expect(await notes(id)).toMatchObject({
            reviewedThrough: 2,
            ...NOTES,
        });
    });

    it("keeps hidden and unreadable sidecars untouched", async () => {
        const hidden = await conversation(1, NOW.getTime(), { hidden: true });
        const broken = await conversation(2, NOW.getTime());
        await writeFile(sidecarPath(dir, broken), "{broken");
        const before = await Promise.all(
            [hidden, broken].map((id) =>
                readFile(sidecarPath(dir, id), "utf8"),
            ),
        );
        expect(await runReviewBackfill(options(good))).toEqual(emptyCounts);
        expect(
            await Promise.all(
                [hidden, broken].map((id) =>
                    readFile(sidecarPath(dir, id), "utf8"),
                ),
            ),
        ).toEqual(before);
    });

    it("uses the vocabulary and feeds earlier reviews into the next memory block", async () => {
        const first = await conversation(1, NOW.getTime());
        const second = await conversation(2, NOW.getTime() - 1);
        const prompts: string[] = [];
        const result = await runReviewBackfill(
            options(async (request) => {
                prompts.push(request.system);
                return {
                    ok: true,
                    output: {
                        ...NOTES,
                        tags: ["tea"],
                        coined:
                            prompts.length === 1
                                ? [{ prefLabel: "tea", scopeNote: "Tea." }]
                                : [],
                    },
                    model: "fixture",
                    costUsd: 0,
                };
            }),
        );
        expect(result.reviewed).toBe(2);
        expect(prompts[1]).toContain(NOTES.abstract);
        const a = await notes(first);
        expect(a.tags).toHaveLength(1);
        expect((await notes(second)).tags).toEqual(a.tags);
        const vocabulary = await readVocabulary(vocabularyPath(env));
        expect(
            vocabulary.kind === "ok" &&
                Object.keys(vocabulary.vocabulary.concepts),
        ).toHaveLength(1);
    });

    it("commits the cleared mark and review through the service's history wiring", async () => {
        const id = await conversation(1, NOW.getTime());
        await writeFile(configPath(env), "[history]\nenabled = true\n");
        expect(await runReviewBackfill(options(good))).toEqual({
            ...emptyCounts,
            reviewed: 1,
        });
        const repo = await openRepo(
            join(env.XDG_DATA_HOME as string, "dorothy"),
        );
        const commits = await repo.log(undefined, 10);
        expect(
            commits.some((commit) => commit.message.includes(`review: ${id}`)),
        ).toBe(true);
        const path = `transcripts/${id}.meta.json`;
        const committed = await repo.show(path, "main");
        expect(committed).not.toBeNull();
        const saved = JSON.parse(
            new TextDecoder().decode(committed as Uint8Array),
        );
        expect(saved.backfilled).not.toBe(true);
        expect(saved.title).toBe("Tea");
    });

    it.each([0, -1, 1.5, Infinity, NaN])(
        "rejects invalid count %p before any call",
        async (count) => {
            await expect(
                runReviewBackfill({ ...options(good), count }),
            ).rejects.toThrow("positive integer");
        },
    );

    it("opens an index in a store with no directories yet", async () => {
        await rm(root, { recursive: true, force: true });
        expect(await runReviewBackfill(options(good))).toEqual(emptyCounts);
    });

    it("returns empty counts for an empty store", async () => {
        expect(await runReviewBackfill(options(good))).toEqual(emptyCounts);
    });
});
