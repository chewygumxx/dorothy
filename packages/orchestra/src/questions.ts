// vim:set expandtab shiftwidth=4 filetype=typescript:
// SPDX-License-Identifier: GPL-3.0-only

//
//
// ~chewygumxx/dorothy.git
// ::: :/packages/orchestra/src/questions.ts
//
//

import type { Clock, Timers } from "@dorothy/core";
import type { Server } from "@modelcontextprotocol/sdk/server/index.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import {
    ElicitResultSchema,
    type RequestId,
} from "@modelcontextprotocol/sdk/types.js";
import { beforeDeadline } from "./deadline.js";
import type { Answer, Ask } from "./gate.js";

// The original 2025-06-18 form shape: no mode or newer enum constructs.
// The SDK may negotiate 2025-11-25; this payload works for either version.
const FORM = {
    type: "object" as const,
    required: ["decision"],
    properties: {
        decision: {
            type: "string" as const,
            title: "Permission",
            enum: ["allow_once", "deny"],
            enumNames: ["Allow once", "Deny"],
        },
    },
};
type Pending = {
    workerId: string;
    controller: AbortController;
    done: Promise<Answer>;
};
const denied = (reason: string, source: Answer["source"] = "user"): Answer => ({
    decision: "deny",
    source,
    reason,
});

export function createQuestions(
    server: Server,
    { clock, timers }: { clock: Clock; timers: Timers },
) {
    const pending = new Map<string, Pending>();
    const cancelled = new Set<RequestId>();
    const sending = new Set<Promise<void>>();
    let next = 0;
    let closed = false;
    let wrapped = false;

    const settle = async (questions: Pending[]) => {
        for (const question of questions)
            question.controller.abort("Question cancelled");
        await Promise.all(questions.map((question) => question.done));
        // SDK abort initiates a cancellation send without awaiting it.
        await Promise.allSettled([...sending]);
    };
    const close = async () => {
        closed = true;
        await settle([...pending.values()]);
    };
    const stop = async (workerId: string) => {
        await settle(
            [...pending.values()].filter(
                (question) => question.workerId === workerId,
            ),
        );
    };
    const ask: Ask = (question, signal) => {
        if (closed || !wrapped || signal.aborted)
            return Promise.resolve(
                denied("Question service closed or worker stopped"),
            );
        const capability = server.getClientCapabilities()?.elicitation;
        if (!capability || (capability.url && !capability.form)) {
            return Promise.resolve(
                denied("Client does not support form elicitation"),
            );
        }
        const questionId = `question-${++next}`;
        const controller = new AbortController();
        const abort = () => controller.abort(signal.reason);
        signal.addEventListener("abort", abort, { once: true });
        const done = beforeDeadline(
            (signal) =>
                server.request(
                    {
                        method: "elicitation/create",
                        params: {
                            message: `Worker: ${question.workerId}\n${question.reason}\nRequest:\n${JSON.stringify(question.request, null, 2)}`,
                            requestedSchema: FORM,
                            _meta: { questionId, deadline: question.deadline },
                        },
                    },
                    ElicitResultSchema,
                    {
                        signal,
                        // The injected clock owns the deadline, not the SDK's real timer.
                        timeout: 2147483647,
                    },
                ),
            question.deadline,
            controller.signal,
            clock,
            timers,
        )
            .then((settled): Answer => {
                if (settled.status !== "value")
                    return denied(
                        `Question ${settled.status}`,
                        settled.status === "timeout" ? "timeout" : "user",
                    );
                const result = settled.value;
                if (
                    result.action === "accept" &&
                    result.content?.decision === "allow_once" &&
                    Object.keys(result.content).length === 1
                ) {
                    return {
                        decision: "allow",
                        source: "user",
                        reason: "User allowed once",
                    };
                }
                return denied("User declined or returned an invalid answer");
            })
            .finally(() => {
                signal.removeEventListener("abort", abort);
                pending.delete(questionId);
            });
        pending.set(questionId, {
            workerId: question.workerId,
            controller,
            done,
        });
        return done;
    };

    // Install before server.connect. Only the transport sees the SDK-assigned
    // JSON-RPC id, and its close runs while cancellation can still be sent.
    const transport = (inner: Transport): Transport => {
        if (wrapped) throw new Error("Question transport already installed");
        wrapped = true;
        const outer: Transport = {
            get sessionId() {
                return inner.sessionId;
            },
            async start() {
                inner.onmessage = (message, extra) => {
                    if (
                        "id" in message &&
                        message.id !== undefined &&
                        !("method" in message) &&
                        cancelled.has(message.id)
                    )
                        return;
                    outer.onmessage?.(message, extra);
                };
                inner.onerror = (error) => outer.onerror?.(error);
                inner.onclose = () => {
                    void close();
                    outer.onclose?.();
                };
                await inner.start();
            },
            async send(message, options) {
                if (
                    "method" in message &&
                    message.method === "elicitation/create" &&
                    "id" in message
                ) {
                    message = {
                        ...message,
                        params: {
                            ...message.params,
                            _meta: {
                                ...message.params?._meta,
                                requestId: message.id,
                            },
                        },
                    };
                }
                if (
                    "method" in message &&
                    message.method === "notifications/cancelled"
                ) {
                    const id = message.params?.requestId;
                    if (typeof id === "string" || typeof id === "number")
                        cancelled.add(id);
                }
                const sent = inner.send(message, options);
                sending.add(sent);
                try {
                    await sent;
                } finally {
                    sending.delete(sent);
                }
            },
            async close() {
                await close();
                await inner.close();
            },
        };
        return outer;
    };
    return { ask, stop, close, transport };
}
