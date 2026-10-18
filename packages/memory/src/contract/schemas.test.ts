// vim:set expandtab shiftwidth=4 filetype=typescript:
// SPDX-License-Identifier: GPL-3.0-only

//
//
// ~chewygumxx/dorothy.git
// ::: :/packages/memory/src/contract/schemas.test.ts
//
//

import { describe, expect, it } from "bun:test";
import type { BlockRequest, RecordRequest } from "@dorothy/core";
import { ContractError } from "./errors.js";
import {
    blockRequestSchema,
    parseWith,
    recordRequestSchema,
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
