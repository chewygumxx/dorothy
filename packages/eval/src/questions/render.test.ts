// vim:set expandtab shiftwidth=4 filetype=typescript:
// SPDX-License-Identifier: GPL-3.0-only

//
//
// ~chewygumxx/dorothy.git
// ::: :/packages/eval/src/questions/render.test.ts
//
//

import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { existsSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { GARDEN, snapshotFixture, tempRoot } from "../testing.js";
import {
    type Question,
    questionId,
    readQuestions,
    writeQuestions,
} from "./file.js";
import { renderDrafts, spotCheck } from "./render.js";

let temp: ReturnType<typeof tempRoot>;
let work: string;

const drafted = (
    question: string,
    changes: Partial<Question> = {},
): Question => ({
    id: questionId(question, [`c:${GARDEN}`]),
    type: "single-session",
    question,
    answer: "Plot twelve, by the river.",
    evidence: [`c:${GARDEN}`],
    exclude: null,
    asOf: "2026-10-19",
    project: null,
    source: "generated:m/1",
    status: "draft",
    note: null,
    ...changes,
});

const idOf = (question: string) => questionId(question, [`c:${GARDEN}`]);
const modeOf = (path: string) => statSync(path).mode & 0o777;

beforeEach(async () => {
    temp = tempRoot("render");
    work = await snapshotFixture(temp.root);
});
afterEach(() => temp.remove());

describe("renderDrafts", () => {
    const ten = Array.from({ length: 10 }, (_, at) => `Plot question ${at}?`);
    const opts = { batches: 1, source: null, chars: 6000 };

    it("splits the drafts in file order, the larger parts first", async () => {
        await writeQuestions(
            work,
            ten.map((text) => drafted(text)),
        );
        const dir = join(temp.root, "out", "drafts");
        expect(await renderDrafts(work, dir, { ...opts, batches: 3 })).toEqual([
            4, 3, 3,
        ]);
        const part = (k: number) =>
            readFileSync(join(dir, `drafts-${k}.md`), "utf8");
        const heads = (text: string) =>
            [...text.matchAll(/^## Draft (\d+) of (\d+): id (q-\w+)$/gm)].map(
                (found) => [found[1], found[2], found[3]],
            );
        expect(heads(part(1))).toEqual(
            [0, 1, 2, 3].map((at) => [
                `${at + 1}`,
                "10",
                idOf(ten[at] as string),
            ]),
        );
        expect(heads(part(2))).toEqual(
            [4, 5, 6].map((at) => [`${at + 1}`, "10", idOf(ten[at] as string)]),
        );
        expect(heads(part(3))[0]).toEqual(["8", "10", idOf(ten[7] as string)]);
        expect(heads(part(3))).toHaveLength(3);
        expect(existsSync(join(dir, "drafts-4.md"))).toBe(false);
    });

    it("keeps the files and the directory private", async () => {
        await writeQuestions(
            work,
            ten.map((text) => drafted(text)),
        );
        const dir = join(temp.root, "private");
        await renderDrafts(work, dir, { ...opts, batches: 2 });
        expect(modeOf(dir)).toBe(0o700);
        expect(modeOf(join(dir, "drafts-1.md"))).toBe(0o600);
        expect(modeOf(join(dir, "drafts-2.md"))).toBe(0o600);
    });

    it("writes each draft's question, answer, note and evidence", async () => {
        await writeQuestions(work, [
            drafted("Which plot is my allotment?", {
                project: "garden",
                note: "was plot ten",
            }),
            drafted("Where is my allotment?"),
            drafted("Already decided?", { status: "accepted" }),
        ]);
        const dir = join(temp.root, "one");
        expect(await renderDrafts(work, dir, opts)).toEqual([2]);
        const text = readFileSync(join(dir, "drafts-1.md"), "utf8");
        expect(text).toContain(
            `## Draft 1 of 2: id ${idOf("Which plot is my allotment?")}`,
        );
        expect(text).toContain(
            "Type: single-session; asked 2026-10-19; project: garden",
        );
        expect(text).toContain("Q: Which plot is my allotment?");
        expect(text).toContain("A: Plot twelve, by the river.");
        expect(text).toContain("Older claim (note): was plot ten");
        expect(text).toContain("project: none");
        expect(text.match(/Older claim/g)).toHaveLength(1);
        expect(text).toContain(`c:${GARDEN}: The allotment`);
        expect(text).not.toContain("Already decided?");
    });

    it("shows as many characters of evidence as it is told", async () => {
        await writeQuestions(work, [drafted("Which plot is my allotment?")]);
        const sized = async (chars: number) => {
            const dir = join(temp.root, `chars-${chars}`);
            await renderDrafts(work, dir, { ...opts, chars });
            return readFileSync(join(dir, "drafts-1.md"), "utf8").length;
        };
        expect(await sized(10)).toBeLessThan(await sized(6000));
    });

    it("takes only one source, with or without its prefix", async () => {
        await writeQuestions(work, [
            drafted("Which plot is my allotment?"),
            drafted("Where is my allotment?", { source: "generated:other/2" }),
            drafted("By what is my allotment?"),
        ]);
        for (const source of ["m/1", "generated:m/1"]) {
            const dir = join(temp.root, `source-${source.length}`);
            expect(await renderDrafts(work, dir, { ...opts, source })).toEqual([
                2,
            ]);
            const text = readFileSync(join(dir, "drafts-1.md"), "utf8");
            expect(text).toContain("Draft 2 of 2");
            expect(text).toContain("Q: By what is my allotment?");
            expect(text).not.toContain("Where is my allotment?");
        }
        const dir = join(temp.root, "other");
        expect(
            await renderDrafts(work, dir, { ...opts, source: "other/2" }),
        ).toEqual([1]);
    });

    it("makes no more parts than there are drafts", async () => {
        await writeQuestions(
            work,
            ten.slice(0, 2).map((text) => drafted(text)),
        );
        const dir = join(temp.root, "few");
        expect(await renderDrafts(work, dir, { ...opts, batches: 5 })).toEqual([
            1, 1,
        ]);
        expect(existsSync(join(dir, "drafts-3.md"))).toBe(false);
    });

    it("writes nothing, not even the directory, when no draft matches", async () => {
        await writeQuestions(work, [
            drafted("Which plot is my allotment?", { status: "accepted" }),
        ]);
        const dir = join(temp.root, "none");
        expect(await renderDrafts(work, dir, opts)).toEqual([]);
        expect(existsSync(dir)).toBe(false);
        await writeQuestions(work, [drafted("Which plot is my allotment?")]);
        expect(
            await renderDrafts(work, dir, { ...opts, source: "nobody/9" }),
        ).toEqual([]);
        expect(existsSync(dir)).toBe(false);
    });
});

describe("spotCheck", () => {
    const [one, two, three, four, five, six] = [
        "Which plot is my allotment?",
        "Where is my allotment?",
        "By what is my allotment?",
        "Which river runs by my allotment?",
        "What number is my allotment plot?",
        "Is my allotment still plot twelve?",
    ] as const;
    const at = "2026-10-20T10:00:00.000Z";
    const log = (...entries: object[]) =>
        writeFileSync(
            join(work, "reviews.jsonl"),
            entries
                .map(
                    (entry) =>
                        `${JSON.stringify({ reason: "", at, ...entry })}\n`,
                )
                .join(""),
        );
    const file = () => join(temp.root, "spot.md");

    beforeEach(async () => {
        await writeQuestions(work, [
            drafted(one, { status: "accepted" }),
            drafted(two, { status: "accepted" }),
            drafted(three, { status: "rejected" }),
            drafted(four, { status: "accepted" }),
            drafted(five, { status: "accepted" }),
            drafted(six),
        ]);
        log(
            {
                id: idOf(one),
                reviewer: "agent-1",
                decision: "accept",
                reason: "clear",
            },
            // An edit of a question the file now holds under its new id.
            {
                id: "q-00000000",
                newId: idOf(two),
                reviewer: "agent-1",
                decision: "edit",
            },
            // An edit whose question was rejected since.
            {
                id: "q-00000001",
                newId: idOf(three),
                reviewer: "agent-2",
                decision: "edit",
            },
            { id: idOf(four), reviewer: "agent-1", decision: "accept" },
            { id: idOf(four), reviewer: "agent-2", decision: "accept" },
            { id: idOf(five), reviewer: "agent-2", decision: "accept" },
            { id: idOf(six), reviewer: "agent-2", decision: "unsure" },
            // A reopened question, a draft again, that no one has decided.
            {
                id: idOf(six),
                reviewer: "owner",
                decision: "reopen",
                reason: "no",
            },
        );
    });

    const headings = (text: string) =>
        [...text.matchAll(/^## (Unsure|Sample) \d+: (q-\w+)/gm)].map(
            (found) => [found[1], found[2]],
        );

    it("lists the unsure drafts, then each reviewer's accepts once", async () => {
        const counts = await spotCheck(work, file(), {
            per: 15,
            random: () => 0,
        });
        expect(counts).toEqual({ unsure: 1, sampled: 4 });
        const text = readFileSync(file(), "utf8");
        const found = headings(text);
        expect(found[0]).toEqual(["Unsure", idOf(six)]);
        expect(
            found
                .slice(1)
                .map(([, id]) => id)
                .sort(),
        ).toEqual([idOf(one), idOf(two), idOf(four), idOf(five)].sort());
        expect(found.slice(1).every(([kind]) => kind === "Sample")).toBe(true);
        expect(text).toContain("Still a draft.");
        expect(text).not.toContain(idOf(three));
        expect(modeOf(file())).toBe(0o600);
    });

    it("says who decided each and how, the first to name it keeping it", async () => {
        await spotCheck(work, file(), { per: 15, random: () => 0 });
        const text = readFileSync(file(), "utf8");
        const block = (id: string) =>
            text.split("\n## ").find((part) => part.includes(`: ${id}`)) ?? "";
        expect(block(idOf(one))).toContain(
            "Decided by agent-1 (accept: clear)",
        );
        expect(block(idOf(two))).toContain("Decided by agent-1 (edit)");
        expect(block(idOf(four))).toContain("Decided by agent-1 (accept)");
        expect(block(idOf(five))).toContain("Decided by agent-2 (accept)");
        expect(block(idOf(one))).toContain("Q: Which plot is my allotment?");
        expect(block(idOf(one))).toContain(`c:${GARDEN}: The allotment`);
    });

    it("takes up to per of each reviewer's, by the random it is given", async () => {
        // random () => 0 shuffles [one, two, four] into [two, four, one].
        expect(
            await spotCheck(work, file(), { per: 1, random: () => 0 }),
        ).toEqual({
            unsure: 1,
            sampled: 2,
        });
        expect(headings(readFileSync(file(), "utf8"))).toEqual([
            ["Unsure", idOf(six)],
            ["Sample", idOf(two)],
            ["Sample", idOf(five)],
        ]);
    });

    it("takes the last of the random for another sample", async () => {
        await spotCheck(work, file(), { per: 1, random: () => 0.99 });
        expect(headings(readFileSync(file(), "utf8"))[1]).toEqual([
            "Sample",
            idOf(one),
        ]);
    });

    it("leaves out the owner's accepts", async () => {
        log(
            { id: idOf(one), reviewer: "owner", decision: "accept" },
            { id: idOf(two), reviewer: "agent-1", decision: "accept" },
        );
        expect(
            await spotCheck(work, file(), { per: 15, random: () => 0 }),
        ).toEqual({ unsure: 1, sampled: 1 });
        expect(headings(readFileSync(file(), "utf8"))).toEqual([
            ["Unsure", idOf(six)],
            ["Sample", idOf(two)],
        ]);
    });

    it("names who decided a reopened question the second time", async () => {
        log(
            { id: idOf(one), reviewer: "agent-1", decision: "accept" },
            {
                id: idOf(one),
                reviewer: "owner",
                decision: "reopen",
                reason: "no",
            },
            {
                id: idOf(one),
                reviewer: "agent-2",
                decision: "accept",
                reason: "now",
            },
        );
        expect(
            await spotCheck(work, file(), { per: 15, random: () => 0 }),
        ).toEqual({ unsure: 1, sampled: 1 });
        const text = readFileSync(file(), "utf8");
        expect(headings(text)).toEqual([
            ["Unsure", idOf(six)],
            ["Sample", idOf(one)],
        ]);
        expect(text).toContain("Decided by agent-2 (accept: now)");
        expect(text).not.toContain("agent-1");
    });

    it("drops a reopened question nobody has decided again", async () => {
        log(
            { id: idOf(one), reviewer: "agent-1", decision: "accept" },
            {
                id: idOf(one),
                reviewer: "owner",
                decision: "reopen",
                reason: "no",
            },
        );
        expect(
            await spotCheck(work, file(), { per: 15, random: () => 0 }),
        ).toEqual({ unsure: 1, sampled: 0 });
    });

    it("needs no reviews to list the unsure drafts", async () => {
        const { rm } = await import("node:fs/promises");
        await rm(join(work, "reviews.jsonl"));
        expect(
            await spotCheck(work, file(), { per: 15, random: Math.random }),
        ).toEqual({ unsure: 1, sampled: 0 });
    });

    it("leaves the questions as they are", async () => {
        const before = await readQuestions(work);
        await spotCheck(work, file(), { per: 15, random: Math.random });
        expect(await readQuestions(work)).toEqual(before);
    });
});
