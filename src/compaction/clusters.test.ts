// vim:set expandtab shiftwidth=4 filetype=typescript:
// SPDX-License-Identifier: GPL-3.0-only

//
//
// ~chewygumxx/dorothy.git
// ::: :/src/compaction/clusters.test.ts
//
//

import { describe, expect, it } from "bun:test";
import type { Cluster } from "../memory/sidecar.js";
import type { Turn } from "../persona.js";
import {
    CLUSTER_INSTRUCTIONS,
    clusterPrompt,
    clusterSchema,
    validateClusters,
} from "./clusters.js";

const STAMP = { at: "2026-10-07T08:00:00.000Z", model: "claude-test" };
const RANGE = { from: 3, through: 6 };
const turns: Turn[] = [
    { role: "user", text: "One." },
    { role: "assistant", text: "Two." },
    { role: "user", text: "Cats & <dogs>?" },
    { role: "assistant", text: "Four." },
    { role: "user", text: "Five." },
    { role: "assistant", text: "Six." },
    { role: "user", text: "Seven." },
];
const earlier: Cluster[] = [
    { from: 1, through: 2, abstract: "The start.", ...STAMP },
];

describe("clusterPrompt", () => {
    it("gives the earlier abstracts, then the outgoing turns, numbered", () => {
        expect(clusterPrompt(turns, RANGE, earlier)).toBe(
            [
                "Your summaries of the turns before these, for context; do not repeat them:",
                "<earlier>",
                '<cluster n="1" turns="1-2">The start.</cluster>',
                "</earlier>",
                "",
                "The turns leaving your context, numbered:",
                "<turns>",
                '<turn n="3">User: Cats &amp; &lt;dogs&gt;?</turn>',
                '<turn n="4">Dorothy: Four.</turn>',
                '<turn n="5">User: Five.</turn>',
                '<turn n="6">Dorothy: Six.</turn>',
                "</turns>",
            ].join("\n"),
        );
    });

    it("leaves out the earlier part when there is none", () => {
        expect(clusterPrompt(turns, { from: 1, through: 2 }, [])).toBe(
            [
                "The turns leaving your context, numbered:",
                "<turns>",
                '<turn n="1">User: One.</turn>',
                '<turn n="2">Dorothy: Two.</turn>',
                "</turns>",
            ].join("\n"),
        );
    });
});

describe("the instructions and schema", () => {
    it("ask for topical clusters and abstracts within their limit", () => {
        expect(CLUSTER_INSTRUCTIONS).toContain("where the topic changes");
        expect(CLUSTER_INSTRUCTIONS).toContain("1,000 characters");
        expect(clusterSchema(RANGE)).toEqual({
            type: "object",
            properties: {
                clusters: {
                    type: "array",
                    minItems: 1,
                    items: {
                        type: "object",
                        properties: {
                            through: {
                                type: "integer",
                                minimum: 3,
                                maximum: 6,
                            },
                            abstract: {
                                type: "string",
                                minLength: 1,
                                maxLength: 1000,
                            },
                        },
                        required: ["through", "abstract"],
                        additionalProperties: false,
                    },
                },
            },
            required: ["clusters"],
            additionalProperties: false,
        });
    });
});

describe("validateClusters", () => {
    const valid = (output: unknown) => validateClusters(output, RANGE, STAMP);

    it("fills in each cluster's start, unescaped and normalised", () => {
        expect(
            valid({
                clusters: [
                    { through: 4, abstract: " Cats &amp;\n dogs. " },
                    { through: 6, abstract: "Five and six." },
                ],
            }),
        ).toEqual({
            ok: true,
            clusters: [
                { from: 3, through: 4, abstract: "Cats & dogs.", ...STAMP },
                { from: 5, through: 6, abstract: "Five and six.", ...STAMP },
            ],
        });
    });

    it("refuses what does not cover the range in order", () => {
        const reasons = [
            [{}, "no clusters in the result"],
            [{ clusters: [] }, "no clusters in the result"],
            [
                { clusters: [{ through: 7, abstract: "a" }] },
                "cluster 1 ends at 7, outside 3-6",
            ],
            [
                {
                    clusters: [
                        { through: 5, abstract: "a" },
                        { through: 4, abstract: "b" },
                    ],
                },
                "cluster 2 ends at 4, outside 6-6",
            ],
            [
                { clusters: [{ through: 4.5, abstract: "a" }] },
                "cluster 1 ends at 4.5, outside 3-6",
            ],
            [
                { clusters: [{ through: 5, abstract: "a" }] },
                "the last cluster ends at 5, not 6",
            ],
            [
                { clusters: [{ through: 6, abstract: "  " }] },
                "the abstract of cluster 1 is empty",
            ],
            [
                { clusters: [{ through: 6, abstract: "x".repeat(1001) }] },
                "cluster 1: abstract is 1001 characters, over 1000",
            ],
        ] as const;
        for (const [output, reason] of reasons) {
            expect(valid(output)).toEqual({ ok: false, reason });
        }
    });
});
