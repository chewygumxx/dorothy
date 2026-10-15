// vim:set expandtab shiftwidth=4 filetype=typescript:
// SPDX-License-Identifier: GPL-3.0-only

//
//
// ~chewygumxx/dorothy.git
// ::: :/packages/memory/src/projects/export.test.ts
//
//

import { describe, expect, it } from "bun:test";
import {
    type ExportedFact,
    formHash,
    type IndexEntry,
    indexTitles,
    isGeneratedIndex,
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
});
