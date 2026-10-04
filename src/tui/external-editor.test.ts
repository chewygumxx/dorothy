// vim:set expandtab shiftwidth=4 filetype=typescript:
// SPDX-License-Identifier: GPL-3.0-only

//
//
// ~chewygumxx/dorothy.git
// ::: :/src/tui/external-editor.test.ts
//
//

import { describe, expect, it } from "bun:test";
import { existsSync } from "node:fs";
import { mkdtemp, readFile } from "node:fs/promises";
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
        expect(await editInEditor("abc", "no-such-editor-for-dorothy")).toEqual(
            {
                ok: false,
                message: "editor exited with 127",
            },
        );
    });

    it("writes a private file and removes it afterwards", async () => {
        const out = join(await mkdtemp(join(tmpdir(), "dorothy-test-")), "out");
        await editInEditor("x", `stat -c '%a %n' "$1" > ${out}; true`);
        const [mode, path] = (await readFile(out, "utf8")).trim().split(" ");
        expect(mode).toBe("600");
        expect(existsSync(path ?? "")).toBe(false);
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
