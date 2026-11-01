// vim:set expandtab shiftwidth=4 filetype=typescript:
// SPDX-License-Identifier: GPL-3.0-only

//
//
// ~chewygumxx/dorothy.git
// ::: :/packages/agent/src/one-shot.test.ts
//
//

import { afterEach, describe, expect, it } from "bun:test";
import { defaultRoutes } from "@dorothy/core";
import { APICallError } from "ai";
import { runOneShot } from "./one-shot.js";
import { personaPrompt, routeLine } from "./persona.js";
import { mockModel, mockUsage, textChunks } from "./testing.js";

const env = { ANTHROPIC_API_KEY: "test-key" };

function writer() {
    const out: string[] = [];
    const err: string[] = [];
    return {
        out,
        err,
        write: {
            out: (text: string) => out.push(text),
            err: (text: string) => err.push(text),
        },
    };
}

describe("runOneShot", () => {
    afterEach(() => {
        process.exitCode = 0;
    });

    it("streams a reply and ends the line", async () => {
        const model = mockModel([{ chunks: textChunks("Hello") }]);
        const output = writer();
        await runOneShot("hi", "chat", {
            env,
            model: () => model,
            write: output.write,
        });
        expect(output.out.join("")).toBe("Hello\n");
        expect(output.err).toEqual([]);
        expect(process.exitCode).not.toBe(1);
    });

    it("speaks with the persona it is given, offering no tools", async () => {
        const model = mockModel([{ chunks: textChunks("Hello") }]);
        await runOneShot("hi", "development", {
            env,
            model: () => model,
            write: writer().write,
        });
        expect(model.doStreamCalls[0]?.prompt[0]).toMatchObject({
            role: "system",
            content: `${personaPrompt({ recall: false, mode: "development" })}\n\n${routeLine(defaultRoutes().chat)}`,
        });
        expect(model.doStreamCalls[0]?.tools ?? []).toHaveLength(0);
    });

    it("fails on a refusal, saying why on stderr", async () => {
        const model = mockModel([
            new APICallError({
                message: "overloaded",
                url: "u",
                requestBodyValues: {},
                statusCode: 529,
            }),
        ]);
        const output = writer();
        await runOneShot("hi", "chat", {
            env,
            model: () => model,
            write: output.write,
        });
        expect(output.err).toEqual(["overloaded\n"]);
        expect(process.exitCode).toBe(1);
    });

    it("keeps the reply streamed before a failure", async () => {
        const model = mockModel([
            {
                chunks: [
                    { type: "stream-start", warnings: [] },
                    { type: "text-start", id: "t" },
                    { type: "text-delta", id: "t", delta: "Half" },
                    {
                        type: "error",
                        error: new APICallError({
                            message: "reset",
                            url: "u",
                            requestBodyValues: {},
                            statusCode: 500,
                        }),
                    },
                    {
                        type: "finish",
                        usage: mockUsage(),
                        finishReason: { unified: "error", raw: undefined },
                    },
                ],
            },
        ]);
        const output = writer();
        await runOneShot("hi", "chat", {
            env,
            model: () => model,
            write: output.write,
        });
        expect(output.out.join("")).toBe("Half");
        expect(output.err).toEqual(["reset\n"]);
        expect(process.exitCode).toBe(1);
    });

    it("fails without a key", async () => {
        const output = writer();
        await runOneShot("hi", "chat", {
            env: {},
            model: () => mockModel([]),
            write: output.write,
        });
        expect(output.err).toEqual(["ANTHROPIC_API_KEY is not set\n"]);
        expect(process.exitCode).toBe(1);
    });
});
