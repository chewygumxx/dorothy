// vim:set expandtab shiftwidth=4 filetype=typescript:
// SPDX-License-Identifier: GPL-3.0-only

//
//
// ~chewygumxx/dorothy.git
// ::: :/packages/memory/src/contract/schemas.ts
//
//

// The contract's zod schemas, checked on both sides: the service parses
// every request with them, and the client every response. Each is held
// to its type in core by satisfies, so the two cannot drift.

import {
    BLOCK_REASONS,
    type BlockRequest,
    type BlockResponse,
    DELIVERIES,
    HOST_ID,
    type HostProfile,
    ITEM_TIERS,
    KNOWLEDGE_TYPES,
    MEMORY_KINDS,
    MEMORY_SCOPES,
    type MemoryOpenInput,
    type MemoryRememberInput,
    type MemorySearchInput,
    REMEMBER_ACTIONS,
    type RecallRequest,
    type RecallResponse,
    type RecordEvent,
    type RecordRequest,
    type RecordResponse,
    SEARCH_LIMIT,
} from "@dorothy/core";
import { z } from "zod";
import { ContractError } from "./errors.js";

const host = z.string().regex(HOST_ID, "host is not a profile's name");
const session = z.string().min(1).max(256);
const project = z.string().min(1).max(512);
const budget = z.number().int().min(1).max(1_000_000);
const at = z.iso.datetime({ offset: true });
const sourceId = z.string().min(1).max(256);

export const hostProfileSchema = z
    .object({
        id: host,
        checked: z.array(z.string().min(1).max(64)),
        blockBudget: z.number().int().min(200).max(200_000),
        recallBudget: z.number().int().min(0).max(100_000),
        delivery: z.array(z.enum(DELIVERIES)).min(1),
        instructions: z.number().int().min(64).max(100_000),
    })
    .strict() satisfies z.ZodType<HostProfile>;

export const blockRequestSchema = z
    .object({
        host,
        hostVersion: z.string().min(1).max(64).optional(),
        session,
        project: project.optional(),
        reason: z.enum(BLOCK_REASONS),
        budget: budget.optional(),
    })
    .strict() satisfies z.ZodType<BlockRequest>;

export const blockResponseSchema = z
    .object({
        text: z.string(),
        digest: z.string().regex(/^xxh3:[0-9a-f]{16}$/),
        items: z.array(
            z.object({ id: z.string(), tier: z.enum(ITEM_TIERS) }).strict(),
        ),
        used: z.number().int().min(0),
    })
    .strict() satisfies z.ZodType<BlockResponse>;

export const recallRequestSchema = z
    .object({
        host,
        session,
        project: project.optional(),
        prompt: z.string().min(1).max(100_000),
        budget: budget.optional(),
    })
    .strict() satisfies z.ZodType<RecallRequest>;

export const recallResponseSchema = z
    .object({
        text: z.string(),
        ids: z.array(z.string()),
        used: z.number().int().min(0),
    })
    .strict() satisfies z.ZodType<RecallResponse>;

const recordEventSchema = z.discriminatedUnion("kind", [
    z
        .object({ sourceId, at, kind: z.literal("user"), text: z.string() })
        .strict(),
    z
        .object({
            sourceId,
            at,
            kind: z.literal("assistant"),
            text: z.string(),
            interrupted: z.boolean().optional(),
        })
        .strict(),
    z
        .object({
            sourceId,
            at,
            kind: z.literal("tool"),
            name: z.string().min(1).max(256),
            input: z.string(),
            output: z.string(),
            ok: z.boolean(),
        })
        .strict(),
]) satisfies z.ZodType<RecordEvent>;

export const recordRequestSchema = z
    .object({
        host,
        hostVersion: z.string().min(1).max(64).optional(),
        session,
        project: project.optional(),
        parent: session.optional(),
        private: z.boolean().optional(),
        events: z.array(recordEventSchema).max(10_000).optional(),
        transcript: z.string().min(1).max(4096).optional(),
    })
    .strict()
    .refine(
        (request) =>
            request.private === true ||
            (request.events === undefined) !==
                (request.transcript === undefined),
        { message: "give events or a transcript, not both" },
    ) satisfies z.ZodType<RecordRequest>;

export const recordResponseSchema = z
    .object({
        accepted: z.number().int().min(0),
        duplicates: z.number().int().min(0),
        through: z.string().nullable(),
    })
    .strict() satisfies z.ZodType<RecordResponse>;

// Tool inputs, as McpServer.registerTool takes them: raw shapes.
export const briefShape = {
    project: project.optional(),
    budget: budget.optional(),
};
export const searchShape = {
    query: z.string().min(1).max(1000),
    scope: z.enum(MEMORY_SCOPES).optional(),
    kind: z.enum(MEMORY_KINDS).optional(),
    after: z.string().optional(),
    before: z.string().optional(),
    limit: z.number().int().min(1).max(SEARCH_LIMIT).optional(),
    project: project.optional(),
};
export const openShape = {
    id: z.string().min(3).max(600),
    from: z.number().int().min(1).optional(),
    through: z.number().int().min(1).optional(),
    project: project.optional(),
};
export const rememberShape = {
    action: z.enum(REMEMBER_ACTIONS),
    id: z.string().max(600).optional(),
    title: z.string().max(200).optional(),
    text: z.string().max(10_000).optional(),
    type: z.enum(KNOWLEDGE_TYPES).optional(),
    scope: z.enum(["personal", "project"]).optional(),
    why: z.string().max(400).optional(),
    project: project.optional(),
};

z.object(searchShape) satisfies z.ZodType<MemorySearchInput>;
z.object(openShape) satisfies z.ZodType<MemoryOpenInput>;
z.object(rememberShape) satisfies z.ZodType<MemoryRememberInput>;

export function parseWith<T>(schema: z.ZodType<T>, value: unknown): T {
    const parsed = schema.safeParse(value);
    if (parsed.success) {
        return parsed.data;
    }
    const issue = parsed.error.issues[0];
    const where = issue?.path.join(".") ?? "";
    throw new ContractError(
        400,
        where === ""
            ? (issue?.message ?? "the request is not the contract's")
            : `${where}: ${issue?.message ?? "invalid"}`,
    );
}
