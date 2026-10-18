// vim:set expandtab shiftwidth=4 filetype=typescript:
// SPDX-License-Identifier: GPL-3.0-only

//
//
// ~chewygumxx/dorothy.git
// ::: :/packages/memory/src/facts/file.test.ts
//
//

import { describe, expect, it } from "bun:test";
import {
    actorOf,
    type Fact,
    type FactProvenance,
    handEdited,
    parseFact,
    renderFact,
} from "./file.js";

const AT = "2026-10-15T09:30:00.000Z";
const LATER = "2026-10-16T10:00:00.000Z";
const PHRASE = "bingo-overabundance-mazer-kasha";

const fact = (fields: Partial<Fact> = {}): Fact => ({
    name: "likes-tea",
    title: "Likes tea",
    description: "Prefers tea to coffee in the afternoon.",
    type: "user",
    extra: {},
    tags: [],
    importance: null,
    provenance: { origin: "user", by: "dorothy", at: AT, created: AT },
    retired: null,
    body: "Asked for tea twice.",
    ...fields,
});

const CANONICAL = [
    "---",
    "type: user",
    "title: >-",
    "  Likes tea",
    "description: >-",
    "  Prefers tea to coffee in the afternoon.",
    "tags:",
    "  - k1a2b3c4d",
    "sources:",
    `  - resource: "dorothy:conversation/${PHRASE}#12"`,
    "generated:",
    '  by: "dorothy/claude-opus-5-5"',
    `  at: "${AT}"`,
    "dorothy:",
    "  origin: user",
    `  created: "${AT}"`,
    "  importance: 7",
    "  metadata:",
    '    node_type: "memory"',
    "---",
    "",
    "Asked for tea twice.",
    "",
].join("\n");

const roundTrip = (written: Fact) =>
    expect(parseFact(renderFact(written), written.name)).toEqual({
        kind: "ok",
        fact: written,
    });

describe("renderFact", () => {
    it("writes OKF's keys, then Dorothy's, free text in >- blocks", () => {
        const written = fact({
            extra: { node_type: "memory" },
            tags: ["k1a2b3c4d"],
            importance: 7,
            provenance: {
                origin: "user",
                by: "dorothy",
                at: AT,
                created: AT,
                model: "claude-opus-5-5",
                from: `${PHRASE}#12`,
            },
        });
        expect(renderFact(written)).toBe(CANONICAL);
        roundTrip(written);
    });

    it("marks a retired fact deprecated and keeps why", () => {
        const text = renderFact(
            fact({ retired: { at: AT, by: "user", why: "No longer true." } }),
        );
        expect(text).toContain(
            [
                "status: deprecated",
                "dorothy:",
                "  origin: user",
                `  created: "${AT}"`,
                "  retired:",
                `    at: "${AT}"`,
                "    by: user",
                "    why: >-",
                "      No longer true.",
                "---",
            ].join("\n"),
        );
        roundTrip(
            fact({ retired: { at: AT, by: "user", why: "No longer true." } }),
        );
    });

    it("wraps free text at 80 columns", () => {
        const description = `${"word ".repeat(31)}end`;
        const text = renderFact(fact({ description }));
        for (const line of text.split("\n")) {
            expect(line.length).toBeLessThanOrEqual(80);
        }
        roundTrip(fact({ description }));
    });
});

describe("actors", () => {
    const cases: [FactProvenance, string][] = [
        [{ origin: "user", by: "user", at: AT, created: AT }, "human:owner"],
        [
            { origin: "repo", by: "repo", at: AT, created: AT },
            "process:repo-sync",
        ],
        [
            {
                origin: "dorothy",
                by: "review",
                at: AT,
                created: AT,
                model: "m",
            },
            "dorothy-extraction/m",
        ],
        [
            {
                origin: "dorothy",
                by: "dorothy",
                at: AT,
                created: AT,
                host: "codex",
                model: "gpt-5.5",
            },
            "codex/gpt-5.5",
        ],
        [
            { origin: "dorothy", by: "dorothy", at: AT, created: AT },
            "dorothy/unknown",
        ],
    ];
    for (const [provenance, actor] of cases) {
        it(`writes ${actor} and reads it back`, () => {
            expect(actorOf(provenance)).toBe(actor);
            roundTrip(fact({ provenance }));
        });
    }

    it("keeps a model name holding a slash whole", () => {
        roundTrip(
            fact({
                provenance: {
                    origin: "dorothy",
                    by: "dorothy",
                    at: AT,
                    created: AT,
                    host: "opencode",
                    model: "deepseek/deepseek-v4",
                },
            }),
        );
    });

    it("names Dorothy's own origin by how she wrote", () => {
        const review = renderFact(
            fact({
                provenance: {
                    origin: "dorothy",
                    by: "review",
                    at: AT,
                    created: AT,
                },
            }),
        );
        expect(review).toContain("  origin: extraction\n");
        const model = renderFact(
            fact({
                provenance: {
                    origin: "dorothy",
                    by: "dorothy",
                    at: AT,
                    created: AT,
                },
            }),
        );
        expect(model).toContain("  origin: model\n");
    });
});

describe("parseFact", () => {
    it("keeps keys another producer wrote, and other sources", () => {
        const text = CANONICAL.replace(
            `  - resource: "dorothy:conversation/${PHRASE}#12"`,
            [
                `  - resource: "dorothy:conversation/${PHRASE}#12"`,
                "  - resource: https://example.com/tea",
                "    title: Tea",
            ].join("\n"),
        ).replace(
            "---\n\nAsked",
            [
                "verified:",
                "  - by: human:owner",
                `    at: ${LATER}`,
                `stale_after: ${LATER}`,
                "---",
                "",
                "Asked",
            ].join("\n"),
        );
        const read = parseFact(text, "likes-tea");
        expect(read.kind).toBe("ok");
        if (read.kind !== "ok") {
            return;
        }
        expect(read.fact.otherSources).toEqual([
            { resource: "https://example.com/tea", title: "Tea" },
        ]);
        expect(read.fact.foreign).toEqual({
            stale_after: LATER,
            verified: [{ by: "human:owner", at: LATER }],
        });
        const again = renderFact(read.fact);
        expect(again).toContain(
            '  - {"resource":"https://example.com/tea","title":"Tea"}',
        );
        expect(again).toContain(`stale_after: "${LATER}"`);
        expect(parseFact(again, "likes-tea")).toEqual(read);
    });

    it("refuses what OKF or the store cannot hold", () => {
        const cases: [string, string, string][] = [
            [
                "status without retired",
                "\ndorothy:\n",
                "\nstatus: deprecated\ndorothy:\n",
            ],
            ["a draft", "\ndorothy:\n", "\nstatus: draft\ndorothy:\n"],
            ["an unknown dorothy key", "  importance: 7", "  colour: blue"],
            [
                "a writer that is no actor",
                '  by: "dorothy/claude-opus-5-5"',
                '  by: "nobody"',
            ],
        ];
        for (const [what, line, replacement] of cases) {
            const text = CANONICAL.replace(line, replacement);
            expect(text).not.toBe(CANONICAL);
            expect({ what, kind: parseFact(text, "likes-tea").kind }).toEqual({
                what,
                kind: "unparseable",
            });
        }
    });

    it("refuses a file not named as a fact", () => {
        expect(parseFact(CANONICAL, "Likes Tea").kind).toBe("unparseable");
    });

    it("refuses a hidden character spelled as an escape in another key", () => {
        const text = CANONICAL.replace(
            "---\n\nAsked",
            'note: "a\\u202eb"\n---\n\nAsked',
        );
        expect(parseFact(text, "likes-tea").kind).toBe("unparseable");
    });
});

describe("handEdited", () => {
    const now = new Date(LATER);

    it("makes a hand-added fact the user's", () => {
        const text =
            "---\ntype: user\ntitle: Likes tea\ndescription: Prefers tea.\n---\n\nTea.\n";
        const canonical = handEdited(text, "likes-tea", now);
        expect(canonical).not.toBeNull();
        const read = parseFact(canonical as string, "likes-tea");
        expect(read.kind === "ok" && read.fact.provenance).toEqual({
            origin: "user",
            by: "user",
            at: LATER,
            created: LATER,
        });
    });

    it("keeps when a fact was created and where it came from", () => {
        const canonical = handEdited(
            CANONICAL.replace("  Likes tea", "  Loves tea"),
            "likes-tea",
            now,
        );
        const read = parseFact(canonical as string, "likes-tea");
        expect(read.kind === "ok" && read.fact.provenance).toEqual({
            origin: "user",
            by: "user",
            at: LATER,
            created: AT,
            from: `${PHRASE}#12`,
        });
    });

    it("gives null for a file that is no fact", () => {
        expect(handEdited("title: null\n", "likes-tea", now)).toBeNull();
    });
});
