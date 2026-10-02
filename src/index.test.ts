// vim:set expandtab shiftwidth=4 filetype=typescript:
// SPDX-License-Identifier: GPL-3.0-only

//
//
// ~chewygumxx/dorothy.git
// ::: :/src/index.test.ts
//
//

import { describe, expect, it } from "bun:test";
import { parseArgs } from "./index.js";
import { newPhrase } from "./session-id.js";

const phrase = newPhrase(() => Uint8Array.from([1, 2, 3, 4, 5, 6, 7, 8]));

describe("parseArgs", () => {
    it("joins argv into a one-shot prompt, terminal or not", () => {
        expect(parseArgs(["What", "is", "your", "name?"], false)).toEqual({
            kind: "oneshot",
            prompt: "What is your name?",
        });
    });

    it("opens the TUI with no argv in a terminal", () => {
        expect(parseArgs([], true)).toEqual({ kind: "tui", resume: null });
    });

    it("refuses the TUI without a terminal", () => {
        expect(parseArgs([], false).kind).toBe("usage");
    });

    it("resumes a valid phrase in a terminal", () => {
        expect(parseArgs(["--resume", phrase], true)).toEqual({
            kind: "tui",
            resume: phrase,
        });
    });

    it.each([
        [["--resume"]],
        [["--resume", "../../etc/passwd"]],
        [["--resume", phrase.toUpperCase()]],
        [["--resume", phrase, "extra"]],
    ])("rejects %p", (argv) => {
        expect(parseArgs(argv, true).kind).toBe("usage");
    });

    it("refuses --resume without a terminal", () => {
        expect(parseArgs(["--resume", phrase], false).kind).toBe("usage");
    });
});
