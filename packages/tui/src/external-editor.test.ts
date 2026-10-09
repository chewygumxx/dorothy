// vim:set expandtab shiftwidth=4 filetype=typescript:
// SPDX-License-Identifier: GPL-3.0-only

//
//
// ~chewygumxx/dorothy.git
// ::: :/packages/tui/src/external-editor.test.ts
//
//

import { describe, expect, it } from "bun:test";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { editInEditor, editorCommand } from "./external-editor.js";

describe("editInEditor", () => {
    it("returns what the editor saved, less one trailing newline", async () => {
        expect(await editInEditor("abc", "sed -i 's/a/b/'")).toEqual({
            ok: true,
            text: "bbc",
        });
        expect(await editInEditor("", "printf 'one\\ntwo\\n\\n' >")).toEqual({
            ok: true,
            text: "one\ntwo\n",
        });
    });

    it("reports an editor that fails or is missing", async () => {
        expect(await editInEditor("abc", "false")).toEqual({
            ok: false,
            message: "editor exited with 1",
        });
        // The redirect keeps sh's "not found" out of the test output.
        expect(
            await editInEditor("abc", "no-such-editor-for-dorothy 2>/dev/null"),
        ).toEqual({ ok: false, message: "editor exited with 127" });
    });

    it("writes a private file and removes it afterwards", async () => {
        const dir = await mkdtemp(join(tmpdir(), "dorothy-test-"));
        const out = join(dir, "out");
        try {
            // ls -l's mode string is POSIX, where stat's flags are not.
            await editInEditor(
                "x",
                `{ ls -l "$1"; printf '%s\\n' "$1"; } > '${out}'; true`,
            );
            const [listing = "", path = ""] = (await readFile(out, "utf8"))
                .trim()
                .split("\n");
            expect(listing.slice(0, 10)).toBe("-rw-------");
            expect(existsSync(path)).toBe(false);
        } finally {
            await rm(dir, { recursive: true, force: true });
        }
    });
});

describe("editorCommand", () => {
    it("prefers VISUAL, then EDITOR, then vi", () => {
        expect(editorCommand({ VISUAL: "a", EDITOR: "b" })).toBe("a");
        expect(editorCommand({ EDITOR: "b" })).toBe("b");
        expect(editorCommand({ VISUAL: "" })).toBe("vi");
        expect(editorCommand({})).toBe("vi");
    });
});
