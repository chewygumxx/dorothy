// vim:set expandtab shiftwidth=4 filetype=typescript:
// SPDX-License-Identifier: GPL-3.0-only

//
//
// ~chewygumxx/dorothy.git
// ::: :/packages/memory/src/bodies/launch.test.ts
//
//

import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { newPhrase } from "@dorothy/core";
import { putFact } from "../facts/store.js";
import { MEMORY_PREAMBLE } from "../memory/block.js";
import { EMPTY_SIDECAR, sidecarPath } from "../memory/sidecar.js";
import { identify } from "../projects/identify.js";
import { claudeBlock, syncDirectory } from "./launch.js";

let home = "";
let env: Record<string, string>;
beforeEach(async () => {
    home = await mkdtemp(join(tmpdir(), "dorothy-launch-"));
    env = {
        HOME: home,
        XDG_DATA_HOME: join(home, "data"),
        XDG_CACHE_HOME: join(home, "cache"),
        XDG_CONFIG_HOME: join(home, "config"),
        XDG_STATE_HOME: join(home, "state"),
    };
});
afterEach(async () => {
    await rm(home, { recursive: true, force: true });
});

const config = (text: string) =>
    mkdir(join(home, "config", "dorothy"), { recursive: true }).then(() =>
        writeFile(join(home, "config", "dorothy", "config.toml"), text),
    );

describe("claudeBlock", () => {
    it("renders chat's block from the notes", async () => {
        const dir = join(home, "data", "dorothy", "transcripts");
        await mkdir(dir, { recursive: true });
        const phrase = newPhrase();
        await writeFile(
            join(dir, `${phrase}.jsonl`),
            `${JSON.stringify({ v: 1, kind: "user", at: new Date().toISOString(), text: "hello" })}\n`,
        );
        await writeFile(
            sidecarPath(dir, phrase),
            JSON.stringify({
                ...EMPTY_SIDECAR,
                title: "Greetings",
                description: "A hello.",
            }),
        );
        const { block } = await claudeBlock({ env });
        expect(block).toStartWith(MEMORY_PREAMBLE);
        expect(block).toContain("<title>Greetings</title>");
    });

    it("is empty with no notes, and with memory off", async () => {
        expect((await claudeBlock({ env })).block).toBe("");
        await config("[memory]\nenabled = false\n");
        expect((await claudeBlock({ env })).block).toBe("");
    });
});

describe("syncDirectory", () => {
    it("says nothing outside a repository", async () => {
        await mkdir(join(home, "plain"));
        expect(
            await syncDirectory(join(home, "plain"), {
                env,
                openHistory: async () => null,
            }),
        ).toBeNull();
    });

    it("syncs a repository's project, exporting its facts", async () => {
        const repo = join(home, "repo");
        await mkdir(join(repo, ".git"), { recursive: true });
        await writeFile(join(repo, ".git", "config"), "[core]\n");
        const project = await identify(repo);
        await putFact(
            join(home, "data", "dorothy"),
            { kind: "project", id: project?.id as string },
            {
                name: "gateway",
                title: "The gateway",
                description: "How it runs.",
                type: "project",
                extra: {},
                tags: [],
                importance: null,
                provenance: {
                    origin: "dorothy",
                    by: "dorothy",
                    at: new Date().toISOString(),
                    created: new Date().toISOString(),
                },
                retired: null,
                body: "On loopback.",
            },
        );
        expect(
            await syncDirectory(repo, { env, openHistory: async () => null }),
        ).toBeNull();
        expect(
            await Bun.file(
                join(repo, ".agents", "memory", "gateway.md"),
            ).exists(),
        ).toBe(true);
    });
});
