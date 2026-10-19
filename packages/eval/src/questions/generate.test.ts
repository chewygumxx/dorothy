// vim:set expandtab shiftwidth=4 filetype=typescript:
// SPDX-License-Identifier: GPL-3.0-only

//
//
// ~chewygumxx/dorothy.git
// ::: :/packages/eval/src/questions/generate.test.ts
//
//

import { afterAll, afterEach, beforeAll, describe, expect, it } from "bun:test";
import {
    existsSync,
    mkdirSync,
    readFileSync,
    rmSync,
    writeFileSync,
} from "node:fs";
import { join } from "node:path";
import type { ArchiveConversation } from "@dorothy/memory/evaluation";
import { runCli } from "../cli.js";
import { CallCap } from "../models/client.js";
import { configPath } from "../models/config.js";
import { workEnv } from "../snapshot/snapshot.js";
import { type Corpus, openCorpus } from "../systems/corpus.js";
import {
    extraQuestion,
    fakeIo,
    GARDEN,
    snapshotFixture,
    stubConfig,
    stubModels,
    tempRoot,
    whileLocked,
} from "../testing.js";
import { locking, type Question, questionId, readQuestions } from "./file.js";
import {
    acceptDraft,
    answerable,
    countsFor,
    type Draft,
    draftPrompt,
    generateQuestions,
    latestDay,
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
const context = (ids = new Map<string, Question>()) => ({
    model: "m/1",
    ids,
    corpus,
});

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

    it("pass over a retired file nothing live may have replaced", () => {
        const orphan: Corpus = {
            ...corpus,
            knowledge: new Map(
                [...corpus.knowledge].filter(
                    ([id]) => id === "k:personal/uses-vim",
                ),
            ),
        };
        expect(
            sampleFor("knowledge-update", orphan, seeded(1), "2026-10-19"),
        ).toBeNull();
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

describe("an update from a revising conversation", () => {
    const talk = (
        id: string,
        project: string | null,
        first: string,
        last: string,
        text: string,
    ): ArchiveConversation => ({
        id: `c:${id}`,
        phrase: id,
        project,
        title: id,
        tags: [],
        firstAt: first,
        lastAt: last,
        turns: [
            { n: 1, role: "user", at: first, text },
            { n: 2, role: "assistant", at: last, text: "Noted." },
        ],
    });
    // Two in one project, the later begun after the earlier ended; one
    // overlapping the first; one alone.
    const conversations = [
        talk(
            "plan-a",
            "p",
            "2026-09-01T10:00:00.000Z",
            "2026-09-01T11:00:00.000Z",
            "We deploy on Fridays.",
        ),
        talk(
            "plan-b",
            "p",
            "2026-09-08T10:00:00.000Z",
            "2026-09-08T11:00:00.000Z",
            "We now deploy on Tuesdays instead.",
        ),
        talk(
            "aside",
            "q",
            "2026-09-02T10:00:00.000Z",
            "2026-09-02T11:00:00.000Z",
            "Something else.",
        ),
    ];
    const revising = (
        knowledge = new Map(),
        extra: ArchiveConversation[] = [],
    ) =>
        ({
            ...corpus,
            conversations: new Map(
                [...conversations, ...extra].map((each) => [each.id, each]),
            ),
            knowledge,
        }) as Corpus;

    it("shows the earlier conversation before the later, the later its evidence", () => {
        const sample = sampleFor(
            "knowledge-update",
            revising(),
            seeded(1),
            "2026-10-19",
        );
        expect(sample?.items.map((each) => each.id)).toEqual([
            "c:plan-a",
            "c:plan-b",
        ]);
        expect(sample?.ids).toEqual(["c:plan-b"]);
        expect(sample?.project).toBe("p");
        expect(sample?.items[1]?.text).toContain("Tuesdays");
        const prompt = draftPrompt(sample as Sample, 3);
        expect(prompt[0]?.content).toContain("The later conversation");
        expect(prompt[0]?.content).not.toContain("was retired");
    });

    it("pairs no two conversations that overlap", () => {
        const overlapping = revising(new Map(), [
            talk(
                "plan-c",
                "r",
                "2026-09-01T10:00:00.000Z",
                "2026-09-03T10:00:00.000Z",
                "One thing.",
            ),
            talk(
                "plan-d",
                "r",
                "2026-09-02T10:00:00.000Z",
                "2026-09-04T10:00:00.000Z",
                "Another.",
            ),
        ]);
        for (let seed = 0; seed < 20; seed++) {
            const sample = sampleFor(
                "knowledge-update",
                overlapping,
                seeded(seed),
                "2026-10-19",
            );
            expect(sample?.ids).toEqual(["c:plan-b"]);
        }
    });

    it("draws from retired files and revising conversations both", () => {
        const both = revising(corpus.knowledge);
        const firsts = new Set<string>();
        for (let seed = 0; seed < 20; seed++) {
            const sample = sampleFor(
                "knowledge-update",
                both,
                seeded(seed),
                "2026-10-19",
            );
            firsts.add(sample?.items[0]?.id ?? "none");
        }
        expect([...firsts].sort()).toEqual(["c:plan-a", "k:personal/uses-vim"]);
    });

    it("takes the latest of its project as what is true now", () => {
        // Fridays, then Tuesdays, then Wednesdays: Wednesdays stands.
        const thrice = revising(new Map(), [
            talk(
                "plan-c",
                "p",
                "2026-09-15T10:00:00.000Z",
                "2026-09-15T11:00:00.000Z",
                "We have moved deploys to Wednesdays.",
            ),
        ]);
        const earlier = new Set<string>();
        for (let seed = 0; seed < 20; seed++) {
            const sample = sampleFor(
                "knowledge-update",
                thrice,
                seeded(seed),
                "2026-10-19",
            );
            expect(sample?.ids).toEqual(["c:plan-c"]);
            expect(sample?.items[1]?.id).toBe("c:plan-c");
            earlier.add(sample?.items[0]?.id ?? "none");
            expect(draftPrompt(sample as Sample, 1)[0]?.content).toContain(
                "the latest of its project or tag",
            );
        }
        expect([...earlier].sort()).toEqual(["c:plan-a", "c:plan-b"]);
    });

    it("draw each source by how much of it there is", () => {
        // One retired file against three projects with a revision each.
        const projects = ["x", "y", "z"].flatMap((project) => [
            talk(
                `${project}-1`,
                project,
                "2026-09-01T10:00:00.000Z",
                "2026-09-01T11:00:00.000Z",
                "First.",
            ),
            talk(
                `${project}-2`,
                project,
                "2026-09-09T10:00:00.000Z",
                "2026-09-09T11:00:00.000Z",
                "Second.",
            ),
        ]);
        const many = {
            ...corpus,
            conversations: new Map(projects.map((each) => [each.id, each])),
        } as Corpus;
        let retired = 0;
        for (let seed = 0; seed < 200; seed++) {
            const sample = sampleFor(
                "knowledge-update",
                many,
                seeded(seed),
                "2026-10-19",
            );
            retired += sample?.items[0]?.id.startsWith("k:") ? 1 : 0;
        }
        // A quarter, some 50, not the half an even split would give.
        expect(retired).toBeGreaterThan(25);
        expect(retired).toBeLessThan(75);
    });

    it("meet the type's count with no retired file at all", async () => {
        const result = await generateQuestions({
            corpus: revising(),
            counts: {
                "single-session": 0,
                preference: 0,
                "multi-session": 0,
                "knowledge-update": 2,
                temporal: 0,
                abstention: 0,
            },
            random: seeded(4),
            model: "m/1",
            existing: [],
            today: "2026-10-19",
            draft: async (sample) => [
                {
                    question: "Which day do we deploy on?",
                    answer: "Tuesdays.",
                    evidence: sample.ids,
                    older: "Fridays.",
                },
                {
                    question: "When do our deploys go out?",
                    answer: "On Tuesdays.",
                    evidence: sample.ids,
                    older: "On Fridays.",
                },
            ],
        });
        expect(result.made.map((each) => [each.evidence, each.note])).toEqual([
            [["c:plan-b"], "Fridays."],
            [["c:plan-b"], "On Fridays."],
        ]);
        expect(result.dropped).toEqual({});
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

    it("is dropped as a repeat, or as another question with its id", () => {
        const made = acceptDraft(draft(), garden, context()) as Question;
        const held = new Map([[made.id, made]]);
        expect(acceptDraft(draft(), garden, context(held))).toBe("duplicate");
        const other = { ...made, question: "A different question?" };
        expect(
            acceptDraft(draft(), garden, context(new Map([[made.id, other]]))),
        ).toBe("id collision");
    });

    it("is dropped as many sessions' that cites only one conversation", () => {
        const many: Sample = {
            ...garden,
            type: "multi-session",
            ids: [`c:${GARDEN}`, "c:other"],
        };
        expect(acceptDraft(draft(), many, context())).toBe("one conversation");
        expect(
            acceptDraft(
                draft({ evidence: [`c:${GARDEN}`, "c:other"] }),
                many,
                context(),
            ),
        ).toMatchObject({ evidence: [`c:${GARDEN}`, "c:other"] });
    });

    it("is dropped as malformed for a path no evidence has, or a long question", () => {
        const odd: Sample = { ...garden, ids: ["nowhere", "c:"] };
        expect(
            acceptDraft(draft({ evidence: ["nowhere"] }), odd, context()),
        ).toBe("malformed");
        expect(acceptDraft(draft({ evidence: ["c:"] }), odd, context())).toBe(
            "malformed",
        );
        expect(
            acceptDraft(
                draft({ question: "Why?".repeat(700) }),
                garden,
                context(),
            ),
        ).toBe("malformed");
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

describe("the prompt", () => {
    const system = (sample: Sample, n = 3) =>
        draftPrompt(sample, n)[0]?.content ?? "";

    it("gives its type's guidance, the day and how many to write", () => {
        const content = system(garden, 3);
        expect(content).toContain("Ask about one specific detail");
        expect(content).toContain("Today is 2026-10-01.");
        expect(content).toEndWith("Write at most 3 questions.");
        expect(system({ ...garden, type: "temporal" })).toContain(
            "the order of events",
        );
    });

    it("gives a sample's own guidance in place of its type's", () => {
        const content = system({ ...garden, guidance: "Ask only about tea." });
        expect(content).toContain("Ask only about tea.");
        expect(content).not.toContain("Ask about one specific detail");
    });

    it("gives the items as the user, each by its id", () => {
        const [, user] = draftPrompt(garden, 1);
        expect(user?.role).toBe("user");
        expect(user?.content).toContain(`c:${GARDEN}`);
        expect(user?.content).toContain("The allotment");
    });
});

describe("the last day", () => {
    it("is the day of the snapshot's last turn", () => {
        expect(latestDay(corpus)).toBe("2026-10-01");
    });

    it("is none for a snapshot of no conversations", () => {
        const none = { ...corpus, conversations: new Map() } as Corpus;
        expect(latestDay(none)).toBeNull();
    });
});

describe("an answerable question", () => {
    it("is one the snapshot holds enough of the terms of", () => {
        expect(answerable("What colour is my canoe on the lake?", corpus)).toBe(
            false,
        );
        expect(answerable("Plot twelve by the river?", corpus)).toBe(true);
    });

    it("of one term is answerable when a turn holds it", () => {
        expect(answerable("Derailleur?", corpus)).toBe(true);
        expect(answerable("Canoe?", corpus)).toBe(false);
    });

    it("of no term is not", () => {
        expect(answerable("Is it?", corpus)).toBe(false);
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

    it("hands the drafts of each call over before it asks the next", async () => {
        const events: string[] = [];
        let n = 0;
        await generateQuestions({
            corpus,
            counts: { ...counts, "single-session": 10, "multi-session": 0 },
            random: seeded(3),
            model: "m/1",
            existing: [],
            today: "2026-10-19",
            draft: async (sample) => {
                events.push("asked");
                return [
                    {
                        question: `Handed over ${++n}?`,
                        answer: "An answer.",
                        evidence: sample.ids,
                        older: "",
                    },
                ];
            },
            keep: async (drafts) => {
                events.push(`kept ${drafts.map((each) => each.question)}`);
            },
        });
        expect(events.slice(0, 4)).toEqual([
            "asked",
            "kept Handed over 1?",
            "asked",
            "kept Handed over 2?",
        ]);
    });

    it("stops when it cannot keep a draft, handing it back unkept", async () => {
        let asked = 0;
        const result = await generateQuestions({
            corpus,
            counts,
            random: seeded(3),
            model: "m/1",
            existing: [],
            today: "2026-10-19",
            draft: async (sample) => {
                asked++;
                return [
                    {
                        question: "Unkept?",
                        answer: "An answer.",
                        evidence: sample.ids,
                        older: "",
                    },
                ];
            },
            keep: async () => {
                throw new Error("disk full");
            },
        });
        expect(asked).toBe(1);
        expect(result.stopped).toBe("could not keep the drafts: disk full");
        expect(result.unkept.map((each) => each.question)).toEqual(["Unkept?"]);
        expect(result.made).toHaveLength(1);
    });

    it("counts a reply of no questions", async () => {
        const result = await generateQuestions({
            corpus,
            counts: { ...counts, "single-session": 6, "multi-session": 0 },
            random: seeded(3),
            model: "m/1",
            existing: [],
            today: "2026-10-19",
            draft: async () => [],
        });
        expect(result.made).toEqual([]);
        expect(result.dropped).toEqual({ "reply with no questions": 6 });
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
        expect(result.unkept).toEqual([]);
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

    // One question a call, each its own, citing the first item shown.
    const oneEach = (
        tag: string,
        between: (count: number, evidence: string) => void = () => {},
    ) =>
        stubModels((request, count) => {
            const content = JSON.stringify(request.body.messages);
            const id = /<item id=\\"([^\\]+)\\">/.exec(content)?.[1] ?? "";
            between(count, id);
            return {
                json: {
                    questions: [
                        {
                            question: `${tag} number ${count}?`,
                            answer: "Something.",
                            evidence: [id],
                            older: "",
                        },
                    ],
                },
            };
        });
    const generate = (...args: string[]) => {
        const { io, out, err } = fakeIo();
        return {
            out,
            err,
            code: runCli(
                ["generate", "--work", work, "--count", "1", ...args],
                io,
            ),
        };
    };

    it("writes each call's drafts as they arrive, and says the seed first", async () => {
        const seen: boolean[] = [];
        stub = oneEach("Arrival", (count) => {
            if (count === 2) {
                seen.push(
                    readFileSync(
                        join(work, "questions.jsonl"),
                        "utf8",
                    ).includes("Arrival number 1?"),
                );
            }
        });
        writeFileSync(configPath(work), stubConfig(stub.url));
        const run = generate("--type", "single-session=10", "--seed", "11");
        expect(await run.code).toBe(0);
        expect(seen).toEqual([true]);
        expect(run.out[0]).toBe("seed 11\n");
    });

    it("says what fell short of what was asked", async () => {
        stub = oneEach("Short");
        writeFileSync(configPath(work), stubConfig(stub.url));
        const run = generate("--type", "single-session=10", "--seed", "12");
        expect(await run.code).toBe(0);
        const shown = run.out.join("");
        expect(shown).toContain("drafted 6 questions (seed 12)");
        expect(shown).toContain("  short: single-session made 6 of 10\n");
    });

    it("keeps the drafts when generated.json is spoilt meanwhile", async () => {
        const path = join(work, "generated.json");
        const before = readFileSync(path, "utf8");
        stub = oneEach("Spoilt", (count) => {
            if (count === 2) {
                writeFileSync(path, "{not json");
            }
        });
        writeFileSync(configPath(work), stubConfig(stub.url));
        try {
            const run = generate("--type", "single-session=10", "--seed", "13");
            expect(await run.code).toBe(1);
            expect(run.err.join("")).toContain(
                "generated.json is not a list: mend or remove it",
            );
            expect(run.err.join("")).toContain(
                "6 drafts are in questions.jsonl",
            );
            const { questions } = await readQuestions(work);
            expect(
                questions.filter((each) => each.question.startsWith("Spoilt"))
                    .length,
            ).toBe(6);
            expect(readFileSync(path, "utf8")).toBe("{not json");
        } finally {
            writeFileSync(path, before);
        }
    });

    it("waits for another writer's lock, and keeps what it wrote", async () => {
        stub = oneEach("Waiting");
        writeFileSync(configPath(work), stubConfig(stub.url));
        const extra = extraQuestion("Which river runs by the allotment?");
        const run = await whileLocked(work, extra, async () => {
            const each = generate("--type", "single-session=5", "--seed", "15");
            expect(await each.code).toBe(0);
            return each;
        });
        expect(run.out.join("")).toContain("drafted 3 questions");
        const { questions } = await readQuestions(work);
        expect(questions.map((each) => each.question)).toContain(
            extra.question,
        );
        expect(
            questions.filter((each) => each.question.startsWith("Waiting"))
                .length,
        ).toBe(3);
    });

    it("does not count a draft another command had written", async () => {
        stub = oneEach("Twice", (count, evidence) => {
            if (count === 1) {
                const text = "Twice number 1?";
                const path = join(work, "questions.jsonl");
                const there = {
                    ...extraQuestion(text),
                    id: questionId(text, [evidence]),
                    evidence: [evidence],
                };
                writeFileSync(
                    path,
                    `${readFileSync(path, "utf8")}${JSON.stringify(there)}\n`,
                );
            }
        });
        writeFileSync(configPath(work), stubConfig(stub.url));
        const run = generate("--type", "single-session=5", "--seed", "16");
        expect(await run.code).toBe(0);
        const shown = run.out.join("");
        expect(shown).toContain("drafted 2 questions (seed 16)");
        expect(shown).toContain(
            "  not added 1: another command had written the same ids\n",
        );
        const record = JSON.parse(
            readFileSync(join(work, "generated.json"), "utf8"),
        );
        expect(record.at(-1)).toMatchObject({ notAdded: 1 });
    });

    it("says the drafts were kept on a second try, when they were", async () => {
        const lock = join(work, "questions.jsonl.lock");
        stub = oneEach("Retried", () => writeFileSync(lock, "1\n"));
        writeFileSync(configPath(work), stubConfig(stub.url));
        const kept = { ...locking };
        let sleeps = 0;
        // The lock is there for the first keep and gone for the second.
        Object.assign(locking, {
            tries: 2,
            sleep: async () => {
                if (++sleeps === 2) {
                    rmSync(lock);
                }
            },
        });
        try {
            const run = generate("--type", "single-session=10", "--seed", "17");
            expect(await run.code).toBe(0);
            const shown = run.out.join("");
            expect(shown).toContain("drafted 1 questions (seed 17)");
            expect(shown).toContain("stopped: could not keep the drafts: ");
            expect(shown).toEndWith("; kept at the end, on a second try\n");
            expect(stub.requests).toHaveLength(1);
            expect(existsSync(lock)).toBe(false);
        } finally {
            Object.assign(locking, kept);
        }
    });

    it("refuses a generated.json it cannot read, before any call", async () => {
        const path = join(work, "generated.json");
        const before = readFileSync(path, "utf8");
        stub = oneEach("Unread");
        writeFileSync(configPath(work), stubConfig(stub.url));
        rmSync(path);
        mkdirSync(path);
        try {
            const run = generate("--type", "single-session=5");
            expect(await run.code).toBe(1);
            expect(run.err.join("")).toContain(`cannot read ${path}: EISDIR`);
            expect(stub.requests).toHaveLength(0);
        } finally {
            rmSync(path, { recursive: true });
            writeFileSync(path, before);
        }
    });

    it("says where the drafts are when generated.json cannot be read at the end", async () => {
        const path = join(work, "generated.json");
        const before = readFileSync(path, "utf8");
        stub = oneEach("Unrecorded", (count) => {
            if (count === 1) {
                rmSync(path);
                mkdirSync(path);
            }
        });
        writeFileSync(configPath(work), stubConfig(stub.url));
        try {
            const run = generate("--type", "single-session=10", "--seed", "18");
            expect(await run.code).toBe(1);
            expect(run.err.join("")).toContain(
                `cannot read ${path}: EISDIR; mend it, or remove it to start again; the 6 drafts are in questions.jsonl`,
            );
        } finally {
            rmSync(path, { recursive: true });
            writeFileSync(path, before);
        }
    });

    it("prints the drafts it could not write to the question file", async () => {
        const path = join(work, "questions.jsonl");
        const before = readFileSync(path, "utf8");
        stub = oneEach("Unwritten", () => writeFileSync(path, "not json\n"));
        writeFileSync(configPath(work), stubConfig(stub.url));
        try {
            const run = generate("--type", "single-session=10", "--seed", "14");
            expect(await run.code).toBe(1);
            const said = run.err.join("");
            expect(said).toContain("questions.jsonl:1: not JSON");
            expect(said).toContain('"question":"Unwritten number 1?"');
            expect(stub.requests).toHaveLength(1);
        } finally {
            writeFileSync(path, before);
        }
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
