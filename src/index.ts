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

export function resolvePrompt(args: string[]): string {
    return args.join(" ") || "Hello, who are you?";
}

async function main(): Promise<void> {
    const prompt = resolvePrompt(process.argv.slice(2));

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
    config();
    await main();
}
