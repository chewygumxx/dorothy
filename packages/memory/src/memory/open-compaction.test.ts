// vim:set expandtab shiftwidth=4 filetype=typescript:
// SPDX-License-Identifier: GPL-3.0-only

//
//
// ~chewygumxx/dorothy.git
// ::: :/packages/memory/src/memory/open-compaction.test.ts
//
//

// A chat compacted end to end: openMemory over a real transcript, sidecar
// and index, with fake sessions and a fake model. Every place that counts
// turns, the wrapper, the transcript, the sidecar's clusters, the index's
// `clusters` table and recollect, must count the same ones.

import { describe, expect, it } from "bun:test";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import {
    configPath,
    type SessionStart,
    type StructuredCall,
    type StructuredRequest,
    withSection,
} from "@dorothy/core";
import { recollect } from "../recall/query.js";
import { indexPath, RecallIndex } from "../recall/store.js";
import { syncIndex } from "../recall/sync.js";
import { readTranscript, transcriptDir } from "../transcript.js";
import { escapeXml } from "./block.js";
import { FakeSession } from "./fake-session.js";
import { type MemoryPrompts, openMemory } from "./open.js";
import { useXdgDir } from "./open-testing.js";
import { readSidecar } from "./sidecar.js";

useXdgDir();

const prompts: MemoryPrompts = {
    review: "R",
    compaction: "C",
    hash: (recall) => (recall ? "with" : "without"),
    session: (start) => withSection("S", start.memory),
};
const STATS = {
    inputTokens: 1,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    outputTokens: 1,
    ttftMs: null,
    durationMs: 1,
    costUsd: 0,
    sessionCostUsd: 0,
};

// Three hundred tokens a turn, each its own words.
const text = (word: string) => `${word} `.repeat(240).trim();

async function until(done: () => boolean): Promise<void> {
    for (let wait = 0; wait < 400 && !done(); wait++) {
        await new Promise((resolve) => setTimeout(resolve, 5));
    }
    expect(done()).toBe(true);
}

describe("a chat compacted end to end", () => {
    it("counts the same turns in the transcript, clusters, index and recollect", async () => {
        const env = process.env;
        await mkdir(dirname(configPath(env)), { recursive: true });
        // Memory's reviews are off: a review of the live chat at its first
        // session holds the conversation's claim, and compaction, refused
        // it, asks again only after CLAIM_RETRY_MS. Recall stays on.
        await writeFile(
            configPath(env),
            "[memory]\nenabled = false\n[compaction]\nsoft = 2000\nhard = 4000\ntail = 500\n[history]\nenabled = false\n",
        );
        const compactions: StructuredRequest[] = [];
        // Two clusters over whatever range it is asked for, split after
        // the range's second turn.
        const call: StructuredCall = async (request) => {
            if (request.what !== "compaction") {
                return { ok: false, reason: "not under test", costUsd: 0 };
            }
            compactions.push(request);
            const { minimum, maximum } = (
                request.schema as {
                    properties: {
                        clusters: {
                            items: {
                                properties: {
                                    through: {
                                        minimum: number;
                                        maximum: number;
                                    };
                                };
                            };
                        };
                    };
                }
            ).properties.clusters.items.properties.through;
            return {
                ok: true,
                output: {
                    clusters: [
                        { through: minimum + 1, abstract: "The walnut cake." },
                        ...(maximum > minimum + 1
                            ? [{ through: maximum, abstract: "The kiln." }]
                            : []),
                    ],
                },
                model: "claude-test",
                costUsd: 0.1,
            };
        };
        const starts: SessionStart[] = [];
        const inners: FakeSession[] = [];
        const opened = await openMemory({
            resume: null,
            call,
            prompts,
            connect: (start) => {
                starts.push(start);
                const inner = new FakeSession();
                inners.push(inner);
                return inner;
            },
            recallLaunch: (phrase) => ({ command: "x", args: [phrase] }),
            env,
        });
        if (!opened.ok) {
            throw new Error(opened.message);
        }
        const { memory } = opened;
        const words = ["walnut", "kiln", "ember", "loom", "quill", "tarn"];
        const reply = (inner: FakeSession, replied: string, context: number) =>
            inner.emit({
                type: "turn-end",
                reply: replied,
                contextTokens: context,
                interrupted: false,
                stats: STATS,
            });
        try {
            const session = memory.createSession([]);
            session.send(text(words[0] as string));
            const first = inners[0] as FakeSession;
            first.emit({ type: "ready", model: "m", sdkSessionId: "s" });
            reply(first, text(words[1] as string), 900);
            session.send(text(words[2] as string));
            reply(first, text(words[3] as string), 1800);
            session.send(text(words[4] as string));
            // Past hard: the next message waits for compaction.
            reply(first, text(words[5] as string), 4500);
            session.send("Held until compaction.");
            await until(() => inners.length === 2);
            const second = inners[1] as FakeSession;
            await until(() => second.sent.length === 1);
            expect(second.sent).toEqual(["Held until compaction."]);
            reply(second, "Done.", 600);
        } finally {
            await memory.close();
        }

        const dir = transcriptDir(env);
        const turns = (await readTranscript(`${dir}/${memory.phrase}.jsonl`))
            .turns;
        expect(turns.map((turn) => turn.text.slice(0, 6))).toEqual([
            "walnut",
            "kiln k",
            "ember ",
            "loom l",
            "quill ",
            "tarn t",
            "Held u",
            "Done.",
        ]);
        const notes = await readSidecar(dir, memory.phrase);
        if (notes.kind !== "ok") {
            throw new Error("the notes were not saved");
        }
        const { clusters } = notes.sidecar;
        expect(clusters.map(({ from, through }) => [from, through])).toEqual([
            [1, 2],
            [3, 4],
        ]);

        // The call was sent the transcript's own turns, under their
        // transcript numbers.
        expect(compactions).toHaveLength(1);
        for (const [at, turn] of turns.slice(0, 4).entries()) {
            const who = turn.role === "user" ? "User" : "Dorothy";
            expect(compactions[0]?.prompt).toContain(
                `<turn n="${at + 1}">${who}: ${escapeXml(turn.text)}</turn>`,
            );
        }
        expect(compactions[0]?.prompt).not.toContain('<turn n="5">');

        // The first session began whole; the second began after the clusters,
        // with the turns they leave and a way back to the ones they cover.
        expect(starts).toHaveLength(2);
        expect(starts[0]).toMatchObject({ history: [], recollect: false });
        expect(starts[1]?.history).toEqual(
            turns.slice(4, 6).map(({ role, text }) => ({ role, text })),
        );
        expect(starts[1]?.earlier).toContain(
            '<cluster n="2" turns="3-4">The kiln.</cluster>',
        );
        expect(starts[1]?.recollect).toBe(true);

        // The index counts the same, and recollect serves each cluster's own
        // turns.
        const index = RecallIndex.open(indexPath(env));
        try {
            await syncIndex(index, dir);
            expect(
                index.db
                    .query(
                        "SELECT n, first_turn AS first, last_turn AS last FROM clusters WHERE phrase = ? ORDER BY n",
                    )
                    .all(memory.phrase),
            ).toEqual([
                { n: 1, first: 1, last: 2 },
                { n: 2, first: 3, last: 4 },
            ]);
            for (const [at, cluster] of clusters.entries()) {
                const served = recollect(
                    index,
                    { cluster: at + 1 },
                    { phrase: memory.phrase },
                );
                expect(served.turns).toEqual([cluster.from, cluster.through]);
                expect(served.total).toBe(turns.length);
                const wanted = turns.slice(cluster.from - 1, cluster.through);
                expect(
                    served.window.map(({ turn, role, text: said }) => ({
                        turn,
                        role,
                        text: said,
                    })),
                ).toEqual(
                    wanted.map((turn, offset) => ({
                        turn: cluster.from + offset,
                        role: turn.role,
                        text: turn.text,
                    })),
                );
            }
        } finally {
            index.close();
        }
    });
});
