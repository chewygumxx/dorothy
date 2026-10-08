// vim:set expandtab shiftwidth=4 filetype=typescript:
// SPDX-License-Identifier: GPL-3.0-only

//
//
// ~chewygumxx/dorothy.git
// ::: :/packages/memory/src/history/open.test.ts
//
//

import { describe, expect, it } from "bun:test";
import { openRepo } from "./open.js";
import { hasGitBinary } from "./repo.js";

describe("openRepo", () => {
    it("prefers the binary and falls back to isomorphic-git", async () => {
        expect(
            (await openRepo("/nonexistent", { probe: async () => true }))
                .engine,
        ).toBe("git");
        expect(
            (await openRepo("/nonexistent", { probe: async () => false }))
                .engine,
        ).toBe("isomorphic-git");
        expect(
            (
                await openRepo("/nonexistent", {
                    engine: "isomorphic-git",
                    probe: async () => true,
                })
            ).engine,
        ).toBe("isomorphic-git");
    });

    it("finds the binary on this machine", async () => {
        expect(await hasGitBinary()).toBe(true);
    });
});
