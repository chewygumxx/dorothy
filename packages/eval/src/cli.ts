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
import { reviewCommand } from "./questions/review.js";
import { compareCommand } from "./report/command.js";
import { runCommand } from "./run/command.js";
import { snapshotCommand } from "./snapshot/command.js";

export const COMMANDS: Record<string, Command> = {
    snapshot: snapshotCommand,
    mine: mineCommand,
    generate: generateCommand,
    review: reviewCommand,
    run: runCommand,
    compare: compareCommand,
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
    lines.push(
        "",
        "`bun run eval -- <command> --help` gives a command's options.",
    );
    return `${lines.join("\n")}\n`;
}

// A command's usage, and each option with its kind and what it does.
export function commandUsage(name: string, command: Command): string {
    const args = command.args === undefined ? "" : ` ${command.args}`;
    const flags = Object.entries(command.options).map(([option, spec]) => ({
        flag: `--${option}${spec.type === "string" ? " <value>" : ""}`,
        description: `${spec.description}${spec.multiple === true ? "; repeatable" : ""}`,
    }));
    const width = Math.max(...flags.map(({ flag }) => flag.length)) + 2;
    return `${[
        `Usage: bun run eval -- ${name} [options]${args}`,
        "",
        `${name}: ${command.summary}`,
        "",
        "Options:",
        ...flags.map(
            ({ flag, description }) => `  ${flag.padEnd(width)}${description}`,
        ),
    ].join("\n")}\n`;
}

// Whether --help is among a command's arguments as an option of its
// own, not the value of one, such as --work's.
function asksHelp(args: string[], command: Command): boolean {
    for (let at = 0; at < args.length; at++) {
        const arg = args[at] as string;
        if (arg === "--help") {
            return true;
        }
        if (arg === "--") {
            return false;
        }
        const option = arg.slice(2);
        if (
            Object.hasOwn(command.options, option) &&
            command.options[option]?.type === "string"
        ) {
            at++;
        }
    }
    return false;
}

// node:util's parseArgs marks its own errors with these codes.
const isArgumentError = (error: unknown) =>
    String((error as { code?: unknown }).code ?? "").startsWith(
        "ERR_PARSE_ARGS",
    );

export async function runCli(argv: string[], io: Io): Promise<number> {
    const [name, ...rest] = argv;
    if (
        name === "--help" ||
        (name === "help" && (rest.length === 0 || rest[0] === "--help"))
    ) {
        io.out(usage());
        return 0;
    }
    const asked = name === "help" ? rest[0] : name;
    // Own keys only: `constructor` is no command.
    const command =
        asked !== undefined && Object.hasOwn(COMMANDS, asked)
            ? COMMANDS[asked]
            : undefined;
    if (command === undefined) {
        io.err(
            asked === undefined
                ? usage()
                : `eval: no command ${asked}\n${usage()}`,
        );
        return 1;
    }
    if (name === "help" || asksHelp(rest, command)) {
        io.out(commandUsage(asked as string, command));
        return 0;
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
