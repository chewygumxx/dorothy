// vim:set expandtab shiftwidth=4 filetype=typescript:
// SPDX-License-Identifier: GPL-3.0-only

//
//
// ~chewygumxx/dorothy.git
// ::: :/packages/memory/src/memory/preview.test.ts
//
//

import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { configPath, newPhrase, type Turn } from "@dorothy/core";
import { previewStart } from "./preview.js";
import { EMPTY_SIDECAR } from "./sidecar.js";

describe("previewStart", () => {
    let dir: string;
    let env: Record<string, string>;

    beforeEach(async () => {
        dir = await mkdtemp(join(tmpdir(), "dorothy-preview-"));
        env = {
            HOME: dir,
            XDG_CONFIG_HOME: join(dir, "config"),
            XDG_DATA_HOME: join(dir, "data"),
            XDG_CACHE_HOME: join(dir, "cache"),
        };
    });

    afterEach(async () => {
        await rm(dir, { recursive: true, force: true });
    });

    it("starts a compacted chat as it would resume", async () => {
        const phrase = newPhrase();
        const transcripts = join(dir, "data", "dorothy", "transcripts");
        await mkdir(transcripts, { recursive: true });
        const line = (kind: string, text: string) =>
            JSON.stringify({
                v: 1,
                kind,
                at: "2026-10-07T08:00:00.000Z",
                text,
                ...(kind === "assistant" ? { interrupted: false } : {}),
            });
        await writeFile(
            join(transcripts, `${phrase}.jsonl`),
            `${[
                line("user", "Old question."),
                line("assistant", "Old answer."),
                line("user", "New question."),
                line("assistant", "New answer."),
            ].join("\n")}\n`,
        );
        await writeFile(
            join(transcripts, `${phrase}.meta.json`),
            JSON.stringify({
                ...EMPTY_SIDECAR,
                clusters: [
                    {
                        from: 1,
                        through: 2,
                        abstract: "The old exchange.",
                        at: "2026-10-07T08:00:00.000Z",
                        model: "claude-test",
                    },
                ],
            }),
        );
        const preview = await previewStart({
            resume: phrase,
            recallLaunch: (of) => ({ command: "x", args: [of] }),
            env,
        });
        if (!preview.ok) {
            throw new Error(preview.message);
        }
        expect(preview.start.earlier).toContain(
            '<cluster n="1" turns="1-2">The old exchange.</cluster>',
        );
        expect(preview.start.history).toEqual([
            { role: "user", text: "New question." },
            { role: "assistant", text: "New answer." },
        ]);
        expect(preview.start.recollect).toBe(true);
    });

    it("offers no recollect to a chat with recall on and no clusters", async () => {
        const preview = await previewStart({
            resume: null,
            recallLaunch: (of) => ({ command: "x", args: [of] }),
            env,
        });
        if (!preview.ok) {
            throw new Error(preview.message);
        }
        expect(preview.start.recall).toEqual({
            command: "x",
            args: [preview.phrase],
        });
        expect(preview.start.earlier).toBe("");
        expect(preview.start.recollect).toBe(false);
    });

    describe("from a chat's turns and notes", () => {
        const at = "2026-10-07T08:00:00.000Z";
        const line = (kind: string, text: string) =>
            JSON.stringify({
                v: 1,
                kind,
                at,
                text,
                ...(kind === "assistant" ? { interrupted: false } : {}),
            });
        const talk = (...texts: string[]) =>
            `${texts
                .map((text, i) =>
                    line(i % 2 === 0 ? "user" : "assistant", text),
                )
                .join("\n")}\n`;
        const transcripts = () => join(dir, "data", "dorothy", "transcripts");
        const cluster = (abstract: string) => ({
            from: 1,
            through: 2,
            abstract,
            at,
            model: "claude-test",
        });
        const resume = async () => {
            const preview = await previewStart({
                resume: HERE,
                recallLaunch: (of) => ({ command: "x", args: [of] }),
                env,
            });
            if (!preview.ok) {
                throw new Error(preview.message);
            }
            return preview;
        };
        const HERE = newPhrase(() => Uint8Array.from([1, 1, 2, 3, 4, 5, 6, 7]));
        const OTHER = newPhrase(() =>
            Uint8Array.from([2, 1, 2, 3, 4, 5, 6, 7]),
        );

        beforeEach(async () => {
            await mkdir(transcripts(), { recursive: true });
            await writeFile(
                join(transcripts(), `${HERE}.jsonl`),
                talk("Old question.", "Old answer.", "New question."),
            );
            await writeFile(
                join(transcripts(), `${OTHER}.jsonl`),
                talk("Tea?", "Yes."),
            );
            await writeFile(
                join(transcripts(), `${OTHER}.meta.json`),
                JSON.stringify({
                    ...EMPTY_SIDECAR,
                    title: "Afternoon tea",
                    description: "What she drinks at four.",
                }),
            );
            await mkdir(dirname(configPath(env)), { recursive: true });
            await writeFile(configPath(env), "[memory]\nbudget = 200\n");
        });

        it("charges the abstracts' tokens before the notes on other chats", async () => {
            const without = await resume();
            expect(without.start.memory).toContain("Afternoon tea");
            await writeFile(
                join(transcripts(), `${HERE}.meta.json`),
                JSON.stringify({
                    ...EMPTY_SIDECAR,
                    clusters: [cluster("An old exchange. ".repeat(50))],
                }),
            );
            const reserved = await resume();
            expect(reserved.start.earlier).toContain("An old exchange.");
            expect(reserved.start.memory).not.toContain("Afternoon tea");
        });

        it("falls back to the whole history when the notes are missing or unreadable", async () => {
            const whole: Turn[] = [
                { role: "user", text: "Old question." },
                { role: "assistant", text: "Old answer." },
                { role: "user", text: "New question." },
            ];
            const missing = await resume();
            expect(missing.start.history).toEqual(whole);
            expect(missing.start.earlier).toBe("");
            expect(missing.start.recollect).toBe(false);
            await writeFile(join(transcripts(), `${HERE}.meta.json`), "{");
            const broken = await resume();
            expect(broken.start.history).toEqual(whole);
            expect(broken.start.earlier).toBe("");
            expect(broken.start.recollect).toBe(false);
        });
    });

    it("fails on a chat that cannot be resumed", async () => {
        const preview = await previewStart({
            resume: "tumble-orchid-vapor-lantern",
            recallLaunch: (of) => ({ command: "x", args: [of] }),
            env,
        });
        expect(preview).toMatchObject({ ok: false });
    });
});
