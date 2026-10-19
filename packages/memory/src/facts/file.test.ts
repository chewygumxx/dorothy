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
    isConfirmed,
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

    it("refuses retired without a deprecated status", () => {
        const text = renderFact(
            fact({ retired: { at: AT, by: "user", why: "Gone." } }),
        ).replace("status: deprecated\n", "");
        const read = parseFact(text, "likes-tea");
        expect(read).toEqual({
            kind: "unparseable",
            reason: "status and dorothy.retired disagree",
        });
    });

    it("refuses a foreign key the store cannot keep", () => {
        for (const key of ["has space", "null", "a.b", '"__proto__"']) {
            const text = CANONICAL.replace(
                "---\n\nAsked",
                `${key}: x\n---\n\nAsked`,
            );
            expect({ key, kind: parseFact(text, "likes-tea").kind }).toEqual({
                key,
                kind: "unparseable",
            });
        }
    });

    it("refuses a file with no dorothy.origin, or no generated key", () => {
        const noOrigin = CANONICAL.replace("  origin: user\n", "");
        expect(parseFact(noOrigin, "likes-tea")).toEqual({
            kind: "unparseable",
            reason: "dorothy.origin is not one of external, repo, model, extraction, user",
        });
        const noGenerated = CANONICAL.replace(
            `generated:\n  by: "dorothy/claude-opus-5-5"\n  at: "${AT}"\n`,
            "",
        );
        expect(noGenerated).not.toBe(CANONICAL);
        expect(parseFact(noGenerated, "likes-tea").kind).toBe("unparseable");
    });

    it("refuses a type among dorothy.metadata, which would be dropped", () => {
        const text = CANONICAL.replace(
            '    node_type: "memory"',
            '    node_type: "memory"\n    type: "feedback"',
        );
        expect(parseFact(text, "likes-tea")).toEqual({
            kind: "unparseable",
            reason: "dorothy.metadata.type would be dropped: type is a top-level key",
        });
    });

    it("caps what it keeps of another producer, foreign keys and sources", () => {
        const big = "x".repeat(9000);
        const foreign = CANONICAL.replace(
            "---\n\nAsked",
            `note: ${big}\n---\n\nAsked`,
        );
        expect(parseFact(foreign, "likes-tea")).toEqual({
            kind: "unparseable",
            reason: "the keys it keeps for another producer are over 8000 characters",
        });
        const sources = CANONICAL.replace(
            "generated:",
            `  - resource: https://example.com/${big}\ngenerated:`,
        );
        expect(parseFact(sources, "likes-tea")).toEqual({
            kind: "unparseable",
            reason: "the sources it keeps for another producer are over 8000 characters",
        });
        const fits = CANONICAL.replace(
            "---\n\nAsked",
            `note: ${"x".repeat(7000)}\n---\n\nAsked`,
        );
        expect(parseFact(fits, "likes-tea").kind).toBe("ok");
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

    it("keeps the foreign keys and other sources a hand edit carries", () => {
        const text = CANONICAL.replace(
            `  - resource: "dorothy:conversation/${PHRASE}#12"`,
            [
                `  - resource: "dorothy:conversation/${PHRASE}#12"`,
                "  - resource: https://example.com/tea",
            ].join("\n"),
        ).replace("---\n\nAsked", `stale_after: ${LATER}\n---\n\nAsked`);
        const canonical = handEdited(
            text.replace("  Likes tea", "  Loves tea"),
            "likes-tea",
            now,
        );
        const read = parseFact(canonical as string, "likes-tea");
        expect(read.kind === "ok" && read.fact.foreign).toEqual({
            stale_after: LATER,
        });
        expect(read.kind === "ok" && read.fact.otherSources).toEqual([
            { resource: "https://example.com/tea" },
        ]);
    });

    it("gives null for a file that is no fact", () => {
        expect(handEdited("title: null\n", "likes-tea", now)).toBeNull();
    });
});

// A fact as its origin and writer leave it.
const confirmable = (
    provenance: Pick<FactProvenance, "origin" | "by">,
    fields: Partial<Fact> = {},
): Fact =>
    fact({ provenance: { ...provenance, at: AT, created: AT }, ...fields });

describe("isConfirmed", () => {
    it("takes the user's and a repository's knowledge as confirmed", () => {
        expect(isConfirmed(confirmable({ origin: "user", by: "user" }))).toBe(
            true,
        );
        expect(isConfirmed(confirmable({ origin: "repo", by: "repo" }))).toBe(
            true,
        );
    });

    it("takes a model's, extraction's and an outside writer's as unconfirmed", () => {
        expect(
            isConfirmed(confirmable({ origin: "dorothy", by: "dorothy" })),
        ).toBe(false);
        expect(
            isConfirmed(confirmable({ origin: "dorothy", by: "review" })),
        ).toBe(false);
        expect(
            isConfirmed(confirmable({ origin: "external", by: "dorothy" })),
        ).toBe(false);
    });

    it("takes a model's knowledge the user verified as confirmed", () => {
        const verified = confirmable(
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
                    confirmable(
                        { origin: "dorothy", by: "dorothy" },
                        { foreign: { verified } },
                    ),
                ),
            ).toBe(false);
        }
    });
});

describe("parseFact and the links in a body", () => {
    const withBody = (body: string) =>
        parseFact(CANONICAL.replace("Asked for tea twice.", body), "likes-tea");

    it.each([
        ["a title", '[x](../personal/a.md "title")'],
        ["a title in single quotes", "[x](../personal/a.md 'title')"],
        ["a title in parentheses", "[x](../personal/a.md (title))"],
        ["angle brackets", "[x](<../personal/a.md>)"],
        ["angle brackets and a title", '[x](<../personal/a.md> "title")'],
        ["an upper-case extension", "[x](../personal/a.MD)"],
        ["an anchor", "[x](../personal/a.md#why)"],
        ["spaces inside the parentheses", "[x]( ../personal/a.md )"],
        ["a reference definition", "[x][1]\n\n[1]: ../personal/a.md"],
        ["a reference definition in angle brackets", "[1]: <../personal/a.md>"],
        ["an indented reference definition", "   [1]: ../personal/a.md 'x'"],
        ["a link that is no sibling", "[x](./sub/a.md)"],
    ])("refuses a link to another scope through %s", (_, body) => {
        expect(withBody(body).kind).toBe("unparseable");
    });

    it.each([
        "[x](./other-fact.md)",
        '[x](./other-fact.md "title")',
        "[x](<./other-fact.md>)",
        "[x](./other-fact.md#why)",
        "[1]: ./other-fact.md",
        "[x](https://example.com/page)",
        "[x](#heading)",
        "[x]: not a definition because it has no colon-space",
    ])("takes the link %p to a fact beside it, or none to a file", (body) => {
        expect(withBody(body).kind).toBe("ok");
    });
});

describe("parseFact and repeated keys", () => {
    const edit = (replace: string, by: string) =>
        parseFact(CANONICAL.replace(replace, by), "likes-tea");

    it.each([
        ["top level", "tags:\n", "type: feedback\ntags:\n"],
        ["in a mapping", "  importance: 7", "  importance: 7\n  importance: 8"],
        [
            "in a nested mapping",
            '    node_type: "memory"',
            '    node_type: "memory"\n    node_type: "other"',
        ],
    ])("refuses a key repeated at the %s", (_, replace, by) => {
        const read = edit(replace, by);
        expect(read.kind).toBe("unparseable");
        expect(read.kind === "unparseable" && read.reason).toContain(
            "repeats the key",
        );
    });

    it.each([
        "metadata: {type: reference, type: feedback}",
        'metadata: {type: reference, "\\u0074ype": feedback}',
        'metadata:\n  type: reference\n  "\\u0074ype": feedback',
        "foreign: [{type: conversation, type: url}]",
        "foreign:\n  - type: conversation\n    type: url",
        "foreign: {nested: {a: one, a: two}}",
    ])("refuses duplicates in supported YAML mappings: %s", (mapping) => {
        const text = CANONICAL.replace(
            "---\n\nAsked",
            `${mapping}\n---\n\nAsked`,
        );
        expect(parseFact(text, "likes-tea").kind).toBe("unparseable");
    });

    it("takes the same key in sibling mappings and list items", () => {
        const text = CANONICAL.replace(
            "---\n\nAsked",
            [
                "verified:",
                "  - by: human:owner",
                `    at: ${LATER}`,
                "  - by: human:other",
                `    at: ${LATER}`,
                "---",
                "",
                "Asked",
            ].join("\n"),
        );
        expect(parseFact(text, "likes-tea").kind).toBe("ok");
    });

    it("takes a block scalar that holds lines like keys", () => {
        const text = CANONICAL.replace(
            "  Prefers tea to coffee in the afternoon.",
            "  note: one\n  note: two",
        );
        expect(parseFact(text, "likes-tea").kind).toBe("ok");
    });

    it("takes a quoted scalar over several lines that holds lines like keys", () => {
        const text = CANONICAL.replace(
            "---\n\nAsked",
            'note: "a\n  type: 1\n  type: 2"\n---\n\nAsked',
        );
        expect(parseFact(text, "likes-tea").kind).toBe("ok");
    });
});

describe("renderFact and wide text", () => {
    it("wraps by the columns the text takes, not by its code points", () => {
        const description = `${"日本語".repeat(12)} ${"日本語".repeat(12)}`;
        const text = renderFact(fact({ description }));
        const lines = text.split("\n");
        const at = lines.indexOf("description: >-");
        const wrapped = lines.slice(at + 1, at + 3);
        expect(wrapped.map((line) => Bun.stringWidth(line))).toEqual([
            2 + 36 * 2,
            2 + 36 * 2,
        ]);
        expect(
            parseFact(text, "likes-tea").kind === "ok" &&
                (parseFact(text, "likes-tea") as { fact: Fact }).fact
                    .description,
        ).toBe(description);
    });

    it("keeps no line past 80 columns", () => {
        const description = Array.from({ length: 12 }, () => "语言文字").join(
            " ",
        );
        for (const line of renderFact(fact({ description })).split("\n")) {
            expect(Bun.stringWidth(line)).toBeLessThanOrEqual(80);
        }
    });
});

describe("parseFact and times", () => {
    it.each([
        "2026-02-31T00:00:00.000Z",
        "2026-04-31T00:00:00.000Z",
        "2026-13-01T00:00:00.000Z",
        "2025-02-29T00:00:00.000Z",
    ])("refuses %s, a day the calendar lacks", (day) => {
        const read = parseFact(CANONICAL.replace(AT, day), "likes-tea");
        expect(read.kind).toBe("unparseable");
    });

    it("takes the last day of a leap February", () => {
        const read = parseFact(
            CANONICAL.replaceAll(AT, "2028-02-29T23:59:59.999Z"),
            "likes-tea",
        );
        expect(read.kind).toBe("ok");
    });
});
