// vim:set expandtab shiftwidth=4 filetype=typescript:
// SPDX-License-Identifier: GPL-3.0-only

//
//
// ~chewygumxx/dorothy.git
// ::: :/src/memory/sidecar.ts
//
//

import { randomBytes } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

// In code points, as JSON Schema's maxLength counts them.
export const LIMITS = { title: 60, description: 160, abstract: 1000 } as const;
export type Field = keyof typeof LIMITS;
export const FIELDS: readonly Field[] = ["title", "description", "abstract"];

export type Author = "prompt" | "dorothy" | "user";
export type Provenance = {
    by: Author;
    at: string;
    model?: string;
    // How many transcript turns Dorothy had seen.
    throughTurn?: number;
};
export type PastTitle = { title: string; at: string; by: Author };
export type Notes = Record<Field, string>;

// How well a read served the purpose Dorothy opened it for, judged in her
// next review.
export type Served = "none" | "slight" | "useful" | "essential";
export const SERVED: readonly Served[] = [
    "none",
    "slight",
    "useful",
    "essential",
];
export type Appraisal = { served: Served; at: string; model: string };
// Reviews that failed in a row, and when the last one did.
export type Failures = { count: number; at: string };

// A run of a conversation's turns that compaction took out of Dorothy's
// context, and her abstract of it. Turns count from 1, both ends included;
// each cluster starts on the turn after the one before it ends.
export type Cluster = {
    from: number;
    through: number;
    abstract: string;
    at: string;
    model: string;
};
// Holds a write against writers in other processes; the index provides it.
export type Lock = <T>(work: () => Promise<T>) => Promise<T>;

export type Sidecar = {
    v: 1;
    rev: number;
    title: string | null;
    description: string | null;
    abstract: string | null;
    pinned: boolean;
    hidden: boolean;
    // Oldest first.
    titles: PastTitle[];
    fields: Partial<Record<Field, Provenance>>;
    // The turn count Dorothy's last review covered; 0 for never.
    reviewedThrough: number;
    reviewCostUsd: number;
    // Dorothy's appraisals of what she read, by tool call id; final once made.
    appraisals: Record<string, Appraisal>;
    failures: Failures | null;
    // Oldest first; written once, never revised.
    clusters: Cluster[];
};

export type SidecarRead =
    | { kind: "none" }
    | { kind: "ok"; sidecar: Sidecar }
    | { kind: "unparseable"; reason: string };

export type UpdateResult =
    | { kind: "written"; sidecar: Sidecar }
    | { kind: "unchanged"; sidecar: Sidecar | null }
    | { kind: "unparseable"; reason: string }
    | { kind: "failed"; reason: string };

// A note set to null is emptied, handing it back to Dorothy.
export type EditChanges = Partial<Record<Field, string | null>> & {
    pinned?: boolean;
    hidden?: boolean;
};

// Frozen through, so that a change made through a sidecar built on it
// throws instead of reaching every sidecar built after.
export const EMPTY_SIDECAR: Sidecar = frozen({
    v: 1,
    rev: 0,
    title: null,
    description: null,
    abstract: null,
    pinned: false,
    hidden: false,
    titles: [],
    fields: {},
    reviewedThrough: 0,
    reviewCostUsd: 0,
    appraisals: {},
    failures: null,
    clusters: [],
});

function frozen(sidecar: Sidecar): Sidecar {
    Object.freeze(sidecar.titles);
    Object.freeze(sidecar.fields);
    Object.freeze(sidecar.appraisals);
    Object.freeze(sidecar.clusters);
    return Object.freeze(sidecar);
}

const AUTHORS: readonly string[] = ["prompt", "dorothy", "user"];

const describeError = (error: unknown) =>
    error instanceof Error ? error.message : String(error);
const isRecord = (value: unknown): value is Record<string, unknown> =>
    typeof value === "object" && value !== null && !Array.isArray(value);
const isAuthor = (value: unknown): value is Author =>
    typeof value === "string" && AUTHORS.includes(value);
const isCount = (value: unknown): value is number =>
    typeof value === "number" && Number.isInteger(value) && value >= 0;

export function sidecarPath(dir: string, phrase: string): string {
    return join(dir, `${phrase}.meta.json`);
}

// Notes are kept as one line with single spaces. Control characters (C0, DEL
// and C1) become spaces, so a note can never carry a terminal escape.
export const normalise = (text: string) =>
    text
        .replace(/\p{Cc}/gu, " ")
        .replace(/\s+/g, " ")
        .trim();
export const characters = (text: string) => [...text].length;

export function overLimit(field: Field, text: string): string | null {
    const count = characters(text);
    return count > LIMITS[field]
        ? `${field} is ${count} characters, over ${LIMITS[field]}`
        : null;
}

// A note is normalised as it is read, so a stray space typed into the JSON
// costs nothing; an empty note, or one over its limit, reads as absent.
function readNote(field: Field, value: unknown): string | null {
    if (typeof value !== "string") {
        return null;
    }
    const note = normalise(value);
    return note !== "" && overLimit(field, note) === null ? note : null;
}

const isTurn = (value: unknown): value is number =>
    typeof value === "number" && Number.isInteger(value) && value >= 1;

// The clusters that follow on from turn 1, up to the first that does not.
function readClusters(value: unknown): Cluster[] {
    const clusters: Cluster[] = [];
    for (const entry of Array.isArray(value) ? value : []) {
        const from = (clusters.at(-1)?.through ?? 0) + 1;
        const abstract =
            isRecord(entry) && typeof entry.abstract === "string"
                ? normalise(entry.abstract)
                : "";
        if (
            !isRecord(entry) ||
            entry.from !== from ||
            !isTurn(entry.through) ||
            entry.through < from ||
            abstract === "" ||
            overLimit("abstract", abstract) !== null ||
            typeof entry.at !== "string" ||
            typeof entry.model !== "string"
        ) {
            break;
        }
        clusters.push({
            from,
            through: entry.through,
            abstract,
            at: entry.at,
            model: entry.model,
        });
    }
    return clusters;
}

function readProvenance(value: unknown): Provenance | null {
    if (
        !isRecord(value) ||
        !isAuthor(value.by) ||
        typeof value.at !== "string"
    ) {
        return null;
    }
    const provenance: Provenance = { by: value.by, at: value.at };
    if (typeof value.model === "string") {
        provenance.model = value.model;
    }
    if (isCount(value.throughTurn)) {
        provenance.throughTurn = value.throughTurn;
    }
    return provenance;
}

// Only bad JSON, a non-object or an unknown version make a sidecar
// unparseable; a field of the wrong shape reads as absent.
export function parseSidecar(
    text: string,
): Exclude<SidecarRead, { kind: "none" }> {
    let data: unknown;
    try {
        data = JSON.parse(text);
    } catch (error) {
        return { kind: "unparseable", reason: describeError(error) };
    }
    if (!isRecord(data)) {
        return { kind: "unparseable", reason: "not a JSON object" };
    }
    if (data.v !== 1) {
        return {
            kind: "unparseable",
            reason: `unknown version ${JSON.stringify(data.v)}`,
        };
    }
    const sidecar: Sidecar = {
        ...EMPTY_SIDECAR,
        titles: [],
        fields: {},
        appraisals: {},
        clusters: readClusters(data.clusters),
    };
    sidecar.rev = isCount(data.rev) ? data.rev : 0;
    for (const field of FIELDS) {
        const note = readNote(field, data[field]);
        sidecar[field] = note;
        const provenance = isRecord(data.fields)
            ? readProvenance(data.fields[field])
            : null;
        // A note that is not there has no owner.
        if (note !== null && provenance !== null) {
            sidecar.fields[field] = provenance;
        }
    }
    sidecar.pinned = data.pinned === true;
    sidecar.hidden = data.hidden === true;
    if (Array.isArray(data.titles)) {
        for (const entry of data.titles) {
            const title =
                isRecord(entry) && typeof entry.title === "string"
                    ? normalise(entry.title)
                    : "";
            if (
                isRecord(entry) &&
                title !== "" &&
                typeof entry.at === "string" &&
                isAuthor(entry.by)
            ) {
                sidecar.titles.push({
                    title,
                    at: entry.at,
                    by: entry.by,
                });
            }
        }
    }
    sidecar.reviewedThrough = isCount(data.reviewedThrough)
        ? data.reviewedThrough
        : 0;
    const cost = data.reviewCostUsd;
    sidecar.reviewCostUsd =
        typeof cost === "number" && Number.isFinite(cost) && cost >= 0
            ? cost
            : 0;
    if (isRecord(data.appraisals)) {
        for (const [id, value] of Object.entries(data.appraisals)) {
            if (
                isRecord(value) &&
                SERVED.includes(value.served as Served) &&
                typeof value.at === "string" &&
                typeof value.model === "string"
            ) {
                sidecar.appraisals[id] = {
                    served: value.served as Served,
                    at: value.at,
                    model: value.model,
                };
            }
        }
    }
    const failures = data.failures;
    if (
        isRecord(failures) &&
        isCount(failures.count) &&
        failures.count > 0 &&
        typeof failures.at === "string"
    ) {
        sidecar.failures = { count: failures.count, at: failures.at };
    }
    return { kind: "ok", sidecar };
}

// A sidecar that cannot be read is treated as unparseable, so it is never
// written either.
export async function readSidecar(
    dir: string,
    phrase: string,
): Promise<SidecarRead> {
    let text: string;
    try {
        text = await readFile(sidecarPath(dir, phrase), "utf8");
    } catch (error) {
        if ((error as { code?: unknown }).code === "ENOENT") {
            return { kind: "none" };
        }
        return { kind: "unparseable", reason: describeError(error) };
    }
    return parseSidecar(text);
}

// No reader ever sees half a file: the text lands under a temporary name in
// the same directory, then replaces the sidecar in one rename.
async function writeAtomic(path: string, text: string): Promise<void> {
    await mkdir(dirname(path), { recursive: true, mode: 0o700 });
    const temporary = `${path}.${randomBytes(4).toString("hex")}.tmp`;
    try {
        await writeFile(temporary, text, { mode: 0o600, flag: "wx" });
        await rename(temporary, path);
    } catch (error) {
        await rm(temporary, { force: true });
        throw error;
    }
}

// Writers of one sidecar in this process take turns.
const queues = new Map<string, Promise<UpdateResult>>();

// Every writer re-reads the sidecar and applies only its own changes to
// what it finds, so a review landing during an edit merges with it.
export function updateSidecar(
    dir: string,
    phrase: string,
    change: (current: Sidecar | null) => Sidecar | null,
    lock?: Lock,
): Promise<UpdateResult> {
    const path = sidecarPath(dir, phrase);
    const write = async (): Promise<UpdateResult> => {
        const read = await readSidecar(dir, phrase);
        if (read.kind === "unparseable") {
            return read;
        }
        const current = read.kind === "ok" ? read.sidecar : null;
        const next = change(current);
        if (next === null) {
            return { kind: "unchanged", sidecar: current };
        }
        const sidecar = { ...next, rev: (current?.rev ?? 0) + 1 };
        await writeAtomic(path, `${JSON.stringify(sidecar, null, 2)}\n`);
        return { kind: "written", sidecar };
    };
    const run = lock === undefined ? write : () => lock(write);
    const result = (queues.get(path) ?? Promise.resolve()).then(run).catch(
        (error: unknown): UpdateResult => ({
            kind: "failed",
            reason: describeError(error),
        }),
    );
    queues.set(path, result);
    void result.then(() => {
        if (queues.get(path) === result) {
            queues.delete(path);
        }
    });
    return result;
}

// The first non-blank line of the first message, cut to the title limit.
export function provisionalTitle(message: string): string | null {
    const line = message
        .split("\n")
        .map(normalise)
        .find((text) => text !== "");
    if (line === undefined) {
        return null;
    }
    const points = [...line];
    return points.length <= LIMITS.title
        ? line
        : `${points
              .slice(0, LIMITS.title - 1)
              .join("")
              .trimEnd()}…`;
}

// Only a conversation with no sidecar gets one.
export function withProvisional(
    current: Sidecar | null,
    title: string,
    at: string,
): Sidecar | null {
    if (current !== null) {
        return null;
    }
    return {
        ...EMPTY_SIDECAR,
        title,
        titles: [],
        fields: { title: { by: "prompt", at } },
        appraisals: {},
        clusters: [],
    };
}

// Whoever changes the title, the old one joins the history with its own
// stamp.
function retitle(
    sidecar: Sidecar,
    title: string | null,
    at: string,
): PastTitle[] {
    const old = sidecar.title;
    if (old === null || old === title) {
        return sidecar.titles;
    }
    const source = sidecar.fields.title;
    return [
        ...sidecar.titles,
        { title: old, at: source?.at ?? at, by: source?.by ?? "user" },
    ];
}

// Dorothy's review: every note she owns is replaced and stamped; the user's
// are left alone.
export function mergeReview(
    current: Sidecar | null,
    notes: Notes,
    review: {
        model: string;
        at: string;
        throughTurn: number;
        costUsd: number;
        appraisals?: Record<string, Served>;
    },
): Sidecar {
    const base = current ?? EMPTY_SIDECAR;
    const next: Sidecar = {
        ...base,
        fields: { ...base.fields },
        reviewedThrough: review.throughTurn,
        reviewCostUsd: base.reviewCostUsd + review.costUsd,
        appraisals: { ...base.appraisals },
        failures: null,
    };
    // An appraisal, once made, is final.
    for (const [id, served] of Object.entries(review.appraisals ?? {})) {
        next.appraisals[id] ??= { served, at: review.at, model: review.model };
    }
    for (const field of FIELDS) {
        if (base.fields[field]?.by === "user") {
            continue;
        }
        if (field === "title") {
            next.titles = retitle(base, notes.title, review.at);
        }
        next[field] = notes[field];
        next.fields[field] = {
            by: "dorothy",
            model: review.model,
            at: review.at,
            throughTurn: review.throughTurn,
        };
    }
    return next;
}

// The user's edit: a changed note becomes theirs; an emptied one goes back
// to Dorothy, and the next review rewrites it.
export function mergeEdit(
    current: Sidecar | null,
    changes: EditChanges,
    at: string,
): Sidecar {
    const base = current ?? EMPTY_SIDECAR;
    const next: Sidecar = { ...base, fields: { ...base.fields } };
    for (const field of FIELDS) {
        const value = changes[field];
        if (value === undefined) {
            continue;
        }
        if (field === "title") {
            next.titles = retitle(base, value, at);
        }
        next[field] = value;
        if (value === null) {
            delete next.fields[field];
            next.reviewedThrough = 0;
        } else {
            next.fields[field] = { by: "user", at };
        }
    }
    if (changes.pinned !== undefined) {
        next.pinned = changes.pinned;
    }
    if (changes.hidden !== undefined) {
        next.hidden = changes.hidden;
    }
    return next;
}

const HOUR_MS = 3_600_000;
const MAX_BACKOFF_MS = 7 * 24 * HOUR_MS;

// A review that failed: the count grows until one succeeds.
export function markFailed(current: Sidecar | null, at: string): Sidecar {
    const base = current ?? EMPTY_SIDECAR;
    return {
        ...base,
        failures: { count: (base.failures?.count ?? 0) + 1, at },
    };
}

// A review that had nothing to do: the turns count as covered.
export function markReviewed(
    current: Sidecar | null,
    throughTurn: number,
): Sidecar | null {
    return current === null
        ? null
        : { ...current, reviewedThrough: throughTurn };
}

// New clusters go on the end, and only if they start where the last one
// ended; anything else would cover turns twice or leave a gap.
export function appendClusters(
    current: Sidecar | null,
    clusters: readonly Cluster[],
): Sidecar | null {
    const base = current ?? EMPTY_SIDECAR;
    const next = (base.clusters.at(-1)?.through ?? 0) + 1;
    if (clusters[0]?.from !== next) {
        return null;
    }
    return { ...base, clusters: [...base.clusters, ...clusters] };
}

// After n failures in a row, no review until min(2^(n-1) hours, 7 days)
// after the last.
export function reviewDue(sidecar: Sidecar | null, now: number): boolean {
    const failures = sidecar?.failures;
    if (failures === null || failures === undefined) {
        return true;
    }
    const at = Date.parse(failures.at);
    if (!Number.isFinite(at)) {
        return true;
    }
    const wait = Math.min(2 ** (failures.count - 1) * HOUR_MS, MAX_BACKOFF_MS);
    return now >= at + wait;
}

// Every note is there and the user's, so a review could change nothing.
export function ownsAll(sidecar: Sidecar): boolean {
    return FIELDS.every(
        (field) =>
            sidecar[field] !== null && sidecar.fields[field]?.by === "user",
    );
}
