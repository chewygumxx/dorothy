// vim:set expandtab shiftwidth=4 filetype=typescript:
// SPDX-License-Identifier: GPL-3.0-only

//
//
// ~chewygumxx/dorothy.git
// ::: :/packages/core/src/contracts/model.ts
//
//

// The models Dorothy's calls may take: each role's route, an ordered
// list of entries, and what one attempt on an entry comes to. Nothing
// here knows a provider's SDK or wire; agent turns its errors into
// Failures, and runRoute decides on them.

export const ROLES = ["chat", "review", "compaction", "maintenance"] as const;
export type Role = (typeof ROLES)[number];

export const KINDS = [
    "anthropic",
    "openrouter",
    "featherless",
    "local",
] as const;
export type Kind = (typeof KINDS)[number];

// One model a role may use, with what reaching it needs.
export type RouteEntry = {
    // The provider it came from, [providers.<name>] in Part B's config.
    provider: string;
    kind: Kind;
    model: string;
    // Always explicit, never an environment variable's.
    baseUrl: string;
    // A secrets.json name, never a value; null for a keyless local server.
    key: string | null;
    // Dollars per million tokens, input and output, where no table has it.
    price: [number, number] | null;
};
export type Route = RouteEntry[];
export type Routes = Record<Role, Route>;

export type FailureClass =
    | "usage"
    | "rate-limit"
    | "overload"
    | "server"
    | "timeout"
    | "network"
    | "rejected"
    | "unparsed"
    | "secret"
    | "cancelled";

export type Failure = {
    class: FailureClass;
    message: string;
    retryAfterMs: number | null;
};

// One attempt on one entry. started: text has streamed or remember has
// run, so no other entry may take the turn over.
export type AttemptResult<T> =
    | { ok: true; value: T; costUsd: number }
    | { ok: false; failure: Failure; started: boolean; costUsd: number };

export type Attempt<T> = (
    entry: RouteEntry,
    signal: AbortSignal,
) => Promise<AttemptResult<T>>;

// An entry as notes and outcomes name it: anthropic:claude-opus-5-5.
export const label = (entry: RouteEntry) => `${entry.provider}:${entry.model}`;
