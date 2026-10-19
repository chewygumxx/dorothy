// vim:set expandtab shiftwidth=4 filetype=typescript:
// SPDX-License-Identifier: GPL-3.0-only

//
//
// ~chewygumxx/dorothy.git
// ::: :/packages/memory/src/contract/schemas.test.ts
//
//

import { describe, expect, it } from "bun:test";
import type { BlockRequest, BlockResponse, RecordRequest } from "@dorothy/core";
import { z } from "zod";
import { ContractError } from "./errors.js";
import {
    blockRequestSchema,
    blockResponseSchema,
    openShape,
    parseWith,
    recallRequestSchema,
    recallResponseSchema,
    recordRequestSchema,
    recordResponseSchema,
    rememberShape,
    searchShape,
} from "./schemas.js";

const AT = "2026-10-18T09:30:00.000Z";

describe("blockRequestSchema", () => {
    it("takes a request and refuses unknown keys", () => {
        const request: BlockRequest = {
            host: "claude-code",
            session: "s1",
            project: "github.com/me/app",
            reason: "startup",
        };
        expect(parseWith(blockRequestSchema, request)).toEqual(request);
        expect(() =>
            parseWith(blockRequestSchema, { ...request, colour: "blue" }),
        ).toThrow(ContractError);
        expect(() =>
            parseWith(blockRequestSchema, { ...request, reason: "later" }),
        ).toThrow(ContractError);
        expect(() =>
            parseWith(blockRequestSchema, { ...request, host: "Claude" }),
        ).toThrow(ContractError);
    });

    it("throws a 400 naming the field", () => {
        try {
            parseWith(blockRequestSchema, { host: "codex" });
            throw new Error("parsed");
        } catch (error) {
            expect(error).toBeInstanceOf(ContractError);
            expect((error as ContractError).status).toBe(400);
            expect((error as ContractError).message).toContain("session");
        }
    });
});

describe("recordRequestSchema", () => {
    const base = { host: "codex", session: "s1" };

    it("takes events of each kind", () => {
        const request: RecordRequest = {
            ...base,
            events: [
                { sourceId: "a", at: AT, kind: "user", text: "Hi" },
                {
                    sourceId: "b",
                    at: AT,
                    kind: "assistant",
                    text: "Hello",
                    interrupted: false,
                },
                {
                    sourceId: "c",
                    at: AT,
                    kind: "tool",
                    name: "Bash",
                    input: "ls",
                    output: "a",
                    ok: true,
                },
            ],
        };
        expect(parseWith(recordRequestSchema, request)).toEqual(request);
    });

    it("wants events or a transcript, not both nor neither", () => {
        expect(() => parseWith(recordRequestSchema, base)).toThrow(
            ContractError,
        );
        expect(() =>
            parseWith(recordRequestSchema, {
                ...base,
                events: [],
                transcript: "/tmp/x.jsonl",
            }),
        ).toThrow(ContractError);
        expect(
            parseWith(recordRequestSchema, { ...base, private: true }),
        ).toEqual({ ...base, private: true });
    });

    it("refuses an event with no time", () => {
        expect(() =>
            parseWith(recordRequestSchema, {
                ...base,
                events: [{ sourceId: "a", kind: "user", text: "Hi" }],
            }),
        ).toThrow(ContractError);
    });
});

describe("a hook request's project", () => {
    const block = { host: "codex", session: "s1", reason: "startup" };
    const recall = { host: "codex", session: "s1", prompt: "tea" };
    const record = { host: "codex", session: "s1", private: true };

    it("is a project's id, as the client makes it", () => {
        for (const project of [
            "github.com/me/app",
            "local-0123456789ab",
            "gitlab.example.com/group/sub/app",
        ]) {
            expect(
                parseWith(blockRequestSchema, { ...block, project }).project,
            ).toBe(project);
        }
    });

    it("is refused when it is a path or any other string", () => {
        for (const project of [
            "/home/me/app",
            "../app",
            "github.com/../app",
            "my project",
            "app",
        ]) {
            const refused = (parse: () => unknown) =>
                expect(parse).toThrow("project: project is not a project's id");
            refused(() => parseWith(blockRequestSchema, { ...block, project }));
            refused(() =>
                parseWith(recallRequestSchema, { ...recall, project }),
            );
            refused(() =>
                parseWith(recordRequestSchema, { ...record, project }),
            );
        }
    });
});

describe("the responses", () => {
    it("take what the service gives, and refuse what it does not", () => {
        const block: BlockResponse = {
            text: "<memory/>",
            digest: `xxh3:${"0123456789abcdef"}`,
            items: [{ id: "k:personal/likes-tea", tier: "full" }],
            used: 9,
        };
        expect(parseWith(blockResponseSchema, block)).toEqual(block);
        const bads: unknown[] = [
            { ...block, digest: "xxh3:abc" },
            { ...block, items: [{ id: "k:x", tier: "huge" }] },
            { ...block, used: -1 },
            { ...block, extra: 1 },
        ];
        for (const bad of bads) {
            expect(() => parseWith(blockResponseSchema, bad)).toThrow(
                ContractError,
            );
        }
        const recall = { text: "", ids: [], used: 0 };
        expect(parseWith(recallResponseSchema, recall)).toEqual(recall);
        expect(() =>
            parseWith(recallResponseSchema, { ...recall, ids: [1] }),
        ).toThrow(ContractError);
        const record = { accepted: 1, duplicates: 0, through: null };
        expect(parseWith(recordResponseSchema, record)).toEqual(record);
        expect(() =>
            parseWith(recordResponseSchema, { ...record, accepted: 1.5 }),
        ).toThrow(ContractError);
    });
});

describe("the tools' shapes", () => {
    const search = z.object(searchShape);
    const open = z.object(openShape);
    const remember = z.object(rememberShape);

    it("bound a search's limit and words", () => {
        expect(search.safeParse({ query: "tea", limit: 20 }).success).toBe(
            true,
        );
        for (const bad of [
            { query: "tea", limit: 21 },
            { query: "tea", limit: 0 },
            { query: "" },
            { query: "x".repeat(1001) },
            { query: "tea", scope: "everything" },
        ]) {
            expect(search.safeParse(bad).success).toBe(false);
        }
    });

    it("bound an open's id and turns", () => {
        expect(open.safeParse({ id: "k:personal/likes-tea" }).success).toBe(
            true,
        );
        for (const bad of [
            { id: "k" },
            { id: "k:".padEnd(601, "x") },
            { id: "k:personal/likes-tea", from: 0 },
            { id: "k:personal/likes-tea", through: 1.5 },
        ]) {
            expect(open.safeParse(bad).success).toBe(false);
        }
    });

    it("bound what remember takes", () => {
        expect(
            remember.safeParse({ action: "add", text: "x".repeat(10_000) })
                .success,
        ).toBe(true);
        for (const bad of [
            { action: "forget" },
            { action: "add", text: "x".repeat(10_001) },
            { action: "add", title: "x".repeat(201) },
            { action: "retire", why: "x".repeat(401) },
            { action: "add", type: "rumour" },
            { action: "add", scope: "all" },
        ]) {
            expect(remember.safeParse(bad).success).toBe(false);
        }
    });
});

describe("a request's caps", () => {
    const base = { host: "codex", session: "s1" };
    const event = (at: number) => ({
        sourceId: `e${at}`,
        at: AT,
        kind: "user" as const,
        text: "Hi",
    });

    it("hold events to 10,000 and a session id to 256 characters", () => {
        const events = (count: number) =>
            Array.from({ length: count }, (_, at) => event(at));
        expect(() =>
            parseWith(recordRequestSchema, { ...base, events: events(10_000) }),
        ).not.toThrow();
        expect(() =>
            parseWith(recordRequestSchema, { ...base, events: events(10_001) }),
        ).toThrow(ContractError);
        expect(() =>
            parseWith(recordRequestSchema, {
                ...base,
                session: "s".repeat(257),
                private: true,
            }),
        ).toThrow(ContractError);
    });

    it("say an unknown key without echoing a long one whole", () => {
        const key = "k".repeat(5000);
        try {
            parseWith(blockRequestSchema, {
                host: "codex",
                session: "s",
                reason: "startup",
                [key]: 1,
            });
            throw new Error("parsed");
        } catch (error) {
            expect(error).toBeInstanceOf(ContractError);
            expect((error as ContractError).message.length).toBeLessThan(300);
        }
    });
});
