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
            persona: "chat",
        });
    });

    it("opens the TUI with no argv in a terminal", () => {
        expect(parseArgs([], true)).toEqual({
            kind: "tui",
            resume: null,
            persona: "chat",
        });
    });

    it("refuses the TUI without a terminal", () => {
        expect(parseArgs([], false).kind).toBe("usage");
    });

    it("resumes a valid phrase in a terminal", () => {
        expect(parseArgs(["--resume", phrase], true)).toEqual({
            kind: "tui",
            resume: phrase,
            persona: "chat",
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

    it("lists the tags", () => {
        expect(parseArgs(["--tags"], false)).toEqual({ kind: "tags" });
        expect(parseArgs(["--tags", "x"], true)).toEqual({
            kind: "usage",
            message: "--tags takes no arguments",
        });
    });

    it("edits the tags in a terminal only", () => {
        expect(parseArgs(["--edit-tags"], true)).toEqual({ kind: "tags-edit" });
        expect(parseArgs(["--edit-tags"], false)).toEqual({
            kind: "usage",
            message: "--edit-tags needs a terminal",
        });
        expect(parseArgs(["--edit-tags", "x"], true)).toEqual({
            kind: "usage",
            message: "--edit-tags takes no arguments",
        });
    });

    it("parses history's commands", () => {
        expect(parseArgs(["--history"], false)).toEqual({
            kind: "history",
            path: null,
            count: 20,
        });
        expect(parseArgs(["--history", "tags.json", "-n", "5"], false)).toEqual(
            {
                kind: "history",
                path: "tags.json",
                count: 5,
            },
        );
        expect(parseArgs(["--history", "-n", "0"], false)).toEqual({
            kind: "usage",
            message: "--history takes [<path>] [-n <count>]",
        });
        expect(parseArgs(["--restore", "tags.json"], false)).toEqual({
            kind: "restore",
            path: "tags.json",
            rev: null,
        });
        expect(parseArgs(["--restore", "tags.json", "3f9a2c1"], false)).toEqual(
            {
                kind: "restore",
                path: "tags.json",
                rev: "3f9a2c1",
            },
        );
        expect(parseArgs(["--restore"], false)).toEqual({
            kind: "usage",
            message: "--restore takes <path> [<rev>]",
        });
        expect(parseArgs(["--rollback", "3f9a2c1"], false)).toEqual({
            kind: "rollback",
            rev: "3f9a2c1",
        });
        expect(parseArgs(["--rollback"], false)).toEqual({
            kind: "usage",
            message: "--rollback takes one revision",
        });
        expect(parseArgs(["--check"], false)).toEqual({
            kind: "check",
            staged: false,
        });
        expect(parseArgs(["--check", "--staged"], false)).toEqual({
            kind: "check",
            staged: true,
        });
        expect(parseArgs(["--check", "x"], false)).toEqual({
            kind: "usage",
            message: "--check takes only --staged",
        });
        expect(parseArgs(["--mirror"], false)).toEqual({
            kind: "mirror",
            url: null,
        });
        expect(parseArgs(["--mirror", "/mnt/m.git"], false)).toEqual({
            kind: "mirror",
            url: "/mnt/m.git",
        });
        expect(parseArgs(["--recover", "/mnt/m.git"], false)).toEqual({
            kind: "recover",
            url: "/mnt/m.git",
        });
        expect(parseArgs(["--recover"], false)).toEqual({
            kind: "usage",
            message: "--recover takes one url or path",
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
            persona: "chat",
        });
        expect(parseArgs(["--"], true)).toEqual({
            kind: "tui",
            resume: null,
            persona: "chat",
        });
    });

    it("leaves options after the first word in the prompt", () => {
        expect(parseArgs(["what", "does", "--force", "do?"], false)).toEqual({
            kind: "oneshot",
            prompt: "what does --force do?",
            persona: "chat",
        });
    });

    it("refuses --resume without a terminal", () => {
        expect(parseArgs(["--resume", phrase], false).kind).toBe("usage");
    });

    it("serves recall, terminal or not, with or without an exclusion", () => {
        expect(parseArgs(["--recall-server"], false)).toEqual({
            kind: "recall-server",
            exclude: null,
            recollect: false,
        });
        expect(
            parseArgs(["--recall-server", "--exclude", phrase], true),
        ).toEqual({
            kind: "recall-server",
            exclude: phrase,
            recollect: false,
        });
    });

    it("serves recollect when asked, with a phrase", () => {
        expect(
            parseArgs(
                ["--recall-server", "--exclude", phrase, "--recollect"],
                false,
            ),
        ).toEqual({ kind: "recall-server", exclude: phrase, recollect: true });
        for (const rest of [
            ["--recollect"],
            ["--exclude", phrase, "--other"],
            ["--exclude", phrase, "--recollect", "x"],
        ]) {
            expect(parseArgs(["--recall-server", ...rest], false)).toEqual({
                kind: "usage",
                message:
                    "--recall-server takes only --exclude <phrase> [--recollect]",
            });
        }
    });

    it("puts chat, a resumed chat or one reply in development mode", () => {
        expect(parseArgs(["--dev"], true)).toEqual({
            kind: "tui",
            resume: null,
            persona: "development",
        });
        expect(parseArgs(["--dev", "--resume", phrase], true)).toEqual({
            kind: "tui",
            resume: phrase,
            persona: "development",
        });
        expect(parseArgs(["--dev", "who", "are", "you?"], false)).toEqual({
            kind: "oneshot",
            prompt: "who are you?",
            persona: "development",
        });
    });

    it.each([
        [["--dev", "--list"]],
        [["--dev", "--memory", phrase]],
        [["--dev", "--dev"]],
    ])("refuses --dev before anything but chat or a prompt: %p", (argv) => {
        expect(parseArgs(argv, true)).toEqual({
            kind: "usage",
            message: "--dev applies only to chat, a prompt or --dump-context",
        });
    });

    it("dumps the context, terminal or not, with a message or without", () => {
        expect(parseArgs(["--dump-context"], false)).toEqual({
            kind: "dump",
            resume: null,
            message: "hi",
            persona: "chat",
        });
        expect(
            parseArgs(
                ["--dump-context", "--resume", phrase, "what", "now?"],
                false,
            ),
        ).toEqual({
            kind: "dump",
            resume: phrase,
            message: "what now?",
            persona: "chat",
        });
        expect(
            parseArgs(["--dev", "--dump-context", "--", "-v?"], false),
        ).toEqual({
            kind: "dump",
            resume: null,
            message: "-v?",
            persona: "development",
        });
    });

    it.each([
        [["--dump-context", "--resume"]],
        [["--dump-context", "--resume", "nope"]],
        [["--dump-context", "--verbose"]],
    ])("rejects %p", (argv) => {
        expect(parseArgs(argv, false)).toEqual({
            kind: "usage",
            message: "--dump-context takes [--resume <phrase>] [message...]",
        });
    });

    it("refuses anything else after --recall-server", () => {
        for (const rest of [["x"], ["--exclude"], ["--exclude", "nope"]]) {
            expect(parseArgs(["--recall-server", ...rest], false)).toEqual({
                kind: "usage",
                message:
                    "--recall-server takes only --exclude <phrase> [--recollect]",
            });
        }
    });
});
