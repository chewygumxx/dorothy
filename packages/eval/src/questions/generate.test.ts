// vim:set expandtab shiftwidth=4 filetype=typescript:
// SPDX-License-Identifier: GPL-3.0-only

//
//
// ~chewygumxx/dorothy.git
// ::: :/packages/eval/src/questions/generate.test.ts
//
//

import { afterAll, afterEach, beforeAll, describe, expect, it } from "bun:test";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { runCli } from "../cli.js";
import { CallCap } from "../models/client.js";
import { configPath } from "../models/config.js";
import { workEnv } from "../snapshot/snapshot.js";
import { type Corpus, openCorpus } from "../systems/corpus.js";
import {
    fakeIo,
    GARDEN,
    snapshotFixture,
    stubConfig,
    stubModels,
    tempRoot,
} from "../testing.js";
import { type Question, questionId, readQuestions } from "./file.js";
import {
    acceptDraft,
    countsFor,
    type Draft,
    generateQuestions,
    parseTypeCounts,
    type Sample,
    sampleFor,
    seeded,
} from "./generate.js";

let temp: ReturnType<typeof tempRoot>;
let work: string;
let corpus: Corpus;

beforeAll(async () => {
    temp = tempRoot("generate");
    work = await snapshotFixture(temp.root);
    corpus = await openCorpus(workEnv(work));
});
afterAll(() => {
    corpus.close();
    temp.remove();
});

const garden: Sample = {
    type: "single-session",
    items: [{ id: `c:${GARDEN}`, text: "The allotment" }],
    ids: [`c:${GARDEN}`],
    asOf: "2026-10-01",
    project: null,
};
const draft = (fields: Partial<Draft> = {}): Draft => ({
    question: "Which plot is my allotment?",
    answer: "Plot twelve, by the river.",
    evidence: [`c:${GARDEN}`],
    older: "",
    ...fields,
});
const context = () => ({ model: "m/1", ids: new Set<string>(), corpus });

describe("counts", () => {
    it("follow LongMemEval-S's shares, scaled", () => {
        expect(countsFor(530)).toEqual({
            "single-session": 126,
            preference: 30,
            "multi-session": 133,
            "knowledge-update": 78,
            temporal: 133,
            abstention: 30,
        });
        expect(countsFor(300, { temporal: 40 }).temporal).toBe(40);
    });

    it("are read from type=count", () => {
        expect(parseTypeCounts(["temporal=40", "preference=0"])).toEqual({
            temporal: 40,
            preference: 0,
        });
        expect(() => parseTypeCounts(["lookup=3"])).toThrow(
            "--type takes single-session, preference",
        );
        expect(() => parseTypeCounts(["temporal=many"])).toThrow(
            "--type takes",
        );
    });
});

describe("samples", () => {
    it("repeat for a seed", () => {
        const [a, b] = [seeded(7), seeded(7)];
        expect([a(), a(), a()]).toEqual([b(), b(), b()]);
        expect(seeded(8)()).not.toBe(seeded(7)());
    });

    it("take one conversation for a single session", () => {
        const sample = sampleFor(
            "single-session",
            corpus,
            seeded(1),
            "2026-10-19",
        );
        expect(sample?.ids).toHaveLength(1);
        expect(sample?.ids[0]).toStartWith("c:");
    });

    it("take live personal preferences, never a retired one", () => {
        const sample = sampleFor("preference", corpus, seeded(1), "2026-10-19");
        expect(sample?.ids.sort()).toEqual([
            "k:personal/prefers-mornings",
            "k:personal/uses-helix",
        ]);
    });

    it("show a retired file beside the live ones that may replace it", () => {
        const sample = sampleFor(
            "knowledge-update",
            corpus,
            seeded(1),
            "2026-10-19",
        );
        expect(sample?.items[0]?.id).toBe("k:personal/uses-vim");
        expect(sample?.ids).not.toContain("k:personal/uses-vim");
        expect(sample?.ids).toContain("k:personal/uses-helix");
    });

    it("find nothing for many sessions where none share a project or tag", () => {
        expect(
            sampleFor("multi-session", corpus, seeded(1), "2026-10-19"),
        ).toBeNull();
    });

    it("show the topics there are for an abstention, with no evidence", () => {
        const sample = sampleFor("abstention", corpus, seeded(1), "2026-10-19");
        expect(sample?.ids).toEqual([]);
        expect(sample?.items[0]?.text).toContain("Tea at four");
    });
});

describe("a draft", () => {
    it("becomes a draft question", () => {
        expect(acceptDraft(draft(), garden, context())).toMatchObject({
            type: "single-session",
            evidence: [`c:${GARDEN}`],
            exclude: null,
            asOf: "2026-10-01",
            source: "generated:m/1",
            status: "draft",
            note: null,
        });
    });

    it("is dropped for evidence outside its sample, or an empty answer", () => {
        expect(
            acceptDraft(draft({ evidence: ["c:x"] }), garden, context()),
        ).toBe("evidence not in its sample");
        expect(acceptDraft(draft({ answer: " " }), garden, context())).toBe(
            "empty",
        );
        expect(acceptDraft(draft({ evidence: [] }), garden, context())).toBe(
            "no evidence",
        );
    });

    it("is dropped as an abstention the snapshot can answer", () => {
        const topics: Sample = { ...garden, type: "abstention", ids: [] };
        expect(
            acceptDraft(
                draft({
                    question: "What do I drink at four every afternoon?",
                    evidence: [],
                }),
                topics,
                context(),
            ),
        ).toBe("answerable");
        expect(
            acceptDraft(
                draft({
                    question: "What colour is my canoe on the lake?",
                    answer: "The memory does not say.",
                    evidence: ["c:x"],
                }),
                topics,
                context(),
            ),
        ).toMatchObject({ type: "abstention", evidence: [] });
    });

    it("keeps an update's older answer as its note", () => {
        const update: Sample = {
            ...garden,
            type: "knowledge-update",
            ids: ["k:personal/uses-helix"],
        };
        expect(
            acceptDraft(
                draft({
                    question: "Which editor do I use?",
                    answer: "Helix.",
                    evidence: ["k:personal/uses-helix"],
                    older: "Vim.",
                }),
                update,
                context(),
            ),
        ).toMatchObject({ note: "Vim." });
    });
});

describe("generation", () => {
    const counts = {
        "single-session": 2,
        preference: 0,
        "multi-session": 1,
        "knowledge-update": 0,
        temporal: 0,
        abstention: 0,
    };

    it("asks until it has the counts, and says what it dropped", async () => {
        let n = 0;
        const result = await generateQuestions({
            corpus,
            counts,
            random: seeded(3),
            model: "m/1",
            existing: [],
            today: "2026-10-19",
            draft: async (sample) => [
                {
                    question: `Question ${++n}?`,
                    answer: "An answer.",
                    evidence: sample.ids,
                    older: "",
                },
            ],
        });
        expect(result.made).toHaveLength(2);
        expect(result.dropped).toEqual({ "no material for multi-session": 1 });
        expect(result.stopped).toBeNull();
    });

    it("stops at the cap, keeping what it made", async () => {
        const result = await generateQuestions({
            corpus,
            counts,
            random: seeded(3),
            model: "m/1",
            existing: [],
            today: "2026-10-19",
            draft: async () => {
                throw new CallCap("reached --max-calls (0)");
            },
        });
        expect(result.made).toEqual([]);
        expect(result.stopped).toBe("reached --max-calls (0)");
    });
});

describe("failed calls", () => {
    const counts = {
        "single-session": 6,
        preference: 0,
        "multi-session": 0,
        "knowledge-update": 0,
        temporal: 0,
        abstention: 0,
    };
    const options = (draft: () => Promise<Draft[]>) => ({
        corpus,
        counts,
        random: seeded(3),
        model: "m/1",
        existing: [],
        today: "2026-10-19",
        draft,
    });

    it("stop at once for a refused key", async () => {
        let calls = 0;
        const result = await generateQuestions(
            options(async () => {
                calls++;
                throw Object.assign(new Error("bad key"), { status: 401 });
            }),
        );
        expect(calls).toBe(1);
        expect(result.stopped).toBe("the generating model failed: 401 bad key");
        expect(result.dropped).toEqual({ "failed call: 401 bad key": 1 });
    });

    it("stop after three in a row, naming the failure", async () => {
        let calls = 0;
        const result = await generateQuestions(
            options(async () => {
                calls++;
                throw new Error("down");
            }),
        );
        expect(calls).toBe(3);
        expect(result.dropped).toEqual({ "failed call: down": 3 });
        expect(result.stopped).toBe("the generating model failed: down");
    });

    it("go on when a call returns between failures", async () => {
        let calls = 0;
        const result = await generateQuestions(
            options(async () => {
                calls++;
                if (calls % 3 !== 0) {
                    throw new Error("down");
                }
                return [];
            }),
        );
        expect(result.stopped).toBeNull();
        expect(calls).toBeGreaterThan(3);
    });
});

describe("bun run eval -- generate", () => {
    let stub: ReturnType<typeof stubModels> | null = null;
    afterEach(() => {
        stub?.stop();
        stub = null;
    });

    it("drafts questions and records its seed", async () => {
        stub = stubModels((request) => {
            const content = JSON.stringify(request.body.messages);
            const id = /<item id=\\"([^\\]+)\\">/.exec(content)?.[1] ?? "";
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
        });
        writeFileSync(configPath(work), stubConfig(stub.url));
        const { io, out } = fakeIo();
        const code = await runCli(
            [
                "generate",
                "--work",
                work,
                "--count",
                "1",
                "--type",
                "single-session=1",
                "--seed",
                "5",
            ],
            io,
        );
        expect(code).toBe(0);
        expect(out.join("")).toContain("drafted 1 questions (seed 5)");
        const { questions } = await readQuestions(work);
        expect(questions.at(-1)).toMatchObject({
            status: "draft",
            source: "generated:generate/model",
        });
        const record = JSON.parse(
            readFileSync(join(work, "generated.json"), "utf8"),
        );
        expect(record.at(-1)).toMatchObject({
            seed: 5,
            model: "generate/model",
        });
        expect(
            (
                stub.requests[0]?.body.response_format as
                    | { type: string }
                    | undefined
            )?.type,
        ).toBe("json_schema");
    });

    it("keeps questions written while it ran", async () => {
        const extra = {
            ...(await readQuestions(work)).questions[0],
            question: "Written meanwhile?",
        } as Question;
        extra.id = questionId(extra.question, extra.evidence);
        stub = stubModels((request) => {
            // As if a review in another terminal wrote now.
            const text = readFileSync(join(work, "questions.jsonl"), "utf8");
            if (!text.includes(extra.id)) {
                writeFileSync(
                    join(work, "questions.jsonl"),
                    `${text}${JSON.stringify(extra)}\n`,
                );
            }
            const content = JSON.stringify(request.body.messages);
            const id = /<item id=\\"([^\\]+)\\">/.exec(content)?.[1] ?? "";
            return {
                json: {
                    questions: [
                        {
                            question: "What was said in that talk?",
                            answer: "Something.",
                            evidence: [id],
                            older: "",
                        },
                    ],
                },
            };
        });
        writeFileSync(configPath(work), stubConfig(stub.url));
        const { io } = fakeIo();
        expect(
            await runCli(
                [
                    "generate",
                    "--work",
                    work,
                    "--count",
                    "1",
                    "--type",
                    "single-session=1",
                    "--seed",
                    "9",
                ],
                io,
            ),
        ).toBe(0);
        const { questions } = await readQuestions(work);
        expect(questions.map((each) => each.id)).toContain(extra.id);
        expect(questions.at(-1)?.source).toBe("generated:generate/model");
    });

    it("refuses a generated.json that is not a list, writing nothing", async () => {
        stub = stubModels(() => ({ content: "" }));
        writeFileSync(configPath(work), stubConfig(stub.url));
        const path = join(work, "generated.json");
        const before = readFileSync(path, "utf8");
        const questions = readFileSync(join(work, "questions.jsonl"), "utf8");
        writeFileSync(path, "{not json");
        try {
            const { io, err } = fakeIo();
            expect(
                await runCli(["generate", "--work", work, "--count", "1"], io),
            ).toBe(1);
            expect(err.join("")).toContain("generated.json is not a list");
            expect(readFileSync(path, "utf8")).toBe("{not json");
            expect(stub.requests).toHaveLength(0);
            expect(readFileSync(join(work, "questions.jsonl"), "utf8")).toBe(
                questions,
            );
        } finally {
            writeFileSync(path, before);
        }
    });

    it("counts its calls on a dry run, and makes none", async () => {
        stub = stubModels(() => ({ content: "" }));
        writeFileSync(configPath(work), stubConfig(stub.url));
        const { io, out } = fakeIo();
        expect(
            await runCli(
                ["generate", "--work", work, "--count", "300", "--dry-run"],
                io,
            ),
        ).toBe(0);
        expect(out.join("")).toContain(
            "dry run: at least 62 calls to the generating model, each tried up to three times, for ",
        );
        expect(stub.requests).toHaveLength(0);
    });
});
