// vim:set expandtab shiftwidth=4 filetype=typescript:
// SPDX-License-Identifier: GPL-3.0-only

//
//
// ~chewygumxx/dorothy.git
// ::: :/packages/memory/src/hosts/profiles.test.ts
//
//

import { afterEach, describe, expect, it } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadProfiles } from "./profiles.js";

const dirs: string[] = [];
const tempDir = () => {
    const dir = mkdtempSync(join(tmpdir(), "dorothy-hosts-"));
    dirs.push(dir);
    return dir;
};
afterEach(() => {
    for (const dir of dirs.splice(0)) {
        rmSync(dir, { recursive: true, force: true });
    }
});

describe("loadProfiles", () => {
    it("loads the shipped profiles", async () => {
        const profiles = await loadProfiles();
        expect([...profiles.keys()].sort()).toEqual([
            "claude-code",
            "codex",
            "deepseek-harness",
            "goose",
            "hermes",
            "openclaw",
            "opencode",
            "qwen-code",
        ]);
        expect(profiles.get("codex")?.instructions).toBe(512);
        expect(profiles.get("goose")?.recallBudget).toBe(0);
    });

    it("refuses a profile that is not one", async () => {
        const dir = tempDir();
        writeFileSync(join(dir, "codex.json"), '{"id":"codex"}');
        await expect(loadProfiles(dir)).rejects.toThrow("hosts/codex.json");
    });

    it("refuses a profile whose id is not its file's", async () => {
        const dir = tempDir();
        writeFileSync(
            join(dir, "codex.json"),
            JSON.stringify({
                id: "goose",
                checked: [],
                blockBudget: 1000,
                recallBudget: 0,
                delivery: ["mcp"],
                instructions: 512,
            }),
        );
        await expect(loadProfiles(dir)).rejects.toThrow("its id is goose");
    });
});
