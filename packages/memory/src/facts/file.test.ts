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
    FACT_NAME,
    type Fact,
    handEdited,
    hiddenCharacter,
    nextOrigin,
    parseFact,
    renderFact,
    wrap,
} from "./file.js";

const AT = "2026-10-15T09:30:00.000Z";
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
    "name: likes-tea",
    "title: >-",
    "  Likes tea",
    "description: >-",
    "  Prefers tea to coffee in the afternoon.",
    "metadata:",
    "  type: user",
    '  node_type: "memory"',
    "tags:",
    "  - k1a2b3c4d",
    "importance: 7",
    "provenance:",
    "  origin: user",
    "  by: dorothy",
    `  at: "${AT}"`,
    `  created: "${AT}"`,
    '  model: "claude-opus-5-5"',
    `  from: "${PHRASE}#12"`,
    "---",
    "",
    "Asked for tea twice.",
    "",
].join("\n");

describe("renderFact", () => {
    it("writes the keys in order, free text in >- blocks, the rest as JSON", () => {
        expect(
            renderFact(
                fact({
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
                }),
            ),
        ).toBe(CANONICAL);
    });

    it("wraps free text at 80 columns", () => {
        const description = `${"word ".repeat(31)}end`;
        const text = renderFact(fact({ description }));
        for (const line of text.split("\n")) {
            expect(line.length).toBeLessThanOrEqual(80);
        }
        expect(parseFact(text, "likes-tea")).toEqual({
            kind: "ok",
            fact: fact({ description }),
        });
    });

    it("writes a retirement after provenance", () => {
        const text = renderFact(
            fact({ retired: { at: AT, by: "user", why: "No longer true." } }),
        );
        expect(text).toContain(
            `retired:\n  at: "${AT}"\n  by: user\n  why: >-\n    No longer true.\n---`,
        );
    });
});

// A small, seeded generator, so a failure reproduces.
function random(seed: number): () => number {
    let state = seed;
    return () => {
        state = (state + 0x6d2b79f5) | 0;
        let t = Math.imul(state ^ (state >>> 15), 1 | state);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

const PIECES = [
    "null",
    "~",
    "no",
    "yes",
    "1e3",
    "0o17",
    "true",
    ":",
    "a: b",
    " #",
    "#",
    "*x",
    "&y",
    "!z",
    "[",
    "]",
    "{",
    "}",
    "|",
    ">",
    "'",
    '"',
    "\\",
    "-",
    "---",
    "%",
    "@",
    "`",
    "é",
    "日本",
    "😀",
    "word",
    "tea",
    "",
];

const NAMES = [
    "likes-tea",
    "a",
    "x1",
    "tea-2",
    "nullable",
    "true-story",
    "falsehood",
    "a-1-b-2",
    "z".repeat(64),
];
const TAGS = ["k1a2b3c4d", "k00000000", "kffffffff", "k1e300000"];
const KEYS = [
    "node_type",
    "_x",
    "A-b",
    "source",
    "k1",
    "Nullable",
    "trueish",
    "falsey",
    "NULLS",
];

describe("FACT_NAME", () => {
    it.each(["123", "0", "1e3", "0x1f", "0o17", "null", "true", "false"])(
        "refuses %s, which YAML would not read as text",
        (name) => {
            expect(FACT_NAME.test(name)).toBe(false);
            const text = renderFact(fact({ name }));
            expect(parseFact(text, name).kind).toBe("unparseable");
        },
    );

    it.each(["a", "likes-tea", "null-pointer", "x1", "a-1"])(
        "reads %s back whole",
        (name) => {
            expect(FACT_NAME.test(name)).toBe(true);
            expect(parseFact(renderFact(fact({ name })), name)).toEqual({
                kind: "ok",
                fact: fact({ name }),
            });
        },
    );

    it.each(["1a", "-a", "a-", "a--b", "A", "a_b", ""])(
        "refuses %s",
        (name) => {
            expect(FACT_NAME.test(name)).toBe(false);
        },
    );
});

describe("parseFact", () => {
    it("reads back every field it renders, whatever the text", () => {
        const next = random(42);
        const pick = () => PIECES[Math.floor(next() * PIECES.length)] ?? "";
        const phrase = (count: number) =>
            Array.from({ length: count }, pick).join(" ");
        for (let run = 0; run < 300; run++) {
            const clip = (text: string, limit: number) =>
                [...text].slice(0, limit).join("").trim() || "x";
            const normal = (text: string, limit: number) =>
                clip(text.replace(/\s+/g, " ").trim(), limit);
            const written = fact({
                name: NAMES[run % NAMES.length] as string,
                tags: TAGS.slice(0, run % (TAGS.length + 1)),
                title: normal(phrase(8), 60),
                description: normal(phrase(30), 160),
                extra: {
                    note: phrase(5),
                    count: run,
                    flag: run % 2 === 0,
                    [KEYS[run % KEYS.length] as string]: "v",
                },
                provenance: {
                    origin: "dorothy",
                    by: "review",
                    at: AT,
                    created: AT,
                    model: `m ${phrase(2)}`,
                },
                retired:
                    run % 3 === 0
                        ? { at: AT, by: "user", why: normal(phrase(10), 160) }
                        : null,
                body: Array.from({ length: 4 }, () => phrase(6))
                    .join("\n")
                    .trim(),
            });
            const read = parseFact(renderFact(written), written.name);
            expect(read).toEqual({ kind: "ok", fact: written });
        }
    });

    it("normalises free text written by hand", () => {
        const text = CANONICAL.replace(
            "title: >-\n  Likes tea",
            'title: "Likes   tea "',
        );
        const read = parseFact(text, "likes-tea");
        expect(read.kind === "ok" && read.fact.title).toBe("Likes tea");
    });

    it("reads CRLF line ends as LF", () => {
        const read = parseFact(CANONICAL.replaceAll("\n", "\r\n"), "likes-tea");
        expect(read.kind).toBe("ok");
    });

    const broken: [string, string, string][] = [
        ["a null title", "title: >-\n  Likes tea", "title: null"],
        ["a numeric title", "title: >-\n  Likes tea", "title: 1e3"],
        ["a tilde title", "title: >-\n  Likes tea", "title: ~"],
        ["an octal title", "title: >-\n  Likes tea", "title: 0o17"],
        ["a colon in plain text", "title: >-\n  Likes tea", "title: a: b"],
        ["importance as text", "importance: 7", 'importance: "7"'],
        ["importance out of range", "importance: 7", "importance: 11"],
        ["an unknown type", "  type: user", "  type: notes"],
        ["a nested extra", '  node_type: "memory"', "  node_type:\n    a: 1"],
        ["a name not its stem", "name: likes-tea", "name: other"],
        ["an unknown key", "importance: 7", "importance: 7\ncolor: blue"],
        ["an unknown origin", "  origin: user", "  origin: owner"],
        ["a time that is not one", `  at: "${AT}"`, '  at: "yesterday"'],
        ["a from that is no phrase", `  from: "${PHRASE}#12"`, '  from: "x"'],
        ["a tag that is no concept", "  - k1a2b3c4d", "  - tea"],
        [
            "an unknown provenance key",
            "  origin: user\n",
            "  origin: user\n  extra: 1\n",
        ],
    ];

    it.each(broken)("refuses %s", (_, from, to) => {
        const text = CANONICAL.replace(from, to);
        expect(text).not.toBe(CANONICAL);
        expect(parseFact(text, "likes-tea").kind).toBe("unparseable");
    });

    it("refuses a fact with no provenance", () => {
        const text = CANONICAL.replace(/provenance:\n(?: {2}.*\n)+/, "");
        expect(text).not.toContain("provenance");
        expect(parseFact(text, "likes-tea")).toEqual({
            kind: "unparseable",
            reason: "provenance is not a mapping",
        });
    });

    it("refuses a fact with no frontmatter, or none closed", () => {
        expect(parseFact("Just text.\n", "likes-tea").kind).toBe("unparseable");
        expect(parseFact("---\nname: likes-tea\n", "likes-tea").kind).toBe(
            "unparseable",
        );
    });

    it("refuses hidden and control characters anywhere", () => {
        for (const hidden of [
            "\u200b",
            "\u202e",
            "\u0007",
            "\ufeff",
            "\u{e0041}",
        ]) {
            const text = CANONICAL.replace("twice.", `twice.${hidden}`);
            const read = parseFact(text, "likes-tea");
            expect(read.kind).toBe("unparseable");
        }
    });

    it("refuses hidden characters spelled as YAML escapes", () => {
        const escapes: [string, string, string][] = [
            ["title", "title: >-\n  Likes tea", 'title: "Likes\\u202etea"'],
            [
                "description",
                "description: >-\n  Prefers tea to coffee in the afternoon.",
                'description: "Prefers\\u200btea"',
            ],
            ["extra", '  node_type: "memory"', '  node_type: "a\\u0007b"'],
            ["model", '  model: "claude-opus-5-5"', '  model: "m\\u2028"'],
        ];
        for (const [, from, to] of escapes) {
            const text = CANONICAL.replace(from, to);
            expect(text).not.toBe(CANONICAL);
            expect(text).not.toContain("\u202e");
            expect(parseFact(text, "likes-tea").kind).toBe("unparseable");
            expect(handEdited(text, "likes-tea", new Date(AT))).toBeNull();
        }
        const retired = renderFact(
            fact({ retired: { at: AT, by: "user", why: "No longer true." } }),
        ).replace("why: >-\n    No longer true.", 'why: "No\\u202elonger"');
        expect(parseFact(retired, "likes-tea").kind).toBe("unparseable");
    });

    it("refuses a time that is not the form the store writes", () => {
        for (const at of [
            "1",
            "2026",
            "May 5",
            "2026-10-15",
            "2026-10-15T09:30:00Z",
        ]) {
            const text = CANONICAL.replace(`  at: "${AT}"`, `  at: "${at}"`);
            expect(parseFact(text, "likes-tea").kind).toBe("unparseable");
        }
    });

    it.each(["null", "Null", "NULL", "true", "TRUE", "False", "false"])(
        "refuses a metadata key of %s, which YAML would not read as itself",
        (key) => {
            const text = CANONICAL.replace(
                '  node_type: "memory"',
                `  ${key}: "memory"`,
            );
            expect(parseFact(text, "likes-tea").kind).toBe("unparseable");
        },
    );

    it("refuses a metadata key of __proto__", () => {
        const text = CANONICAL.replace(
            '  node_type: "memory"',
            '  __proto__: "x"',
        );
        expect(parseFact(text, "likes-tea").kind).toBe("unparseable");
    });

    it("refuses a body over 8,000 characters", () => {
        const text = renderFact(fact({ body: "x".repeat(8001) }));
        expect(parseFact(text, "likes-tea")).toEqual({
            kind: "unparseable",
            reason: "its body is 8001 characters, over 8000",
        });
    });

    it("refuses a link to a fact outside its directory", () => {
        for (const link of [
            "../other.md",
            "/etc/x.md",
            "sub/x.md",
            "./Bad.md",
        ]) {
            const text = renderFact(fact({ body: `See [it](${link}).` }));
            expect(parseFact(text, "likes-tea").kind).toBe("unparseable");
        }
        const ok = renderFact(fact({ body: "See [it](./other-fact.md#why)." }));
        expect(parseFact(ok, "likes-tea").kind).toBe("ok");
    });
});

describe("hiddenCharacter", () => {
    it.each([
        ["a control", "\u0007", "U+0007"],
        ["a carriage return", "\r", "U+000D"],
        ["a zero width space", "\u200b", "U+200B"],
        ["a joiner", "\u200d", "U+200D"],
        ["a non-joiner", "\u200c", "U+200C"],
        ["a soft hyphen", "\u00ad", "U+00AD"],
        ["a bidirectional override", "\u202e", "U+202E"],
        ["a tag", "\u{e0041}", "U+E0041"],
        ["a variation selector", "\ufe0f", "U+FE0F"],
        ["a supplementary variation selector", "\u{e0100}", "U+E0100"],
        ["the Hangul filler", "\u3164", "U+3164"],
        ["a line separator", "\u2028", "U+2028"],
        ["a paragraph separator", "\u2029", "U+2029"],
        ["a byte order mark", "\ufeff", "U+FEFF"],
    ])("names %s", (_, character, name) => {
        expect(hiddenCharacter(`a${character}b`)).toBe(name);
    });

    it("lets ordinary and non-Latin text through", () => {
        expect(hiddenCharacter("tea é 日本 😀 \u00a0")).toBeNull();
    });

    it("names the first hidden character, and allows tab and newline", () => {
        expect(hiddenCharacter("a\tb\nc")).toBeNull();
        expect(hiddenCharacter("a\u200bb")).toBe("U+200B");
    });
});

describe("wrap", () => {
    it("keeps a word longer than the width whole, on a line of its own", () => {
        expect(wrap(`a ${"x".repeat(90)} b`, 78)).toEqual([
            "a",
            "x".repeat(90),
            "b",
        ]);
    });
});

describe("handEdited", () => {
    const now = new Date("2026-10-16T08:00:00.000Z");

    it("fills in a hand-added fact's provenance as the user's", () => {
        const text = [
            "---",
            "name: likes-tea",
            "title: Likes tea",
            "description: Prefers tea.",
            "metadata:",
            "  type: user",
            "---",
            "",
            "Tea.",
            "",
        ].join("\n");
        const canonical = handEdited(text, "likes-tea", now);
        expect(canonical).not.toBeNull();
        const read = parseFact(canonical as string, "likes-tea");
        expect(read.kind === "ok" && read.fact.provenance).toEqual({
            origin: "user",
            by: "user",
            at: now.toISOString(),
            created: now.toISOString(),
        });
    });

    it("keeps when a fact was created and where it came from", () => {
        const edited = renderFact(
            fact({
                body: "Tea, always.",
                provenance: {
                    origin: "external",
                    by: "review",
                    at: AT,
                    created: AT,
                    model: "m",
                    from: `${PHRASE}#3`,
                },
            }),
        );
        const read = parseFact(
            handEdited(edited, "likes-tea", now) as string,
            "likes-tea",
        );
        expect(read.kind === "ok" && read.fact.provenance).toEqual({
            origin: "user",
            by: "user",
            at: now.toISOString(),
            created: AT,
            from: `${PHRASE}#3`,
        });
    });

    it("gives null for a file that is no fact", () => {
        expect(handEdited("Just text.\n", "likes-tea", now)).toBeNull();
    });
});

describe("nextOrigin", () => {
    it("lets a later writer lower a fact's origin but not raise it", () => {
        expect(nextOrigin(null, "dorothy", "dorothy")).toBe("dorothy");
        expect(nextOrigin("user", "external", "review")).toBe("external");
        expect(nextOrigin("external", "dorothy", "dorothy")).toBe("external");
        expect(nextOrigin("repo", "dorothy", "review")).toBe("repo");
    });

    it("makes a version the user writes the user's", () => {
        expect(nextOrigin("external", "external", "user")).toBe("user");
    });
});
