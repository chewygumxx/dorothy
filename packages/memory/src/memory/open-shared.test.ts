// vim:set expandtab shiftwidth=4 filetype=typescript:
// SPDX-License-Identifier: GPL-3.0-only

//
//
// ~chewygumxx/dorothy.git
// ::: :/packages/memory/src/memory/open-shared.test.ts
//
//

// Two chats on one conversation: each keeps its own turns, and the
// transcript has them in the order written, so that one chat's turn 5 can
// be the transcript's turn 7. A cluster is saved only for the transcript's
// own turns.

import { describe, expect, it } from "bun:test";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import {
    type ConversationEvent,
    configPath,
    newPhrase,
    type StructuredCall,
    type StructuredRequest,
    type Turn,
    withSection,
} from "@dorothy/core";
import { seedTurns } from "../compaction/plan.js";
import {
    readTranscript,
    TranscriptWriter,
    transcriptDir,
    transcriptPath,
} from "../transcript.js";
import { FakeSession } from "./fake-session.js";
import { type MemoryPrompts, openMemory, turnsAgree } from "./open.js";
import { useXdgDir } from "./open-testing.js";
import {
    EMPTY_SIDECAR,
    readSidecar,
    sidecarPath,
    writeAtomic,
} from "./sidecar.js";

useXdgDir();

const prompts: MemoryPrompts = {
    review: "R",
    compaction: "C",
    hash: () => "h",
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
const COMMON = [
    ["user", "Common one"],
    ["assistant", "Common two"],
    ["user", "Common three"],
    ["assistant", "Common four"],
] as const;

async function until(done: () => boolean | Promise<boolean>): Promise<void> {
    for (let wait = 0; wait < 400 && !(await done()); wait++) {
        await new Promise((resolve) => setTimeout(resolve, 5));
    }
    expect(await done()).toBe(true);
}

describe("openMemory with two chats on one conversation", () => {
    it("compacts a chat's turns only where they are the transcript's, never another chat's", async () => {
        const env = process.env;
        await mkdir(dirname(configPath(env)), { recursive: true });
        await writeFile(
            configPath(env),
            "[memory]\nenabled = false\nrecall = false\n[history]\nenabled = false\n[compaction]\nsoft = 2000\nhard = 4000\ntail = 500\n",
        );
        // Four turns both chats start from, already in a cluster.
        const phrase = newPhrase();
        const path = transcriptPath(phrase, env);
        const writer = await TranscriptWriter.open(path);
        for (const [kind, text] of COMMON) {
            await writer.append(
                kind === "user"
                    ? { kind, text }
                    : { kind, text, interrupted: false },
            );
        }
        await writer.close();
        await writeAtomic(
            sidecarPath(transcriptDir(env), phrase),
            JSON.stringify({
                ...EMPTY_SIDECAR,
                clusters: [
                    {
                        from: 1,
                        through: 4,
                        abstract: "Common history.",
                        at: "2026-10-19T00:00:00.000Z",
                        model: "fake",
                    },
                ],
            }),
        );

        const asked: StructuredRequest[] = [];
        const call: StructuredCall = async (request) => {
            asked.push(request);
            return {
                ok: true,
                output: {
                    clusters: [{ through: 6, abstract: "Whatever it summed." }],
                },
                model: "fake",
                costUsd: 0,
            };
        };
        const chat = async () => {
            const inners: FakeSession[] = [];
            const opened = await openMemory({
                resume: phrase,
                call,
                prompts,
                connect: () => {
                    const inner = new FakeSession();
                    inners.push(inner);
                    return inner;
                },
                recallLaunch: () => {
                    throw new Error("no recall expected");
                },
                env,
            });
            if (!opened.ok) {
                throw new Error(opened.message);
            }
            const session = opened.memory.createSession(opened.memory.history);
            const events: ConversationEvent[] = [];
            session.subscribe((event) => events.push(event));
            return { memory: opened.memory, session, inners, events };
        };
        const a = await chat();
        const b = await chat();
        const reply = (inner: FakeSession, text: string, context: number) =>
            inner.emit({
                type: "turn-end",
                reply: text,
                contextTokens: context,
                interrupted: false,
                stats: STATS,
            });
        const turnsOnDisk = async () => (await readTranscript(path)).turns;
        try {
            // A writes the transcript's turns 5 and 6; B then writes 7 and 8,
            // which are its own turns 5 and 6.
            a.session.send("A essential fact: scarlet bicycle");
            reply(a.inners[0] as FakeSession, "A acknowledged", 0);
            await until(async () => (await turnsOnDisk()).length === 6);
            b.session.send(`B only ${"b".repeat(1200)}`);
            reply(
                b.inners[0] as FakeSession,
                `B replied ${"c".repeat(2400)}`,
                0,
            );
            b.session.send("Latest B");
            // Past hard, so that the next message waits for compaction.
            reply(b.inners[0] as FakeSession, "Latest answer", 5000);
            b.session.send("Held next");
            await until(() =>
                b.events.some(
                    (event) =>
                        event.type === "warning" &&
                        event.message.includes("off until the next launch"),
                ),
            );

            // B's turns 5 and 6 are not the transcript's: nothing was asked
            // of the model, nothing saved, and A's turns are still the ones
            // a resume drops from the seed, with the cluster that was there.
            expect(asked).toEqual([]);
            const notes = await readSidecar(transcriptDir(env), phrase);
            if (notes.kind !== "ok") {
                throw new Error("the notes were lost");
            }
            expect(
                notes.sidecar.clusters.map((c) => [c.from, c.through]),
            ).toEqual([[1, 4]]);
            const warned = b.events.flatMap((event) =>
                event.type === "warning" ? [event.message] : [],
            );
            expect(warned[0]).toBe(
                "compaction: off until the next launch; turn 5 here is not turn 5 of its transcript, which another chat is writing to",
            );
            // The message held for it still goes.
            await until(() =>
                (b.inners[0] as FakeSession).sent.includes("Held next"),
            );
            const disk = await turnsOnDisk();
            expect(disk[4]?.text).toBe("A essential fact: scarlet bicycle");
            expect(
                seedTurns(disk, notes.sidecar.clusters)
                    .map((turn) => turn.text)
                    .join("|"),
            ).toContain("A essential fact: scarlet bicycle");

            // A's turns 5 and 6 are the transcript's, whatever came after,
            // so A may still compact them, and the cluster is A's.
            a.session.send(`A next ${"a".repeat(1200)}`);
            reply(
                a.inners[0] as FakeSession,
                `A answer ${"d".repeat(2400)}`,
                5000,
            );
            a.session.send("A held");
            await until(() => asked.length === 1);
            expect(asked[0]?.prompt).toContain(
                "A essential fact: scarlet bicycle",
            );
            expect(asked[0]?.prompt).not.toContain("B only");
            await until(async () => {
                const read = await readSidecar(transcriptDir(env), phrase);
                return read.kind === "ok" && read.sidecar.clusters.length === 2;
            });
        } finally {
            await a.memory.close();
            await b.memory.close();
        }
    });
});

describe("turnsAgree", () => {
    const turns = (...texts: [Turn["role"], string][]): Turn[] =>
        texts.map(([role, text]) => ({ role, text }));

    it("is satisfied by the transcript's own turns at those numbers, and by nothing to check", async () => {
        const path = transcriptPath(newPhrase(), process.env);
        const writer = await TranscriptWriter.open(path);
        for (const [kind, text] of COMMON) {
            void writer.append(
                kind === "user"
                    ? { kind, text }
                    : { kind, text, interrupted: false },
            );
        }
        // Unflushed appends are waited for, not missed.
        expect(
            await turnsAgree(writer, path, {
                from: 2,
                turns: turns(
                    ["assistant", "Common two"],
                    ["user", "Common three"],
                ),
            }),
        ).toEqual({ ok: true });
        expect(await turnsAgree(writer, path, null)).toEqual({ ok: true });
        expect(
            await turnsAgree(null, path, {
                from: 1,
                turns: turns(["user", "never read"]),
            }),
        ).toEqual({ ok: true });
        await writer.close();
    });

    it("refuses at the first turn that differs in text or role, or is not there", async () => {
        const path = transcriptPath(newPhrase(), process.env);
        const writer = await TranscriptWriter.open(path);
        for (const [kind, text] of COMMON) {
            void writer.append(
                kind === "user"
                    ? { kind, text }
                    : { kind, text, interrupted: false },
            );
        }
        const refused = async (
            from: number,
            outgoing: [Turn["role"], string][],
        ) => {
            const result = await turnsAgree(writer, path, {
                from,
                turns: turns(...outgoing),
            });
            return result.ok ? "ok" : result.reason;
        };
        const reason = (number: number) =>
            `turn ${number} here is not turn ${number} of its transcript, which another chat is writing to`;
        expect(
            await refused(3, [
                ["user", "Common three"],
                ["assistant", "Else"],
            ]),
        ).toBe(reason(4));
        expect(await refused(1, [["assistant", "Common one"]])).toBe(reason(1));
        expect(
            await refused(4, [
                ["assistant", "Common four"],
                ["user", "Fifth"],
            ]),
        ).toBe(reason(5));
        await writer.close();
    });
});
