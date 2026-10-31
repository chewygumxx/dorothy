// vim:set expandtab shiftwidth=4 filetype=typescript:
// SPDX-License-Identifier: GPL-3.0-only

//
//
// ~chewygumxx/dorothy.git
// ::: :/packages/cli/src/self.test.ts
//
//

import { expect, it } from "bun:test";
import { mainEntry, shellWord } from "./self.js";

it("quotes a word for a shell", () => {
    expect(shellWord("it's")).toBe(`'it'\\''s'`);
});

it("finds the main checkout's entry from a worktree", () => {
    const git = (args: string[]) =>
        args.includes("--git-common-dir") ? "/home/u/dev/dorothy/.git" : null;
    expect(
        mainEntry(
            "/home/u/dev/_worktree/dorothy/x/packages/cli/src/index.ts",
            (args) =>
                args.includes("--show-toplevel")
                    ? "/home/u/dev/_worktree/dorothy/x"
                    : git(args),
        ),
    ).toBe("/home/u/dev/dorothy/packages/cli/src/index.ts");
});

it("answers null outside a repository", () => {
    expect(mainEntry("/opt/dorothy/index.ts", () => null)).toBeNull();
});
