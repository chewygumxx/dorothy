// vim:set expandtab shiftwidth=4 filetype=typescript:
// SPDX-License-Identifier: GPL-3.0-only

//
//
// ~chewygumxx/dorothy.git
// ::: :/packages/cli/src/hosts/pi/steward/types.ts
//
//

// The contracts stewardship's parts meet on: the declared fleet, what is
// observed of it, and the helper's request and reply. No Pi or model type.

export type Harness = "codex" | "claude";
export type Role = "implementer" | "reviewer" | "reserve";
export type Availability = "available" | "busy" | "limited" | "unknown";

export type Worker = {
    id: string;
    name: string;
    pane: string;
    harness: Harness;
    role: Role;
    cwd: string;
    accountLabel: string;
    availability: Availability;
    observedAt: string;
    expiresAt: string;
};

export type Fleet = {
    version: 1;
    fleetId: string;
    fixtureRoot: string;
    workers: Worker[];
};

export type WorkerState = "idle" | "working" | "blocked" | "done" | "unknown";

export type WorkerObservation = {
    id: string;
    matches: boolean;
    state: WorkerState;
    observedAt: string;
    code: string | null;
    // herdr's terminal id of the matched occupant, for the caller to pin;
    // null where unmatched, absent or not a bounded word. Never a match.
    terminalId: string | null;
};

export type TaskBrief = {
    taskId: string;
    workerId: string;
    briefPath: string;
    reportPath: string;
    baseOid: string;
};

export type CompletionEvidence = {
    reportDigest: string;
    revision: string;
    verification: { command: string[]; exitCode: number; logPath: string };
};

// A task's state in the ledger. `intent` is recorded before a send and
// proves no delivery; `unknown` is a send that may or may not have landed;
// `verified` needs the runner's receipt. Only `verified`, `cancelled` and
// `failed` release the worker.
export type TaskState =
    | "intent"
    | "sent"
    | "running"
    | "reported"
    | "verified"
    | "cancel-requested"
    | "cancelled"
    | "failed"
    | "unknown";

// The ledger's row, as the reply carries it.
export type TaskRecord = TaskBrief & {
    briefDigest: string;
    state: TaskState;
    createdAt: string;
    updatedAt: string;
    reportDigest: string | null;
    revision: string | null;
    code: string | null;
};

export type StewardRequest = {
    registry: string;
    controller: { pid: number; startedAt: string };
    operation:
        | { kind: "list" }
        | { kind: "read"; workerId: string; lines: number }
        | { kind: "dispatch"; task: TaskBrief }
        | { kind: "wait"; taskId: string; timeoutMs: number }
        | { kind: "cancel"; taskId: string }
        | { kind: "reconcile"; taskId?: string }
        | { kind: "finish"; taskId: string; evidence: CompletionEvidence };
};

export type StewardReply = {
    ok: boolean;
    code: string;
    workers?: WorkerObservation[];
    tasks?: TaskRecord[];
    text?: string;
};

// An error with a stable code; its message starts `<code>: `.
export class StewardError extends Error {
    constructor(
        readonly code: string,
        detail: string,
    ) {
        super(`${code}: ${detail}`);
        this.name = "StewardError";
    }
}
