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
import { INSTRUCTIONS } from "../contract/tools.js";
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

    it("gives each shipped profile values the service can use", async () => {
        for (const [id, profile] of await loadProfiles()) {
            expect({ id, same: profile.id }).toEqual({ id, same: id });
            expect(profile.blockBudget).toBeGreaterThanOrEqual(200);
            expect(profile.recallBudget).toBeGreaterThanOrEqual(0);
            expect(profile.delivery.length).toBeGreaterThan(0);
            expect(profile.delivery).toContain("mcp");
            // The server's instructions fit the smallest client allowance.
            expect(INSTRUCTIONS.length).toBeLessThanOrEqual(
                profile.instructions,
            );
        }
        const profiles = await loadProfiles();
        expect(profiles.get("hermes")?.blockBudget).toBe(4000);
        expect(profiles.get("openclaw")?.blockBudget).toBe(4000);
        expect(profiles.get("goose")?.blockBudget).toBe(16000);
        expect(profiles.get("claude-code")?.delivery).toEqual(["hook", "mcp"]);
    });

    it("names the file of a profile that is not JSON", async () => {
        const dir = tempDir();
        writeFileSync(join(dir, "codex.json"), "{not json");
        await expect(loadProfiles(dir)).rejects.toThrow(
            /^hosts\/codex\.json: not JSON \(/,
        );
    });

    it("names the field a schema failure is about", async () => {
        const dir = tempDir();
        writeFileSync(
            join(dir, "codex.json"),
            JSON.stringify({
                id: "codex",
                checked: [],
                blockBudget: 5,
                recallBudget: 0,
                delivery: ["mcp"],
                instructions: 512,
            }),
        );
        await expect(loadProfiles(dir)).rejects.toThrow(
            /^hosts\/codex\.json: blockBudget: /,
        );
    });

    it("refuses a directory with no profile", async () => {
        const dir = tempDir();
        writeFileSync(join(dir, "notes.txt"), "not a profile");
        await expect(loadProfiles(dir)).rejects.toThrow("no host profile in");
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
