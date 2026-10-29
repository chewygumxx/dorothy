// vim:set expandtab shiftwidth=4 filetype=typescript:
// SPDX-License-Identifier: GPL-3.0-only

//
//
// ~chewygumxx/dorothy.git
// ::: :/packages/eval/src/models/cli.test.ts
//
//

import { describe, expect, it } from "bun:test";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { UsageError } from "../errors.js";
import { tempRoot } from "../testing.js";
import { CliFailure, cliAttempt, PlanLimit } from "./cli.js";
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
            cache_creation_input_tokens: 3,
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
            // Claude counts cached input apart from input_tokens.
            input: 19,
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
            ).rejects.toThrow(`${config.via} is not runnable`);
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

const RESET = "Nov 3rd, 2026 9:12 AM";
const codexLimit = `You've hit your usage limit. Upgrade to Pro (https://example.test/pro) or try again at ${RESET}.`;
const LIMITS = [
    [
        "Claude's credits reply",
        claude,
        JSON.stringify({
            is_error: true,
            api_error_status: 429,
            result: "Fable 5.1 requires usage credits. Switch to another model to continue.",
        }),
        1,
        "",
    ],
    [
        "Claude's 429 with any text",
        claude,
        JSON.stringify({
            is_error: true,
            api_error_status: 429,
            result: "Private snapshot",
        }),
        1,
        "",
    ],
    [
        "Claude's limit string, ending in an epoch",
        claude,
        JSON.stringify({
            is_error: true,
            result: "Claude AI usage limit reached|1793401200",
        }),
        1,
        " (try again at 2026-10-30T23:00:00.000Z)",
    ],
    [
        "Claude's rate limit text",
        claude,
        JSON.stringify({ is_error: true, result: "Rate limit exceeded" }),
        0,
        "",
    ],
    [
        "Codex's error and turn.failed events",
        codex,
        [
            '{"type":"thread.started","thread_id":"t"}',
            JSON.stringify({ type: "error", message: codexLimit }),
            JSON.stringify({
                type: "turn.failed",
                error: { message: codexLimit },
            }),
        ].join("\n"),
        1,
        ` (try again at ${RESET})`,
    ],
    [
        "Codex's turn.failed alone",
        codex,
        JSON.stringify({
            type: "turn.failed",
            error: { message: "The usage limit has been reached" },
        }),
        0,
        "",
    ],
    [
        "Codex's notice, then turn.failed, with exit 0",
        codex,
        [
            JSON.stringify({ type: "error", message: codexLimit }),
            JSON.stringify({
                type: "turn.failed",
                error: { message: "Request failed" },
            }),
        ].join("\n"),
        0,
        ` (try again at ${RESET})`,
    ],
    [
        "Codex's notice, then a non-zero exit after turn.completed",
        codex,
        [
            JSON.stringify({ type: "error", message: codexLimit }),
            '{"type":"turn.completed"}',
        ].join("\n"),
        1,
        ` (try again at ${RESET})`,
    ],
    [
        "Codex's notice with no turn.completed, exit 0",
        codex,
        JSON.stringify({ type: "error", message: codexLimit }),
        0,
        ` (try again at ${RESET})`,
    ],
    [
        "Claude's session limit, with no status",
        claude,
        JSON.stringify({
            is_error: true,
            result: "You've hit your session limit \u00b7 resets 3pm (Europe/London)",
        }),
        1,
        " (try again at 3pm)",
    ],
    [
        "Claude's weekly limit, with exit 0",
        claude,
        JSON.stringify({
            is_error: true,
            result: "You've hit your weekly limit \u00b7 resets Nov 3, 9am",
        }),
        0,
        " (try again at Nov 3, 9am)",
    ],
    [
        "Claude's limit reached, with no reset",
        claude,
        JSON.stringify({ is_error: true, result: "5-hour limit reached" }),
        1,
        "",
    ],
    [
        "Codex's workspace out of credits, in a failed turn",
        codex,
        JSON.stringify({
            type: "turn.failed",
            error: {
                message:
                    "Your workspace is out of credits. Add credits to continue.",
            },
        }),
        1,
        "",
    ],
    [
        "Claude's reset naming words, not a time",
        claude,
        JSON.stringify({
            is_error: true,
            result: "You've hit your session limit \u00b7 resets whenever you like",
        }),
        1,
        "",
    ],
    [
        "Claude's reset naming words, not a time",
        claude,
        JSON.stringify({
            is_error: true,
            result: "Usage limit reached, try again at your convenience",
        }),
        1,
        "",
    ],
    [
        "Codex's error event after an unreadable line",
        codex,
        `not JSON\n${JSON.stringify({ type: "error", message: "usage_limit_reached" })}`,
        1,
        "",
    ],
] as const;

describe("a plan's limit", () => {
    it.each(LIMITS)(
        "is read from %s",
        async (_name, config, stdout, exitCode, reset) => {
            const fake = fakeCli(() => ({ exitCode, stdout }));
            const error = await cliAttempt(config, messages, schema, {
                env,
                ...fake,
            }).catch((e) => e);
            expect(error).toBeInstanceOf(PlanLimit);
            expect(error).toBeInstanceOf(UsageError);
            expect(error).not.toBeInstanceOf(CliFailure);
            expect(error.message).toBe(
                `the ${config.via} plan's usage limit is reached${reset}`,
            );
            expect(String(error)).not.toContain("Private");
            expect(fake.removed).toHaveLength(1);
        },
    );

    it.each(["session", "weekly", "Opus", "Sonnet", "Fable"])(
        "is read from Claude's %s limit, with no status",
        async (kind) => {
            const fake = fakeCli(() => ({
                exitCode: 1,
                stdout: JSON.stringify({
                    is_error: true,
                    result: `You've hit your ${kind} limit \u00b7 resets 3pm`,
                }),
            }));
            const error = await cliAttempt(claude, messages, schema, {
                env,
                ...fake,
            }).catch((e) => e);
            expect(error).toBeInstanceOf(PlanLimit);
            expect(error.message).toBe(
                "the claude plan's usage limit is reached (try again at 3pm)",
            );
        },
    );

    it.each([
        "9:12 AM",
        "Nov 3rd, 2026 9:12 AM",
        "2026-11-03 09:12",
        "Monday 4:05 pm",
        "11/03/2026",
    ])("keeps a reset of %o that is a time or date", async (reset) => {
        const fake = fakeCli(() => ({
            exitCode: 1,
            stdout: JSON.stringify({
                is_error: true,
                result: `Usage limit reached, try again at ${reset}.`,
            }),
        }));
        const error = await cliAttempt(claude, messages, schema, {
            env,
            ...fake,
        }).catch((e) => e);
        expect(error.message).toBe(
            `the claude plan's usage limit is reached (try again at ${reset})`,
        );
    });

    // Codex says of a recovered stream what it says of a failed one.
    it("succeeds when a retry notice names a limit but the turn completes", async () => {
        const fake = fakeCli((request) => {
            fake.contents.set(`${request.cwd}/reply.txt`, '{"n":3}');
            return {
                stdout: [
                    JSON.stringify({
                        type: "error",
                        message:
                            "Reconnecting... 1/5 (rate limit exceeded: try again in 2s)",
                    }),
                    '{"type":"turn.completed","usage":{"input_tokens":5,"output_tokens":2}}',
                ].join("\n"),
            };
        });
        expect(
            await cliAttempt(codex, messages, schema, { env, ...fake }),
        ).toMatchObject({ text: '{"n":3}', value: { n: 3 }, input: 5 });
        expect(fake.removed).toHaveLength(1);
    });

    // Whatever else they come to, none of these is a limit.
    it.each([
        [
            "a Claude reply that mentions a limit but is no error",
            claude,
            claudeReply({ result: "The usage limit is a policy" }),
            0,
        ],
        [
            "a Claude error with another status and text",
            claude,
            JSON.stringify({
                is_error: true,
                api_error_status: 500,
                result: "Overloaded",
            }),
            1,
        ],
        [
            "a Codex retry notice",
            codex,
            '{"type":"error","message":"Reconnecting... 1/5"}',
            1,
        ],
        [
            "a Codex message item that mentions a limit",
            codex,
            '{"type":"item.completed","item":{"text":"usage limit"}}',
            1,
        ],
        [
            "a Claude reply that quotes a limit but is no error",
            claude,
            claudeReply({ result: "You've hit your session limit" }),
            0,
        ],
        [
            "a Claude error that hits another thing",
            claude,
            JSON.stringify({ is_error: true, result: "You hit your head" }),
            1,
        ],
        [
            "a Codex error in Claude's words for a limit",
            codex,
            '{"type":"error","message":"You\'ve hit your session limit"}',
            1,
        ],
        ["output with no event", claude, "usage limit", 1],
    ] as const)(
        "is not read from %s",
        async (_name, config, stdout, exitCode) => {
            const fake = fakeCli(() => ({ exitCode, stdout }));
            const error = await cliAttempt(config, messages, schema, {
                env,
                ...fake,
            }).catch((e) => e);
            expect(error).not.toBeInstanceOf(PlanLimit);
        },
    );
});

describe("a Codex model switch", () => {
    const switched =
        "Automatically switched to gpt-6.1-luna due to usage limits.";
    // A turn that completes with a notice among its events.
    const completed = (notice: object) => {
        const fake = fakeCli((request) => {
            fake.contents.set(`${request.cwd}/reply.txt`, '{"n":3}');
            return {
                stdout: [
                    '{"type":"thread.started","thread_id":"t"}',
                    JSON.stringify(notice),
                    '{"type":"turn.completed","usage":{"input_tokens":5,"output_tokens":2}}',
                ].join("\n"),
            };
        });
        return fake;
    };

    it.each([
        ["an error event", { type: "error", message: switched }],
        [
            "an error item",
            {
                type: "item.completed",
                item: { id: "i", type: "error", message: switched },
            },
        ],
    ])(
        "stops the run, though the turn completes, on %s",
        async (_n, notice) => {
            const fake = completed(notice);
            const error = await cliAttempt(codex, messages, schema, {
                env,
                ...fake,
            }).catch((e) => e);
            expect(error).toBeInstanceOf(PlanLimit);
            expect(error.message).toBe(
                "the codex plan switched the model to gpt-6.1-luna under its usage limits",
            );
            expect(fake.removed).toHaveLength(1);
        },
    );

    it("stops the run on a notice that does not name the model", async () => {
        const fake = completed({
            type: "error",
            message:
                "Automatically switched to a smaller model due to usage limits.",
        });
        const error = await cliAttempt(codex, messages, schema, {
            env,
            ...fake,
        }).catch((e) => e);
        expect(error).toBeInstanceOf(PlanLimit);
        expect(error.message).toBe(
            "the codex plan switched the model under its usage limits",
        );
    });

    it.each([
        [
            "a switch back",
            {
                type: "error",
                message:
                    "Automatically switched back to gpt-6.1-terra because ordinary usage is available again.",
            },
        ],
        [
            "an answer that says it",
            {
                type: "item.completed",
                item: { id: "i", type: "agent_message", text: switched },
            },
        ],
    ])("goes on past %s", async (_n, notice) => {
        const fake = completed(notice);
        expect(
            await cliAttempt(codex, messages, schema, { env, ...fake }),
        ).toMatchObject({ value: { n: 3 } });
    });
});

it.each(["temp", "write", "read"] as const)(
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

it("bounds the real runner's deadline and stops a wrapper's grandchild", async () => {
    const temp = tempRoot("cli-deadline");
    const pidsFile = join(temp.root, "pids");
    // The parent reaps its child on TERM. Killing only the parent leaves
    // sleep holding stdout open, just as the npm Codex wrapper does.
    writeFileSync(
        join(temp.root, "codex"),
        `#!/bin/sh
trap 'wait "$grandchild"; exit 0' TERM
sleep 30 &
grandchild=$!
printf '%s %s\\n' "$$" "$grandchild" > "$HOME/pids"
wait
`,
        { mode: 0o700 },
    );
    const started = performance.now();
    const attempt = cliAttempt(codex, messages, undefined, {
        env: { PATH: `${temp.root}:/usr/bin:/bin`, HOME: temp.root },
        timeoutMs: 200,
    }).catch((e: unknown) => e);
    let watchdog: ReturnType<typeof setTimeout> | undefined;
    try {
        const result = await Promise.race([
            attempt,
            new Promise<null>((resolve) => {
                watchdog = setTimeout(() => resolve(null), 1500);
            }),
        ]);
        expect(result).toBeInstanceOf(CliFailure);
        expect(performance.now() - started).toBeLessThan(1000);
        expect((result as Error).message).toContain("timed out");
        const [, grandchild] = readFileSync(pidsFile, "utf8")
            .trim()
            .split(/\s+/)
            .map(Number);
        expect(grandchild).toBeGreaterThan(0);
        expect(() => process.kill(grandchild as number, 0)).toThrow();
    } finally {
        clearTimeout(watchdog);
        const pids = readFileSync(pidsFile, "utf8")
            .trim()
            .split(/\s+/)
            .map(Number);
        for (const pid of pids) {
            try {
                process.kill(pid, "SIGKILL");
            } catch {
                /* Already gone. */
            }
        }
        await attempt;
        temp.remove();
    }
}, 5000);

it("escalates the real runner's deadline when the child ignores TERM", async () => {
    const temp = tempRoot("cli-kill");
    const pidFile = join(temp.root, "pid");
    writeFileSync(
        join(temp.root, "codex"),
        `#!/bin/sh
trap '' TERM
printf '%s\\n' "$$" > "$HOME/pid"
exec sleep 30
`,
        { mode: 0o700 },
    );
    try {
        const started = performance.now();
        const error = await cliAttempt(codex, messages, undefined, {
            env: { PATH: `${temp.root}:/usr/bin:/bin`, HOME: temp.root },
            timeoutMs: 200,
        }).catch((e: unknown) => e);
        expect(error).toBeInstanceOf(CliFailure);
        expect((error as Error).message).toContain("timed out");
        expect(performance.now() - started).toBeLessThan(1000);
        const pid = Number(readFileSync(pidFile, "utf8").trim());
        let alive = true;
        for (let poll = 0; poll < 50 && alive; poll++) {
            try {
                process.kill(pid, 0);
            } catch {
                alive = false;
            }
            if (alive) await Bun.sleep(10);
        }
        expect(alive).toBe(false);
    } finally {
        const pid = Number(readFileSync(pidFile, "utf8").trim());
        try {
            process.kill(pid, "SIGKILL");
        } catch {
            /* Already gone. */
        }
        temp.remove();
    }
}, 3000);

it("reads a normal reply through the real runner", async () => {
    const temp = tempRoot("cli-reply");
    writeFileSync(
        join(temp.root, "claude"),
        `#!/bin/sh
cat >/dev/null
printf '%s\\n' '{"result":"A reply","usage":{"input_tokens":3,"output_tokens":2}}'
`,
        { mode: 0o700 },
    );
    try {
        expect(
            await cliAttempt(claude, messages, undefined, {
                env: {
                    PATH: `${temp.root}:/usr/bin:/bin`,
                    HOME: temp.root,
                    CLAUDE_CODE_OAUTH_TOKEN: "test-token",
                },
                timeoutMs: 1000,
            }),
        ).toMatchObject({ text: "A reply", input: 3, output: 2 });
    } finally {
        temp.remove();
    }
});

it("always supplies Claude a private neutral system prompt for user-only messages", async () => {
    const fake = fakeCli(() => ({ stdout: claudeReply() }));
    await cliAttempt(
        claude,
        [{ role: "user", content: "Judge this answer." }],
        schema,
        { env, ...fake },
    );
    const args = fake.requests[0]?.args ?? [];
    expect(args).toContain("--system-prompt-file");
    expect(args[args.indexOf("--system-prompt-file") + 1]).toBe(
        "/private/eval-1/system.txt",
    );
    expect(fake.writes).toContainEqual({
        path: "/private/eval-1/system.txt",
        text: "Answer the user's request directly.",
        mode: 0o600,
    });
    expect(fake.requests[0]?.stdin).toBe("Judge this answer.");
});

it.each([claude, codex])(
    "keeps a successful $via reply when temp cleanup fails",
    async (config) => {
        const fake = fakeCli((request) => {
            fake.contents.set(`${request.cwd}/reply.txt`, '{"n":3}');
            return { stdout: config.via === "claude" ? claudeReply() : "" };
        });
        fake.cliFiles.remove = async () => {
            throw new Error("Private snapshot private-token");
        };
        expect(
            await cliAttempt(config, messages, schema, { env, ...fake }),
        ).toMatchObject({ value: { n: 3 } });
    },
);

it("keeps a paid reply when temp removal throws synchronously", async () => {
    const fake = fakeCli(() => ({ stdout: claudeReply() }));
    fake.cliFiles.remove = () => {
        throw new Error("private-token");
    };
    expect(
        await cliAttempt(claude, messages, schema, { env, ...fake }),
    ).toMatchObject({ value: { n: 3 } });
});

it("keeps the original failure when temp cleanup also fails", async () => {
    const fake = fakeCli(() => ({ exitCode: 17 }));
    fake.cliFiles.remove = async () => {
        throw new Error("Private snapshot private-token");
    };
    const error = await cliAttempt(codex, messages, schema, {
        env,
        ...fake,
    }).catch((e: unknown) => e);
    expect((error as Error).message).toBe("codex exited with code 17");
});

it.each(["ENOENT", "EACCES"])(
    "rejects an unavailable CLI through the real runner (%s)",
    async (code) => {
        const temp = tempRoot("cli-unavailable");
        if (code === "EACCES") {
            writeFileSync(join(temp.root, "codex"), "#!/bin/sh\nexit 0\n", {
                mode: 0o600,
            });
        }
        try {
            const error = await cliAttempt(codex, messages, undefined, {
                env: { PATH: temp.root, HOME: temp.root },
            }).catch((e: unknown) => e);
            expect(error).toBeInstanceOf(UsageError);
            // Bun's PATH resolver also reports ENOENT for candidates
            // without execute permission. Neither case is retryable.
            expect((error as Error).message).toMatch(
                /codex is (missing|not runnable)/,
            );
            expect((error as Error).message).not.toContain(temp.root);
        } finally {
            temp.remove();
        }
    },
);

it.each([0, 17])(
    "installs signal handlers only while a CLI attempt is live (exit %s)",
    async (exitCode) => {
        const signals = ["SIGINT", "SIGTERM", "SIGHUP"] as const;
        const before = signals.map((signal) => process.listenerCount(signal));
        let during: number[] = [];
        const fake = fakeCli(() => {
            during = signals.map((signal) => process.listenerCount(signal));
            return { exitCode, stdout: claudeReply() };
        });
        await cliAttempt(claude, messages, schema, { env, ...fake }).catch(
            () => {},
        );
        expect(during).toEqual(before.map((count) => count + 1));
        expect(signals.map((signal) => process.listenerCount(signal))).toEqual(
            before,
        );
    },
);

it.each([undefined, schema])(
    "keeps a Codex reply after a recoverable error event (schema %o)",
    async (jsonSchema) => {
        const fake = fakeCli((request) => {
            fake.contents.set(
                `${request.cwd}/reply.txt`,
                jsonSchema === undefined ? "A reply" : '{"n":3}',
            );
            return {
                stdout: '{"type":"error","message":"Reconnecting... 1/5 private snapshot"}\n{"type":"turn.completed","usage":{"input_tokens":21,"output_tokens":9}}\n',
            };
        });
        const reply = await cliAttempt(codex, messages, jsonSchema, {
            env,
            ...fake,
        });
        expect(reply).toMatchObject({ input: 21, output: 9 });
        expect(reply.text).toBe(
            jsonSchema === undefined ? "A reply" : '{"n":3}',
        );
    },
);

it.each(["exit", "turn.failed", "missing output"])(
    "rejects a failed Codex attempt despite an error event and later completion: %s",
    async (failure) => {
        const fake = fakeCli((request) => {
            if (failure !== "missing output")
                fake.contents.set(`${request.cwd}/reply.txt`, '{"n":3}');
            return {
                exitCode: failure === "exit" ? 17 : 0,
                stdout: [
                    '{"type":"error","message":"Reconnecting... 1/5 private snapshot"}',
                    ...(failure === "turn.failed"
                        ? [
                              '{"type":"turn.failed","error":{"message":"private snapshot"}}',
                          ]
                        : []),
                    '{"type":"turn.completed","usage":{"input_tokens":21,"output_tokens":9}}',
                ].join("\n"),
            };
        });
        const error = await cliAttempt(codex, messages, schema, {
            env,
            ...fake,
        }).catch((e: unknown) => e);
        expect(error).toBeInstanceOf(CliFailure);
        expect(String(error)).not.toContain("snapshot");
    },
);
