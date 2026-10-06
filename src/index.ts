// vim:set expandtab shiftwidth=4 filetype=typescript:
// SPDX-License-Identifier: GPL-3.0-only

//
//
// ~chewygumxx/dorothy.git
// ::: :/src/index.ts
//
//

import { pathToFileURL } from "node:url";
import { query } from "@anthropic-ai/claude-agent-sdk";
import { config } from "@dotenvx/dotenvx";
import {
    baseOptions,
    cliOptions,
    type PersonaMode,
    personaPrompt,
    prepareCliHome,
} from "./persona.js";
import { isPhrase } from "./session-id.js";

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
    | { kind: "recall-server"; exclude: string | null }
    | { kind: "help" }
    | { kind: "usage"; message: string };

export const USAGE = [
    "usage: dorothy <prompt...>        one reply, then exit",
    "       dorothy                    chat (needs a terminal)",
    "       dorothy --resume <phrase>  continue a saved chat",
    "       dorothy --list             what Dorothy remembers",
    "       dorothy --memory <phrase>  correct, pin or hide a chat's notes",
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
    if (first === "--recall-server") {
        if (rest.length === 0) {
            return { kind: "recall-server", exclude: null };
        }
        const [flag, phrase] = rest;
        return rest.length === 2 &&
            flag === "--exclude" &&
            phrase !== undefined &&
            isPhrase(phrase)
            ? { kind: "recall-server", exclude: phrase }
            : {
                  kind: "usage",
                  message: "--recall-server takes only --exclude <phrase>",
              };
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

async function oneShot(prompt: string, persona: PersonaMode): Promise<void> {
    try {
        for await (const message of query({
            prompt,
            options: {
                ...baseOptions,
                ...cliOptions(),
                systemPrompt: personaPrompt({ recall: false, mode: persona }),
            },
        })) {
            if (
                message.type === "stream_event" &&
                message.event.type === "content_block_delta" &&
                message.event.delta.type === "text_delta"
            ) {
                process.stdout.write(message.event.delta.text);
            }
        }
    } catch (error) {
        process.stderr.write(
            `${error instanceof Error ? error.message : String(error)}\n`,
        );
        process.exitCode = 1;
        return;
    }
    process.stdout.write("\n");
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
        prepareCliHome();
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
        await oneShot(mode.prompt, mode.persona);
    } else if (mode.kind === "list") {
        const { runList } = await import("./memory/commands.js");
        process.exitCode = await runList();
    } else if (mode.kind === "memory") {
        const { runMemoryEdit } = await import("./memory/commands.js");
        process.exitCode = await runMemoryEdit(mode.phrase);
    } else if (mode.kind === "recall-server") {
        const { runRecallServer } = await import("./recall/server.js");
        process.exitCode = await runRecallServer(mode.exclude);
    } else {
        // Loaded only for chat, so one-shot replies never pay for React.
        const { runTui } = await import("./tui/run.js");
        process.exitCode = await runTui(mode.resume, mode.persona);
    }
}
