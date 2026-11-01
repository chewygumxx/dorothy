// vim:set expandtab shiftwidth=4 filetype=typescript:
// SPDX-License-Identifier: GPL-3.0-only

//
//
// ~chewygumxx/dorothy.git
// ::: :/packages/core/src/contracts/structured.test.ts
//
//

import { describe, expect, it } from "bun:test";
import {
    type StructuredOutcome,
    type StructuredRequest,
    withNotes,
} from "./structured.js";

const REQUEST: StructuredRequest = {
    what: "review",
    system: "s",
    prompt: "p",
    schema: {},
    timeoutMs: 1000,
};

describe("withNotes", () => {
    it.each([
        {
            ok: true,
            output: {},
            model: "b:m",
            costUsd: 0.1,
            notes: ["a:m refused (usage: spent); answering with b:m"],
        },
        {
            ok: false,
            reason: "a:m: usage: spent; b:m: server: down",
            costUsd: 0,
            notes: ["a:m refused (usage: spent); answering with b:m"],
        },
    ] satisfies StructuredOutcome[])(
        "says each note with what the call was for, passing the outcome on",
        async (outcome) => {
            const said: string[] = [];
            const call = withNotes(
                async () => outcome,
                (message) => said.push(message),
            );
            expect(await call(REQUEST)).toBe(outcome);
            expect(said).toEqual([
                "review: a:m refused (usage: spent); answering with b:m",
            ]);
        },
    );

    it("says nothing of an outcome with no notes", async () => {
        const said: string[] = [];
        await withNotes(
            async () => ({ ok: true, output: {}, model: "a:m", costUsd: 0 }),
            (message) => said.push(message),
        )(REQUEST);
        expect(said).toEqual([]);
    });
});
