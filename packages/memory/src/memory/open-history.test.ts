// vim:set expandtab shiftwidth=4 filetype=typescript:
// SPDX-License-Identifier: GPL-3.0-only

//
//
// ~chewygumxx/dorothy.git
// ::: :/packages/memory/src/memory/open-history.test.ts
//
//

import { describe, expect, it } from "bun:test";
import { randomBytes } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdtemp, readFile } from "node:fs/promises";
import { join } from "node:path";
import { DEFAULT_CONFIG, newPhrase } from "@dorothy/core";
import { clusterSaver, launchHistory } from "./open.js";

import { dir, useXdgDir } from "./open-testing.js";

useXdgDir();

describe("launchHistory", () => {
    // A bare repository with git isolated, local to this file, which
    // may not import from history (the package graph keeps it out).
    const gitEnv = { ...process.env, GIT_CONFIG_GLOBAL: "/dev/null" };
    const bareRepo = async () => {
        const path = await mkdtemp(join(dir, "mirror-"));
        const proc = Bun.spawn(["git", "init", "-q", "--bare", path], {
            env: gitEnv,
        });
        expect(await proc.exited).toBe(0);
        return path;
    };
    const sealedAt = async (bare: string) => {
        const proc = Bun.spawn(
            ["git", "rev-parse", "--verify", "-q", "refs/heads/sealed"],
            { cwd: bare, env: gitEnv, stdout: "pipe", stderr: "ignore" },
        );
        const out = await new Response(proc.stdout).text();
        return (await proc.exited) === 0 ? out.trim() : null;
    };

    it("adopts the data directory and asks for a mirror", async () => {
        const warnings: string[] = [];
        const launched = await launchHistory({
            config: DEFAULT_CONFIG,
            index: null,
            warnings,
            hook: null,
        });
        expect(launched).not.toBeNull();
        expect(existsSync(join(dir, "dorothy", ".git", "HEAD"))).toBe(true);
        expect(warnings).toEqual([
            "memory has no mirror · dorothy --mirror <url>",
        ]);
        await launched?.close();
    });

    it("pushes to a mirror at every launch, even when nothing waits", async () => {
        const key = randomBytes(32).toString("base64");
        const env = { ...process.env, DOROTHY_MIRROR_KEY: key };
        const pushed = async (bare: string) => {
            for (let tries = 0; tries < 100; tries++) {
                const tip = await sealedAt(bare);
                if (tip !== null) {
                    return tip;
                }
                await new Promise((resolve) => setTimeout(resolve, 50));
            }
            return null;
        };
        const options = {
            config: DEFAULT_CONFIG,
            index: null,
            warnings: [] as string[],
            env,
            hook: null,
        };

        const first = await launchHistory(options);
        const bare = await bareRepo();
        await first?.history.repo.setRemote("mirror", bare);
        await first?.close();
        const second = await launchHistory(options);
        expect(await pushed(bare)).not.toBeNull();
        // Everything is sealed now, so nothing waits; a new mirror still
        // gets the branch at the next launch.
        const other = await bareRepo();
        await second?.history.repo.setRemote("mirror", other);
        await second?.close();
        const third = await launchHistory(options);
        expect(await pushed(other)).not.toBeNull();
        expect(options.warnings).toEqual([
            "memory has no mirror · dorothy --mirror <url>",
        ]);
        await third?.close();
    });

    it("repacks only once the launch's push is done", async () => {
        const options = {
            config: DEFAULT_CONFIG,
            index: null,
            warnings: [] as string[],
            env: {
                ...process.env,
                DOROTHY_MIRROR_KEY: randomBytes(32).toString("base64"),
            },
            hook: null,
        };
        const first = await launchHistory(options);
        const bare = await bareRepo();
        await first?.history.repo.setRemote("mirror", bare);
        await first?.close();
        let seen: string | null = null;
        let done!: () => void;
        const maintained = new Promise<void>((resolve) => {
            done = resolve;
        });
        const second = await launchHistory({
            ...options,
            maintain: async () => {
                seen = await sealedAt(bare);
                done();
                return true;
            },
        });
        await maintained;
        expect(seen).not.toBeNull();
        await second?.close();
    });

    it("is off when the config says so", async () => {
        expect(
            await launchHistory({
                config: { history: { enabled: false, pushSeconds: 60 } },
                index: null,
                warnings: [],
                hook: null,
            }),
        ).toBeNull();
    });
});

describe("clusterSaver", () => {
    const cluster = (from: number, through: number) => ({
        from,
        through,
        abstract: "Turns.",
        at: "2026-10-07T08:00:00.000Z",
        model: "claude-test",
    });
    const notes = async (phrase: string) =>
        JSON.parse(await readFile(join(dir, `${phrase}.meta.json`), "utf8"));

    it("saves the clusters and adds the compaction's cost", async () => {
        const phrase = newPhrase();
        const save = clusterSaver({ dir, phrase, transcript: true });
        expect(await save([cluster(1, 4)], 0.25)).toEqual({ ok: true });
        expect(await save([cluster(5, 8)], 0.5)).toEqual({ ok: true });
        const written = await notes(phrase);
        expect(written.clusters).toHaveLength(2);
        expect(written.compactionCostUsd).toBe(0.75);
    });

    it("hands back the notes' clusters when another writer covered those turns first", async () => {
        const phrase = newPhrase();
        const other = clusterSaver({ dir, phrase, transcript: true });
        expect(await other([cluster(1, 4), cluster(5, 8)], 0.25)).toEqual({
            ok: true,
        });
        const save = clusterSaver({ dir, phrase, transcript: true });
        expect(await save([cluster(1, 4)], 0.5)).toEqual({
            ok: true,
            clusters: [cluster(1, 4), cluster(5, 8)],
        });
        // Nothing written: the cost is the other writer's alone.
        expect((await notes(phrase)).compactionCostUsd).toBe(0.25);
    });

    it("hands back the notes' clusters however much of those turns they cover, for compaction to judge", async () => {
        const phrase = newPhrase();
        const save = clusterSaver({ dir, phrase, transcript: true });
        expect(await save([cluster(5, 8)], 0.5)).toEqual({
            ok: true,
            clusters: [],
        });
        expect(await save([cluster(1, 6)], 0.5)).toEqual({ ok: true });
        expect(await save([cluster(5, 8)], 0.5)).toEqual({
            ok: true,
            clusters: [cluster(1, 6)],
        });
    });

    it("saves nothing without a transcript", async () => {
        const phrase = newPhrase();
        const save = clusterSaver({ dir, phrase, transcript: false });
        expect(await save([cluster(1, 4)], 0.25)).toEqual({ ok: true });
        await expect(notes(phrase)).rejects.toThrow();
    });

    it("records the compaction in history", async () => {
        const phrase = newPhrase();
        const recorded: { paths: readonly string[]; message: string }[] = [];
        const save = clusterSaver({
            dir,
            phrase,
            transcript: true,
            recorder: async (paths, message) => {
                recorded.push({ paths, message });
            },
        });
        expect(await save([cluster(1, 4)], 0.25)).toEqual({ ok: true });
        expect(recorded).toEqual([
            {
                paths: [join(dir, `${phrase}.meta.json`)],
                message: `compaction: ${phrase} (dorothy, claude-test)`,
            },
        ]);
    });
});
