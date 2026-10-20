// vim:set expandtab shiftwidth=4 filetype=typescript:
// SPDX-License-Identifier: GPL-3.0-only

//
//
// ~chewygumxx/dorothy.git
// ::: :/packages/agent/src/one-shot.test.ts
//
//

import { afterEach, describe, expect, it } from "bun:test";
import type { SDKMessage } from "@anthropic-ai/claude-agent-sdk";
import { type OneShotQuery, runOneShot } from "./one-shot.js";

const delta = (text: string) =>
    ({
        type: "stream_event",
        event: {
            type: "content_block_delta",
            index: 0,
            delta: { type: "text_delta", text },
        },
    }) as unknown as SDKMessage;
const success = () =>
    ({
        type: "result",
        subtype: "success",
        is_error: false,
        result: "Hello",
    }) as unknown as SDKMessage;
const apiError = (text: string) =>
    ({
        type: "result",
        subtype: "success",
        is_error: true,
        result: text,
    }) as unknown as SDKMessage;
const executionError = (errors: string[]) =>
    ({
        type: "result",
        subtype: "error_during_execution",
        is_error: true,
        errors,
    }) as unknown as SDKMessage;

const scripted =
    (...messages: SDKMessage[]): OneShotQuery =>
    () =>
        (async function* () {
            yield* messages;
        })();

// What a run writes to stdout and stderr, and the exit code it set.
async function ran(queryFn: OneShotQuery) {
    const write = process.stdout.write;
    const writeError = process.stderr.write;
    let stdout = "";
    let stderr = "";
    process.stdout.write = ((text: string) => {
        stdout += text;
        return true;
    }) as typeof process.stdout.write;
    process.stderr.write = ((text: string) => {
        stderr += text;
        return true;
    }) as typeof process.stderr.write;
    process.exitCode = 0;
    try {
        await runOneShot("hi", "chat", queryFn);
        return { stdout, stderr, exitCode: process.exitCode };
    } finally {
        process.stdout.write = write;
        process.stderr.write = writeError;
        process.exitCode = 0;
    }
}

describe("runOneShot", () => {
    afterEach(() => {
        process.exitCode = 0;
    });

    it("streams a reply and ends the line", async () => {
        const out = await ran(scripted(delta("Hel"), delta("lo"), success()));
        expect(out).toEqual({ stdout: "Hello\n", stderr: "", exitCode: 0 });
    });

    it("fails on an API error result, saying why on stderr", async () => {
        const out = await ran(scripted(apiError("Invalid API key")));
        expect(out).toEqual({
            stdout: "",
            stderr: "Invalid API key\n",
            exitCode: 1,
        });
    });

    it("fails on an execution error result with its errors", async () => {
        const out = await ran(scripted(executionError(["one", "two"])));
        expect(out).toEqual({
            stdout: "",
            stderr: "one; two\n",
            exitCode: 1,
        });
    });

    it("keeps the reply streamed before a failure", async () => {
        const out = await ran(scripted(delta("Chec"), apiError("Overloaded")));
        expect(out.stdout).toBe("Chec");
        expect(out.stderr).toBe("Overloaded\n");
        expect(out.exitCode).toBe(1);
    });

    it("fails when the query throws", async () => {
        const out = await ran(() =>
            // biome-ignore lint/correctness/useYield: it fails at once
            (async function* () {
                throw new Error("boom");
            })(),
        );
        expect(out).toEqual({ stdout: "", stderr: "boom\n", exitCode: 1 });
    });
});
