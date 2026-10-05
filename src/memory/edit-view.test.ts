// vim:set expandtab shiftwidth=4 filetype=typescript:
// SPDX-License-Identifier: GPL-3.0-only

//
//
// ~chewygumxx/dorothy.git
// ::: :/src/memory/edit-view.test.ts
//
//

import { describe, expect, it } from "bun:test";
import { parseEditView, renderEditView, wrap } from "./edit-view.js";
import { EMPTY_SIDECAR, type Sidecar } from "./sidecar.js";

const PHRASE = "bingo-overabundance-mazer-kasha";
const AT = "2026-10-05T05:40:12.000Z";
const sidecar: Sidecar = {
    ...EMPTY_SIDECAR,
    title: "Memory and metadata",
    description: "Designing how Dorothy remembers past conversations.",
    abstract:
        "The user, still building Dorothy's TUI, proposed tiered conversation metadata with titles, descriptions and abstracts that fade.",
    titles: [
        { title: "Hey there o/", at: "2026-10-04T05:01:00.000Z", by: "prompt" },
    ],
    fields: {
        title: {
            by: "dorothy",
            model: "claude-opus-5-5",
            at: AT,
            throughTurn: 12,
        },
        description: {
            by: "dorothy",
            model: "claude-opus-5-5",
            at: AT,
            throughTurn: 12,
        },
        abstract: { by: "user", at: "2026-10-05T06:02:00.000Z" },
    },
    reviewedThrough: 12,
};
const view = renderEditView(PHRASE, sidecar);

describe("renderEditView", () => {
    it("renders the notes as a template", () => {
        expect(view).toBe(
            [
                "# Dorothy's notes on bingo-overabundance-mazer-kasha.",
                "# Lines starting with # are ignored. Change a field to make it yours;",
                "# empty it to hand it back to Dorothy. Pinned and Hidden take yes or no.",
                "",
                "Title: Memory and metadata",
                "Pinned: no",
                "Hidden: no",
                "",
                "# Description (Dorothy, claude-opus-5-5, 2026-10-05)",
                "Description:",
                "Designing how Dorothy remembers past conversations.",
                "",
                "# Abstract (yours, 2026-10-05)",
                "Abstract:",
                "The user, still building Dorothy's TUI, proposed tiered conversation",
                "metadata with titles, descriptions and abstracts that fade.",
                "",
                "# Earlier titles:",
                "#   Hey there o/ (provisional, 2026-10-04)",
                "",
            ].join("\n"),
        );
    });

    it("renders empty fields when there are no notes yet", () => {
        const empty = renderEditView(PHRASE, null);
        expect(empty).toContain("\nTitle:\nPinned: no\nHidden: no\n");
        expect(empty).toContain("# Description (empty)\nDescription:\n");
        expect(empty).not.toContain("Earlier titles");
    });
});

describe("wrap", () => {
    it("never starts a line with a field name", () => {
        const lines = wrap(`${"word ".repeat(14)}Title: inside`);
        expect(lines.some((line) => line.startsWith("Title:"))).toBe(false);
    });
});

describe("parseEditView", () => {
    it("finds nothing changed in the template as rendered", () => {
        expect(parseEditView(view, sidecar)).toEqual({ kind: "unchanged" });
    });

    it("finds nothing changed in an emptied file", () => {
        expect(parseEditView("", sidecar)).toEqual({ kind: "unchanged" });
        expect(parseEditView("# a comment\n\n", sidecar)).toEqual({
            kind: "unchanged",
        });
    });

    it("takes an edited title and pin", () => {
        const edited = view
            .replace("Title: Memory and metadata", "Title: Remembering")
            .replace("Pinned: no", "Pinned: YES");
        expect(parseEditView(edited, sidecar)).toEqual({
            kind: "edit",
            changes: { title: "Remembering", pinned: true },
        });
    });

    it("joins a paragraph's lines with single spaces", () => {
        const edited = view.replace(
            "Designing how Dorothy remembers past conversations.",
            "Designing how\n  Dorothy remembers.",
        );
        expect(parseEditView(edited, sidecar)).toEqual({
            kind: "edit",
            changes: { description: "Designing how Dorothy remembers." },
        });
    });

    it("ignores a change only in whitespace, or of where text starts", () => {
        const rewrapped = view
            .replace(
                "tiered conversation\nmetadata",
                "tiered   conversation metadata",
            )
            .replace("Description:\nDesigning", "Description: Designing");
        expect(parseEditView(rewrapped, sidecar)).toEqual({
            kind: "unchanged",
        });
    });

    it("hands back an emptied field as null", () => {
        const edited = view.replace(
            "Designing how Dorothy remembers past conversations.\n",
            "",
        );
        expect(parseEditView(edited, sidecar)).toEqual({
            kind: "edit",
            changes: { description: null },
        });
    });

    it("leaves a field whose line was deleted as it was", () => {
        expect(
            parseEditView(view.replace("Hidden: no\n", ""), sidecar),
        ).toEqual({
            kind: "unchanged",
        });
    });

    it("takes notes for a conversation that had none", () => {
        const empty = renderEditView(PHRASE, null);
        expect(
            parseEditView(empty.replace("Title:", "Title: Mine"), null),
        ).toEqual({ kind: "edit", changes: { title: "Mine" } });
    });

    it("gives back unchanged a note that wraps at a # or a field name", () => {
        const tricky: Sidecar = {
            ...sidecar,
            description: "Title: a note that starts like a field.",
            abstract: `${"word ".repeat(14)}xx #42 is fixed.`,
        };
        expect(
            wrap(tricky.abstract ?? "").some((line) => line.startsWith("#")),
        ).toBe(false);
        expect(parseEditView(renderEditView(PHRASE, tricky), tricky)).toEqual({
            kind: "unchanged",
        });
    });

    it.each([
        [
            "an unknown field",
            view.replace("Hidden: no\n", "Hidden: no\nMood: happy\n"),
            "there is no field Mood",
        ],
        ["a repeated field", `${view}Title: again\n`, "Title appears twice"],
        [
            "a pin that is neither yes nor no",
            view.replace("Pinned: no", "Pinned: maybe"),
            'Pinned takes yes or no, not "maybe"',
        ],
        [
            "a title over its limit",
            view.replace(
                "Title: Memory and metadata",
                `Title: ${"x".repeat(61)}`,
            ),
            "title is 61 characters, over 60",
        ],
        [
            "a line under no field",
            view.replace("Hidden: no\n", "Hidden: no\nstray words\n"),
            '"stray words" is under no field',
        ],
        [
            "a hide that is neither yes nor no",
            view.replace("Hidden: no", "Hidden: perhaps"),
            'Hidden takes yes or no, not "perhaps"',
        ],
        [
            "a repeated paragraph field",
            `${view}Description: again\n`,
            "Description appears twice",
        ],
        [
            "an abstract over its limit",
            renderEditView(PHRASE, null).replace(
                "Abstract:",
                `Abstract: ${"y".repeat(1001)}`,
            ),
            "abstract is 1001 characters, over 1000",
        ],
    ])("refuses %s", (_, text, reason) => {
        expect(parseEditView(text, sidecar)).toEqual({ kind: "error", reason });
    });
});
