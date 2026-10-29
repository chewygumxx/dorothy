// vim:set expandtab shiftwidth=4 filetype=typescript:
// SPDX-License-Identifier: GPL-3.0-only

//
//
// ~chewygumxx/dorothy.git
// ::: :/packages/eval/src/models/cli.test.ts
//
//

import { describe, expect, it } from "bun:test";
import { CliFailure, cliAttempt } from "./cli.js";
import type { CliConfig } from "./config.js";
import { fakeCli } from "./testing.js";

const env = {
    PATH: "/mise/shims:/bin",
    HOME: "/test/home",
    CODEX_HOME: "/test/codex",
    CLAUDE_CODE_OAUTH_TOKEN: "private-token",
    ANTHROPIC_API_KEY: "api-secret",
    OPENAI_API_KEY: "api-secret",
    LANGSMITH_TRACING: "true",
    NODE_OPTIONS: "bad",
};
const messages = [
    { role: "system" as const, content: "Private system" },
    { role: "user" as const, content: "Private snapshot" },
    { role: "user" as const, content: "Next question" },
];
const schema = {
    type: "object",
    properties: { n: { type: "number" } },
    required: ["n"],
    additionalProperties: false,
};
const claude: CliConfig = { via: "claude", model: "claude-haiku-5-5" };
const codex: CliConfig = {
    via: "codex",
    model: "gpt-6.1-terra",
    effort: "medium",
};

const claudeReply = (extra = {}) =>
    JSON.stringify({
        result: "A reply",
        is_error: false,
        structured_output: { n: 3 },
        usage: {
            input_tokens: 11,
            output_tokens: 7,
            cache_read_input_tokens: 5,
        },
        ...extra,
    });

describe("CLI routes", () => {
    it("isolates Claude and sends its prompts privately", async () => {
        const fake = fakeCli(() => ({ stdout: claudeReply() }));
        const reply = await cliAttempt(claude, messages, schema, {
            env,
            timeoutMs: 1234,
            ...fake,
        });
        const request = fake.requests[0];
        expect(request).toEqual({
            command: "claude",
            cwd: "/private/eval-1",
            timeoutMs: 1234,
            args: [
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
                "claude-haiku-5-5",
                "--system-prompt-file",
                "/private/eval-1/system.txt",
                "--json-schema",
                JSON.stringify(schema),
            ],
            stdin: "Private snapshot\n\nNext question",
            env: {
                PATH: env.PATH,
                HOME: env.HOME,
                CLAUDE_CONFIG_DIR: "/private/eval-1",
                CLAUDE_CODE_OAUTH_TOKEN: "private-token",
            },
        });
        expect(fake.writes).toContainEqual({
            path: "/private/eval-1/system.txt",
            text: "Private system",
            mode: 0o600,
        });
        expect(reply).toEqual({
            text: "A reply",
            value: { n: 3 },
            input: 11,
            output: 7,
        });
        expect(fake.removed).toEqual(["/private/eval-1"]);
    });

    it("isolates Codex while retaining its login and reads its file and events", async () => {
        const fake = fakeCli((request) => {
            fake.contents.set(`${request.cwd}/reply.txt`, '{"n":3}');
            return {
                stdout: '{"type":"thread.started","thread_id":"test"}\n{"type":"turn.completed","usage":{"input_tokens":21,"cached_input_tokens":8,"output_tokens":9}}\n',
            };
        });
        expect(
            await cliAttempt(codex, messages, schema, { env, ...fake }),
        ).toEqual({ text: '{"n":3}', value: { n: 3 }, input: 21, output: 9 });
        expect(fake.requests[0]).toEqual({
            command: "codex",
            cwd: "/private/eval-1",
            timeoutMs: 120_000,
            args: [
                "exec",
                "--ephemeral",
                "--skip-git-repo-check",
                "-s",
                "read-only",
                "-C",
                "/private/eval-1",
                "--ignore-user-config",
                "--ignore-rules",
                "-c",
                "project_doc_max_bytes=0",
                "-m",
                "gpt-6.1-terra",
                "-c",
                'model_reasoning_effort="medium"',
                "--json",
                "-o",
                "/private/eval-1/reply.txt",
                "--output-schema",
                "/private/eval-1/schema.json",
                "-",
            ],
            stdin: "Private system\n\nPrivate snapshot\n\nNext question",
            env: { PATH: env.PATH, HOME: env.HOME, CODEX_HOME: env.CODEX_HOME },
        });
        expect(fake.writes).toContainEqual({
            path: "/private/eval-1/schema.json",
            text: JSON.stringify(schema),
            mode: 0o600,
        });
        expect(fake.removed).toEqual(["/private/eval-1"]);
    });

    it.each([claude, codex])(
        "completes without a schema through $via",
        async (config) => {
            const fake = fakeCli((request) => {
                fake.contents.set(`${request.cwd}/reply.txt`, "Plain text");
                return {
                    stdout:
                        config.via === "claude"
                            ? claudeReply({
                                  result: "Plain text",
                                  usage: undefined,
                              })
                            : "",
                };
            });
            expect(
                await cliAttempt(config, messages, undefined, {
                    env: {
                        PATH: "/bin",
                        HOME: "/fake",
                        CLAUDE_CODE_OAUTH_TOKEN: "test",
                    },
                    ...fake,
                }),
            ).toMatchObject({ text: "Plain text", input: 0, output: 0 });
            expect(fake.requests[0]?.args).not.toContain("--json-schema");
            expect(fake.requests[0]?.args).not.toContain("--output-schema");
            expect(fake.requests[0]?.env.CODEX_HOME).toBeUndefined();
        },
    );

    it.each([claude, codex])(
        "never quotes failed $via output",
        async (config) => {
            const fake = fakeCli(() => ({
                exitCode: 17,
                stdout: "Private snapshot private-token",
            }));
            const error = await cliAttempt(config, messages, schema, {
                env,
                ...fake,
            }).catch((e) => e);
            expect(error).toBeInstanceOf(CliFailure);
            expect(error.message).toBe(`${config.via} exited with code 17`);
            expect(error.cause).toBeUndefined();
            expect(fake.removed).toHaveLength(1);
        },
    );

    it.each([claude, codex])(
        "sanitizes a $via timeout and a failure to start",
        async (config) => {
            const timeout = fakeCli(() => ({ exitCode: 143, timedOut: true }));
            await expect(
                cliAttempt(config, messages, undefined, { env, ...timeout }),
            ).rejects.toThrow(`${config.via} exited with code 143: timed out`);
            const failed = fakeCli(() => {
                throw new Error("Private snapshot private-token");
            });
            await expect(
                cliAttempt(config, messages, undefined, { env, ...failed }),
            ).rejects.toThrow(
                `${config.via} exited with code unknown: could not run`,
            );
            expect(failed.removed).toHaveLength(1);
        },
    );

    it.each([
        [claude, "not JSON", undefined],
        [claude, claudeReply({ structured_output: undefined }), undefined],
        [claude, claudeReply({ is_error: true }), undefined],
        [codex, "", "not JSON"],
        [codex, "", undefined],
        [
            codex,
            '{"type":"turn.failed","error":{"message":"Private snapshot"}}',
            '{"n":3}',
        ],
    ] as const)(
        "rejects an unreadable reply from %o",
        async (config, stdout, output) => {
            const fake = fakeCli((request) => {
                if (output !== undefined)
                    fake.contents.set(`${request.cwd}/reply.txt`, output);
                return { stdout };
            });
            const error = await cliAttempt(config, messages, schema, {
                env,
                ...fake,
            }).catch((e) => e);
            expect(error).toBeInstanceOf(CliFailure);
            expect(error.message).toStartWith(
                `${config.via} exited with code 0:`,
            );
            expect(error.message).not.toContain("Private");
            expect(fake.removed).toHaveLength(1);
        },
    );
});

it.each(["temp", "write", "read", "remove"] as const)(
    "sanitizes a failure to %s private files",
    async (operation) => {
        const fake = fakeCli((request) => {
            fake.contents.set(`${request.cwd}/reply.txt`, '{"n":3}');
            return {};
        });
        fake.cliFiles[operation] = async () => {
            throw new Error("Private snapshot private-token");
        };
        const error = await cliAttempt(codex, messages, schema, {
            env,
            ...fake,
        }).catch((e) => e);
        expect(error).toBeInstanceOf(CliFailure);
        expect(error.message).toStartWith("codex exited with code");
        expect(error.message).not.toContain("Private");
        expect(error.message).not.toContain("private-token");
    },
);
