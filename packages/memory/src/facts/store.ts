// vim:set expandtab shiftwidth=4 filetype=typescript:
// SPDX-License-Identifier: GPL-3.0-only

//
//
// ~chewygumxx/dorothy.git
// ::: :/packages/memory/src/facts/store.ts
//
//

// The store's facts: personal ones in knowledge/personal/, a project's
// in knowledge/projects/<id>/, one file each in the Open Knowledge
// Format. Writes take the store's lock and are recorded by history.
// Nothing here deletes a fact: a fact that no longer serves is retired,
// and stays.

import { readdir, readFile, rm } from "node:fs/promises";
import { dirname, join, relative, sep } from "node:path";
import type { Env } from "@dorothy/core";
import {
    type Lock,
    normalise,
    type Recorder,
    writeAtomic,
} from "../memory/sidecar.js";
import { transcriptDir } from "../transcript.js";
import {
    FACT_NAME,
    type Fact,
    type FactRead,
    type FactType,
    isConfirmed,
    nextOrigin,
    type Origin,
    parseFact,
    renderFact,
    USER_ACTOR,
    type Writer,
} from "./file.js";

export type Scope = { kind: "personal" } | { kind: "project"; id: string };
export const PERSONAL: Scope = Object.freeze({ kind: "personal" });

// Where facts live under the data directory; facts/ held them before.
export const KNOWLEDGE = "knowledge";

// local- and 12 hex digits, or a host and at least one path segment, as
// projects/identify.ts makes them.
export const PROJECT_ID =
    /^(?:local-[0-9a-f]{12}|[a-z0-9.-]+(?:\/[A-Za-z0-9._~-]+)+)$/;
export const isProjectId = (id: string) =>
    PROJECT_ID.test(id) &&
    !id.split("/").some((part) => part === "." || part === "..");

// The data directory: transcripts/, tags.json, knowledge/ and projects.json.
export const dataRoot = (env: Env = process.env) => dirname(transcriptDir(env));

export function scopeDir(
    root: string,
    scope: Scope,
    under: string = KNOWLEDGE,
): string {
    if (scope.kind === "personal") {
        return join(root, under, "personal");
    }
    // An id with .. or an empty part would write outside the store.
    if (!isProjectId(scope.id)) {
        throw new Error(`${scope.id} is not a project id`);
    }
    return join(root, under, "projects", ...scope.id.split("/"));
}

export const factPath = (root: string, scope: Scope, name: string) =>
    join(scopeDir(root, scope), `${name}.md`);

export const scopeLabel = (scope: Scope) =>
    scope.kind === "personal" ? "personal" : scope.id;

// personal/<name> or <project id>/<name>, as the commands take them.
export function parseTarget(
    target: string,
): { scope: Scope; name: string } | null {
    const at = target.lastIndexOf("/");
    const label = target.slice(0, at);
    const name = target.slice(at + 1);
    if (at <= 0 || !FACT_NAME.test(name)) {
        return null;
    }
    if (label === "personal") {
        return { scope: PERSONAL, name };
    }
    return isProjectId(label)
        ? { scope: { kind: "project", id: label }, name }
        : null;
}

export type FactFile = { scope: Scope; name: string; path: string };

const codeOf = (error: unknown) => (error as { code?: unknown }).code;
const describeError = (error: unknown) =>
    error instanceof Error ? error.message : String(error);

async function entries(dir: string) {
    try {
        return await readdir(dir, { withFileTypes: true });
    } catch (error) {
        if (codeOf(error) === "ENOENT") {
            return [];
        }
        throw error;
    }
}

const factName = (file: string) =>
    file.endsWith(".md") && FACT_NAME.test(file.slice(0, -3))
        ? file.slice(0, -3)
        : null;

// Every fact file, or one scope's, personal first, then by project and
// name. Symlinks are never followed.
export async function factFiles(
    root: string,
    scope?: Scope,
    under: string = KNOWLEDGE,
): Promise<FactFile[]> {
    const files: FactFile[] = [];
    const inScope = async (dir: string, of: Scope) => {
        for (const entry of await entries(dir)) {
            const name = entry.isFile() ? factName(entry.name) : null;
            if (name !== null) {
                files.push({ scope: of, name, path: join(dir, entry.name) });
            }
        }
    };
    const projects = join(root, under, "projects");
    const walk = async (dir: string): Promise<void> => {
        const id = relative(projects, dir).split(sep).join("/");
        if (id !== "" && isProjectId(id)) {
            await inScope(dir, { kind: "project", id });
        }
        for (const entry of await entries(dir)) {
            if (entry.isDirectory()) {
                await walk(join(dir, entry.name));
            }
        }
    };
    if (scope !== undefined) {
        await inScope(scopeDir(root, scope, under), scope);
    } else {
        await inScope(scopeDir(root, PERSONAL, under), PERSONAL);
        await walk(projects);
    }
    const key = (file: FactFile) =>
        `${file.scope.kind === "personal" ? "" : file.scope.id}\u0000${file.name}`;
    return files.sort((a, b) =>
        key(a) < key(b) ? -1 : key(a) > key(b) ? 1 : 0,
    );
}

export async function readFactFile(
    path: string,
    name: string,
): Promise<FactRead | { kind: "none" }> {
    let text: string;
    try {
        text = await readFile(path, "utf8");
    } catch (error) {
        if (codeOf(error) === "ENOENT") {
            return { kind: "none" };
        }
        return { kind: "unparseable", reason: describeError(error) };
    }
    return parseFact(text, name);
}

export type StoredFact = { scope: Scope; path: string; fact: Fact };

export async function listFacts(
    root: string,
    scope?: Scope,
): Promise<{
    facts: StoredFact[];
    broken: { path: string; reason: string }[];
}> {
    const facts: StoredFact[] = [];
    const broken: { path: string; reason: string }[] = [];
    for (const file of await factFiles(root, scope)) {
        const read = await readFactFile(file.path, file.name);
        if (read.kind === "ok") {
            facts.push({ scope: file.scope, path: file.path, fact: read.fact });
        } else if (read.kind === "unparseable") {
            broken.push({ path: file.path, reason: read.reason });
        }
    }
    return { facts, broken };
}

// Writes a fact where it belongs once it reads back as written, replacing
// one there; with keep it fails with EEXIST instead. The caller holds the
// lock and records the path.
export async function putFact(
    root: string,
    scope: Scope,
    fact: Fact,
    options: { keep?: boolean } = {},
): Promise<string> {
    const text = renderFact(fact);
    const read = parseFact(text, fact.name);
    if (read.kind !== "ok") {
        throw new Error(`${scopeLabel(scope)}/${fact.name}: ${read.reason}`);
    }
    const path = factPath(root, scope, fact.name);
    await writeAtomic(path, text, options);
    return path;
}

export type FactStore = {
    root: string;
    lock: Lock;
    recorder: Recorder | null;
    now?: () => Date;
};

export type FactInput = {
    scope: Scope;
    name: string;
    title: string;
    description: string;
    type: FactType;
    body: string;
    origin: Origin;
    by: Writer;
    host?: string;
    tags?: string[];
    importance?: number | null;
    model?: string;
    from?: string;
};

// A check on the fact as it stands (null: there is none), made under
// the lock with the write it guards; a reason refuses the write.
export type Guard = (current: Fact | null) => string | null;

export type FactResult =
    | { kind: "written"; fact: Fact }
    | { kind: "unchanged" }
    | { kind: "missing" }
    | { kind: "refused"; reason: string }
    | { kind: "failed"; reason: string };

type Target = { scope: Scope; name: string };

const at = (store: FactStore) => (store.now?.() ?? new Date()).toISOString();
// Every write gives the fact a new provenance time, and the writer where
// the write names one, so that the sweep knows an uncommitted write as
// Dorothy's own rather than a hand edit.
const stamped = (fact: Fact, now: string, by?: Writer): Fact => ({
    ...fact,
    provenance: {
        ...fact.provenance,
        ...(by === undefined ? {} : { by }),
        at: now,
    },
});
const label = ({ scope, name }: Target) => `${scopeLabel(scope)}/${name}`;

// Runs work under the store's lock; a throw becomes a failure.
function held<T>(
    store: FactStore,
    work: () => Promise<T>,
): Promise<T | { kind: "failed"; reason: string }> {
    return store.lock(work).catch((error: unknown) => ({
        kind: "failed" as const,
        reason: describeError(error),
    }));
}

async function existing(
    store: FactStore,
    target: Target,
): Promise<
    { path: string; fact: Fact | null } | { kind: "failed"; reason: string }
> {
    if (!FACT_NAME.test(target.name)) {
        return {
            kind: "failed",
            reason: `${target.name} is not a fact's name`,
        };
    }
    const path = factPath(store.root, target.scope, target.name);
    const read = await readFactFile(path, target.name);
    if (read.kind === "unparseable") {
        return { kind: "failed", reason: `it is broken: ${read.reason}` };
    }
    return { path, fact: read.kind === "ok" ? read.fact : null };
}

export function writeFact(
    store: FactStore,
    input: FactInput,
    guard?: Guard,
): Promise<FactResult> {
    return held(store, async (): Promise<FactResult> => {
        const found = await existing(store, input);
        if ("kind" in found) {
            return found;
        }
        const refusal = guard?.(found.fact) ?? null;
        if (refusal !== null) {
            return { kind: "refused", reason: refusal };
        }
        const fact = factOf(input, found.fact, at(store));
        const path = await putFact(store.root, input.scope, fact);
        await store.recorder?.([path], `fact: ${label(input)}`);
        return { kind: "written", fact };
    });
}

// The keys another producer wrote, kept through a write; the user's
// verifications only through the user's own, as they confirmed the
// words a write by anyone else replaces.
function foreignAfter(
    foreign: Fact["foreign"],
    by: Writer,
): Pick<Fact, "foreign"> {
    if (foreign === undefined) {
        return {};
    }
    if (by === "user" || !("verified" in foreign)) {
        return { foreign };
    }
    const { verified: _, ...rest } = foreign;
    return Object.keys(rest).length === 0 ? {} : { foreign: rest };
}

// The fact as written: what the input gives, else what it held before.
function factOf(input: FactInput, before: Fact | null, now: string): Fact {
    return {
        name: input.name,
        title: normalise(input.title),
        description: normalise(input.description),
        type: input.type,
        extra: before?.extra ?? {},
        tags: input.tags ?? before?.tags ?? [],
        importance:
            input.importance === undefined
                ? (before?.importance ?? null)
                : input.importance,
        provenance: {
            origin: nextOrigin(
                before?.provenance.origin ?? null,
                input.origin,
                input.by,
            ),
            by: input.by,
            ...(input.host === undefined ? {} : { host: input.host }),
            at: now,
            created: before?.provenance.created ?? now,
            ...(input.model === undefined ? {} : { model: input.model }),
            ...(input.from === undefined ? {} : { from: input.from }),
        },
        retired: null,
        body: input.body.trim(),
        ...foreignAfter(before?.foreign, input.by),
        ...(before?.otherSources === undefined
            ? {}
            : { otherSources: before.otherSources }),
    };
}

export function moveFact(
    store: FactStore,
    from: Target,
    to: Scope,
): Promise<FactResult> {
    return held(store, async (): Promise<FactResult> => {
        const found = await existing(store, from);
        if ("kind" in found) {
            return found;
        }
        if (found.fact === null) {
            return { kind: "missing" };
        }
        const there = await existing(store, { scope: to, name: from.name });
        if ("kind" in there) {
            return there;
        }
        if (there.fact !== null) {
            return {
                kind: "failed",
                reason: `there is already a fact ${label({ scope: to, name: from.name })}`,
            };
        }
        const fact = stamped(found.fact, at(store));
        const path = await putFact(store.root, to, fact);
        await rm(found.path);
        await store.recorder?.(
            [found.path, path],
            `move: ${label(from)} to ${scopeLabel(to)}`,
        );
        return { kind: "written", fact };
    });
}

export function retireFact(
    store: FactStore,
    target: Target,
    { by, why, guard }: { by: Writer; why: string; guard?: Guard },
): Promise<FactResult> {
    return held(store, async (): Promise<FactResult> => {
        const found = await existing(store, target);
        if ("kind" in found) {
            return found;
        }
        if (found.fact === null) {
            return { kind: "missing" };
        }
        const refusal = guard?.(found.fact) ?? null;
        if (refusal !== null) {
            return { kind: "refused", reason: refusal };
        }
        if (found.fact.retired !== null) {
            return { kind: "unchanged" };
        }
        const now = at(store);
        const fact = {
            ...stamped(found.fact, now, by),
            retired: { at: now, by, why: normalise(why) },
        };
        const path = await putFact(store.root, target.scope, fact);
        await store.recorder?.([path], `retire: ${label(target)}`);
        return { kind: "written", fact };
    });
}

export function reviveFact(
    store: FactStore,
    target: Target,
): Promise<FactResult> {
    return held(store, async (): Promise<FactResult> => {
        const found = await existing(store, target);
        if ("kind" in found) {
            return found;
        }
        if (found.fact === null) {
            return { kind: "missing" };
        }
        if (found.fact.retired === null) {
            return { kind: "unchanged" };
        }
        const fact = { ...stamped(found.fact, at(store)), retired: null };
        const path = await putFact(store.root, target.scope, fact);
        await store.recorder?.([path], `revive: ${label(target)}`);
        return { kind: "written", fact };
    });
}

export type VerifyResult =
    | { kind: "written"; fact: Fact }
    | { kind: "confirmed"; fact: Fact }
    | { kind: "missing" }
    | { kind: "failed"; reason: string };

// The user's confirmation of a fact, OKF's verified entry beside any
// another hand made, committed as theirs. The fact's own writing is
// left as it was. Knowledge already confirmed is left alone.
export function verifyFact(
    store: FactStore,
    target: Target,
): Promise<VerifyResult> {
    return held(store, async (): Promise<VerifyResult> => {
        const found = await existing(store, target);
        if ("kind" in found) {
            return found;
        }
        if (found.fact === null) {
            return { kind: "missing" };
        }
        if (isConfirmed(found.fact)) {
            return { kind: "confirmed", fact: found.fact };
        }
        const foreign = found.fact.foreign ?? {};
        const before = foreign.verified ?? [];
        if (!Array.isArray(before)) {
            return { kind: "failed", reason: "its verified key is not a list" };
        }
        const fact: Fact = {
            ...found.fact,
            foreign: {
                ...foreign,
                verified: [...before, { by: USER_ACTOR, at: at(store) }],
            },
        };
        const path = await putFact(store.root, target.scope, fact);
        await store.recorder?.([path], `verify: ${label(target)} (user)`);
        return { kind: "written", fact };
    });
}

// Every live fact whose provenance names the conversation, retired in one
// commit, for when a conversation turns out to have been wrong.
export function retireFacts(
    store: FactStore,
    phrase: string,
    { by, why }: { by: Writer; why: string },
): Promise<
    { kind: "done"; retired: string[] } | { kind: "failed"; reason: string }
> {
    return held(store, async () => {
        const { facts } = await listFacts(store.root);
        const paths: string[] = [];
        const retired: string[] = [];
        const now = at(store);
        for (const { scope, fact } of facts) {
            if (
                fact.retired !== null ||
                fact.provenance.from?.split("#")[0] !== phrase
            ) {
                continue;
            }
            const next = {
                ...stamped(fact, now, by),
                retired: { at: now, by, why: normalise(why) },
            };
            paths.push(await putFact(store.root, scope, next));
            retired.push(label({ scope, name: fact.name }));
        }
        if (paths.length > 0) {
            await store.recorder?.(
                paths,
                `retire: ${paths.length} ${paths.length === 1 ? "fact" : "facts"} from ${phrase}`,
            );
        }
        return { kind: "done" as const, retired };
    });
}
