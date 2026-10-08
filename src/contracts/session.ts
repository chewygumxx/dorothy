// vim:set expandtab shiftwidth=4 filetype=typescript:
// SPDX-License-Identifier: GPL-3.0-only

//
//
// ~chewygumxx/dorothy.git
// ::: :/src/contracts/session.ts
//
//

// What the packages meet on: a chat session as the screen, memory and
// the model side each see it. Nothing here runs a model.

import type { Lookup, RecallEvent } from "./recall.js";

export type Turn = { role: "user" | "assistant"; text: string };

export type TurnStats = {
    // Input the cache did not serve; cached input is counted apart.
    inputTokens: number;
    cacheReadTokens: number;
    cacheWriteTokens: number;
    outputTokens: number;
    ttftMs: number | null;
    durationMs: number;
    costUsd: number;
    sessionCostUsd: number;
};

// The fields of an SDK message the raw pane reads. Every SDKMessage fits it,
// so the TUI shows them without depending on the SDK's types.
export type RawMessage = {
    type: string;
    subtype?: string;
    event?: { type?: string; delta?: unknown };
};

export type ConversationEvent =
    | { type: "ready"; model: string; sdkSessionId: string }
    | { type: "delta"; text: string }
    | {
          type: "turn-end";
          reply: string;
          interrupted: boolean;
          stats: TurnStats;
          // Estimated tokens the next request starts from: what the last
          // request read, plus the reply it added. Conversation always sets
          // it.
          contextTokens?: number;
      }
    | { type: "sdk"; message: RawMessage }
    // A lookup Dorothy made; offset is where in the reply it happened.
    | {
          type: "lookup";
          id: string;
          ok: boolean;
          offset: number;
          lookup: Lookup;
      }
    | { type: "warning"; message: string }
    // Compaction is under way and the next message waits for it.
    | { type: "compacting" }
    // Turns from to through now live in clusters of a new session.
    | { type: "compacted"; from: number; through: number; clusters: number }
    // What a background call for memory cost, such as compaction's.
    | { type: "memory-cost"; usd: number }
    // partial: the reply streamed so far, when the turn died mid-reply.
    | { type: "error"; message: string; partial?: string };

export interface ChatSession {
    subscribe(listener: (event: ConversationEvent) => void): () => void;
    send(text: string): void;
    interrupt(): Promise<void>;
    close(): Promise<void>;
}

// How long a closed session waits for its subprocess to exit on its own
// before terminating it. Compaction waits as long for the saves under way
// when quitting.
export const CLOSE_GRACE_MS = 2000;

// A turn read back from a transcript: a reply keeps the stats recorded after
// it, what the chat had cost by then, and the lookups made while writing it.
export type ResumedTurn = Turn & {
    stats?: TurnStats;
    chatCostUsd?: number;
    lookups?: RecallEvent[];
};
