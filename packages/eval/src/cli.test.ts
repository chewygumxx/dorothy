// vim:set expandtab shiftwidth=4 filetype=typescript:
// SPDX-License-Identifier: GPL-3.0-only

//
//
// ~chewygumxx/dorothy.git
// ::: :/packages/eval/src/cli.test.ts
//
//

import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { SecretsCode } from "@dorothy/core";
import { COMMANDS, runCli } from "./cli.js";
import { configPath, ROLES } from "./models/config.js";
import { fakeCli } from "./models/testing.js";
import { writeQuestions } from "./questions/file.js";
import {
    extraQuestion,
    fakeIo,
    snapshotFixture,
    stubConfig,
    stubModels,
    tempRoot,
    writeFixtureData,
} from "./testing.js";

let temp: ReturnType<typeof tempRoot>;
beforeEach(() => {
    temp = tempRoot("cli");
});
afterEach(() => temp.remove());

describe("bun run eval", () => {
    it("gives its usage, and fails, with no command", async () => {
        const { io, err } = fakeIo();
        expect(await runCli([], io)).toBe(1);
        expect(err.join("")).toContain("Usage: bun run eval -- <command>");
        expect(err.join("")).toContain("snapshot");
    });

    it("gives its usage on --help, and succeeds", async () => {
        const { io, out } = fakeIo();
        expect(await runCli(["--help"], io)).toBe(0);
        expect(out.join("")).toContain("Usage:");
    });

    it("gives its usage on help, and succeeds", async () => {
        const { io, out } = fakeIo();
        expect(await runCli(["help"], io)).toBe(0);
        expect(out.join("")).toContain("Usage: bun run eval -- <command>");
        expect(out.join("")).toContain("compare");
    });

    it("gives a command's usage and options on --help", async () => {
        const { io, out, err } = fakeIo();
        expect(await runCli(["run", "--help"], io)).toBe(0);
        const text = out.join("");
        expect(text).toStartWith("Usage: bun run eval -- run [options]\n");
        expect(text).toContain("ask the accepted questions");
        expect(text).toMatch(/\n {2}--work <value> +the evaluation's /);
        expect(text).toMatch(/\n {2}--dry-run +count the model calls/);
        expect(text).toContain("--max-calls <value>");
        expect(err).toEqual([]);
    });

    it("gives a command's usage on help <command>, with its arguments", async () => {
        const { io, out } = fakeIo();
        expect(await runCli(["help", "compare"], io)).toBe(0);
        expect(out.join("")).toStartWith(
            "Usage: bun run eval -- compare [options] <run> <run>\n",
        );
        const { io: other, out: more } = fakeIo();
        expect(await runCli(["generate", "--work", "w", "--help"], other)).toBe(
            0,
        );
        expect(more.join("")).toMatch(/--type <value> +.*repeat/);
    });

    it("takes --help as an option's value for no help", async () => {
        const { io, out, err } = fakeIo();
        expect(await runCli(["run", "--work", "--help"], io)).toBe(1);
        expect(out).toEqual([]);
        expect(err.join("")).toStartWith("eval: ");
        expect(err.join("")).toContain("--work");
        const asked = fakeIo();
        expect(await runCli(["help", "--help"], asked.io)).toBe(0);
        expect(asked.out.join("")).toContain("Commands:");
    });

    it("describes every option of every command", () => {
        for (const [name, command] of Object.entries(COMMANDS)) {
            for (const [option, spec] of Object.entries(command.options)) {
                expect([name, option, typeof spec.description]).toEqual([
                    name,
                    option,
                    "string",
                ]);
                expect(spec.description.trim()).not.toBe("");
            }
        }
    });

    it("names a command it lacks", async () => {
        const { io, err } = fakeIo();
        expect(await runCli(["dance"], io)).toBe(1);
        expect(err.join("")).toContain("eval: no command dance");
    });

    it("takes an inherited key for no command", async () => {
        for (const name of ["constructor", "toString", "__proto__"]) {
            const { io, err } = fakeIo();
            expect(await runCli([name], io)).toBe(1);
            expect(err.join("")).toContain(`eval: no command ${name}`);
            const helped = fakeIo();
            expect(await runCli(["help", name], helped.io)).toBe(1);
            expect(helped.err.join("")).toContain(`no command ${name}`);
        }
        const { io, err } = fakeIo();
        expect(await runCli(["run", "--constructor"], io)).toBe(1);
        expect(err.join("")).toContain("--constructor");
    });

    it("names an option a command lacks", async () => {
        const { io, err } = fakeIo();
        expect(await runCli(["snapshot", "--frm", "x"], io)).toBe(1);
        expect(err.join("")).toStartWith("eval: ");
        expect(err.join("")).toContain("--frm");
    });

    it("asks for --from and --work", async () => {
        const { io, err } = fakeIo();
        expect(await runCli(["snapshot", "--work", "w"], io)).toBe(1);
        expect(err.join("")).toContain("give --from");
        expect(await runCli(["snapshot", "--from", "d"], io)).toBe(1);
        expect(err.join("")).toContain("give --work");
    });

    it("takes a snapshot", async () => {
        const data = await writeFixtureData(temp.root);
        const { io, out } = fakeIo();
        const work = join(temp.root, "work");
        expect(
            await runCli(["snapshot", "--from", data, "--work", work], io),
        ).toBe(0);
        expect(out.join("")).toBe(
            `copied 4 conversations and 3 knowledge files from ${data}\n`,
        );
    });

    it("says the links a snapshot did not follow", async () => {
        const data = await writeFixtureData(temp.root);
        symlinkSync(temp.root, join(data, "knowledge", "away"));
        const { io, out } = fakeIo();
        expect(
            await runCli(
                ["snapshot", "--from", data, "--work", join(temp.root, "w")],
                io,
            ),
        ).toBe(0);
        expect(out.join("")).toBe(
            `copied 4 conversations and 3 knowledge files from ${data}\n  skipped 1 symbolic link below the top, not followed\n`,
        );
    });
});

describe("evaluation secrets", () => {
    let stub: ReturnType<typeof stubModels> | null = null;
    afterEach(() => {
        stub?.stop();
        stub = null;
    });

    async function workWithModels(): Promise<string> {
        const work = await snapshotFixture(temp.root);
        stub = stubModels((request) => {
            if (request.body.model === "generate/model") {
                const prompt = JSON.stringify(request.body.messages);
                const id = /<item id=\\"([^\\]+)\\">/.exec(prompt)?.[1] ?? "";
                return {
                    json: {
                        questions: [
                            {
                                question: "What did I say there?",
                                answer: "Something.",
                                evidence: [id],
                                older: "",
                            },
                        ],
                    },
                };
            }
            return request.body.response_format === undefined
                ? { content: "Plot twelve." }
                : { json: { reasoning: "Checked.", score: true } };
        });
        writeFileSync(configPath(work), stubConfig(stub.url, "EVAL_TEST_KEY"));
        await writeQuestions(work, [
            {
                ...extraQuestion("Which plot is my allotment?"),
                status: "accepted",
            },
        ]);
        return work;
    }

    const argsFor = (command: string, work: string) =>
        command === "generate"
            ? [
                  command,
                  "--work",
                  work,
                  "--count",
                  "1",
                  "--type",
                  "single-session=1",
                  "--seed",
                  "5",
              ]
            : [
                  command,
                  "--work",
                  work,
                  "--systems",
                  "lexical",
                  "--concurrency",
                  "1",
              ];

    it.each(["generate", "run"])(
        "awaits checkout secrets before %s calls a model",
        async (command) => {
            const work = await workWithModels();
            const { io, err, out } = fakeIo({ env: { HOME: temp.root } });
            let loaded = 0;
            io.loadSecrets = async (path, into) => {
                expect(path).toBe(
                    new URL("../../../secrets.json", import.meta.url).pathname,
                );
                expect(into).toBe(io.env);
                await Bun.sleep(5);
                into.EVAL_TEST_KEY = "synthetic-eval-key";
                loaded++;
                return null;
            };
            expect(await runCli(argsFor(command, work), io)).toBe(0);
            expect(loaded).toBe(1);
            expect((stub?.requests.length ?? 0) > 0).toBe(true);
            expect(
                stub?.requests.every(
                    (request) =>
                        request.authorization === "Bearer synthetic-eval-key",
                ),
            ).toBe(true);
            expect(
                [...out, ...err].join("").includes("synthetic-eval-key"),
            ).toBe(false);
            expect(err).toEqual([]);
        },
    );

    it.each(
        ["generate", "run"].flatMap((command) =>
            (
                [
                    "SOPS_MISSING",
                    "SOPS_FAILED",
                    "SECRETS_INVALID",
                ] as SecretsCode[]
            ).map((code) => ({ command, code })),
        ),
    )(
        "warns by code and continues to missing-key validation (case %#)",
        async ({ command, code }) => {
            const work = await workWithModels();
            const { io, err } = fakeIo({ env: { HOME: temp.root } });
            io.loadSecrets = async () => code;
            expect(await runCli(argsFor(command, work), io)).toBe(1);
            expect(err).toEqual([
                `eval: secrets not loaded (${code})\n`,
                "eval: EVAL_TEST_KEY is not set: add it with `sops edit secrets.json`\n",
            ]);
            expect(stub?.requests.length).toBe(0);
        },
    );

    describe("a named Claude token", () => {
        const NAMED = "CLAUDE_CODE_OAUTH_TOKEN_TWO";

        async function workViaClaude(): Promise<string> {
            const work = await snapshotFixture(temp.root);
            writeFileSync(
                configPath(work),
                ROLES.map(
                    (role) =>
                        `[models.${role}]\nvia = "claude"\nmodel = "claude-haiku-5-5"\n`,
                ).join("\n"),
            );
            await writeQuestions(work, [
                {
                    ...extraQuestion("Which plot is my allotment?"),
                    status: "accepted",
                },
            ]);
            return work;
        }

        it.each(["generate", "run"])(
            "stops %s before any model call when it names no token",
            async (command) => {
                const work = await workViaClaude();
                const fake = fakeCli(() => ({ stdout: "{}" }));
                const { io, err } = fakeIo({
                    env: {
                        CLAUDE_CODE_OAUTH_TOKEN: "synthetic-other",
                        DOROTHY_CLAUDE_TOKEN_VAR:
                            "CLAUDE_CODE_OAUTH_TOKEN_MISSING",
                    },
                    modelOptions: {
                        runner: fake.runner,
                        cliFiles: fake.cliFiles,
                        findCli: fake.findCli,
                    },
                });
                expect(await runCli(argsFor(command, work), io)).toBe(1);
                expect(err).toEqual([
                    "eval: DOROTHY_CLAUDE_TOKEN_VAR names no token in secrets.json; no model was called\n",
                ]);
                expect(fake.requests).toEqual([]);
            },
        );

        it.each(["generate", "run"])(
            "gives %s's runner the token the secrets hold for it",
            async (command) => {
                const work = await workViaClaude();
                const fake = fakeCli((request) => {
                    // The verdict, question or answer each call asks for.
                    const id =
                        /<item id="([^"]+)">/.exec(request.stdin)?.[1] ?? "";
                    const value = request.args.includes("--json-schema")
                        ? command === "generate"
                            ? {
                                  questions: [
                                      {
                                          question: "What did I say there?",
                                          answer: "Something.",
                                          evidence: [id],
                                          older: "",
                                      },
                                  ],
                              }
                            : { reasoning: "Checked.", score: true }
                        : undefined;
                    return {
                        stdout: JSON.stringify({
                            result: "Plot twelve.",
                            ...(value === undefined
                                ? {}
                                : { structured_output: value }),
                            usage: { input_tokens: 1, output_tokens: 1 },
                        }),
                    };
                });
                const { io } = fakeIo({
                    env: {
                        CLAUDE_CODE_OAUTH_TOKEN: "synthetic-other",
                        DOROTHY_CLAUDE_TOKEN_VAR: NAMED,
                    },
                    modelOptions: {
                        runner: fake.runner,
                        cliFiles: fake.cliFiles,
                        findCli: fake.findCli,
                    },
                });
                io.loadSecrets = async (_path, into) => {
                    into[NAMED] = "synthetic-two";
                    return null;
                };
                expect(await runCli(argsFor(command, work), io)).toBe(0);
                expect(fake.requests.length > 0).toBe(true);
                expect(
                    fake.requests.every(
                        (request) =>
                            request.env.CLAUDE_CODE_OAUTH_TOKEN ===
                            "synthetic-two",
                    ),
                ).toBe(true);
            },
        );
    });

    it.each(["answer", "judge"])(
        "rejects a missing %s role before decrypting",
        async (missing) => {
            const work = await workWithModels();
            const kept = missing === "answer" ? "judge" : "answer";
            writeFileSync(
                configPath(work),
                `[models.${kept}]\nbase-url = "http://127.0.0.1:9/v1"\nmodel = "${kept}/model"\n`,
            );
            const { io, err } = fakeIo({ env: { HOME: temp.root } });
            let loads = 0;
            io.loadSecrets = async () => {
                loads++;
                return "SOPS_FAILED";
            };
            expect(await runCli(argsFor("run", work), io)).toBe(1);
            expect(loads).toBe(0);
            expect(err.join("")).toContain(`[models.${missing}]`);
            expect(err.join("").includes("secrets not loaded")).toBe(false);
        },
    );

    it("reports an unexpected loader exception by code alone", async () => {
        const work = await workWithModels();
        const { io, err } = fakeIo({ env: { HOME: temp.root } });
        io.loadSecrets = async () => {
            throw new Error("untrusted diagnostic");
        };
        expect(await runCli(argsFor("generate", work), io)).toBe(1);
        expect(err[0]).toBe("eval: secrets not loaded (SOPS_FAILED)\n");
        expect(err.join("").includes("untrusted diagnostic")).toBe(false);
        expect(stub?.requests.length).toBe(0);
    });

    it.each(
        [
            ["run", "--retrieval-only"],
            ["run", "--dry-run"],
            ["generate", "--dry-run"],
            ["mine"],
        ].map((command) => ({ command })),
    )(
        "loads no secrets for a command that asks no model (case %#)",
        async ({ command }) => {
            const work = await workWithModels();
            const { io } = fakeIo({ env: { HOME: temp.root } });
            let loaded = 0;
            io.loadSecrets = async () => {
                loaded++;
                return "SOPS_FAILED";
            };
            expect(await runCli([...command, "--work", work], io)).toBe(0);
            expect(loaded).toBe(0);
            expect(stub?.requests.length).toBe(0);
        },
    );

    it("loads no secrets when resuming a retrieval-only run without the flag", async () => {
        const work = await workWithModels();
        const { io, out } = fakeIo({ env: { HOME: temp.root } });
        let loaded = 0;
        io.loadSecrets = async () => {
            loaded++;
            return "SOPS_FAILED";
        };
        expect(
            await runCli(["run", "--work", work, "--retrieval-only"], io),
        ).toBe(0);
        const id = /run ([0-9A-Za-z-]+):/.exec(out.join(""))?.[1] ?? "";
        expect(id.length > 0).toBe(true);
        expect(await runCli(["run", "--work", work, "--resume", id], io)).toBe(
            0,
        );
        expect(loaded).toBe(0);
        expect(stub?.requests.length).toBe(0);
    });
});
