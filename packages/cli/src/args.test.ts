// vim:set expandtab shiftwidth=4 filetype=typescript:
// SPDX-License-Identifier: GPL-3.0-only

//
//
// ~chewygumxx/dorothy.git
// ::: :/packages/cli/src/args.test.ts
//
//

import { describe, expect, it } from "bun:test";
import { newPhrase } from "@dorothy/core";
import { parseArgs, USAGE } from "./args.js";

const phrase = newPhrase(() => Uint8Array.from([1, 2, 3, 4, 5, 6, 7, 8]));

const RECALL_USAGE =
    "--recall-server takes [--exclude <phrase> [--recollect]] [--project <root>]";

const HOOK_USAGE =
    "--claude-hook takes [--catch-up <launch> [--session <id>]], --reread or --dismiss <session>";

describe("parseArgs", () => {
    it("hands everything after --claude to claude, terminal or not", () => {
        expect(parseArgs(["--claude"], true)).toEqual({
            kind: "claude",
            args: [],
        });
        expect(
            parseArgs(["--claude", "-p", "--resume", "x", "hi"], false),
        ).toEqual({
            kind: "claude",
            args: ["-p", "--resume", "x", "hi"],
        });
    });

    it("refuses --dev before --claude", () => {
        expect(parseArgs(["--dev", "--claude"], true)).toEqual({
            kind: "usage",
            message: "--dev applies only to chat, a prompt or --dump-context",
        });
    });

    it("lists --claude in the usage", () => {
        expect(USAGE).toContain("dorothy --claude [args...] ");
    });

    it("dumps claude's request, its args before -- and the message after", () => {
        expect(parseArgs(["--claude", "--dump-context"], true)).toEqual({
            kind: "claude-dump",
            args: [],
            message: "hi",
        });
        expect(
            parseArgs(
                [
                    "--claude",
                    "--dump-context",
                    "--model",
                    "sonnet",
                    "--",
                    "Who",
                    "are",
                    "you?",
                ],
                false,
            ),
        ).toEqual({
            kind: "claude-dump",
            args: ["--model", "sonnet"],
            message: "Who are you?",
        });
        expect(
            parseArgs(["--claude", "--dump-context", "--", "--", "-v"], false),
        ).toEqual({ kind: "claude-dump", args: [], message: "-- -v" });
        expect(
            parseArgs(
                ["--claude", "--dump-context", "--model", "x", "--"],
                false,
            ),
        ).toEqual({
            kind: "claude-dump",
            args: ["--model", "x"],
            message: "hi",
        });
    });

    it("refuses --dev before --claude --dump-context", () => {
        expect(
            parseArgs(["--dev", "--claude", "--dump-context"], true),
        ).toEqual({
            kind: "usage",
            message: "--dev applies only to chat, a prompt or --dump-context",
        });
    });

    it("lists --claude --dump-context in the usage", () => {
        expect(USAGE).toContain(
            "dorothy --claude --dump-context [args...] [-- message...]",
        );
    });

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
            project: null,
        });
        expect(
            parseArgs(["--recall-server", "--exclude", phrase], true),
        ).toEqual({
            kind: "recall-server",
            exclude: phrase,
            recollect: false,
            project: null,
        });
    });

    it("serves recollect when asked, with a phrase", () => {
        expect(
            parseArgs(
                ["--recall-server", "--exclude", phrase, "--recollect"],
                false,
            ),
        ).toEqual({
            kind: "recall-server",
            exclude: phrase,
            recollect: true,
            project: null,
        });
        for (const rest of [
            ["--recollect"],
            ["--exclude", phrase, "--other"],
            ["--exclude", phrase, "--recollect", "x"],
        ]) {
            expect(parseArgs(["--recall-server", ...rest], false)).toEqual({
                kind: "usage",
                message: RECALL_USAGE,
            });
        }
    });

    it("takes the recall server's flags in any order", () => {
        expect(
            parseArgs(
                [
                    "--recall-server",
                    "--project",
                    "/r",
                    "--exclude",
                    phrase,
                    "--recollect",
                ],
                false,
            ),
        ).toEqual({
            kind: "recall-server",
            exclude: phrase,
            recollect: true,
            project: "/r",
        });
        expect(
            parseArgs(["--recall-server", "--project", "/r"], false),
        ).toEqual({
            kind: "recall-server",
            exclude: null,
            recollect: false,
            project: "/r",
        });
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

    it("runs Claude Code's hooks, catches up, rereads and dismisses", () => {
        const L = "6c84fb90-12c4-11e1-840d-7b25c5ee775a";
        const S = "0f8fad5b-d9cb-469f-a165-70867728950e";
        const hook = (argv: string[]) =>
            parseArgs(["--claude-hook", ...argv], false);
        expect(hook([])).toEqual({
            kind: "claude-hook",
            hook: { kind: "hook" },
        });
        expect(hook(["--catch-up", L])).toEqual({
            kind: "claude-hook",
            hook: { kind: "catch-up", launch: L, session: null },
        });
        expect(hook(["--catch-up", L, "--session", S])).toEqual({
            kind: "claude-hook",
            hook: { kind: "catch-up", launch: L, session: S },
        });
        expect(hook(["--reread"])).toEqual({
            kind: "claude-hook",
            hook: { kind: "reread" },
        });
        expect(hook(["--dismiss", S])).toEqual({
            kind: "claude-hook",
            hook: { kind: "dismiss", session: S },
        });
        for (const rest of [
            ["--catch-up"],
            ["--catch-up", "../x"],
            ["--catch-up", L, "--session"],
            ["--catch-up", L, "--session", "x"],
            ["--catch-up", L, "--other", S],
            ["--dismiss"],
            ["--dismiss", "x"],
            ["--dismiss", S, "--catch-up", L],
            ["--session", S],
            ["--reread", "x"],
            ["--reread", "--session", S],
            ["--other"],
        ]) {
            expect(hook(rest)).toEqual({ kind: "usage", message: HOOK_USAGE });
        }
    });

    it("takes an option's value after = or run on, as POSIX and GNU do", () => {
        expect(
            parseArgs(["--recall-server", `--exclude=${phrase}`], false),
        ).toEqual({
            kind: "recall-server",
            exclude: phrase,
            recollect: false,
            project: null,
        });
        expect(parseArgs(["--history", "-n5"], false)).toEqual({
            kind: "history",
            path: null,
            count: 5,
        });
        expect(parseArgs(["--retire", `--from=${phrase}`], false)).toEqual({
            kind: "retire-from",
            phrase,
        });
    });

    it("takes a catch-up's session before its launch", () => {
        const L = "6c84fb90-12c4-11e1-840d-7b25c5ee775a";
        const S = "0f8fad5b-d9cb-469f-a165-70867728950e";
        expect(
            parseArgs(
                ["--claude-hook", "--session", S, "--catch-up", L],
                false,
            ),
        ).toEqual({
            kind: "claude-hook",
            hook: { kind: "catch-up", launch: L, session: S },
        });
    });

    it("refuses anything else after --recall-server", () => {
        for (const rest of [
            ["x"],
            ["--exclude"],
            ["--exclude", "nope"],
            ["--exclude", phrase, "--exclude", phrase],
            ["--project"],
            ["--project", "/a", "--project", "/b"],
        ]) {
            expect(parseArgs(["--recall-server", ...rest], false)).toEqual({
                kind: "usage",
                message: RECALL_USAGE,
            });
        }
    });

    it("parses the fact commands, terminal or not", () => {
        const RETIRE = "--retire takes <scope>/<name> or --from <phrase>";
        expect(parseArgs(["--facts"], false)).toEqual({ kind: "facts" });
        expect(parseArgs(["--facts", "x"], false)).toEqual({
            kind: "usage",
            message: "--facts takes no arguments",
        });
        expect(parseArgs(["--retire", "personal/likes-tea"], false)).toEqual({
            kind: "retire",
            target: "personal/likes-tea",
        });
        expect(parseArgs(["--retire", "--from", phrase], false)).toEqual({
            kind: "retire-from",
            phrase,
        });
        for (const rest of [
            [],
            ["--from"],
            ["--from", "nope"],
            ["a", "b"],
            ["-x"],
        ]) {
            expect(parseArgs(["--retire", ...rest], false)).toEqual({
                kind: "usage",
                message: RETIRE,
            });
        }
        expect(parseArgs(["--revive", "personal/likes-tea"], true)).toEqual({
            kind: "revive",
            target: "personal/likes-tea",
        });
        expect(parseArgs(["--revive"], true)).toEqual({
            kind: "usage",
            message: "--revive takes <scope>/<name>",
        });
        expect(parseArgs(["--verify", "k:personal/likes-tea"], false)).toEqual({
            kind: "verify",
            id: "k:personal/likes-tea",
        });
        for (const rest of [[], ["a", "b"], ["-x"]]) {
            expect(parseArgs(["--verify", ...rest], false)).toEqual({
                kind: "usage",
                message: "--verify takes one knowledge id, k:...",
            });
        }
        expect(parseArgs(["--sync"], false)).toEqual({
            kind: "sync",
            path: null,
        });
        expect(parseArgs(["--sync", "../repo"], false)).toEqual({
            kind: "sync",
            path: "../repo",
        });
        expect(parseArgs(["--sync", "a", "b"], false)).toEqual({
            kind: "usage",
            message: "--sync takes [<path>]",
        });
        expect(parseArgs(["--projects"], false)).toEqual({ kind: "projects" });
        expect(parseArgs(["--projects", "x"], false)).toEqual({
            kind: "usage",
            message: "--projects takes no arguments",
        });
    });

    it("lists the fact commands in the usage", () => {
        for (const line of [
            "dorothy --facts            what Dorothy knows, by scope",
            "dorothy --retire <scope>/<name> | --from <phrase>",
            "dorothy --revive <scope>/<name>",
            "dorothy --verify <id>      confirm knowledge a model gave",
            "dorothy --sync [<path>]    sync a project's facts with its repo",
            "dorothy --projects         the projects Dorothy knows",
        ]) {
            expect(USAGE).toContain(line);
        }
    });
});

describe("--serve and --mcp", () => {
    it("serves, or makes and withdraws a device's token", () => {
        expect(parseArgs(["--serve"], false)).toEqual({ kind: "serve" });
        expect(parseArgs(["--serve", "--token-add", "laptop"], false)).toEqual({
            kind: "token-add",
            device: "laptop",
        });
        expect(
            parseArgs(["--serve", "--token-revoke", "laptop"], false),
        ).toEqual({ kind: "token-revoke", device: "laptop" });
    });

    it("refuses both token commands at once, or words after --serve", () => {
        for (const argv of [
            ["--serve", "--token-add", "a", "--token-revoke", "b"],
            ["--serve", "now"],
            ["--serve", "--token-add"],
        ]) {
            expect(parseArgs(argv, false).kind).toBe("usage");
        }
    });

    it("refuses a token command with no device, or an empty one", () => {
        for (const argv of [
            ["--serve", "--token-revoke"],
            ["--serve", "--token-revoke", ""],
            ["--serve", "--token-add="],
        ]) {
            expect({ argv, kind: parseArgs(argv, false).kind }).toEqual({
                argv,
                kind: "usage",
            });
        }
    });

    it("refuses an option given twice, which would keep the last", () => {
        for (const argv of [
            ["--serve", "--token-add", "a", "--token-add", "b"],
            ["--serve", "--token-revoke", "a", "--token-revoke", "a"],
            ["--mcp", "--host", "codex", "--host", "goose"],
        ]) {
            expect({ argv, kind: parseArgs(argv, false).kind }).toEqual({
                argv,
                kind: "usage",
            });
        }
    });

    it("keeps --mcp and --serve apart, and --host to --mcp", () => {
        for (const argv of [
            ["--mcp", "--serve"],
            ["--serve", "--mcp"],
            ["--mcp", "--host"],
            ["--serve", "--host", "codex"],
        ]) {
            expect({ argv, kind: parseArgs(argv, false).kind }).toEqual({
                argv,
                kind: "usage",
            });
        }
    });

    it("bridges MCP, naming the host that launched it if given", () => {
        expect(parseArgs(["--mcp"], false)).toEqual({
            kind: "mcp",
            host: null,
        });
        expect(parseArgs(["--mcp", "--host", "codex"], false)).toEqual({
            kind: "mcp",
            host: "codex",
        });
        for (const argv of [
            ["--mcp", "x"],
            ["--mcp", "--host", "Not A Host"],
        ]) {
            expect(parseArgs(argv, false).kind).toBe("usage");
        }
    });
});
