// vim:set expandtab shiftwidth=4 filetype=typescript:
// SPDX-License-Identifier: GPL-3.0-only

//
//
// ~chewygumxx/dorothy.git
// ::: :/packages/core/src/contracts/memory.ts
//
//

// The memory contract: what every harness receives from Dorothy's memory
// and gives back, whatever engine sits behind it. Plain types; memory
// holds their zod schemas.

import { isPhrase } from "../session-id.js";

export const CONTRACT_SERVER_NAME = "dorothy-memory";
export const SERVICE_PORT = 4774;
export const SERVICE_PATHS = {
    health: "/v1/health",
    block: "/v1/block",
    recall: "/v1/recall",
    record: "/v1/record",
    mcp: "/mcp",
} as const;

// A host as its profile names it.
export const HOST_ID = /^[a-z][a-z0-9-]{0,39}$/;
export const DELIVERIES = ["hook", "plugin", "file", "mcp"] as const;
export type Delivery = (typeof DELIVERIES)[number];
export type HostProfile = {
    id: string;
    // The host versions the profile was checked against.
    checked: string[];
    // Characters an opening block may fill.
    blockBudget: number;
    // Characters recall for a prompt may fill; 0 where the host cannot
    // inject into the user's turn.
    recallBudget: number;
    // Its mechanisms, in order of preference.
    delivery: Delivery[];
    // Characters its MCP client allows for server instructions.
    instructions: number;
};

export const BLOCK_REASONS = ["startup", "resume", "compact", "clear"] as const;
export type BlockReason = (typeof BLOCK_REASONS)[number];
export type BlockRequest = {
    host: string;
    hostVersion?: string | undefined;
    session: string;
    // A project's id, as projects/identify.ts makes it.
    project?: string | undefined;
    reason: BlockReason;
    budget?: number | undefined;
};
export const ITEM_TIERS = ["full", "summary", "title"] as const;
export type ItemTier = (typeof ITEM_TIERS)[number];
export type BlockItem = { id: string; tier: ItemTier };
export type BlockResponse = {
    text: string;
    // xxh3:<16 hex digits> of text.
    digest: string;
    items: BlockItem[];
    // Characters of text.
    used: number;
};

export type RecallRequest = {
    host: string;
    session: string;
    project?: string | undefined;
    prompt: string;
    budget?: number | undefined;
};
export type RecallResponse = { text: string; ids: string[]; used: number };

export const MEMORY_SCOPES = ["project", "personal", "all"] as const;
export type MemoryScope = (typeof MEMORY_SCOPES)[number];
export const MEMORY_KINDS = ["knowledge", "episodes", "all"] as const;
export type MemoryKind = (typeof MEMORY_KINDS)[number];
export const SEARCH_LIMIT = 20;

export type BriefInput = {
    project?: string | undefined;
    budget?: number | undefined;
};
export type MemorySearchInput = {
    query: string;
    scope?: MemoryScope | undefined;
    kind?: MemoryKind | undefined;
    after?: string | undefined;
    before?: string | undefined;
    limit?: number | undefined;
    project?: string | undefined;
};
export type MemoryHit = {
    id: string;
    kind: "knowledge" | "episode";
    // "personal", or a project's id.
    scope: string;
    title: string;
    snippet: string;
    date?: string | undefined;
    // Knowledge the user has not confirmed carries a warning.
    unconfirmed?: string | undefined;
};
export type MemoryOpenInput = {
    id: string;
    from?: number | undefined;
    through?: number | undefined;
    project?: string | undefined;
};
export const REMEMBER_ACTIONS = ["add", "revise", "retire"] as const;
export type RememberAction = (typeof REMEMBER_ACTIONS)[number];
export const KNOWLEDGE_TYPES = [
    "user",
    "feedback",
    "project",
    "reference",
] as const;
export type KnowledgeType = (typeof KNOWLEDGE_TYPES)[number];
export type MemoryRememberInput = {
    action: RememberAction;
    id?: string | undefined;
    title?: string | undefined;
    text?: string | undefined;
    type?: KnowledgeType | undefined;
    scope?: "personal" | "project" | undefined;
    why?: string | undefined;
    project?: string | undefined;
};
export type MemoryRememberResult = {
    id: string;
    status: "added" | "revised" | "retired" | "unchanged";
};

type Stamped = { sourceId: string; at: string };
export type RecordEvent =
    | (Stamped & { kind: "user"; text: string })
    | (Stamped & {
          kind: "assistant";
          text: string;
          interrupted?: boolean | undefined;
      })
    | (Stamped & {
          kind: "tool";
          name: string;
          input: string;
          output: string;
          ok: boolean;
      });
export type RecordRequest = {
    host: string;
    hostVersion?: string | undefined;
    session: string;
    project?: string | undefined;
    // The session this one resumed or forked from.
    parent?: string | undefined;
    private?: boolean | undefined;
    events?: RecordEvent[] | undefined;
    // A path to the host's transcript, for the service's reader.
    transcript?: string | undefined;
};
export type RecordResponse = {
    accepted: number;
    duplicates: number;
    // The last sourceId held, if any.
    through: string | null;
};

// k: and a knowledge file's path within knowledge/, without .md; c: and
// a conversation's phrase.
export type MemoryId =
    | { kind: "knowledge"; path: string }
    | { kind: "conversation"; phrase: string };

const NAME = "[a-z][a-z0-9]*(?:-[a-z0-9]+)*";
const SEGMENT = "[A-Za-z0-9._-]+";
const KNOWLEDGE_PATH = new RegExp(
    `^(?:personal|projects(?:/${SEGMENT})+)/${NAME}$`,
);

export const knowledgeId = (path: string) => `k:${path}`;
export const conversationId = (phrase: string) => `c:${phrase}`;

export function parseMemoryId(id: string): MemoryId | null {
    if (id.startsWith("k:")) {
        const path = id.slice(2);
        const parts = path.split("/");
        return KNOWLEDGE_PATH.test(path) &&
            !parts.includes("..") &&
            !parts.includes(".")
            ? { kind: "knowledge", path }
            : null;
    }
    if (id.startsWith("c:")) {
        const phrase = id.slice(2);
        return isPhrase(phrase) ? { kind: "conversation", phrase } : null;
    }
    return null;
}
