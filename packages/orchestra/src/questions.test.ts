// vim:set expandtab shiftwidth=4 filetype=typescript:
// SPDX-License-Identifier: GPL-3.0-only

//
//
// ~chewygumxx/dorothy.git
// ::: :/packages/orchestra/src/questions.test.ts
//
//

import { afterEach, describe, expect, it } from "bun:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import {
    type ClientCapabilities,
    ElicitRequestSchema,
    type ElicitResult,
    type JSONRPCMessage,
    type JSONRPCRequest,
} from "@modelcontextprotocol/sdk/types.js";
import { ManualTime } from "./fixtures/time.js";
import type { Question } from "./gate.js";
import { createQuestions } from "./questions.js";

const cleanup: (() => Promise<void>)[] = [];
afterEach(async () => {
    for (const close of cleanup.splice(0)) await close();
});
const tick = async () => {
    for (let i = 0; i < 20; i++) await Promise.resolve();
};
const question = (workerId = "worker-one"): Question => ({
    workerId,
    deadline: 6000,
    reason: "Dependency change",
    request: {
        sessionId: "s",
        options: [],
        toolCall: {
            toolCallId: "t",
            kind: "execute",
            rawInput: { command: "bun add thing" },
        },
    },
});
const answer = (decision: string): ElicitResult => ({
    action: "accept",
    content: { decision },
});
async function pair(
    capabilities: ClientCapabilities = { elicitation: {} },
    legacy = false,
) {
    const [clientWire, serverWire] = InMemoryTransport.createLinkedPair();
    const server = new Server({ name: "test-orchestra", version: "0" });
    const client = new Client(
        { name: "test-client", version: "0" },
        { capabilities },
    );
    const time = new ManualTime();
    const questions = createQuestions(server, { clock: time, timers: time });
    const sent: JSONRPCMessage[] = [];
    const errors: Error[] = [];
    server.onerror = (error) => errors.push(error);
    const send = serverWire.send.bind(serverWire);
    serverWire.send = async (message, options) => {
        sent.push(structuredClone(message));
        await send(message, options);
    };
    if (legacy) {
        const send = clientWire.send.bind(clientWire);
        clientWire.send = async (message, options) => {
            if ("method" in message && message.method === "initialize") {
                message = {
                    ...message,
                    params: {
                        ...message.params,
                        protocolVersion: "2025-06-18",
                    },
                };
            }
            await send(message, options);
        };
    }
    await server.connect(questions.transport(serverWire));
    await client.connect(clientWire);
    cleanup.push(() => server.close());
    const elicitations = () =>
        sent.filter(
            (m): m is JSONRPCRequest =>
                "method" in m && m.method === "elicitation/create",
        );
    const cancellations = () =>
        sent.filter(
            (m) => "method" in m && m.method === "notifications/cancelled",
        );
    return {
        server,
        client,
        clientWire,
        questions,
        time,
        sent,
        errors,
        elicitations,
        cancellations,
    };
}

describe("MCP questions", () => {
    it.each([false, true])(
        "accepts one answer using the 2025-06-18 form shape (legacy %s)",
        async (legacy) => {
            const h = await pair({ elicitation: {} }, legacy);
            h.client.setRequestHandler(ElicitRequestSchema, async () =>
                answer("allow_once"),
            );
            expect(
                await h.questions.ask(question(), new AbortController().signal),
            ).toMatchObject({ decision: "allow", source: "user" });
            const sent = h.elicitations()[0];
            expect(sent?.params?._meta).toMatchObject({
                questionId: "question-1",
                requestId: sent?.id,
                deadline: 6000,
            });
            expect(sent?.params?.mode).toBeUndefined();
            expect(sent?.params?.message).toContain("worker-one");
            expect(sent?.params?.message).toContain("bun add thing");
            expect(sent?.params?.message).toContain("Dependency change");
            expect(sent?.params?.requestedSchema).toEqual({
                type: "object",
                required: ["decision"],
                properties: {
                    decision: {
                        type: "string",
                        title: "Permission",
                        enum: ["allow_once", "deny"],
                        enumNames: ["Allow once", "Deny"],
                    },
                },
            });
            expect(h.cancellations()).toHaveLength(0);
            expect(h.time.size).toBe(0);
        },
    );
    it.each([
        answer("deny"),
        { action: "decline" },
        { action: "cancel" },
        answer("allow_always"),
        { action: "accept" },
    ])("denies response %j", async (response) => {
        const h = await pair();
        h.client.setRequestHandler(
            ElicitRequestSchema,
            async () => response as ElicitResult,
        );
        expect(
            await h.questions.ask(question(), new AbortController().signal),
        ).toMatchObject({ decision: "deny", source: "user" });
    });
    it("denies without sending when the client lacks elicitation", async () => {
        const h = await pair({});
        expect(
            await h.questions.ask(question(), new AbortController().signal),
        ).toMatchObject({ decision: "deny", source: "user" });
        expect(h.elicitations()).toHaveLength(0);
        expect(h.time.size).toBe(0);
    });
    it("denies a URL-only client without asking a form", async () => {
        const h = await pair({ elicitation: { url: {} } });
        expect(
            await h.questions.ask(question(), new AbortController().signal),
        ).toMatchObject({ decision: "deny" });
        expect(h.elicitations()).toHaveLength(0);
    });
    it("cancels at the injected deadline and ignores a raw late answer", async () => {
        const h = await pair();
        h.client.setRequestHandler(
            ElicitRequestSchema,
            async () => new Promise(() => {}),
        );
        const pending = h.questions.ask(
            question(),
            new AbortController().signal,
        );
        await tick();
        const id = h.elicitations()[0]?.id;
        expect(id).toBeDefined();
        h.time.advance(5000);
        expect(await pending).toMatchObject({
            decision: "deny",
            source: "timeout",
        });
        expect(h.cancellations()[0]).toMatchObject({
            params: { requestId: id },
        });
        await h.clientWire.send({
            jsonrpc: "2.0",
            id: id as number,
            result: answer("allow_once"),
        });
        await tick();
        expect(h.errors).toHaveLength(0);
        expect(h.cancellations()).toHaveLength(1);
        expect(h.time.size).toBe(0);
    });
    it("stops only the named worker's questions, and names those pending", async () => {
        const h = await pair();
        const replies: ((result: ElicitResult) => void)[] = [];
        h.client.setRequestHandler(
            ElicitRequestSchema,
            async () => new Promise((resolve) => replies.push(resolve)),
        );
        const first = h.questions.ask(
            question("one"),
            new AbortController().signal,
        );
        const second = h.questions.ask(
            question("two"),
            new AbortController().signal,
        );
        await tick();
        const ids = h.elicitations().map((r) => r.params?._meta?.questionId);
        expect(new Set(ids).size).toBe(2);
        expect(h.questions.pending("one")).toEqual(["question-1"]);
        await h.questions.stop("one");
        expect(h.questions.pending("one")).toEqual([]);
        expect(h.questions.pending("two")).toEqual(["question-2"]);
        expect(await first).toMatchObject({ decision: "deny" });
        expect(h.cancellations()).toHaveLength(1);
        replies[1]?.(answer("allow_once"));
        expect(await second).toMatchObject({ decision: "allow" });
        expect(h.time.size).toBe(0);
    });
    it("cancels on a caller abort", async () => {
        const h = await pair();
        h.client.setRequestHandler(
            ElicitRequestSchema,
            async () => new Promise(() => {}),
        );
        const controller = new AbortController();
        const pending = h.questions.ask(question(), controller.signal);
        await tick();
        controller.abort();
        expect(await pending).toMatchObject({ decision: "deny" });
        expect(h.cancellations()).toHaveLength(1);
    });
    it("sends cancellations before server.close closes its transport", async () => {
        const h = await pair();
        h.client.setRequestHandler(
            ElicitRequestSchema,
            async () => new Promise(() => {}),
        );
        const pending = h.questions.ask(
            question(),
            new AbortController().signal,
        );
        await tick();
        await h.server.close();
        expect(await pending).toMatchObject({ decision: "deny" });
        expect(h.cancellations()).toHaveLength(1);
        expect(h.errors).toHaveLength(0);
        expect(h.time.size).toBe(0);
        expect(
            await h.questions.ask(question(), new AbortController().signal),
        ).toMatchObject({ decision: "deny" });
    });
    it("denies a deadline that has already passed without sending", async () => {
        const h = await pair();
        h.time.advance(6000);
        expect(
            await h.questions.ask(question(), new AbortController().signal),
        ).toMatchObject({ decision: "deny", source: "timeout" });
        expect(h.elicitations()).toHaveLength(0);
    });
});
