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

    it("edits the notes on a valid phrase in a terminal", () => {
        expect(parseArgs(["--memory", phrase], true)).toEqual({
            kind: "memory",
            phrase,
        });
    });

    it.each([
        [["--memory"]],
        [["--memory", "../../etc/passwd"]],
        [["--memory", phrase, "extra"]],
    ])("rejects %p", (argv) => {
        expect(parseArgs(argv, true)).toEqual({
            kind: "usage",
            message: "--memory takes one four-word phrase",
        });
    });

    it("refuses --memory without a terminal", () => {
        expect(parseArgs(["--memory", phrase], false)).toEqual({
            kind: "usage",
            message: "--memory needs a terminal",
        });
    });

    it.each([[["--help"]], [["-h"]]])("shows help for %p", (argv) => {
        expect(parseArgs(argv, false)).toEqual({ kind: "help" });
    });

    it("lists the catalogue, terminal or not", () => {
        expect(parseArgs(["--list"], false)).toEqual({ kind: "list" });
    });

    it("takes nothing after --list", () => {
        expect(parseArgs(["--list", "x"], true)).toEqual({
            kind: "usage",
            message: "--list takes no arguments",
        });
    });

    it.each([[["--resme", phrase]], [["-v"]], [["--model", "x", "hi"]]])(
        "takes no unknown option, so %p costs nothing",
        (argv) => {
            expect(parseArgs(argv, true)).toEqual({
                kind: "usage",
                message: `unknown option ${argv[0]}`,
            });
        },
    );

    it("takes the words after -- as the prompt, dashes included", () => {
        expect(parseArgs(["--", "-v", "means?"], false)).toEqual({
            kind: "oneshot",
            prompt: "-v means?",
        });
        expect(parseArgs(["--"], true)).toEqual({ kind: "tui", resume: null });
    });

    it("leaves options after the first word in the prompt", () => {
        expect(parseArgs(["what", "does", "--force", "do?"], false)).toEqual({
            kind: "oneshot",
            prompt: "what does --force do?",
        });
    });

    it("refuses --resume without a terminal", () => {
        expect(parseArgs(["--resume", phrase], false).kind).toBe("usage");
    });
});
