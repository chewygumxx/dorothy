// vim:set expandtab shiftwidth=4 filetype=typescript:
// SPDX-License-Identifier: GPL-3.0-only

//
//
// ~chewygumxx/dorothy.git
// ::: :/packages/memory/src/engine/engine.test.ts
//
//

import { describe, expect, it } from "bun:test";
import type { Fact, FactProvenance } from "../facts/file.js";
import { isConfirmed } from "./engine.js";

const AT = "2026-10-15T09:30:00.000Z";
const LATER = "2026-10-16T09:30:00.000Z";
const fact = (
    provenance: Pick<FactProvenance, "origin" | "by">,
    fields: Partial<Fact> = {},
): Fact => ({
    name: "likes-tea",
    title: "Likes tea",
    description: "About tea.",
    type: "user",
    extra: {},
    tags: [],
    importance: null,
    provenance: { ...provenance, at: AT, created: AT },
    retired: null,
    body: "Asked for tea.",
    ...fields,
});

describe("isConfirmed", () => {
    it("takes the user's and a repository's knowledge as confirmed", () => {
        expect(isConfirmed(fact({ origin: "user", by: "user" }))).toBe(true);
        expect(isConfirmed(fact({ origin: "repo", by: "repo" }))).toBe(true);
    });

    it("takes a model's, extraction's and an outside writer's as unconfirmed", () => {
        expect(isConfirmed(fact({ origin: "dorothy", by: "dorothy" }))).toBe(
            false,
        );
        expect(isConfirmed(fact({ origin: "dorothy", by: "review" }))).toBe(
            false,
        );
        expect(isConfirmed(fact({ origin: "external", by: "dorothy" }))).toBe(
            false,
        );
    });

    it("takes a model's knowledge the user verified as confirmed", () => {
        const verified = fact(
            { origin: "dorothy", by: "dorothy" },
            { foreign: { verified: [{ by: "human:owner", at: LATER }] } },
        );
        expect(isConfirmed(verified)).toBe(true);
    });

    it("counts only a person's verification", () => {
        for (const verified of [
            [],
            [{ by: "claude-code/opus", at: LATER }],
            [{ by: "human:owner" }],
            "human:owner",
        ]) {
            expect(
                isConfirmed(
                    fact(
                        { origin: "dorothy", by: "dorothy" },
                        { foreign: { verified } },
                    ),
                ),
            ).toBe(false);
        }
    });
});
