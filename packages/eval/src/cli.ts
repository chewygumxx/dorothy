// vim:set expandtab shiftwidth=4 filetype=typescript:
// SPDX-License-Identifier: GPL-3.0-only

//
//
// ~chewygumxx/dorothy.git
// ::: :/packages/eval/src/cli.ts
//
//

// bun run eval -- <command>: the commands in the order a user meets them.

import { parseArgs } from "node:util";
import type { Command, Io, Values } from "./command.js";
import { UsageError } from "./errors.js";
import { generateCommand } from "./questions/generate-command.js";
import { mineCommand } from "./questions/mine.js";
import { snapshotCommand } from "./snapshot/command.js";

export const COMMANDS: Record<string, Command> = {
    snapshot: snapshotCommand,
    mine: mineCommand,
    generate: generateCommand,
};

export function usage(): string {
    const lines = [
        "Usage: bun run eval -- <command> [options]",
        "",
        "Commands:",
    ];
    for (const [name, command] of Object.entries(COMMANDS)) {
        lines.push(`  ${name.padEnd(10)}${command.summary}`);
    }
    return `${lines.join("\n")}\n`;
}

// node:util's parseArgs marks its own errors with these codes.
const isArgumentError = (error: unknown) =>
    String((error as { code?: unknown }).code ?? "").startsWith(
        "ERR_PARSE_ARGS",
    );

export async function runCli(argv: string[], io: Io): Promise<number> {
    const [name, ...rest] = argv;
    if (name === "--help") {
        io.out(usage());
        return 0;
    }
    const command = name === undefined ? undefined : COMMANDS[name];
    if (command === undefined) {
        io.err(
            name === undefined
                ? usage()
                : `eval: no command ${name}\n${usage()}`,
        );
        return 1;
    }
    try {
        const { values, positionals } = parseArgs({
            args: rest,
            options: command.options,
            allowPositionals: true,
            strict: true,
        });
        return await command.run(values as Values, positionals, io);
    } catch (error) {
        if (error instanceof UsageError || isArgumentError(error)) {
            io.err(`eval: ${(error as Error).message}\n`);
            return 1;
        }
        throw error;
    }
}
