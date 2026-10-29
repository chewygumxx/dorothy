// vim:set expandtab shiftwidth=4 filetype=typescript:
// SPDX-License-Identifier: GPL-3.0-only

//
//
// ~chewygumxx/dorothy.git
// ::: :/packages/eval/src/run/judges.test.ts
//
//

import { expect, it } from "bun:test";
import { CORRECTNESS_PROMPT } from "openevals";
import { Models } from "../models/client.js";
import type { CliConfig } from "../models/config.js";
import { fakeCli } from "../models/testing.js";
import {
    ABSTENTION_PROMPT,
    LENIENT_PROMPT,
    makeJudges,
    STALE_PROMPT,
} from "./judges.js";

it.each([
    { via: "claude", model: "claude-haiku-5-5" },
    { via: "codex", model: "gpt-6.1-terra", effort: "medium" },
] satisfies CliConfig[])(
    "judges through $via with one attempt per verdict",
    async (config) => {
        const fake = fakeCli((request) => {
            fake.contents.set(
                `${request.cwd}/reply.txt`,
                '{"score":true,"reasoning":"Supported."}',
            );
            return {
                stdout:
                    config.via === "claude"
                        ? '{"structured_output":{"score":true,"reasoning":"Supported."}}'
                        : "",
            };
        });
        const models = new Models(
            { answer: config, judge: config, generate: null },
            {
                env: {
                    PATH: "/bin",
                    HOME: "/fake",
                    CLAUDE_CODE_OAUTH_TOKEN: "test-token",
                },
                ...fake,
            },
        );
        models.prepare("answer");
        models.prepare("judge");
        const judges = makeJudges(models);
        for (const judge of Object.values(judges)) {
            expect(
                await judge({
                    inputs: "A {question}",
                    outputs: "Answer",
                    referenceOutputs: "Gold",
                }),
            ).toEqual({ score: true, reasoning: "Supported." });
        }
        expect(models.calls).toBe(4);
        expect(fake.requests.map((request) => request.stdin)).toEqual(
            [
                CORRECTNESS_PROMPT,
                LENIENT_PROMPT,
                ABSTENTION_PROMPT,
                STALE_PROMPT,
            ].map((prompt) =>
                prompt
                    .replaceAll("{inputs}", "A {question}")
                    .replaceAll("{outputs}", "Answer")
                    .replaceAll("{reference_outputs}", "Gold"),
            ),
        );
        const json =
            config.via === "claude"
                ? fake.requests[0]?.args[
                      (fake.requests[0]?.args.indexOf("--json-schema") ?? -2) +
                          1
                  ]
                : fake.contents.get("/private/eval-1/schema.json");
        const schema = JSON.parse(json ?? "null");
        expect(schema.required).toEqual(["reasoning", "score"]);
        expect(schema.additionalProperties).toBe(false);
    },
);
