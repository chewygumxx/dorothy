// vim:set expandtab shiftwidth=4 filetype=typescript:
// SPDX-License-Identifier: GPL-3.0-only

//
//
// ~xxdorothy/dorothy.git
// ::: :/packages/agent/src/wire.test.ts
//
//

// The kinds that speak Chat Completions, on the wire: what each sends,
// how its usage is priced, and fallback from one kind to another.

import { afterEach, describe, expect, it } from "bun:test";
import {
    type ConversationEvent,
    Cooldowns,
    type Kind,
    type RouteEntry,
} from "@dorothy/core";
import { Conversation } from "./conversation.js";
import { structuredCall } from "./structured.js";
import { type CompletionReply, fakeCompletions } from "./testing.js";

const stops: (() => void)[] = [];
afterEach(() => {
    for (const stop of stops.splice(0)) {
        stop();
    }
});
const serve = (replies: CompletionReply[]) => {
    const server = fakeCompletions(replies);
    stops.push(server.stop);
    return server;
};

const KEYS = {
    OPENROUTER_API_KEY: "or-key",
    FEATHERLESS_API_KEY: "fl-key",
    HF_TOKEN: "hf-key",
};

const entry = (
    kind: Kind,
    baseUrl: string,
    overrides: Partial<RouteEntry> = {},
): RouteEntry => ({
    provider: kind,
    kind,
    model: "org/model",
    baseUrl,
    key:
        kind === "openrouter"
            ? "OPENROUTER_API_KEY"
            : kind === "featherless"
              ? "FEATHERLESS_API_KEY"
              : kind === "huggingface"
                ? "HF_TOKEN"
                : null,
    price: null,
    ...overrides,
});

const SCHEMA = {
    type: "object",
    properties: { ok: { type: "boolean" } },
    required: ["ok"],
    additionalProperties: false,
};

const REQUEST = {
    what: "review",
    system: "persona",
    prompt: "review this",
    schema: SCHEMA,
    timeoutMs: 5000,
};

const structured = (route: RouteEntry[], cooldowns = new Cooldowns()) =>
    structuredCall({ route, cooldowns, env: KEYS })(REQUEST);

// One chat turn on route: its events, once the turn has ended.
async function chat(route: RouteEntry[]): Promise<ConversationEvent[]> {
    const conversation = new Conversation({ route, env: KEYS });
    const events: ConversationEvent[] = [];
    const done = new Promise<void>((resolve) => {
        conversation.subscribe((event) => {
            events.push(event);
            if (event.type === "turn-end" || event.type === "error") {
                resolve();
            }
        });
    });
    conversation.start();
    conversation.send("hi");
    await done;
    await conversation.close();
    return events;
}

describe("OpenRouter", () => {
    it("denies data collection and asks for ZDR and usage on a chat", async () => {
        const server = serve([{ text: "hello" }]);
        await chat([entry("openrouter", server.url)]);
        expect(server.paths).toEqual(["/chat/completions"]);
        expect(server.auth).toEqual(["Bearer or-key"]);
        expect(server.bodies[0]).toMatchObject({
            model: "org/model",
            provider: { data_collection: "deny", zdr: true },
            usage: { include: true },
            stream_options: { include_usage: true },
        });
        expect(server.bodies[0]?.provider).toEqual({
            data_collection: "deny",
            zdr: true,
        });
    });

    it("requires the schema's parameters of a structured call", async () => {
        const server = serve([{ text: '{"ok":true}' }]);
        await structured([entry("openrouter", server.url)]);
        expect(server.bodies[0]).toMatchObject({
            provider: {
                data_collection: "deny",
                zdr: true,
                require_parameters: true,
            },
            response_format: {
                type: "json_schema",
                json_schema: { schema: SCHEMA },
            },
        });
    });

    it("costs what OpenRouter says a step cost", async () => {
        const server = serve([
            {
                text: '{"ok":true}',
                usage: { prompt_tokens: 10, completion_tokens: 5, cost: 0.25 },
            },
        ]);
        expect(await structured([entry("openrouter", server.url)])).toEqual({
            ok: true,
            output: { ok: true },
            model: "openrouter:org/model",
            costUsd: 0.25,
        });
    });

    it("warns once of a step whose cost it did not say", async () => {
        const server = serve([{ text: '{"ok":true}' }]);
        const route = [
            entry("openrouter", server.url, { model: "org/costless" }),
        ];
        expect(await structured(route)).toMatchObject({
            ok: true,
            costUsd: 0,
            notes: [
                "no price is known for openrouter:org/costless; its cost shows as $0",
            ],
        });
        expect((await structured(route)).notes).toBeUndefined();
    });
});

describe.each([
    ["featherless", "Bearer fl-key"],
    ["huggingface", "Bearer hf-key"],
] as const)("%s", (kind, auth) => {
    it("posts to its root with its key, asking for usage", async () => {
        const server = serve([{ text: "hello" }]);
        await chat([entry(kind, server.url)]);
        expect(server.paths).toEqual(["/chat/completions"]);
        expect(server.auth).toEqual([auth]);
        expect(server.bodies[0]).toMatchObject({
            model: "org/model",
            stream_options: { include_usage: true },
        });
        expect(server.bodies[0]?.provider).toBeUndefined();
    });

    it("asks for the schema of a structured call", async () => {
        const server = serve([{ text: '{"ok":true}' }]);
        await structured([entry(kind, server.url)]);
        expect(server.bodies[0]?.response_format).toMatchObject({
            type: "json_schema",
            json_schema: { schema: SCHEMA },
        });
    });

    it("costs a step at the entry's price, cache reads at its input rate", async () => {
        const server = serve([
            {
                text: '{"ok":true}',
                usage: {
                    prompt_tokens: 1_000_000,
                    completion_tokens: 1_000_000,
                    cached_tokens: 400_000,
                },
            },
        ]);
        const outcome = await structured([
            entry(kind, server.url, { price: [0.5, 2] }),
        ]);
        expect(outcome.costUsd).toBeCloseTo(0.5 + 2, 10);
    });
});

describe("local", () => {
    it("sends a keyless server no Authorization header", async () => {
        const server = serve([{ text: "hello" }]);
        await chat([entry("local", server.url)]);
        expect(server.auth).toEqual([null]);
    });

    it("sends a keyed server its key", async () => {
        const server = serve([{ text: "hello" }]);
        await structuredCall({
            route: [entry("local", server.url, { key: "LOCAL_KEY" })],
            env: { LOCAL_KEY: "local-key" },
        })(REQUEST);
        expect(server.auth).toEqual(["Bearer local-key"]);
    });

    it("warns of nothing at a free price", async () => {
        const server = serve([{ text: '{"ok":true}', usage: null }]);
        const outcome = await structured([
            entry("local", server.url, { model: "free", price: [0, 0] }),
        ]);
        expect(outcome).toMatchObject({ ok: true, costUsd: 0 });
        expect(outcome.notes).toBeUndefined();
    });

    it("warns once of a stream that reports no usage", async () => {
        const server = serve([{ text: '{"ok":true}', usage: null }]);
        const route = [
            entry("local", server.url, { model: "quiet", price: [1, 1] }),
        ];
        expect((await structured(route)).notes).toEqual([
            "local:quiet reported no usage; its cost shows as $0",
        ]);
        expect((await structured(route)).notes).toBeUndefined();
    });
});

describe("failures on Chat Completions", () => {
    it.each(["openrouter", "featherless", "huggingface", "local"] as const)(
        "%s refuses a redirect, so its key never follows it",
        async (kind) => {
            const elsewhere = serve([{ text: "followed" }]);
            const server = serve([{ redirect: `${elsewhere.url}/chat` }]);
            const outcome = await structured([entry(kind, server.url)]);
            expect(outcome).toMatchObject({ ok: false });
            expect(elsewhere.bodies).toHaveLength(0);
        },
    );

    it("classes a 429 after a 200 as a rate limit, cooling the model", async () => {
        const server = serve([
            { midstream: { message: "Rate limit exceeded", code: 429 } },
        ]);
        const cooldowns = new Cooldowns();
        const route = [entry("openrouter", server.url)];
        const outcome = await structured(route, cooldowns);
        expect(outcome).toMatchObject({
            ok: false,
            reason: "Rate limit exceeded",
        });
        expect(cooldowns.until(route[0] as RouteEntry)).not.toBeNull();
    });

    it.each(
        (
            ["openrouter", "featherless", "huggingface", "local"] as const
        ).flatMap((kind) =>
            (
                [
                    [429, "rate-limit"],
                    ["429", "rate-limit"],
                    [402, "usage"],
                    [500, "server"],
                ] as const
            ).map(([code, failure]) => [kind, code, failure] as const),
        ),
    )(
        "%s classes an error with code %p after a 200 as %s, saying nothing of usage",
        async (kind, code, failure) => {
            const failing = serve([{ midstream: { message: "boom", code } }]);
            const answering = serve([{ text: '{"ok":true}' }]);
            const outcome = await structured([
                entry(kind, failing.url, {
                    provider: "first",
                    model: `m-${code}`,
                }),
                entry("local", answering.url, {
                    provider: "next",
                    price: [0, 0],
                }),
            ]);
            expect(outcome).toMatchObject({ ok: true });
            expect(outcome.notes).toEqual([
                `first:m-${code} refused (${failure}: boom); answering with next:org/model`,
            ]);
        },
    );
});

describe("fallback across kinds", () => {
    it("answers a structured call from the next kind when one answers 429", async () => {
        const limited = serve([
            {
                status: 429,
                message: "slow down",
                headers: { "retry-after": "30" },
            },
        ]);
        const answering = serve([
            {
                text: '{"ok":true}',
                usage: { prompt_tokens: 1, completion_tokens: 1, cost: 0.01 },
            },
        ]);
        const cooldowns = new Cooldowns();
        const first = entry("local", limited.url, { provider: "proxy" });
        const outcome = await structured(
            [first, entry("openrouter", answering.url)],
            cooldowns,
        );
        expect(outcome).toEqual({
            ok: true,
            output: { ok: true },
            model: "openrouter:org/model",
            costUsd: 0.01,
            notes: [
                "proxy:org/model refused (rate-limit: slow down, retry in 30s); answering with openrouter:org/model",
            ],
        });
        expect(cooldowns.until(first)).not.toBeNull();
    });

    it("answers a chat turn from the next kind, warning of the move", async () => {
        const limited = serve([{ status: 429, message: "slow down" }]);
        const answering = serve([{ text: "hello" }]);
        const events = await chat([
            entry("local", limited.url, { provider: "proxy" }),
            entry("featherless", answering.url, { price: [0, 0] }),
        ]);
        expect(events.filter((event) => event.type === "warning")).toEqual([
            {
                type: "warning",
                message:
                    "proxy:org/model refused (rate-limit: slow down); answering with featherless:org/model",
            },
        ]);
        expect(events.at(-1)).toMatchObject({
            type: "turn-end",
            reply: "hello",
            model: "featherless:org/model",
        });
    });
});
