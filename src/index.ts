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
import { baseOptions } from "./persona.js";
import { isPhrase } from "./session-id.js";

export type Mode =
    | { kind: "oneshot"; prompt: string }
    | { kind: "tui"; resume: string | null }
    | { kind: "usage"; message: string };

export const USAGE = [
    "usage: dorothy <prompt...>         one reply, then exit",
    "       dorothy                    chat (needs a terminal)",
    "       dorothy --resume <phrase>  continue a saved chat",
].join("\n");

export function parseArgs(argv: readonly string[], isTTY: boolean): Mode {
    if (argv[0] === "--resume") {
        const phrase = argv[1];
        if (argv.length !== 2 || phrase === undefined || !isPhrase(phrase)) {
            return {
                kind: "usage",
                message: "--resume takes one four-word phrase",
            };
        }
        return isTTY
            ? { kind: "tui", resume: phrase }
            : { kind: "usage", message: "--resume needs a terminal" };
    }
    if (argv.length > 0) {
        return { kind: "oneshot", prompt: argv.join(" ") };
    }
    return isTTY
        ? { kind: "tui", resume: null }
        : { kind: "usage", message: "chat needs a terminal" };
}

async function oneShot(prompt: string): Promise<void> {
    try {
        for await (const message of query({ prompt, options: baseOptions })) {
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
    // quiet: dotenvx would otherwise log to stdout, over the TUI.
    config({ quiet: true });
    const mode = parseArgs(
        process.argv.slice(2),
        process.stdin.isTTY === true && process.stdout.isTTY === true,
    );
    if (mode.kind === "usage") {
        process.stderr.write(`dorothy: ${mode.message}\n${USAGE}\n`);
        process.exitCode = 2;
    } else if (mode.kind === "oneshot") {
        await oneShot(mode.prompt);
    } else {
        // Loaded only for chat, so one-shot replies never pay for React.
        const { runTui } = await import("./tui/run.js");
        process.exitCode = await runTui(mode.resume);
    }
}
