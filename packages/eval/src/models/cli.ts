// vim:set expandtab shiftwidth=4 filetype=typescript:
// SPDX-License-Identifier: GPL-3.0-only

//
//
// ~chewygumxx/dorothy.git
// ::: :/packages/eval/src/models/cli.ts
//
//

import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Env } from "@dorothy/core";
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
const files: CliFiles = {
    temp: () => mkdtemp(join(tmpdir(), "dorothy-eval-model-")),
    write: (path, text, mode) => writeFile(path, text, { mode }),
    read: (path) => readFile(path, "utf8"),
    remove: (path) => rm(path, { recursive: true, force: true }),
};

const run: CliRunner = (request) =>
    new Promise((resolve, reject) => {
        const child = spawn(request.command, request.args, {
            cwd: request.cwd,
            env: request.env,
            detached: true,
            // Progress and failures may quote snapshot text. Never retain it.
            stdio: ["pipe", "pipe", "ignore"],
        });
        let stdout = "";
        let exitCode: number | null = null;
        let timedOut = false;
        const signalGroup = (signal: NodeJS.Signals) => {
            if (child.pid === undefined) return;
            try {
                process.kill(-child.pid, signal);
            } catch {
                // The group may already have exited.
            }
        };
        const timer = setTimeout(() => {
            timedOut = true;
            signalGroup("SIGTERM");
            // A wrapper's descendants may still hold the pipe. Stop reading
            // at the deadline, regardless of when those descriptors close.
            child.stdout.destroy();
            child.stdin.destroy();
            setTimeout(() => {
                signalGroup("SIGKILL");
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
    });

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
    return {
        input: tokens(usage.input_tokens),
        output: tokens(usage.output_tokens),
    };
};

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
            if (system !== "") {
                const path = join(directory, "system.txt");
                await io.write(path, system, 0o600);
                args.push("--system-prompt-file", path);
            }
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
        const result = await (options.runner ?? run)({
            command: config.via,
            args,
            env,
            cwd: directory,
            stdin:
                config.via === "claude"
                    ? prompt
                    : messages.map((message) => message.content).join("\n\n"),
            timeoutMs: options.timeoutMs ?? 120_000,
        });
        exitCode = result.exitCode;
        if (result.timedOut) throw failed("timed out");
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
                if (event.type === "turn.failed" || event.type === "error")
                    throw new Error();
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
        throw error instanceof CliFailure ? error : failed("could not run");
    } finally {
        if (directory !== undefined) {
            await io
                .remove(directory)
                .catch(() =>
                    Promise.reject(failed("could not remove temporary files")),
                );
        }
    }
}
