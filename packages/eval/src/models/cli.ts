// vim:set expandtab shiftwidth=4 filetype=typescript:
// SPDX-License-Identifier: GPL-3.0-only

//
//
// ~chewygumxx/dorothy.git
// ::: :/packages/eval/src/models/cli.ts
//
//

import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Env } from "@dorothy/core";
import { codeOf, RunStop, UsageError } from "../errors.js";
import type { Message } from "./client.js";
import type { CliConfig } from "./config.js";

export type CliRequest = {
    command: "claude" | "codex";
    args: string[];
    env: Env;
    cwd: string;
    stdin: string;
    timeoutMs: number;
};
export type CliResult = {
    exitCode: number | null;
    stdout: string;
    timedOut?: boolean;
};
export type CliRunner = (request: CliRequest) => Promise<CliResult>;
export type CliFiles = {
    temp(): Promise<string>;
    write(path: string, text: string, mode: number): Promise<void>;
    read(path: string): Promise<string>;
    remove(path: string): Promise<void>;
};
export type CliOptions = {
    env: Env;
    runner?: CliRunner;
    cliFiles?: CliFiles;
    timeoutMs?: number;
};
export type CliReply = {
    text: string;
    value?: unknown;
    input: number;
    output: number;
};
export class CliFailure extends Error {}
class CliUnavailable extends UsageError {}

// The route's plan has no usage left: not a fault of the call, and no
// retry mends it. The run stops, keeping what is done, for the command to
// say how to go on after the reset, which the CLI may have said.
export class PlanLimit extends RunStop {
    constructor(via: CliConfig["via"], resets: string | null) {
        super(
            `the ${via} plan's usage limit is reached${
                resets === null ? "" : ` (try again at ${resets})`
            }`,
        );
    }
}
const files: CliFiles = {
    temp: async () => mkdtempSync(join(tmpdir(), "dorothy-eval-model-")),
    write: (path, text, mode) => writeFile(path, text, { mode }),
    read: (path) => readFile(path, "utf8"),
    remove: (path) => rm(path, { recursive: true, force: true }),
};

const liveGroups = new Set<number>();
const liveAttempts = new Set<() => Promise<void>>();
let stopping = false;
const EXIT_CODES = { SIGINT: 130, SIGTERM: 143, SIGHUP: 129 } as const;
const signalGroup = (group: number, signal: NodeJS.Signals) => {
    try {
        process.kill(-group, signal);
    } catch {
        // The group may already have exited.
    }
};
function stop(signal: keyof typeof EXIT_CODES): void {
    if (stopping) return;
    stopping = true;
    // Retain the groups and cleanups even if an attempt settles on TERM.
    const groups = [...liveGroups];
    const cleanups = [...liveAttempts];
    for (const group of groups) signalGroup(group, "SIGTERM");
    setTimeout(() => {
        for (const group of groups) signalGroup(group, "SIGKILL");
        void Promise.allSettled(
            cleanups.map((cleanup) => Promise.resolve().then(cleanup)),
        ).then(() => process.exit(EXIT_CODES[signal]));
    }, 100);
}
const handlers = {
    SIGINT: () => stop("SIGINT"),
    SIGTERM: () => stop("SIGTERM"),
    SIGHUP: () => stop("SIGHUP"),
};
const watchSignals = () => {
    for (const signal of Object.keys(handlers) as (keyof typeof handlers)[]) {
        process.on(signal, handlers[signal]);
    }
};
const unwatchSignals = () => {
    for (const signal of Object.keys(handlers) as (keyof typeof handlers)[]) {
        process.off(signal, handlers[signal]);
    }
};

const run: CliRunner = (request) => {
    let group: number | undefined;
    return new Promise<CliResult>((resolve, reject) => {
        const child = spawn(request.command, request.args, {
            cwd: request.cwd,
            env: request.env,
            detached: true,
            // Progress and failures may quote snapshot text. Never retain it.
            stdio: ["pipe", "pipe", "ignore"],
        });
        group = child.pid;
        if (group !== undefined) liveGroups.add(group);
        let stdout = "";
        let exitCode: number | null = null;
        let timedOut = false;
        const signalChildGroup = (signal: NodeJS.Signals) => {
            if (group !== undefined) signalGroup(group, signal);
        };
        const timer = setTimeout(() => {
            timedOut = true;
            signalChildGroup("SIGTERM");
            // A wrapper's descendants may still hold the pipe. Stop reading
            // at the deadline, regardless of when those descriptors close.
            child.stdout.destroy();
            child.stdin.destroy();
            setTimeout(() => {
                signalChildGroup("SIGKILL");
                resolve({ exitCode, stdout: "", timedOut: true });
            }, 100);
        }, request.timeoutMs);
        child.stdout.setEncoding("utf8");
        child.stdout.on("data", (chunk: string) => {
            stdout += chunk;
        });
        // A child may exit before reading stdin (EPIPE).
        child.stdin.on("error", () => {});
        child.on("error", (error) => {
            if (!timedOut) {
                clearTimeout(timer);
                reject(error);
            }
        });
        child.on("exit", (code) => {
            exitCode = code;
        });
        child.on("close", (code) => {
            if (!timedOut) {
                clearTimeout(timer);
                resolve({ exitCode: code, stdout });
            }
        });
        child.stdin.end(request.stdin);
    }).finally(() => {
        if (group !== undefined) liveGroups.delete(group);
    });
};

const record = (value: unknown): Record<string, unknown> => {
    if (typeof value !== "object" || value === null || Array.isArray(value)) {
        throw new Error();
    }
    return value as Record<string, unknown>;
};
const tokens = (value: unknown): number =>
    typeof value === "number" && Number.isFinite(value) && value >= 0
        ? value
        : 0;
const usageOf = (value: unknown) => {
    const usage = value === undefined ? {} : record(value);
    // Claude counts cached input apart from input_tokens; Codex's
    // input_tokens already holds its cached_input_tokens.
    return {
        input:
            tokens(usage.input_tokens) +
            tokens(usage.cache_creation_input_tokens) +
            tokens(usage.cache_read_input_tokens),
        output: tokens(usage.output_tokens),
    };
};

// What each CLI says of a limit, read leniently. A status 429 is one
// whatever it says.
const LIMIT = /usage[ _]limit|usage credits|out of credits|rate[ _]limit/i;

// What Claude alone says: "You've hit your session limit" (also weekly,
// Opus, Sonnet or Fable) and "limit reached".
const CLAUDE_LIMIT = /hit your [\w ]*limit|limit reached/i;

// A word of a time or date: digits (a time, a day, an ISO stamp), AM or
// PM, a month or a weekday.
const WHEN =
    /^(?:\d[\dTZ:/.+-]*(?:st|nd|rd|th|[ap]m)?|[ap]m|at|(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]{0,6}|(?:mon|tue|wed|thu|fri|sat|sun)[a-z]{0,6})$/i;

// The reset time the CLI gives, if a time or date is all it is: any other
// reply text, that a capture might repeat, is left out.
const resetIn = (text: string): string | null => {
    const said = /(?:try again at|resets) ([A-Za-z0-9 ,:/.+-]{1,40})/i
        .exec(text)?.[1]
        ?.trim()
        .replace(/\.$/, "");
    if (said === undefined || !/\d/.test(said)) return null;
    return said.split(/\s+/).every((word) => WHEN.test(word.replace(/,$/, "")))
        ? said
        : null;
};

// Claude ends some limit replies in `|<epoch seconds>`.
const epochIn = (text: string): string | null => {
    const seconds = /\|(\d{10})\s*$/.exec(text)?.[1];
    return seconds === undefined
        ? null
        : new Date(Number(seconds) * 1000).toISOString();
};

type Limit = { resets: string | null };

// The limit a Claude error reply says, if it does.
function claudeLimit(stdout: string): Limit | null {
    let reply: Record<string, unknown>;
    try {
        reply = record(JSON.parse(stdout));
    } catch {
        return null;
    }
    const text = typeof reply.result === "string" ? reply.result : "";
    if (
        reply.is_error !== true ||
        (reply.api_error_status !== 429 &&
            !LIMIT.test(text) &&
            !CLAUDE_LIMIT.test(text))
    ) {
        return null;
    }
    return { resets: resetIn(text) ?? epochIn(text) };
}

// The limit a Codex error or turn.failed event says, if one does and the
// turn did not complete. A completed turn, with exit 0 and no turn.failed,
// has outlived any retry notice that named a limit. Other events, and lines
// that are not events, say nothing of it.
function codexLimit(stdout: string, exitCode: number | null): Limit | null {
    const events: Record<string, unknown>[] = [];
    for (const line of stdout.split("\n")) {
        try {
            events.push(record(JSON.parse(line)));
        } catch {
            // Not an event.
        }
    }
    const types = events.map((event) => event.type);
    if (
        exitCode === 0 &&
        types.includes("turn.completed") &&
        !types.includes("turn.failed")
    ) {
        return null;
    }
    for (const event of events) {
        const message =
            event.type === "error"
                ? event.message
                : event.type === "turn.failed"
                  ? record(event.error).message
                  : undefined;
        if (typeof message === "string" && LIMIT.test(message)) {
            return { resets: resetIn(message) };
        }
    }
    return null;
}

// One attempt only. Models.call owns the cap, retry policy and timing.
// All external failures lose their payload, including thrown filesystem
// and runner errors: both may hold prompts or credentials.
export async function cliAttempt(
    config: CliConfig,
    messages: Message[],
    schema: Record<string, unknown> | undefined,
    options: CliOptions,
): Promise<CliReply> {
    const io = options.cliFiles ?? files;
    let directory: string | undefined;
    let exitCode: number | null = null;
    if (stopping) throw new CliUnavailable("evaluation interrupted");
    const cleanupOnSignal = async () => {
        if (directory === undefined) return;
        if (io === files) rmSync(directory, { recursive: true, force: true });
        else await io.remove(directory);
    };
    if (liveAttempts.size === 0) watchSignals();
    liveAttempts.add(cleanupOnSignal);
    const failed = (reason: string) =>
        new CliFailure(
            `${config.via} exited with code ${exitCode ?? "unknown"}: ${reason}`,
        );
    try {
        directory = await io.temp();
        const env: Env = {};
        for (const key of ["PATH", "HOME"]) {
            if (options.env[key] !== undefined) env[key] = options.env[key];
        }
        const prompt = messages
            .filter((message) => message.role === "user")
            .map((message) => message.content)
            .join("\n\n");
        const system = messages
            .filter((message) => message.role === "system")
            .map((message) => message.content)
            .join("\n\n");
        let args: string[];
        if (config.via === "claude") {
            env.CLAUDE_CONFIG_DIR = directory;
            env.CLAUDE_CODE_OAUTH_TOKEN = options.env.CLAUDE_CODE_OAUTH_TOKEN;
            args = [
                "-p",
                "--setting-sources",
                "",
                "--strict-mcp-config",
                "--tools",
                "",
                "--no-session-persistence",
                "--output-format",
                "json",
                "--model",
                config.model,
            ];
            const path = join(directory, "system.txt");
            await io.write(
                path,
                system || "Answer the user's request directly.",
                0o600,
            );
            args.push("--system-prompt-file", path);
            if (schema !== undefined)
                args.push("--json-schema", JSON.stringify(schema));
        } else {
            if (options.env.CODEX_HOME !== undefined)
                env.CODEX_HOME = options.env.CODEX_HOME;
            args = [
                "exec",
                "--ephemeral",
                "--skip-git-repo-check",
                "-s",
                "read-only",
                "-C",
                directory,
                "--ignore-user-config",
                "--ignore-rules",
                "-c",
                "project_doc_max_bytes=0",
                "-m",
                config.model,
                "-c",
                `model_reasoning_effort=${JSON.stringify(config.effort)}`,
                "--json",
                "-o",
                join(directory, "reply.txt"),
            ];
            if (schema !== undefined) {
                const path = join(directory, "schema.json");
                await io.write(path, JSON.stringify(schema), 0o600);
                args.push("--output-schema", path);
            }
            args.push("-");
        }
        if (stopping) throw new CliUnavailable("evaluation interrupted");
        let result: CliResult;
        try {
            result = await (options.runner ?? run)({
                command: config.via,
                args,
                env,
                cwd: directory,
                stdin:
                    config.via === "claude"
                        ? prompt
                        : messages
                              .map((message) => message.content)
                              .join("\n\n"),
                timeoutMs: options.timeoutMs ?? 120_000,
            });
        } catch (error) {
            const code = codeOf(error);
            throw new CliUnavailable(
                code === "ENOENT"
                    ? `${config.via} is missing (ENOENT): install it and make it available on PATH`
                    : `${config.via} is not runnable${code === "EACCES" ? " (EACCES)" : ""}: check the executable and its permissions`,
            );
        }
        exitCode = result.exitCode;
        if (result.timedOut) throw failed("timed out");
        // A CLI at its limit may exit non-zero, so this comes before the
        // exit code is judged.
        const limit =
            config.via === "claude"
                ? claudeLimit(result.stdout)
                : codexLimit(result.stdout, exitCode);
        if (limit !== null) throw new PlanLimit(config.via, limit.resets);
        if (exitCode !== 0)
            throw new CliFailure(
                `${config.via} exited with code ${exitCode ?? "unknown"}`,
            );
        try {
            if (config.via === "claude") {
                const reply = record(JSON.parse(result.stdout));
                if (reply.is_error === true) throw new Error();
                if (schema !== undefined && !("structured_output" in reply))
                    throw new Error();
                if (schema === undefined && typeof reply.result !== "string")
                    throw new Error();
                return {
                    text: typeof reply.result === "string" ? reply.result : "",
                    ...(schema === undefined
                        ? {}
                        : { value: reply.structured_output }),
                    ...usageOf(reply.usage),
                };
            }
            const usage = { input: 0, output: 0 };
            for (const line of result.stdout
                .split("\n")
                .filter((line) => line.trim() !== "")) {
                const event = record(JSON.parse(line));
                // Exec also emits error events for recoverable stream
                // retries. Exit status, turn.failed and the reply file
                // determine whether this attempt succeeded.
                if (event.type === "turn.failed") throw new Error();
                if (event.type === "turn.completed") {
                    const counts = usageOf(event.usage);
                    usage.input += counts.input;
                    usage.output += counts.output;
                }
            }
            const text = await io.read(join(directory, "reply.txt"));
            return {
                text,
                ...(schema === undefined
                    ? {}
                    : { value: JSON.parse(text) as unknown }),
                ...usage,
            };
        } catch {
            throw failed("unreadable reply");
        }
    } catch (error) {
        throw error instanceof CliFailure ||
            error instanceof CliUnavailable ||
            error instanceof PlanLimit
            ? error
            : failed("could not run");
    } finally {
        if (directory !== undefined) {
            // Cleanup must neither discard a paid reply nor replace the
            // original failure. Its error can also contain private text.
            try {
                await io.remove(directory);
            } catch {
                // Best effort, including synchronous filesystem failures.
            }
        }
        liveAttempts.delete(cleanupOnSignal);
        if (liveAttempts.size === 0 && !stopping) unwatchSignals();
    }
}
