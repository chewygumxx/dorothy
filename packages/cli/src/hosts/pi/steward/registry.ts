// vim:set expandtab shiftwidth=4 filetype=typescript:
// SPDX-License-Identifier: GPL-3.0-only

//
//
// ~chewygumxx/dorothy.git
// ::: :/packages/cli/src/hosts/pi/steward/registry.ts
//
//

// The trial fleet's manifest, strictly read: versioned, bounded, every field
// named, every path canonical beneath the fixture root, every observation
// recent. It discovers nothing and loads no credential.

import { lstat, open, realpath } from "node:fs/promises";
import { dirname, isAbsolute, normalize, sep } from "node:path";
import { isUuid } from "@dorothy/core";
import {
    type Availability,
    type Fleet,
    type Harness,
    type Role,
    StewardError,
    type Worker,
} from "./types.js";

export const MAX_REGISTRY_BYTES = 64 * 1024;
export const MAX_WORKERS = 8;
export const MAX_EXPIRY_MS = 60 * 60_000;
const MAX_PATH = 4096;

// Worker ids, names and panes are argv words for herdr: none may start
// with a dash, or hold a space or a shell word.
const WORD = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,31}$/;
const LABEL = /^[A-Za-z0-9][A-Za-z0-9._-]{0,31}$/;
const TASK_ID = /^[a-z][a-z0-9_-]{0,63}$/;
const INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/;

// Field names that hold or invite a credential, and values shaped like one.
const SECRET_KEY =
    /token|secret|passw|credential|api[-_]?key|auth|bearer|cookie|private/i;
// Each token shape starts at a word edge, as `task-stewardship` and
// `desk-account-one` are paths, not an `sk-` key.
const SECRET_VALUE = new RegExp(
    [
        "sk-[A-Za-z0-9_-]{8,}",
        "gh[pousr]_[A-Za-z0-9]{16,}",
        "github_pat_\\w{10,}",
        "xox[abprs]-[\\w-]{8,}",
        "AKIA[0-9A-Z]{12,}",
        "eyJ[\\w-]{10,}\\.[\\w-]{4,}",
    ]
        .map((shape) => `(?<![A-Za-z0-9])${shape}`)
        .join("|"),
);

const HARNESSES: readonly Harness[] = ["codex", "claude"];
const ROLES: readonly Role[] = ["implementer", "reviewer", "reserve"];
const AVAILABILITIES: readonly Availability[] = [
    "available",
    "busy",
    "limited",
    "unknown",
];
const FLEET_KEYS = ["version", "fleetId", "fixtureRoot", "workers"] as const;
const WORKER_KEYS = [
    "id",
    "name",
    "pane",
    "harness",
    "role",
    "cwd",
    "accountLabel",
    "availability",
    "observedAt",
    "expiresAt",
] as const;

export const isTaskId = (value: unknown): value is string =>
    typeof value === "string" && TASK_ID.test(value);

// What herdr is asked for and told about: a word safe in argv.
export const isWorkerWord = (value: unknown): value is string =>
    typeof value === "string" && WORD.test(value);

const invalid = (what: string) =>
    new StewardError("REGISTRY_FIELD_INVALID", what);

function object(value: unknown, what: string): Record<string, unknown> {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
        throw invalid(what);
    }
    return value as Record<string, unknown>;
}

// Exactly these keys: a credential-like one is named so, any other unknown
// one refused, a missing one refused.
function exactly(
    value: Record<string, unknown>,
    keys: readonly string[],
    what: string,
): void {
    for (const key of Object.keys(value)) {
        if (!keys.includes(key)) {
            throw new StewardError(
                SECRET_KEY.test(key)
                    ? "REGISTRY_CREDENTIAL"
                    : "REGISTRY_UNKNOWN_FIELD",
                `${what}.${key.slice(0, 40)}`,
            );
        }
    }
    for (const key of keys) {
        if (!(key in value)) {
            throw new StewardError("REGISTRY_FIELD_MISSING", `${what}.${key}`);
        }
    }
}

function oneOf<T extends string>(
    value: unknown,
    allowed: readonly T[],
    what: string,
): T {
    if (typeof value !== "string" || !allowed.includes(value as T)) {
        throw invalid(what);
    }
    return value as T;
}

function matching(value: unknown, pattern: RegExp, what: string): string {
    if (typeof value !== "string" || !pattern.test(value)) {
        throw invalid(what);
    }
    return value;
}

function instant(value: unknown, what: string): number {
    const text = matching(value, INSTANT, what);
    const time = Date.parse(text);
    if (Number.isNaN(time)) {
        throw invalid(what);
    }
    return time;
}

const within = (root: string, path: string): boolean =>
    path === root || path.startsWith(root.endsWith(sep) ? root : root + sep);

function absolute(
    value: unknown,
    what: string,
    code = "REGISTRY_PATH_INVALID",
): string {
    if (
        typeof value !== "string" ||
        value.length > MAX_PATH ||
        value.includes("\0") ||
        !isAbsolute(value)
    ) {
        throw new StewardError(code, what);
    }
    return value;
}

async function canonical(path: string, what: string): Promise<string> {
    try {
        return await realpath(path);
    } catch {
        throw new StewardError("REGISTRY_PATH_INVALID", what);
    }
}

async function readBounded(path: string): Promise<string> {
    let info: Awaited<ReturnType<typeof lstat>>;
    try {
        info = await lstat(path);
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") {
            throw new StewardError("REGISTRY_MISSING", path);
        }
        throw new StewardError("REGISTRY_INVALID", path);
    }
    if (!info.isFile()) {
        throw new StewardError("REGISTRY_NOT_REGULAR", path);
    }
    if (info.size > MAX_REGISTRY_BYTES) {
        throw new StewardError("REGISTRY_TOO_LARGE", path);
    }
    const handle = await open(path, "r").catch(() => {
        throw new StewardError("REGISTRY_INVALID", path);
    });
    try {
        const buffer = Buffer.alloc(MAX_REGISTRY_BYTES + 1);
        const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
        if (bytesRead > MAX_REGISTRY_BYTES) {
            throw new StewardError("REGISTRY_TOO_LARGE", path);
        }
        return new TextDecoder("utf-8", { fatal: true }).decode(
            buffer.subarray(0, bytesRead),
        );
    } catch (error) {
        if (error instanceof StewardError) {
            throw error;
        }
        throw new StewardError("REGISTRY_INVALID", path);
    } finally {
        await handle.close();
    }
}

async function readWorker(
    value: unknown,
    index: number,
    root: string,
    now: number,
): Promise<Worker> {
    const what = `workers[${index}]`;
    const raw = object(value, what);
    exactly(raw, WORKER_KEYS, what);
    const cwd = await canonical(
        absolute(raw.cwd, `${what}.cwd`),
        `${what}.cwd`,
    );
    if (!within(root, cwd)) {
        throw new StewardError("REGISTRY_ROOT_ESCAPE", `${what}.cwd`);
    }
    const observed = instant(raw.observedAt, `${what}.observedAt`);
    const expires = instant(raw.expiresAt, `${what}.expiresAt`);
    if (observed > now) {
        throw new StewardError("REGISTRY_FUTURE", `${what}.observedAt`);
    }
    if (expires <= observed || expires - observed > MAX_EXPIRY_MS) {
        throw new StewardError("REGISTRY_EXPIRY_SPAN", what);
    }
    if (expires <= now) {
        throw new StewardError("REGISTRY_EXPIRED", `${what}.expiresAt`);
    }
    return {
        id: matching(raw.id, WORD, `${what}.id`),
        name: matching(raw.name, WORD, `${what}.name`),
        pane: matching(raw.pane, WORD, `${what}.pane`),
        harness: oneOf(raw.harness, HARNESSES, `${what}.harness`),
        role: oneOf(raw.role, ROLES, `${what}.role`),
        cwd,
        accountLabel: matching(raw.accountLabel, LABEL, `${what}.accountLabel`),
        availability: oneOf(
            raw.availability,
            AVAILABILITIES,
            `${what}.availability`,
        ),
        observedAt: raw.observedAt as string,
        expiresAt: raw.expiresAt as string,
    };
}

function distinct(workers: Worker[]): void {
    for (const field of ["id", "name", "pane"] as const) {
        const seen = new Set(workers.map((worker) => worker[field]));
        if (seen.size !== workers.length) {
            throw new StewardError("REGISTRY_DUPLICATE", field);
        }
    }
}

// Reads the registry at `path` against the injected clock. Any worker
// expired, observed in the future or lasting over an hour refuses the whole
// fleet: refresh is the fixture runner's explicit act, never this reader's.
export async function readFleet(path: string, now: Date): Promise<Fleet> {
    const text = await readBounded(path);
    if (SECRET_VALUE.test(text)) {
        throw new StewardError("REGISTRY_CREDENTIAL", "value");
    }
    let parsed: unknown;
    try {
        parsed = JSON.parse(text);
    } catch {
        throw new StewardError("REGISTRY_INVALID", path);
    }
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
        throw new StewardError("REGISTRY_INVALID", path);
    }
    const raw = parsed as Record<string, unknown>;
    exactly(raw, FLEET_KEYS, "registry");
    if (raw.version !== 1) {
        throw new StewardError("REGISTRY_VERSION", String(raw.version));
    }
    if (typeof raw.fleetId !== "string" || !isUuid(raw.fleetId)) {
        throw invalid("fleetId");
    }
    const root = await canonical(
        absolute(raw.fixtureRoot, "fixtureRoot"),
        "fixtureRoot",
    );
    if (root === sep || !(await lstat(root)).isDirectory()) {
        throw new StewardError("REGISTRY_PATH_INVALID", "fixtureRoot");
    }
    if (
        !Array.isArray(raw.workers) ||
        raw.workers.length < 1 ||
        raw.workers.length > MAX_WORKERS
    ) {
        throw invalid("workers");
    }
    const workers: Worker[] = [];
    for (const [index, value] of raw.workers.entries()) {
        workers.push(await readWorker(value, index, root, now.getTime()));
    }
    distinct(workers);
    return { version: 1, fleetId: raw.fleetId, fixtureRoot: root, workers };
}

// A brief or report path, to be used: absolute, beneath the fixture root,
// no link in any part of it, and a regular file (a report may not exist
// yet, but its directory must). Call it again at the point of use.
export async function fixturePath(
    fleet: Fleet,
    path: string,
    kind: "brief" | "report",
): Promise<string> {
    if (typeof path !== "string" || path.length > MAX_PATH) {
        throw new StewardError("PATH_INVALID", kind);
    }
    const target = normalize(absolute(path, kind, "PATH_INVALID"));
    if (!within(fleet.fixtureRoot, target) || target === fleet.fixtureRoot) {
        throw new StewardError("PATH_ESCAPE", kind);
    }
    const info = await lstat(target).catch((error: NodeJS.ErrnoException) => {
        if (error.code === "ENOENT") {
            return null;
        }
        throw new StewardError("PATH_MISSING", kind);
    });
    const anchor = info ? target : dirname(target);
    if (!info && kind === "brief") {
        throw new StewardError("PATH_MISSING", kind);
    }
    if (info?.isSymbolicLink()) {
        throw new StewardError("PATH_SYMLINK", kind);
    }
    const real = await realpath(anchor).catch(() => {
        throw new StewardError("PATH_MISSING", kind);
    });
    if (real !== anchor) {
        throw new StewardError(
            within(fleet.fixtureRoot, real) ? "PATH_SYMLINK" : "PATH_ESCAPE",
            kind,
        );
    }
    if (info ? !info.isFile() : !(await lstat(anchor)).isDirectory()) {
        throw new StewardError("PATH_NOT_REGULAR", kind);
    }
    return target;
}
