// vim:set expandtab shiftwidth=4 filetype=typescript:
// SPDX-License-Identifier: GPL-3.0-only

//
//
// ~chewygumxx/dorothy.git
// ::: :/src/memory/preview.test.ts
//
//

import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { newPhrase } from "@dorothy/core";
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

    it("fails on a chat that cannot be resumed", async () => {
        const preview = await previewStart({
            resume: "tumble-orchid-vapor-lantern",
            recallLaunch: (of) => ({ command: "x", args: [of] }),
            env,
        });
        expect(preview).toMatchObject({ ok: false });
    });
});
