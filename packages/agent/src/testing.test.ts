// vim:set expandtab shiftwidth=4 filetype=typescript:
// SPDX-License-Identifier: GPL-3.0-only

//
//
// ~chewygumxx/dorothy.git
// ::: :/packages/agent/src/testing.test.ts
//
//

import { describe, expect, it } from "bun:test";
import { mockModel, textChunks } from "./testing.js";

describe("mockModel", () => {
    it("settles a hanging stream whose signal is already aborted", async () => {
        const model = mockModel([{ chunks: textChunks("hi"), hang: true }]);
        const controller = new AbortController();
        controller.abort(new Error("early"));
        const { stream } = await model.doStream({
            prompt: [],
            abortSignal: controller.signal,
        });
        await expect(stream.getReader().read()).rejects.toThrow("early");
    });

    it("settles a hanging stream aborted after it starts", async () => {
        const model = mockModel([{ chunks: [], hang: true }]);
        const controller = new AbortController();
        const { stream } = await model.doStream({
            prompt: [],
            abortSignal: controller.signal,
        });
        const read = stream.getReader().read();
        controller.abort(new Error("late"));
        await expect(read).rejects.toThrow("late");
    });
});
