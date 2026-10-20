// vim:set expandtab shiftwidth=4 filetype=typescript:
// SPDX-License-Identifier: GPL-3.0-only

//
//
// ~chewygumxx/dorothy.git
// ::: :/packages/memory/src/recording/watermark.test.ts
//
//

import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { FactStore } from "../facts/store.js";
import { hostWatermark, watermarkPath } from "./watermark.js";

const FIRST = "2026-10-20T10:00:00.000Z";
const LATER = "2026-10-21T10:00:00.000Z";
let root = "";
let commits: string[];
let store: FactStore;
const warnings: string[] = [];
beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "dorothy-watermark-"));
    commits = [];
    warnings.length = 0;
    store = {
        root,
        lock: (work) => work(),
        recorder: async (_paths, message) => {
            commits.push(message);
        },
    };
});
afterEach(async () => {
    await rm(root, { recursive: true, force: true });
});
const warn = (message: string) => warnings.push(message);

describe("host watermarks", () => {
    it("keeps them beside the archive, in the data directory", () => {
        expect(watermarkPath(root)).toBe(join(root, "recording.json"));
    });
    it("stores a host's first time and keeps it", async () => {
        expect(await hostWatermark(store, "codex", FIRST, warn)).toBe(FIRST);
        expect(await hostWatermark(store, "codex", LATER, warn)).toBe(FIRST);
        expect(await hostWatermark(store, "hermes", LATER, warn)).toBe(LATER);
        expect(JSON.parse(await readFile(watermarkPath(root), "utf8"))).toEqual(
            {
                v: 1,
                watermarks: { codex: FIRST, hermes: LATER },
            },
        );
        expect((await stat(watermarkPath(root))).mode & 0o777).toBe(0o600);
        expect(warnings).toEqual([]);
    });
    it("commits a new watermark to history, and only a new one", async () => {
        await hostWatermark(store, "codex", FIRST, warn);
        await hostWatermark(store, "codex", LATER, warn);
        expect(commits).toEqual(["recording: codex watermark"]);
    });
    it("starts afresh from a file it cannot trust, saying so", async () => {
        await writeFile(watermarkPath(root), "SYNTHETIC_CANARY not JSON");
        expect(await hostWatermark(store, "codex", FIRST, warn)).toBe(FIRST);
        expect(warnings).toHaveLength(1);
        expect(warnings.join()).not.toContain("SYNTHETIC_CANARY");
        await writeFile(
            watermarkPath(root),
            JSON.stringify({ v: 1, watermarks: { codex: "not a time" } }),
        );
        expect(await hostWatermark(store, "codex", LATER, warn)).toBe(LATER);
        expect(warnings).toHaveLength(2);
    });
    it("rejects a time that is not an ISO instant", async () => {
        await expect(
            hostWatermark(store, "codex", "yesterday", warn),
        ).rejects.toThrow("invalid sweep watermark");
    });
    it("takes the store's lock", async () => {
        let held = 0;
        store.lock = async (work) => {
            held += 1;
            return work();
        };
        await hostWatermark(store, "codex", FIRST, warn);
        expect(held).toBe(1);
    });
});
