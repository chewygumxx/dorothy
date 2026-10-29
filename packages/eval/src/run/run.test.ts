// vim:set expandtab shiftwidth=4 filetype=typescript:
// SPDX-License-Identifier: GPL-3.0-only

//
//
// ~chewygumxx/dorothy.git
// ::: :/packages/eval/src/run/run.test.ts
//
//

import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import {
    existsSync,
    readdirSync,
    readFileSync,
    statSync,
    writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { runCli } from "../cli.js";
import type { CliRequest } from "../models/cli.js";
import { Models } from "../models/client.js";
import { configPath, readEvalConfig } from "../models/config.js";
import { fakeCli, planLimitReply } from "../models/testing.js";
import {
    type Question,
    questionId,
    readQuestions,
    writeQuestions,
} from "../questions/file.js";
import { readSnapshot, workEnv } from "../snapshot/snapshot.js";
import { openCorpus } from "../systems/corpus.js";
import {
    fakeIo,
    GARDEN,
    snapshotFixture,
    stubConfig,
    stubModels,
    tempRoot,
} from "../testing.js";
import { readRecords, recordsPath, reportPath, summaryPath } from "./record.js";
import { newRunInfo, runEvaluation, servedAt } from "./run.js";

let temp: ReturnType<typeof tempRoot>;
let work: string;
let stub: ReturnType<typeof stubModels> | null = null;

const accepted = (
    question: string,
    fields: Partial<Question> & Pick<Question, "type">,
): Question => {
    const evidence = fields.evidence ?? [];
    return {
        id: questionId(question, evidence),
        question,
        answer: "An answer.",
        evidence,
        exclude: null,
        asOf: "2026-10-19",
        project: null,
        source: "generated:m/1",
        status: "accepted",
        note: null,
        ...fields,
    };
};

beforeEach(async () => {
    temp = tempRoot("run");
    work = await snapshotFixture(temp.root);
    expect(await runCli(["mine", "--work", work], fakeIo().io)).toBe(0);
    const { questions } = await readQuestions(work);
    await writeQuestions(work, [
        ...questions,
        accepted("Which plot is my allotment?", {
            type: "single-session",
            answer: "Plot twelve, by the river.",
            evidence: [`c:${GARDEN}`],
        }),
        accepted("What colour is my canoe?", {
            type: "abstention",
            answer: "The memory does not say.",
        }),
        accepted("Which editor do I use?", {
            type: "knowledge-update",
            answer: "Helix.",
            evidence: ["k:personal/uses-helix"],
            note: "Vim.",
        }),
    ]);
});
afterEach(() => {
    stub?.stop();
    stub = null;
    temp.remove();
});

// Judges ask for a schema; the answering model does not.
const serve = (answer: { status?: number; content?: string }) => {
    stub = stubModels((request) =>
        request.body.response_format === undefined
            ? answer
            : { json: { reasoning: "Checked.", score: true } },
    );
    writeFileSync(configPath(work), stubConfig(stub.url));
    return stub;
};
// A CLI's good reply: the judges' verdict if a schema is asked, else the
// answer. The fake is the caller's, whose files the CLI would write.
const cliReply = (
    via: "claude" | "codex",
    request: CliRequest,
    fake: ReturnType<typeof fakeCli>,
) => {
    const structured =
        request.args.includes("--json-schema") ||
        request.args.includes("--output-schema");
    const value = { score: true, reasoning: "Checked." };
    const text = structured
        ? JSON.stringify(value)
        : "Plot twelve, by the river.";
    fake.contents.set(`${request.cwd}/reply.txt`, text);
    return {
        stdout:
            via === "claude"
                ? JSON.stringify({
                      result: text,
                      ...(structured ? { structured_output: value } : {}),
                      usage: { input_tokens: 11, output_tokens: 7 },
                  })
                : '{"type":"error","message":"Reconnecting... 1/5"}\n{"type":"turn.completed","usage":{"input_tokens":11,"output_tokens":7}}',
    };
};
const idOf = (out: string[]) =>
    /run ([0-9A-Za-z-]+):/.exec(out.join(""))?.[1] ?? "";

describe("bun run eval -- run", () => {
    it.each(["claude", "codex"] as const)(
        "runs CLI answers and judges through %s with injected runners",
        async (via) => {
            writeFileSync(
                configPath(work),
                `[models.answer]\nvia = "${via}"\nmodel = "fixture-answer"\n[models.judge]\nvia = "${via}"\nmodel = "fixture-judge"\n`,
            );
            const fake = fakeCli((request) => cliReply(via, request, fake));
            const { io, out } = fakeIo({
                env: {
                    PATH: "/fixture/bin",
                    HOME: "/fixture",
                    CLAUDE_CODE_OAUTH_TOKEN: "fixture-token",
                },
                modelOptions: fake,
            });
            expect(
                await runCli(
                    [
                        "run",
                        "--work",
                        work,
                        "--systems",
                        "lexical",
                        "--concurrency",
                        "1",
                    ],
                    io,
                ),
            ).toBe(0);
            expect(fake.requests).toHaveLength(9);
            expect(
                fake.requests.every((request) => request.command === via),
            ).toBe(true);
            expect(fake.requests[0]?.stdin).toContain("<memory>");
            const id = idOf(out);
            const records = await readRecords(work, id);
            expect(
                records.every((record) => record.failures.length === 0),
            ).toBe(true);
            expect(
                records.find((record) => record.type === "single-session")
                    ?.judged.reasons,
            ).toEqual({ strict: "Checked.", lenient: "Checked." });
            expect(
                JSON.parse(
                    readFileSync(join(work, "runs", id, "run.json"), "utf8"),
                ).tokens,
            ).toEqual({
                answer: { input: 33, output: 21 },
                judge: { input: 66, output: 42 },
            });
            expect(readFileSync(reportPath(work, id), "utf8")).toContain(
                "| judge | 66 | 42 |",
            );
        },
    );

    it.each([
        ["claude", "anthropic/claude-haiku-5-5", true],
        ["codex", "openai/gpt-6.1-terra", true],
        ["claude", "openai/gpt-6.1-terra", false],
        ["codex", "anthropic/claude-haiku-5-5", false],
    ] as const)(
        "compares the vendor of %s with API judge %s",
        async (via, model, warned) => {
            writeFileSync(
                configPath(work),
                `[models.answer]\nvia = "${via}"\nmodel = "fixture-answer"\n[models.judge]\nbase-url = "http://127.0.0.1:9/v1"\nmodel = "${model}"\n`,
            );
            const fake = fakeCli((request) => {
                fake.contents.set(`${request.cwd}/reply.txt`, "Fixture answer");
                return {
                    stdout:
                        via === "claude" ? '{"result":"Fixture answer"}' : "",
                };
            });
            const { io, err } = fakeIo({
                env: {
                    PATH: "/fixture/bin",
                    HOME: "/fixture",
                    CLAUDE_CODE_OAUTH_TOKEN: "fixture-token",
                },
                modelOptions: fake,
            });
            expect(
                await runCli(
                    [
                        "run",
                        "--work",
                        work,
                        "--systems",
                        "lexical",
                        "--max-calls",
                        "1",
                    ],
                    io,
                ),
            ).toBe(0);
            expect(
                err.join("").includes("is of the answering model's vendor"),
            ).toBe(warned);
            expect(fake.requests).toHaveLength(1);
        },
    );

    it("fails once before creating a run when a CLI is missing", async () => {
        writeFileSync(
            configPath(work),
            '[models.answer]\nvia = "claude"\nmodel = "fixture"\n[models.judge]\nvia = "claude"\nmodel = "fixture"\n',
        );
        const fake = fakeCli(() => ({}));
        const { io, err } = fakeIo({
            env: {
                PATH: "/fixture/bin",
                CLAUDE_CODE_OAUTH_TOKEN: "fixture-token",
            },
            modelOptions: { ...fake, findCli: () => null },
        });
        expect(
            await runCli(["run", "--work", work, "--systems", "lexical"], io),
        ).toBe(1);
        expect(err).toHaveLength(1);
        expect(err[0]).toContain("[models.answer]: claude is not on PATH");
        expect(fake.requests).toHaveLength(0);
        expect(existsSync(join(work, "runs"))).toBe(false);
    });

    it("measures retrieval alone with no model", async () => {
        const { io, out } = fakeIo();
        expect(
            await runCli(["run", "--work", work, "--retrieval-only"], io),
        ).toBe(0);
        const id = idOf(out);
        const records = await readRecords(work, id);
        expect(records).toHaveLength(15);
        expect(records.every((each) => each.answer === null)).toBe(true);
        const tea = records.find(
            (each) =>
                each.system === "lexical" &&
                each.type === "lookup" &&
                each.retrieval.ranked.length > 0 &&
                each.recall !== null,
        );
        expect(tea?.recall?.at5).toBe(true);
        expect(existsSync(reportPath(work, id))).toBe(true);
        expect(existsSync(summaryPath(work, id))).toBe(true);
    });

    it("answers and judges, but never a lookup", async () => {
        const { requests } = serve({ content: "Plot twelve, by the river." });
        const { io, out } = fakeIo();
        expect(
            await runCli(
                [
                    "run",
                    "--work",
                    work,
                    "--systems",
                    "lexical",
                    "--concurrency",
                    "1",
                ],
                io,
            ),
        ).toBe(0);
        const records = await readRecords(work, idOf(out));
        const byType = new Map(records.map((each) => [each.type, each]));
        expect(byType.get("lookup")?.answer).toBeNull();
        // Each judgement's reasoning beside its verdict; declines has none.
        expect(byType.get("single-session")?.judged).toEqual({
            strict: true,
            lenient: true,
            declined: false,
            stale: null,
            reasons: { strict: "Checked.", lenient: "Checked." },
        });
        expect(byType.get("abstention")?.judged.declined).toBe(true);
        expect(byType.get("abstention")?.judged.reasons).toEqual({
            declined: "Checked.",
        });
        expect(byType.get("knowledge-update")?.judged.reasons?.stale).toBe(
            "Checked.",
        );
        expect(byType.get("abstention")?.judged.strict).toBeNull();
        expect(byType.get("knowledge-update")?.judged.stale).toBe(true);
        // Three answers, then judges: two, one and three.
        expect(requests).toHaveLength(9);
        const asked = JSON.stringify(requests[0]?.body.messages);
        expect(asked).toContain("<memory>");
        expect(asked).toContain("Which plot is my allotment?");
    });

    it("stops at --max-calls, keeping a paid answer, and resumes", async () => {
        const { requests } = serve({ content: "Plot twelve, by the river." });
        const first = fakeIo();
        expect(
            await runCli(
                [
                    "run",
                    "--work",
                    work,
                    "--systems",
                    "lexical",
                    "--concurrency",
                    "1",
                    "--max-calls",
                    "4",
                ],
                first.io,
            ),
        ).toBe(0);
        const id = idOf(first.out);
        expect(first.out.join("")).toContain(
            "stopped: reached --max-calls (4); resume with",
        );
        // The abstention's answer was the fourth call: its record is kept
        // with the judgement the cap stopped.
        const kept = await readRecords(work, id);
        expect(kept).toHaveLength(4);
        const capped = kept.find((each) => each.type === "abstention");
        expect(capped?.answer?.text).toBe("Plot twelve, by the river.");
        expect(capped?.failures).toEqual(["declined: reached --max-calls (4)"]);
        const infoPath = join(work, "runs", id, "run.json");
        expect(JSON.parse(readFileSync(infoPath, "utf8")).tokens).toEqual({
            answer: { input: 22, output: 14 },
            judge: { input: 22, output: 14 },
        });
        const again = fakeIo();
        const asked = requests.length;
        expect(
            await runCli(["run", "--work", work, "--resume", id], again.io),
        ).toBe(0);
        const totals = {
            answer: { input: 33, output: 21 },
            judge: { input: 66, output: 42 },
        };
        expect(JSON.parse(readFileSync(infoPath, "utf8")).tokens).toEqual(
            totals,
        );
        const report = readFileSync(reportPath(work, id), "utf8");
        expect(report).toContain("| answer | 33 | 21 |");
        expect(report).toContain("| judge | 66 | 42 |");
        expect(
            await runCli(["run", "--work", work, "--resume", id], fakeIo().io),
        ).toBe(0);
        expect(JSON.parse(readFileSync(infoPath, "utf8")).tokens).toEqual(
            totals,
        );
        // The capped record is asked its judgement alone, its answer kept;
        // the update is asked whole: an answer and three judgements.
        expect(requests.length - asked).toBe(5);
        const records = await readRecords(work, id);
        expect(
            records.find((each) => each.type === "abstention")?.answer,
        ).toEqual(capped?.answer ?? null);
        expect(records).toHaveLength(5);
        expect(new Set(records.map((each) => each.question)).size).toBe(5);
        expect(records.every((each) => each.failures.length === 0)).toBe(true);
        expect(
            readFileSync(recordsPath(work, id), "utf8").trim().split("\n"),
        ).toHaveLength(6);
    });

    it.each([
        ["claude", 1],
        ["codex", 1],
        ["claude", 5],
        ["codex", 5],
    ] as const)(
        "stops at %s's plan limit on call %d, and resumes with no miss",
        async (via, limitedAt) => {
            writeFileSync(
                configPath(work),
                `[models.answer]\nvia = "${via}"\nmodel = "fixture-answer"\n[models.judge]\nvia = "${via}"\nmodel = "fixture-judge"\n`,
            );
            let limited = true;
            const fake = fakeCli((request, count) =>
                limited && count === limitedAt
                    ? planLimitReply(via)
                    : cliReply(via, request, fake),
            );
            const options = {
                env: {
                    PATH: "/fixture/bin",
                    HOME: "/fixture",
                    CLAUDE_CODE_OAUTH_TOKEN: "fixture-token",
                },
                modelOptions: fake,
            };
            const args = [
                "run",
                "--work",
                work,
                "--systems",
                "lexical",
                "--concurrency",
                "1",
            ];
            const first = fakeIo(options);
            expect(await runCli(args, first.io)).toBe(0);
            const id = idOf(first.out);
            // One try: a limit is not retried, and nothing more is asked.
            expect(fake.requests).toHaveLength(limitedAt);
            expect(first.out.join("")).toContain(
                `stopped: the ${via} plan's usage limit is reached; resume after the reset; resume with`,
            );
            const kept = await readRecords(work, id);
            if (limitedAt === 5) {
                // The abstention's paid answer is kept, its judgement
                // not made.
                const capped = kept.find((each) => each.type === "abstention");
                expect(capped?.answer?.text).toBe("Plot twelve, by the river.");
                expect(capped?.failures).toEqual([
                    `declined: the ${via} plan's usage limit is reached; resume after the reset`,
                ]);
            }
            const asked = fake.requests.length;
            limited = false;
            const again = fakeIo(options);
            expect(
                await runCli(["run", "--work", work, "--resume", id], again.io),
            ).toBe(0);
            expect(again.out.join("")).not.toContain("stopped:");
            // What was done is not asked again.
            expect(fake.requests.length - asked).toBe(9 - (limitedAt - 1));
            const records = await readRecords(work, id);
            expect(records).toHaveLength(5);
            expect(records.every((each) => each.failures.length === 0)).toBe(
                true,
            );
            expect(
                records.find((each) => each.type === "abstention")?.judged
                    .declined,
            ).not.toBeNull();
        },
    );

    it("labels totals as partial when an older run is resumed", async () => {
        serve({ content: "Plot twelve, by the river." });
        const first = fakeIo();
        expect(
            await runCli(
                [
                    "run",
                    "--work",
                    work,
                    "--systems",
                    "lexical",
                    "--concurrency",
                    "1",
                    "--max-calls",
                    "4",
                ],
                first.io,
            ),
        ).toBe(0);
        const id = idOf(first.out);
        const path = join(work, "runs", id, "run.json");
        const old = JSON.parse(readFileSync(path, "utf8"));
        delete old.tokens;
        writeFileSync(path, JSON.stringify(old));
        expect(
            await runCli(["run", "--work", work, "--resume", id], fakeIo().io),
        ).toBe(0);
        const resumed = JSON.parse(readFileSync(path, "utf8"));
        expect(resumed.tokensPartial).toBe(true);
        expect(resumed.tokens).toEqual({
            answer: { input: 11, output: 7 },
            judge: { input: 44, output: 28 },
        });
        expect(readFileSync(reportPath(work, id), "utf8")).toContain(
            "Partial totals: earlier calls were not recorded.",
        );
    });

    it("refuses to resume on another snapshot or model", async () => {
        const { requests } = serve({ content: "Plot twelve, by the river." });
        const first = fakeIo();
        const lexical = ["run", "--work", work, "--systems", "lexical"];
        expect(await runCli(lexical, first.io)).toBe(0);
        const id = idOf(first.out);
        const kept = (await readRecords(work, id)).length;
        const calls = requests.length;
        const resume = ["run", "--work", work, "--resume", id];

        const config = readFileSync(configPath(work), "utf8");
        writeFileSync(
            configPath(work),
            config.replace("judge/model", "judge/other"),
        );
        const judged = fakeIo();
        expect(await runCli(resume, judged.io)).toBe(1);
        expect(judged.err.join("")).toContain(
            `the judge model is now judge/other, but run ${id} used judge/model; start a new run`,
        );
        writeFileSync(
            configPath(work),
            config.replace("answer/model", "answer/other"),
        );
        const answered = fakeIo();
        expect(await runCli(resume, answered.io)).toBe(1);
        expect(answered.err.join("")).toContain("the answer model is now");
        // The same model from another provider is another model.
        const url = stub?.url ?? "";
        const moved = config.replace(
            `[models.judge]\nbase-url = "${url}"`,
            `[models.judge]\nbase-url = "${url.replace("/v1", "/v2")}"`,
        );
        expect(moved).not.toBe(config);
        writeFileSync(configPath(work), moved);
        const elsewhere = fakeIo();
        expect(await runCli(resume, elsewhere.io)).toBe(1);
        expect(elsewhere.err.join("")).toContain(
            `the judge base URL is now ${url.replace("/v1", "/v2")}, but run ${id} used ${url}; start a new run`,
        );
        writeFileSync(configPath(work), config);

        const path = join(work, "snapshot.json");
        const snapshot = JSON.parse(readFileSync(path, "utf8"));
        writeFileSync(
            path,
            JSON.stringify({ ...snapshot, at: "2020-01-01T00:00:00.000Z" }),
        );
        const taken = fakeIo();
        expect(await runCli(resume, taken.io)).toBe(1);
        expect(taken.err.join("")).toContain(
            "the snapshot was taken at 2020-01-01T00:00:00.000Z, but run",
        );
        expect(taken.err.join("")).toContain("start a new run");
        expect(await readRecords(work, id)).toHaveLength(kept);
        expect(requests).toHaveLength(calls);
    });

    describe("refuses to resume when a question", () => {
        // A finished retrieval-only run, and its resume's outcome.
        const begun = async () => {
            const first = fakeIo();
            expect(
                await runCli(
                    ["run", "--work", work, "--retrieval-only"],
                    first.io,
                ),
            ).toBe(0);
            const id = idOf(first.out);
            const kept = (await readRecords(work, id)).length;
            const resume = async () => {
                const again = fakeIo();
                const status = await runCli(
                    ["run", "--work", work, "--resume", id],
                    again.io,
                );
                return { status, err: again.err.join("") };
            };
            return { id, kept, resume };
        };
        const edit = async (change: (all: Question[]) => Question[]) => {
            const { questions } = await readQuestions(work);
            await writeQuestions(work, change(questions));
        };
        const GARDEN_ID = questionId("Which plot is my allotment?", [
            `c:${GARDEN}`,
        ]);

        it("was removed since the run began", async () => {
            const { id, kept, resume } = await begun();
            await edit((all) => all.filter((each) => each.id !== GARDEN_ID));
            const { status, err } = await resume();
            expect(status).toBe(1);
            expect(err).toContain(`run ${id} began with questions`);
            expect(err).toContain(
                `${GARDEN_ID}: no longer in the accepted questions`,
            );
            expect(await readRecords(work, id)).toHaveLength(kept);
        });

        it("was rejected since the run began", async () => {
            const { resume } = await begun();
            await edit((all) =>
                all.map((each) =>
                    each.id === GARDEN_ID
                        ? { ...each, status: "rejected" }
                        : each,
                ),
            );
            const { status, err } = await resume();
            expect(status).toBe(1);
            expect(err).toContain(GARDEN_ID);
        });

        it("has another gold answer, though its id is the same", async () => {
            const { id, kept, resume } = await begun();
            await edit((all) =>
                all.map((each) =>
                    each.id === GARDEN_ID
                        ? { ...each, answer: "Plot thirteen." }
                        : each,
                ),
            );
            const { status, err } = await resume();
            expect(status).toBe(1);
            expect(err).toContain(`${GARDEN_ID}: changed since the run began`);
            expect(await readRecords(work, id)).toHaveLength(kept);
        });

        it("is new, or a run's other fields are as they were", async () => {
            const { resume } = await begun();
            await edit((all) => [
                ...all.map((each) =>
                    each.id === GARDEN_ID
                        ? { ...each, source: "generated:m/2" }
                        : each,
                ),
                accepted("What is my cat called?", {
                    type: "abstention",
                    answer: "The memory does not say.",
                }),
            ]);
            expect((await resume()).status).toBe(0);
        });

        for (const missing of ["all", "one"] as const) {
            it(`has ${missing} saved definitions missing`, async () => {
                const { id, resume } = await begun();
                const path = join(work, "runs", id, "run.json");
                const info = JSON.parse(readFileSync(path, "utf8"));
                if (missing === "all") {
                    delete info.definitions;
                } else {
                    delete info.definitions[GARDEN_ID];
                }
                writeFileSync(path, JSON.stringify(info));
                const records = readFileSync(recordsPath(work, id), "utf8");
                const metadata = readFileSync(path, "utf8");
                const { status, err } = await resume();
                expect(status).toBe(1);
                expect(err).toContain("missing question definitions");
                expect(err).toContain("start a new run");
                expect(readFileSync(recordsPath(work, id), "utf8")).toBe(
                    records,
                );
                expect(readFileSync(path, "utf8")).toBe(metadata);
            });
        }
    });

    it("resumes a run that recorded no base URL, whatever they are now", async () => {
        serve({ content: "Plot twelve, by the river." });
        const first = fakeIo();
        const lexical = ["run", "--work", work, "--systems", "lexical"];
        expect(await runCli([...lexical, "--max-calls", "4"], first.io)).toBe(
            0,
        );
        const id = idOf(first.out);
        const path = join(work, "runs", id, "run.json");
        // Written whole, through a temporary file that is gone.
        expect(
            readdirSync(join(work, "runs", id)).filter((name) =>
                name.endsWith(".tmp"),
            ),
        ).toEqual([]);
        expect(statSync(path).mode & 0o777).toBe(0o600);
        const { baseUrls, ...older } = JSON.parse(readFileSync(path, "utf8"));
        expect(baseUrls).toEqual({
            answer: stub?.url,
            judge: stub?.url,
        });
        writeFileSync(path, JSON.stringify(older));
        const config = readFileSync(configPath(work), "utf8");
        writeFileSync(configPath(work), config.replaceAll("/v1", "/v1/"));
        const again = fakeIo();
        expect(
            await runCli(["run", "--work", work, "--resume", id], again.io),
        ).toBe(0);
        expect(await readRecords(work, id)).toHaveLength(5);
    });

    it("reads no eval.toml for a run that asks no model", async () => {
        writeFileSync(configPath(work), "[models.answer\nbroken");
        const { io, out } = fakeIo();
        expect(
            await runCli(
                [
                    "run",
                    "--work",
                    work,
                    "--systems",
                    "lexical",
                    "--retrieval-only",
                ],
                io,
            ),
        ).toBe(0);
        const id = idOf(out);
        const again = fakeIo();
        expect(
            await runCli(["run", "--work", work, "--resume", id], again.io),
        ).toBe(0);
        expect(again.err).toEqual([]);
        const judged = fakeIo();
        expect(
            await runCli(["run", "--work", work, "--dry-run"], judged.io),
        ).toBe(1);
        expect(judged.err.join("")).toContain("eval.toml does not parse");
    });

    it("ends a line cut short before appending after it", async () => {
        const { io, out } = fakeIo();
        expect(
            await runCli(
                [
                    "run",
                    "--work",
                    work,
                    "--systems",
                    "lexical",
                    "--retrieval-only",
                ],
                io,
            ),
        ).toBe(0);
        const id = idOf(out);
        const path = recordsPath(work, id);
        const whole = readFileSync(path, "utf8").split("\n");
        const last = whole.at(-2) ?? "";
        // As if the last append was interrupted halfway.
        writeFileSync(
            path,
            [...whole.slice(0, -2), last.slice(0, last.length / 2)].join("\n"),
        );
        expect(await readRecords(work, id)).toHaveLength(4);
        expect(
            await runCli(["run", "--work", work, "--resume", id], fakeIo().io),
        ).toBe(0);
        expect(await readRecords(work, id)).toHaveLength(5);
        const lines = readFileSync(path, "utf8").split("\n");
        expect(lines.at(-1)).toBe("");
        expect(JSON.parse(lines.at(-2) ?? "").question).toBe(
            JSON.parse(last).question,
        );
        expect(lines.at(-3)).toBe(last.slice(0, last.length / 2));
    });

    it("refuses a run's settings given with --resume", async () => {
        const { io, out } = fakeIo();
        expect(
            await runCli(["run", "--work", work, "--retrieval-only"], io),
        ).toBe(0);
        const id = idOf(out);
        for (const given of [
            ["--systems", "lexical"],
            ["--budget", "4000"],
            ["--full-budget", "4000"],
            ["--retrieval-only"],
        ]) {
            const { io: again, err } = fakeIo();
            expect(
                await runCli(
                    ["run", "--work", work, "--resume", id, ...given],
                    again,
                ),
            ).toBe(1);
            expect(err.join("")).toContain(
                `${given[0]} is the run's own on --resume: leave it out`,
            );
        }
    });

    it("counts a dry run's calls and makes none", async () => {
        const { requests } = serve({ content: "x" });
        const { io, out } = fakeIo();
        expect(
            await runCli(
                ["run", "--work", work, "--systems", "lexical", "--dry-run"],
                io,
            ),
        ).toBe(0);
        expect(out.join("")).toBe(
            "dry run: 5 questions, 1 systems; 9 model calls\n",
        );
        expect(requests).toHaveLength(0);
    });

    it("counts on a resume's dry run only what is left", async () => {
        const { requests } = serve({ content: "Plot twelve, by the river." });
        const first = fakeIo();
        const lexical = ["run", "--work", work, "--systems", "lexical"];
        expect(
            await runCli(
                [...lexical, "--concurrency", "1", "--max-calls", "4"],
                first.io,
            ),
        ).toBe(0);
        const id = idOf(first.out);
        const asked = requests.length;
        const { io, out } = fakeIo();
        expect(
            await runCli(
                ["run", "--work", work, "--resume", id, "--dry-run"],
                io,
            ),
        ).toBe(0);
        // The capped abstention's judgement, and the update whole.
        expect(out.join("")).toBe(
            "dry run: 5 questions, 1 systems, 2 left to ask; 5 model calls\n",
        );
        expect(requests).toHaveLength(asked);
    });

    it("names a key's variable that is not set", async () => {
        stub = stubModels(() => ({ content: "x" }));
        writeFileSync(configPath(work), stubConfig(stub.url, "EVAL_KEY"));
        const { io, err } = fakeIo();
        expect(await runCli(["run", "--work", work], io)).toBe(1);
        expect(err.join("")).toContain("EVAL_KEY is not set");
    });

    it("says there is nothing to ask, or no such run", async () => {
        const { io, err } = fakeIo();
        expect(
            await runCli(["run", "--work", work, "--resume", "nope"], io),
        ).toBe(1);
        expect(err.join("")).toContain("no run nope");
        await writeQuestions(work, []);
        expect(
            await runCli(["run", "--work", work, "--retrieval-only"], io),
        ).toBe(1);
        expect(err.join("")).toContain("no accepted questions");
    });
});

describe("a run", () => {
    it("records each role's base URL with no credential in it", async () => {
        const role = (baseUrl: string, model: string) => ({
            baseUrl,
            model,
            key: "EVAL_KEY",
        });
        const info = newRunInfo(
            {
                systems: ["lexical"],
                budget: 8000,
                fullBudget: 400_000,
                retrievalOnly: false,
            },
            [],
            {
                generate: null,
                answer: role(
                    "https://user:secret@example.test/api/v1?key=secret#x",
                    "a/1",
                ),
                judge: role("http://127.0.0.1:8080/v1", "j/1"),
            },
            await readSnapshot(work),
            new Date("2026-10-19T01:00:00.000Z"),
        );
        expect(info.baseUrls).toEqual({
            answer: "https://example.test/api/v1",
            judge: "http://127.0.0.1:8080/v1",
        });
        expect(JSON.stringify(info)).not.toContain("secret");
        // A trailing slash moves no provider; a query is not kept, so a
        // change in it alone is not refused.
        expect(servedAt("http://127.0.0.1:8080/v1/")).toBe(
            "http://127.0.0.1:8080/v1",
        );
        expect(servedAt("https://Example.test/")).toBe("https://example.test");
        expect(servedAt("https://example.test/v1?api-version=2")).toBe(
            "https://example.test/v1",
        );
        const alone = newRunInfo(
            {
                systems: ["lexical"],
                budget: 8000,
                fullBudget: 400_000,
                retrievalOnly: true,
            },
            [],
            await readEvalConfig(work),
            await readSnapshot(work),
            new Date("2026-10-19T01:00:00.000Z"),
        );
        expect(alone.baseUrls).toEqual({ answer: null, judge: null });
    });

    it("records a subscription route and effort without a base URL", async () => {
        const info = newRunInfo(
            {
                systems: ["lexical"],
                budget: 8000,
                fullBudget: 400_000,
                retrievalOnly: false,
            },
            [],
            {
                generate: null,
                answer: { via: "claude", model: "claude-haiku-5-5" },
                judge: {
                    via: "codex",
                    model: "gpt-6.1-terra",
                    effort: "medium",
                },
            },
            await readSnapshot(work),
            new Date("2026-10-29T00:00:00.000Z"),
        );
        expect(info.baseUrls).toEqual({
            answer: "claude",
            judge: "codex:medium",
        });
    });

    it("records a system's failure and goes on", async () => {
        const corpus = await openCorpus(workEnv(work));
        try {
            const { questions } = await readQuestions(work);
            const info = newRunInfo(
                {
                    systems: ["broken"],
                    budget: 8000,
                    fullBudget: 400_000,
                    retrievalOnly: true,
                },
                questions,
                await readEvalConfig(work),
                await readSnapshot(work),
                new Date("2026-10-19T01:00:00.000Z"),
            );
            const { summary } = await runEvaluation(info, {
                work,
                corpus,
                questions,
                models: null,
                concurrency: 2,
                systems: [
                    {
                        name: "broken",
                        retrieve: async () => {
                            throw new Error("down");
                        },
                    },
                ],
            });
            const records = await readRecords(work, info.id);
            expect(records).toHaveLength(5);
            expect(records[0]?.retrieval.error).toBe("down");
            expect(summary.systems.broken?.all.failures).toBe(5);
        } finally {
            corpus.close();
        }
    });

    it("stops every worker at a failed append, before closing", async () => {
        const corpus = await openCorpus(workEnv(work));
        try {
            const { questions } = await readQuestions(work);
            const info = newRunInfo(
                {
                    systems: ["odd"],
                    budget: 8000,
                    fullBudget: 400_000,
                    retrievalOnly: true,
                },
                questions,
                await readEvalConfig(work),
                await readSnapshot(work),
                new Date("2026-10-19T01:00:00.000Z"),
            );
            let calls = 0;
            let closed = false;
            let lateCalls = 0;
            // The second retrieval waits until the first has returned and
            // every task queued meanwhile has run: by then the first
            // append has failed. No timing is relied on.
            let firstBack = () => {};
            const first = new Promise<void>((done) => {
                firstBack = done;
            });
            let secondBack = () => {};
            const second = new Promise<void>((done) => {
                secondBack = done;
            });
            const run = runEvaluation(info, {
                work,
                corpus,
                questions,
                models: null,
                concurrency: 2,
                systems: [
                    {
                        name: "odd",
                        retrieve: async () => {
                            const call = ++calls;
                            if (call === 1) {
                                firstBack();
                                // The first record cannot be written.
                                return { ranked: [1n as never], context: "" };
                            }
                            await first;
                            await Bun.sleep(0);
                            lateCalls += closed ? 1 : 0;
                            secondBack();
                            return { ranked: [], context: "" };
                        },
                        close: async () => {
                            closed = true;
                        },
                    },
                ],
            });
            await expect(run).rejects.toThrow("BigInt");
            await second;
            // Nothing was still retrieving when the system closed, and
            // the second worker took no task after the fault.
            expect(closed).toBe(true);
            expect(lateCalls).toBe(0);
            expect(calls).toBe(2);
        } finally {
            corpus.close();
        }
    });

    it("says whether the evidence was in context past the first ten", async () => {
        const corpus = await openCorpus(workEnv(work));
        try {
            const { questions } = await readQuestions(work);
            const info = newRunInfo(
                {
                    systems: ["wide"],
                    budget: 8000,
                    fullBudget: 400_000,
                    retrievalOnly: true,
                },
                questions,
                await readEvalConfig(work),
                await readSnapshot(work),
                new Date("2026-10-19T01:00:00.000Z"),
            );
            // As full ranks what fitted, newest first: the evidence fitted,
            // but twelfth.
            const ranked = [
                ...Array.from({ length: 11 }, (_, at) => `k:filler/${at}`),
                `c:${GARDEN}`,
            ];
            const { summary } = await runEvaluation(info, {
                work,
                corpus,
                questions,
                models: null,
                concurrency: 1,
                systems: [
                    {
                        name: "wide",
                        retrieve: async () => ({ ranked, context: "" }),
                    },
                ],
            });
            const garden = (await readRecords(work, info.id)).find(
                (each) => each.type === "single-session",
            );
            expect(garden?.retrieval.ranked).toEqual(ranked.slice(0, 10));
            expect(garden?.recall).toEqual({
                at5: false,
                at10: false,
                inContext: true,
            });
            expect(
                summary.systems.wide?.byType["single-session"]?.inContext,
            ).toEqual({ hits: 1, of: 1 });
            expect(readFileSync(reportPath(work, info.id), "utf8")).toContain(
                "| Recall@10 | In context |",
            );
        } finally {
            corpus.close();
        }
    });

    it("records a model's failure and goes on", async () => {
        serve({ status: 500 });
        const corpus = await openCorpus(workEnv(work));
        try {
            const { questions } = await readQuestions(work);
            const config = await readEvalConfig(work);
            const info = newRunInfo(
                {
                    systems: ["lexical"],
                    budget: 8000,
                    fullBudget: 400_000,
                    retrievalOnly: false,
                },
                questions,
                config,
                await readSnapshot(work),
                new Date("2026-10-19T01:00:00.000Z"),
            );
            await runEvaluation(info, {
                work,
                corpus,
                questions,
                models: new Models(config, { env: {}, retryMs: 1 }),
                concurrency: 1,
            });
            const records = await readRecords(work, info.id);
            expect(records).toHaveLength(5);
            const failed = records.find(
                (each) => each.type === "single-session",
            );
            expect(failed?.failures[0]).toStartWith("answer: 500");
            expect(failed?.judged.strict).toBeNull();
        } finally {
            corpus.close();
        }
    });

    describe("on resume", () => {
        const settings = {
            systems: ["lexical"],
            budget: 8000,
            fullBudget: 400_000,
            retrievalOnly: false,
        };
        const lines = (id: string) =>
            readFileSync(recordsPath(work, id), "utf8")
                .split("\n")
                .filter((line) => line !== "");

        it("asks a failed record again, and only that", async () => {
            let failing = true;
            stub = stubModels((request) =>
                failing
                    ? { status: 500 }
                    : request.body.response_format === undefined
                      ? { content: "Plot twelve, by the river." }
                      : { json: { reasoning: "Checked.", score: true } },
            );
            writeFileSync(configPath(work), stubConfig(stub.url));
            const corpus = await openCorpus(workEnv(work));
            try {
                const { questions } = await readQuestions(work);
                const config = await readEvalConfig(work);
                const info = newRunInfo(
                    settings,
                    questions,
                    config,
                    await readSnapshot(work),
                    new Date("2026-10-19T01:00:00.000Z"),
                );
                const go = () =>
                    runEvaluation(info, {
                        work,
                        corpus,
                        questions,
                        models: new Models(config, { env: {}, retryMs: 1 }),
                        concurrency: 1,
                    });
                expect((await go()).summary.systems.lexical?.all.failures).toBe(
                    3,
                );
                expect(lines(info.id)).toHaveLength(5);
                failing = false;
                const before = stub.requests.length;
                const { summary } = await go();
                // Three answers and six judgements, no lookup asked.
                expect(stub.requests.length - before).toBe(9);
                expect(lines(info.id)).toHaveLength(8);
                const records = await readRecords(work, info.id);
                expect(records).toHaveLength(5);
                expect(
                    records.every((each) => each.failures.length === 0),
                ).toBe(true);
                expect(summary.systems.lexical?.all.failures).toBe(0);
                // What succeeded is not asked again.
                const after = stub.requests.length;
                await go();
                expect(stub.requests).toHaveLength(after);
                expect(lines(info.id)).toHaveLength(8);
            } finally {
                corpus.close();
            }
        });

        it("asks only the judgements a paid answer lacks", async () => {
            let judging = false;
            let answers = 0;
            stub = stubModels((request) =>
                request.body.response_format === undefined
                    ? { content: `Answer ${++answers}.` }
                    : judging
                      ? { json: { reasoning: "Checked.", score: true } }
                      : { status: 500 },
            );
            writeFileSync(configPath(work), stubConfig(stub.url));
            const corpus = await openCorpus(workEnv(work));
            try {
                const { questions } = await readQuestions(work);
                const config = await readEvalConfig(work);
                const info = newRunInfo(
                    settings,
                    questions,
                    config,
                    await readSnapshot(work),
                    new Date("2026-10-19T01:00:00.000Z"),
                );
                const go = () =>
                    runEvaluation(info, {
                        work,
                        corpus,
                        questions,
                        models: new Models(config, { env: {}, retryMs: 1 }),
                        concurrency: 1,
                    });
                await go();
                const first = await readRecords(work, info.id);
                expect(answers).toBe(3);
                expect(
                    first.find((each) => each.type === "abstention")
                        ?.failures[0],
                ).toStartWith("declined: 500");
                judging = true;
                const before = stub.requests.length;
                await go();
                // Two judgements, one and three: no answer asked again.
                expect(stub.requests.length - before).toBe(6);
                expect(answers).toBe(3);
                const records = await readRecords(work, info.id);
                for (const each of records) {
                    const was = first.find(
                        (old) => old.question === each.question,
                    );
                    expect(each.answer).toEqual(was?.answer ?? null);
                    expect(each.retrieval).toEqual(
                        was?.retrieval as typeof each.retrieval,
                    );
                    expect(each.failures).toEqual([]);
                }
                const update = records.find(
                    (each) => each.type === "knowledge-update",
                );
                expect(update?.judged).toEqual({
                    strict: true,
                    lenient: true,
                    declined: false,
                    stale: true,
                    reasons: {
                        strict: "Checked.",
                        lenient: "Checked.",
                        stale: "Checked.",
                    },
                });
                expect(lines(info.id)).toHaveLength(8);
            } finally {
                corpus.close();
            }
        });

        it("spends no model call on a failed retrieval", async () => {
            const { requests } = serve({ content: "Plot twelve." });
            const corpus = await openCorpus(workEnv(work));
            try {
                const { questions } = await readQuestions(work);
                const config = await readEvalConfig(work);
                const info = newRunInfo(
                    { ...settings, systems: ["broken"] },
                    questions,
                    config,
                    await readSnapshot(work),
                    new Date("2026-10-19T01:00:00.000Z"),
                );
                await runEvaluation(info, {
                    work,
                    corpus,
                    questions,
                    models: new Models(config, { env: {}, retryMs: 1 }),
                    concurrency: 1,
                    systems: [
                        {
                            name: "broken",
                            retrieve: async () => {
                                throw new Error("down");
                            },
                        },
                    ],
                });
                expect(requests).toHaveLength(0);
                const records = await readRecords(work, info.id);
                expect(records).toHaveLength(5);
                expect(
                    records.every(
                        (each) =>
                            each.retrieval.error === "down" &&
                            each.answer === null,
                    ),
                ).toBe(true);
            } finally {
                corpus.close();
            }
        });
    });
});
