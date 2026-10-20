// vim:set expandtab shiftwidth=4 filetype=typescript:
// SPDX-License-Identifier: GPL-3.0-only

//
//
// ~chewygumxx/dorothy.git
// ::: :/packages/memory/src/projects/export.test.ts
//
//

import { describe, expect, it } from "bun:test";
import { createHash } from "node:crypto";
import {
    type ExportedFact,
    formHash,
    type IndexEntry,
    indexHooks,
    indexTitles,
    isGeneratedIndex,
    nameOfStem,
    parseExported,
    renderExported,
    renderIndex,
} from "./export.js";

// As Claude Code's auto-memory writes a fact, unquoted date and all.
const NATIVE = [
    "---",
    "name: bg-session-force-color",
    'description: "Claude Code background sessions export FORCE_COLOR=3; the user\'s own shell does not"',
    "metadata:",
    "  node_type: memory",
    "  type: reference",
    "  originSessionId: 4a3e48ae-7145-48e9-ace9-ed4dc9f0042f",
    "  modified: 2026-10-04T20:20:14.359Z",
    "---",
    "",
    "Background sessions export it; the shell does not.",
    "",
].join("\n");

const FORM: ExportedFact = {
    name: "bg-session-force-color",
    description:
        "Claude Code background sessions export FORCE_COLOR=3; the user's own shell does not",
    type: "reference",
    extra: {
        node_type: "memory",
        originSessionId: "4a3e48ae-7145-48e9-ace9-ed4dc9f0042f",
        modified: "2026-10-04T20:20:14.359Z",
    },
    body: "Background sessions export it; the shell does not.",
};

describe("parseExported", () => {
    it.each([
        "metadata: {type: reference, type: feedback}",
        'metadata: {type: reference, "\\u0074ype": feedback}',
        'metadata:\n  type: reference\n  "\\u0074ype": feedback',
    ])(
        "rejects duplicate exported keys, including decoded keys: %s",
        (metadata) => {
            const text =
                NATIVE.slice(0, NATIVE.indexOf("metadata:")) +
                `${metadata}\n---\n\nNotes.\n`;
            const read = parseExported(text, "bg-session-force-color");
            expect(read.kind).toBe("unparseable");
            expect(read.kind === "unparseable" && read.reason).toContain(
                "repeats the key",
            );
        },
    );

    it("reads a fact as Claude Code's auto-memory writes one", () => {
        expect(parseExported(NATIVE, "bg-session-force-color")).toEqual({
            kind: "ok",
            form: FORM,
        });
    });

    it("reads back what renderExported writes", () => {
        const text = renderExported(FORM);
        expect(text).toStartWith(
            "---\nname: bg-session-force-color\ndescription: >-\n  Claude Code",
        );
        expect(parseExported(text, "bg-session-force-color")).toEqual({
            kind: "ok",
            form: FORM,
        });
    });

    it.each([
        [
            "a title",
            "metadata:",
            "title: x\nmetadata:",
            "its frontmatter has an unknown key, title",
        ],
        [
            "a numeric description",
            'description: "Claude',
            'description: 1e3\nx: "',
            "its frontmatter has an unknown key, x",
        ],
        ["no frontmatter", "---\nname", "name", "it has no frontmatter"],
        [
            "a name not its stem",
            "name: bg-session-force-color",
            "name: other",
            "its name is other, not its file's, bg-session-force-color",
        ],
    ])("refuses %s", (_, from, to, reason) => {
        expect(
            parseExported(NATIVE.replace(from, to), "bg-session-force-color"),
        ).toEqual({
            kind: "unparseable",
            reason,
        });
    });

    it("refuses a description that YAML reads as a number", () => {
        const text = [
            "---",
            "name: n",
            "description: 1e3",
            "metadata:",
            "  type: project",
            "---",
            "",
            "x",
            "",
        ].join("\n");
        expect(parseExported(text, "n")).toEqual({
            kind: "unparseable",
            reason: "description is not text",
        });
    });
});

// The user's verification, as a repository's file carries it.
const VERIFIED = {
    by: "human:owner",
    at: "2026-10-20T09:30:00.000Z",
    digest: "a".repeat(64),
};

describe("a verification in the exported form", () => {
    it("is written and read back", () => {
        const form = { ...FORM, verified: [VERIFIED] };
        const text = renderExported(form);
        expect(text).toContain(`verified:\n  - ${JSON.stringify(VERIFIED)}\n`);
        expect(parseExported(text, FORM.name)).toEqual({ kind: "ok", form });
    });

    it("is left out of a form with none", () => {
        expect(renderExported({ ...FORM, verified: [] })).toBe(
            renderExported(FORM),
        );
        expect(renderExported(FORM)).not.toContain("verified");
    });

    it.each([
        ["no list", `verified: ${JSON.stringify(VERIFIED)}`],
        [
            "no person's",
            `verified: [${JSON.stringify({ ...VERIFIED, by: "claude-code/opus" })}]`,
        ],
        [
            "no digest",
            `verified: [${JSON.stringify({ ...VERIFIED, digest: "x" })}]`,
        ],
        [
            "no time",
            `verified: [${JSON.stringify({ ...VERIFIED, at: "then" })}]`,
        ],
        [
            "another key",
            `verified: [${JSON.stringify({ ...VERIFIED, more: 1 })}]`,
        ],
        [
            "a hidden character, escaped",
            `verified: [${JSON.stringify(VERIFIED).replace("owner", "ow\\u200bner")}]`,
        ],
    ])("refuses %s", (_, line) => {
        expect(
            parseExported(
                NATIVE.replace("metadata:", `${line}\nmetadata:`),
                FORM.name,
            ),
        ).toEqual({
            kind: "unparseable",
            reason: "verified is not a list of the user's verifications",
        });
    });
});

describe("formHash", () => {
    it("hashes the content, not how it is written", () => {
        expect(formHash(FORM)).toMatch(/^[0-9a-f]{64}$/);
        const read = parseExported(renderExported(FORM), FORM.name);
        expect(read.kind === "ok" && formHash(read.form)).toBe(formHash(FORM));
        const reordered = {
            ...FORM,
            extra: {
                modified: FORM.extra.modified as string,
                node_type: "memory",
                originSessionId: FORM.extra.originSessionId as string,
            },
        };
        expect(formHash(reordered)).toBe(formHash(FORM));
    });

    it("changes with the content", () => {
        expect(formHash({ ...FORM, body: "Other." })).not.toBe(formHash(FORM));
        expect(formHash({ ...FORM, type: "project" })).not.toBe(formHash(FORM));
        expect(formHash({ ...FORM, verified: [VERIFIED] })).not.toBe(
            formHash(FORM),
        );
    });

    it("hashes a form without verifications as it always has", () => {
        const before = createHash("sha256")
            .update(
                JSON.stringify([
                    FORM.name,
                    FORM.description,
                    FORM.type,
                    Object.entries(FORM.extra).sort(([a], [b]) =>
                        a < b ? -1 : 1,
                    ),
                    FORM.body,
                ]),
            )
            .digest("hex");
        expect(formHash(FORM)).toBe(before);
        expect(formHash({ ...FORM, verified: [] })).toBe(before);
    });
});

const entry = (name: string, fields: Partial<IndexEntry> = {}): IndexEntry => ({
    name,
    title: name,
    description: `About ${name}.`,
    importance: null,
    created: "2026-10-15T00:00:00.000Z",
    ...fields,
});

describe("renderIndex", () => {
    it("lists facts as they were created, each description wrapped beneath", () => {
        const { text, omitted } = renderIndex([
            entry("b", {
                title: "Bee [2]",
                created: "2026-10-02T00:00:00.000Z",
            }),
            entry("a", {
                title: "Ay",
                description: `${"word ".repeat(20)}end`,
                created: "2026-10-01T00:00:00.000Z",
            }),
        ]);
        expect(omitted).toBe(0);
        expect(text).toBe(
            [
                "- [Ay](./a.md)",
                `  ${"word ".repeat(15).trimEnd()}`,
                `  ${"word ".repeat(5)}end`,
                "- [Bee \\[2\\]](./b.md)",
                "  About b.",
                "",
            ].join("\n"),
        );
    });

    it("keeps within 200 lines, the most important first", () => {
        const entries = Array.from({ length: 150 }, (_, at) =>
            entry(`f-${String(at).padStart(3, "0")}`, {
                importance: at >= 140 ? 9 : null,
                created: new Date(Date.UTC(2026, 9, 1, 0, at)).toISOString(),
            }),
        );
        const { text, omitted } = renderIndex(entries);
        expect(omitted).toBe(50);
        expect(text.split("\n").length - 1).toBe(200);
        for (let at = 140; at < 150; at++) {
            expect(text).toContain(`./f-${at}.md`);
        }
    });

    it("keeps within 25,000 bytes", () => {
        const entries = Array.from({ length: 60 }, (_, at) =>
            entry(`f-${at}`, { description: "日".repeat(160) }),
        );
        const { text, omitted } = renderIndex(entries);
        expect(omitted).toBeGreaterThan(0);
        expect(Buffer.byteLength(text)).toBeLessThanOrEqual(25_000);
    });

    it("is empty for no facts", () => {
        expect(renderIndex([])).toEqual({ text: "", omitted: 0 });
    });
});

describe("indexTitles", () => {
    it("reads each entry's title by its fact's name", () => {
        const titles = indexTitles(
            [
                "- [Background sessions force colour](./bg-session-force-color.md)",
                "  `--bg` sessions export FORCE_COLOR=3",
                "- [Bee \\[2\\]](./b.md)",
                "Some prose.",
            ].join("\n"),
        );
        expect([...titles]).toEqual([
            ["bg-session-force-color", "Background sessions force colour"],
            ["b", "Bee [2]"],
        ]);
    });

    it("reads Claude Code's one-line entries and either bullet", () => {
        const titles = indexTitles(
            [
                "- [Testing feedback](feedback-testing.md) \u2014 run the suite",
                "* [Starred](./starred.md): with a hook",
                "- [Plain](plain.md)",
            ].join("\n"),
        );
        expect([...titles]).toEqual([
            ["feedback-testing", "Testing feedback"],
            ["starred", "Starred"],
            ["plain", "Plain"],
        ]);
    });
});

describe("isGeneratedIndex", () => {
    it("takes what renderIndex writes, and nothing a hand adds", () => {
        const { text } = renderIndex([
            {
                name: "a",
                title: "Ay",
                description: "First fact.",
                importance: null,
                created: "2026-10-15T09:30:00.000Z",
            },
        ]);
        expect(isGeneratedIndex(text)).toBe(true);
        expect(isGeneratedIndex("")).toBe(true);
        expect(isGeneratedIndex(`${text}\n\n`)).toBe(true);
        expect(isGeneratedIndex(`# Memory\n${text}`)).toBe(false);
        expect(isGeneratedIndex(`${text}Some prose.\n`)).toBe(false);
        expect(isGeneratedIndex(`  orphan\n${text}`)).toBe(false);
        expect(isGeneratedIndex("- [A](./a.md) - and more\n")).toBe(false);
    });

    it("takes no paragraph after a blank line, nor a nested list", () => {
        const entry = "- [A](./a.md)\n  First fact.\n";
        expect(isGeneratedIndex(`${entry}\n  A hand's paragraph.\n`)).toBe(
            false,
        );
        for (const nested of ["  - see also", "  * see also", "  1. step"]) {
            expect(isGeneratedIndex(`${entry}${nested}\n`)).toBe(false);
        }
        expect(isGeneratedIndex(`${entry}    deeper\n`)).toBe(false);
        expect(isGeneratedIndex(`${entry}\n- [B](./b.md)\n  Two.\n`)).toBe(
            true,
        );
    });

    it("takes back an index whose description wraps onto a marker", () => {
        for (const marker of ["-", "+", "1.", "2)"]) {
            const description = `${"x".repeat(77)} ${marker} more`;
            const { text } = renderIndex([
                {
                    name: "a",
                    title: "Ay",
                    description,
                    importance: null,
                    created: "2026-10-15T09:30:00.000Z",
                },
            ]);
            const lines = text.split("\n");
            expect(lines[2]?.startsWith("  ")).toBe(true);
            expect(lines[2]).toContain("\\");
            expect(lines.every((line) => line.length <= 80)).toBe(true);
            expect(isGeneratedIndex(text)).toBe(true);
        }
    });
});

describe("renderIndex and wide text", () => {
    it("wraps a description by columns, as a terminal shows it", () => {
        const word = "日本語".repeat(12);
        const { text } = renderIndex([
            entry("a", { description: `${word} ${word}` }),
        ]);
        const lines = text.split("\n").slice(1, 3);
        expect(lines).toEqual([`  ${word}`, `  ${word}`]);
    });
});

describe("snake-case files", () => {
    it.each([
        ["feedback_testing", "feedback-testing"],
        ["a_b_c", "a-b-c"],
        ["plain", "plain"],
        ["kebab-case", "kebab-case"],
        ["mixed_kebab-case", "mixed-kebab-case"],
        ["Feedback_Testing", null],
        ["double__score", null],
        ["_leading", null],
        ["1_up", null],
        ["null", null],
    ])("names the fact of the file %p as %p", (stem, name) => {
        expect(nameOfStem(stem)).toBe(name);
    });

    it("reads a file in snake case, its frontmatter naming either", () => {
        for (const name of ["feedback_testing", "feedback-testing"]) {
            const read = parseExported(
                NATIVE.replace("bg-session-force-color", name),
                "feedback_testing",
            );
            expect(read).toMatchObject({
                kind: "ok",
                form: { name: "feedback-testing" },
            });
        }
    });

    it("refuses a file whose frontmatter names another fact", () => {
        expect(
            parseExported(
                NATIVE.replace("bg-session-force-color", "other-fact"),
                "feedback_testing",
            ),
        ).toEqual({
            kind: "unparseable",
            reason: "its name is other-fact, not its file's, feedback-testing",
        });
    });

    it("reads titles and hooks by the file's stem, and takes the index as generated", () => {
        const text = [
            "- [Testing](./feedback_testing.md)",
            "  A hook",
            "  on two lines.",
            "- [Bee](./b.md)",
            "  Another.",
            "",
        ].join("\n");
        expect(isGeneratedIndex(text)).toBe(true);
        expect([...indexTitles(text)]).toEqual([
            ["feedback_testing", "Testing"],
            ["b", "Bee"],
        ]);
        expect([...indexHooks(text)]).toEqual([
            ["feedback_testing", ["A hook", "on two lines."]],
            ["b", ["Another."]],
        ]);
    });

    it("links an entry to its file, and keeps a hook in place of the description", () => {
        const { text } = renderIndex([
            {
                ...entry("feedback-testing", { title: "Testing" }),
                file: "feedback_testing",
                hook: ["A hand's hook", "on two lines."],
            },
        ]);
        expect(text).toBe(
            "- [Testing](./feedback_testing.md)\n  A hand's hook\n  on two lines.\n",
        );
    });
});
