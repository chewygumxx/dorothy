// vim:set expandtab shiftwidth=4 filetype=typescript:
// SPDX-License-Identifier: GPL-3.0-only

//
//
// ~chewygumxx/dorothy.git
// ::: :/packages/cli/src/index.ts
//
//

import { pathToFileURL } from "node:url";
import type { PersonaMode } from "@dorothy/agent";
import { isPhrase } from "@dorothy/core";
import { config } from "@dotenvx/dotenvx";

export type Mode =
    | { kind: "oneshot"; prompt: string; persona: PersonaMode }
    | { kind: "tui"; resume: string | null; persona: PersonaMode }
    | {
          kind: "dump";
          resume: string | null;
          message: string;
          persona: PersonaMode;
      }
    | { kind: "list" }
    | { kind: "memory"; phrase: string }
    | { kind: "tags" }
    | { kind: "tags-edit" }
    | { kind: "history"; path: string | null; count: number }
    | { kind: "restore"; path: string; rev: string | null }
    | { kind: "rollback"; rev: string }
    | { kind: "check"; staged: boolean }
    | { kind: "mirror"; url: string | null }
    | { kind: "recover"; url: string }
    | { kind: "recall-server"; exclude: string | null; recollect: boolean }
    | { kind: "help" }
    | { kind: "usage"; message: string };

export const USAGE = [
    "usage: dorothy <prompt...>        one reply, then exit",
    "       dorothy                    chat (needs a terminal)",
    "       dorothy --resume <phrase>  continue a saved chat",
    "       dorothy --list             what Dorothy remembers",
    "       dorothy --memory <phrase>  correct, pin or hide a chat's notes",
    "       dorothy --tags             Dorothy's tags, as a tree",
    "       dorothy --edit-tags        correct, merge or delete her tags",
    "       dorothy --history [<path>] [-n <count>]",
    "                                  what changed in her memory, newest first",
    "       dorothy --restore <path> [<rev>]",
    "                                  put a file back as it was",
    "       dorothy --rollback <rev>   put notes and tags back as they were",
    "       dorothy --check [--staged] lint memory's files",
    "       dorothy --mirror [<url>]   set or show the sealed mirror",
    "       dorothy --recover <url>    rebuild memory from the mirror",
    "       dorothy --recall-server    memory search for MCP clients (stdio)",
    "       dorothy -- <prompt...>     a prompt that starts with -",
    "       dorothy --dump-context [--resume <phrase>] [message...]",
    "                                  print the request a chat would send",
    "       dorothy --dev ...          development mode, before a chat, a",
    "                                  prompt or --dump-context",
].join("\n");

const DUMP_USAGE = "--dump-context takes [--resume <phrase>] [message...]";

function parseDump(argv: readonly string[]): Mode {
    let words = argv;
    let resume: string | null = null;
    if (words[0] === "--resume") {
        const phrase = words[1];
        if (phrase === undefined || !isPhrase(phrase)) {
            return { kind: "usage", message: DUMP_USAGE };
        }
        resume = phrase;
        words = words.slice(2);
    }
    if (words[0] === "--") {
        words = words.slice(1);
    } else if (words[0] !== undefined && /^-./.test(words[0])) {
        return { kind: "usage", message: DUMP_USAGE };
    }
    return {
        kind: "dump",
        resume,
        message: words.length > 0 ? words.join(" ") : "hi",
        persona: "chat",
    };
}

export function parseArgs(argv: readonly string[], isTTY: boolean): Mode {
    const [first, ...rest] = argv;
    if (first === "--dev") {
        const mode = rest[0] === "--dev" ? null : parseArgs(rest, isTTY);
        if (
            mode?.kind === "oneshot" ||
            mode?.kind === "tui" ||
            mode?.kind === "dump"
        ) {
            return { ...mode, persona: "development" };
        }
        return mode?.kind === "usage"
            ? mode
            : {
                  kind: "usage",
                  message:
                      "--dev applies only to chat, a prompt or --dump-context",
              };
    }
    if (first === "--dump-context") {
        return parseDump(rest);
    }
    if (first === "--help" || first === "-h") {
        return { kind: "help" };
    }
    if (first === "--list") {
        return rest.length === 0
            ? { kind: "list" }
            : { kind: "usage", message: "--list takes no arguments" };
    }
    if (first === "--tags") {
        return rest.length === 0
            ? { kind: "tags" }
            : { kind: "usage", message: "--tags takes no arguments" };
    }
    if (first === "--edit-tags") {
        if (rest.length !== 0) {
            return {
                kind: "usage",
                message: "--edit-tags takes no arguments",
            };
        }
        return isTTY
            ? { kind: "tags-edit" }
            : { kind: "usage", message: "--edit-tags needs a terminal" };
    }
    if (first === "--recall-server") {
        if (rest.length === 0) {
            return { kind: "recall-server", exclude: null, recollect: false };
        }
        const [flag, phrase, extra] = rest;
        const recollect = extra === "--recollect";
        return (rest.length === 2 || (rest.length === 3 && recollect)) &&
            flag === "--exclude" &&
            phrase !== undefined &&
            isPhrase(phrase)
            ? { kind: "recall-server", exclude: phrase, recollect }
            : {
                  kind: "usage",
                  message:
                      "--recall-server takes only --exclude <phrase> [--recollect]",
              };
    }
    if (first === "--history") {
        const usage = {
            kind: "usage",
            message: "--history takes [<path>] [-n <count>]",
        } as const;
        let path: string | null = null;
        let count = 20;
        for (let index = 0; index < rest.length; index++) {
            const word = rest[index] as string;
            if (word === "-n") {
                const value = Number(rest[index + 1]);
                if (!Number.isInteger(value) || value < 1) {
                    return usage;
                }
                count = value;
                index++;
            } else if (path === null && !word.startsWith("-")) {
                path = word;
            } else {
                return usage;
            }
        }
        return { kind: "history", path, count };
    }
    if (first === "--restore") {
        const [path, rev] = rest;
        return path !== undefined && rest.length <= 2
            ? { kind: "restore", path, rev: rev ?? null }
            : { kind: "usage", message: "--restore takes <path> [<rev>]" };
    }
    if (first === "--rollback") {
        const [rev] = rest;
        return rev !== undefined && rest.length === 1
            ? { kind: "rollback", rev }
            : { kind: "usage", message: "--rollback takes one revision" };
    }
    if (first === "--check") {
        if (
            rest.length === 0 ||
            (rest.length === 1 && rest[0] === "--staged")
        ) {
            return { kind: "check", staged: rest.length === 1 };
        }
        return { kind: "usage", message: "--check takes only --staged" };
    }
    if (first === "--mirror") {
        return rest.length <= 1
            ? { kind: "mirror", url: rest[0] ?? null }
            : { kind: "usage", message: "--mirror takes one url or path" };
    }
    if (first === "--recover") {
        const [url] = rest;
        return url !== undefined && rest.length === 1
            ? { kind: "recover", url }
            : { kind: "usage", message: "--recover takes one url or path" };
    }
    if (first === "--memory") {
        const phrase = rest[0];
        if (rest.length !== 1 || phrase === undefined || !isPhrase(phrase)) {
            return {
                kind: "usage",
                message: "--memory takes one four-word phrase",
            };
        }
        return isTTY
            ? { kind: "memory", phrase }
            : { kind: "usage", message: "--memory needs a terminal" };
    }
    if (first === "--resume") {
        const phrase = rest[0];
        if (rest.length !== 1 || phrase === undefined || !isPhrase(phrase)) {
            return {
                kind: "usage",
                message: "--resume takes one four-word phrase",
            };
        }
        return isTTY
            ? { kind: "tui", resume: phrase, persona: "chat" }
            : { kind: "usage", message: "--resume needs a terminal" };
    }
    // A mistyped option would otherwise be sent, and paid for, as a prompt.
    if (first !== undefined && first !== "--" && /^-./.test(first)) {
        return { kind: "usage", message: `unknown option ${first}` };
    }
    const words = first === "--" ? rest : argv;
    if (words.length > 0) {
        return { kind: "oneshot", prompt: words.join(" "), persona: "chat" };
    }
    return isTTY
        ? { kind: "tui", resume: null, persona: "chat" }
        : { kind: "usage", message: "chat needs a terminal" };
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
    const mode = parseArgs(
        process.argv.slice(2),
        process.stdin.isTTY === true && process.stdout.isTTY === true,
    );
    // Credentials are decrypted only for the modes that talk to the model.
    // quiet: dotenvx would otherwise log to stdout, over the TUI.
    if (
        mode.kind === "oneshot" ||
        mode.kind === "tui" ||
        mode.kind === "dump"
    ) {
        config({ quiet: true });
        // Loaded here rather than at the top, so the modes that never talk
        // to the model do not pay for the Agent SDK.
        const { prepareCliHome } = await import("@dorothy/agent");
        prepareCliHome();
    }
    if (mode.kind === "mirror" || mode.kind === "recover") {
        config({ quiet: true });
    }
    if (mode.kind === "help") {
        process.stdout.write(`${USAGE}\n`);
    } else if (mode.kind === "usage") {
        process.stderr.write(`dorothy: ${mode.message}\n${USAGE}\n`);
        process.exitCode = 2;
    } else if (mode.kind === "dump") {
        const { runDump } = await import("./dump.js");
        process.exitCode = await runDump(mode);
    } else if (mode.kind === "oneshot") {
        const { runOneShot } = await import("@dorothy/agent");
        await runOneShot(mode.prompt, mode.persona);
    } else if (mode.kind === "list") {
        const { runList } = await import("@dorothy/memory/commands");
        const { commandHistory } = await import("@dorothy/memory/commands");
        process.exitCode = await runList({ openHistory: commandHistory() });
    } else if (mode.kind === "memory") {
        const { runMemoryEdit } = await import("@dorothy/memory/commands");
        const { commandHistory } = await import("@dorothy/memory/commands");
        const { editInEditor } = await import("@dorothy/tui");
        process.exitCode = await runMemoryEdit(mode.phrase, {
            edit: (text) => editInEditor(text),
            openHistory: commandHistory(),
        });
    } else if (mode.kind === "tags") {
        const { runTags } = await import("@dorothy/memory/commands");
        const { commandHistory } = await import("@dorothy/memory/commands");
        process.exitCode = await runTags({ openHistory: commandHistory() });
    } else if (mode.kind === "tags-edit") {
        const { runTagsEdit } = await import("@dorothy/memory/commands");
        const { commandHistory } = await import("@dorothy/memory/commands");
        const { editInEditor } = await import("@dorothy/tui");
        process.exitCode = await runTagsEdit({
            edit: (text) => editInEditor(text),
            openHistory: commandHistory(),
        });
    } else if (mode.kind === "history") {
        const { runHistory } = await import("@dorothy/memory/commands");
        process.exitCode = await runHistory({
            path: mode.path,
            count: mode.count,
        });
    } else if (mode.kind === "restore") {
        const { runRestore } = await import("@dorothy/memory/commands");
        process.exitCode = await runRestore(mode.path, mode.rev);
    } else if (mode.kind === "rollback") {
        const { runRollback } = await import("@dorothy/memory/commands");
        process.exitCode = await runRollback(mode.rev);
    } else if (mode.kind === "check") {
        const { runCheck } = await import("@dorothy/memory/commands");
        process.exitCode = await runCheck({ staged: mode.staged });
    } else if (mode.kind === "mirror") {
        const { runMirror } = await import("@dorothy/memory/commands");
        process.exitCode = await runMirror(mode.url);
    } else if (mode.kind === "recover") {
        const { runRecover } = await import("@dorothy/memory/commands");
        process.exitCode = await runRecover(mode.url);
    } else if (mode.kind === "recall-server") {
        const { runRecallServer } = await import(
            "@dorothy/memory/recall-server"
        );
        process.exitCode = await runRecallServer(mode.exclude, mode.recollect);
    } else {
        // Loaded only for chat, so one-shot replies never pay for React.
        const { runTui } = await import("./run-tui.js");
        // runTui has closed everything by now. A push or a repack still
        // running must not hold the terminal after the chat is gone.
        process.exit(await runTui(mode.resume, mode.persona));
    }
}
