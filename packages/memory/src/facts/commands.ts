// vim:set expandtab shiftwidth=4 filetype=typescript:
// SPDX-License-Identifier: GPL-3.0-only

//
//
// ~chewygumxx/dorothy.git
// ::: :/packages/memory/src/facts/commands.ts
//
//

// The commands over facts and projects: each opens the index for its
// lock, has history swept first, and writes through the store.

import { existsSync, statSync } from "node:fs";
import { resolve } from "node:path";
import { type Env, parseMemoryId } from "@dorothy/core";
import type { OpenHistory } from "../memory/sidecar.js";
import { projectsPath, readRegistry } from "../projects/registry.js";
import { type SyncReport, syncProject } from "../projects/sync.js";
import { indexPath, RecallIndex } from "../recall/store.js";
import { type Fact, USER_ACTOR, verificationsOf } from "./file.js";
import {
    dataRoot,
    type FactResult,
    type FactStore,
    listFacts,
    parseTarget,
    retireFact,
    retireFacts,
    reviveFact,
    type Scope,
    type StoredFact,
    scopeLabel,
    verifyFact,
} from "./store.js";

export type Output = { write(text: string): unknown };
export type FactCommandOptions = {
    env?: Env;
    out?: Output;
    err?: Output;
    now?: () => Date;
    openHistory?: OpenHistory;
};

const describeError = (error: unknown) =>
    error instanceof Error ? error.message : String(error);

// The store under the index's lock, history swept first; null, said on
// err, when the index cannot be opened.
async function openStore({
    env = process.env,
    err = process.stderr,
    now,
    openHistory,
}: FactCommandOptions): Promise<{
    store: FactStore;
    close(): Promise<void>;
} | null> {
    let index: RecallIndex;
    try {
        index = RecallIndex.open(indexPath(env));
    } catch (error) {
        err.write(
            `dorothy: the memory index can't be opened: ${describeError(error)}\n`,
        );
        return null;
    }
    const versions = (await openHistory?.(index)) ?? null;
    return {
        store: {
            root: dataRoot(env),
            lock: versions?.lock ?? index.lock,
            recorder: versions?.recorder ?? null,
            ...(now === undefined ? {} : { now }),
        },
        close: async () => {
            await versions?.close();
            index.close();
        },
    };
}

export function formatFacts(facts: readonly StoredFact[]): string {
    if (facts.length === 0) {
        return "No facts yet.\n";
    }
    const lines: string[] = [];
    let scope: string | null = null;
    for (const { scope: of, fact } of facts) {
        const label = scopeLabel(of);
        if (label !== scope) {
            lines.push(label);
            scope = label;
        }
        lines.push(
            `  ${fact.type.padEnd(10)} ${fact.name}  ${fact.title}${fact.retired === null ? "" : " (retired)"}`,
        );
        lines.push(`             ${fact.description}`);
    }
    return `${lines.join("\n")}\n`;
}

export async function runFacts(
    options: FactCommandOptions = {},
): Promise<number> {
    const { out = process.stdout, err = process.stderr } = options;
    const opened = await openStore(options);
    if (opened === null) {
        return 1;
    }
    try {
        const { facts, broken, unreadable } = await listFacts(
            opened.store.root,
        );
        for (const { path, reason } of broken) {
            err.write(`dorothy: ${path}: ${reason}\n`);
        }
        for (const { path, reason } of unreadable) {
            err.write(`dorothy: ${path}: it cannot be read: ${reason}\n`);
        }
        out.write(formatFacts(facts));
        return 0;
    } finally {
        await opened.close();
    }
}

// --retire and --revive: one fact, by its target.
async function onTarget(
    target: string,
    options: FactCommandOptions,
    act: (
        store: FactStore,
        at: { scope: Scope; name: string },
    ) => Promise<FactResult>,
    said: { done: string; already: string },
): Promise<number> {
    const { out = process.stdout, err = process.stderr } = options;
    const parsed = parseTarget(target);
    if (parsed === null) {
        err.write(
            `dorothy: ${target} names no fact; give personal/<name> or <project id>/<name>\n`,
        );
        return 1;
    }
    const opened = await openStore(options);
    if (opened === null) {
        return 1;
    }
    try {
        const result = await act(opened.store, parsed);
        if (result.kind === "written") {
            out.write(`${said.done} ${target}.\n`);
            return 0;
        }
        if (result.kind === "unchanged") {
            out.write(`${target} ${said.already}.\n`);
            return 0;
        }
        err.write(
            result.kind === "missing"
                ? `dorothy: there is no fact ${target}\n`
                : `dorothy: ${target}: ${result.reason}\n`,
        );
        return 1;
    } finally {
        await opened.close();
    }
}

export function runRetire(
    target: string,
    options: FactCommandOptions = {},
): Promise<number> {
    return onTarget(
        target,
        options,
        (store, at) =>
            retireFact(store, at, { by: "user", why: "retired by the user" }),
        { done: "Retired", already: "was retired already" },
    );
}

export function runRevive(
    target: string,
    options: FactCommandOptions = {},
): Promise<number> {
    return onTarget(target, options, reviveFact, {
        done: "Revived",
        already: "is not retired",
    });
}

export async function runRetireFrom(
    phrase: string,
    options: FactCommandOptions = {},
): Promise<number> {
    const { out = process.stdout, err = process.stderr } = options;
    const opened = await openStore(options);
    if (opened === null) {
        return 1;
    }
    try {
        const result = await retireFacts(opened.store, phrase, {
            by: "user",
            why: `retired with what ${phrase} gave`,
        });
        if (result.kind === "failed") {
            err.write(`dorothy: ${result.reason}\n`);
            if (result.retired !== undefined && result.retired.length > 0) {
                err.write(
                    `dorothy: retired before it failed: ${result.retired.join(", ")}\n`,
                );
            }
            return 1;
        }
        const count = result.retired.length;
        if (count === 0) {
            err.write(
                `dorothy: no live fact came from ${phrase}; nothing was retired\n`,
            );
            return 1;
        }
        out.write(
            `Retired ${count} ${count === 1 ? "fact" : "facts"} from ${phrase}.\n`,
        );
        return 0;
    } finally {
        await opened.close();
    }
}

// A knowledge id, as open and the block show it, as the store's target.
function targetOfId(id: string): { scope: Scope; name: string } | null {
    const parsed = parseMemoryId(id);
    if (parsed?.kind !== "knowledge") {
        return null;
    }
    const { path } = parsed;
    return parseTarget(
        path.startsWith("projects/") ? path.slice("projects/".length) : path,
    );
}

// Why knowledge is confirmed already; a verification by another person
// names them.
function whyConfirmed(fact: Fact): string {
    if (fact.provenance.origin === "user") {
        return "it is yours";
    }
    if (fact.provenance.origin === "repo") {
        return "it came from a project's repository";
    }
    const by = verificationsOf(fact).map((entry) => entry.by);
    return by.includes(USER_ACTOR)
        ? "you verified it"
        : `${[...new Set(by)].join(", ")} verified it`;
}

// --verify: the user confirms a piece of knowledge a model or an
// outside writer gave, by its id.
export async function runVerify(
    id: string,
    options: FactCommandOptions = {},
): Promise<number> {
    const { out = process.stdout, err = process.stderr } = options;
    const target = targetOfId(id);
    if (target === null) {
        err.write(
            `dorothy: ${id} is no knowledge's id; give k:personal/<name> or k:projects/<project id>/<name>\n`,
        );
        return 1;
    }
    const opened = await openStore(options);
    if (opened === null) {
        return 1;
    }
    try {
        const result = await verifyFact(opened.store, target);
        switch (result.kind) {
            case "written":
                out.write(`Verified ${id}: it is confirmed now.\n`);
                return 0;
            case "confirmed":
                out.write(
                    `${id} is confirmed already: ${whyConfirmed(result.fact)}.\n`,
                );
                return 0;
            case "missing":
                err.write(`dorothy: there is no knowledge ${id}\n`);
                return 1;
            default:
                err.write(`dorothy: ${id}: ${result.reason}\n`);
                return 1;
        }
    } finally {
        await opened.close();
    }
}

// What moved, a line for each way that holds a name.
const MOVES = ["imported", "exported", "retired", "removed"] as const;

export function formatReport(report: SyncReport): string {
    const lines = [
        `${report.project.id}: ${report.imported.length + report.retired.length} in, ${report.exported.length + report.removed.length} out (${report.memoryDir})`,
        ...MOVES.filter((way) => report[way].length > 0).map(
            (way) => `${way}: ${report[way].join(", ")}`,
        ),
        ...report.renamed.map(
            ({ file, name }) => `named: ${file} as the fact ${name}`,
        ),
        ...report.conflicts.map(
            (name) => `conflict: ${name}; the repository's version was kept`,
        ),
        ...report.skipped.map(
            ({ name, reason }) => `skipped: ${name} (${reason})`,
        ),
    ];
    if (report.unrecorded !== undefined) {
        lines.push(
            `history was not told of this, and will find it next time: ${report.unrecorded}`,
        );
    }
    if (report.index === "left") {
        lines.push(
            `MEMORY.md left as it is${report.indexReason === undefined ? "" : `: ${report.indexReason}`}`,
        );
    }
    if (report.omitted > 0) {
        lines.push(
            `MEMORY.md leaves out ${report.omitted} ${report.omitted === 1 ? "fact" : "facts"}, past what Claude Code loads`,
        );
    }
    return `${lines.join("\n")}\n`;
}

export async function runSync(
    path: string | null,
    options: FactCommandOptions & { cwd?: string } = {},
): Promise<number> {
    const {
        out = process.stdout,
        err = process.stderr,
        cwd = process.cwd(),
    } = options;
    const target = resolve(cwd, path ?? ".");
    if (!existsSync(target)) {
        err.write(`dorothy: ${target} does not exist\n`);
        return 1;
    }
    if (!statSync(target).isDirectory()) {
        err.write(`dorothy: ${target} is not a directory\n`);
        return 1;
    }
    const opened = await openStore(options);
    if (opened === null) {
        return 1;
    }
    try {
        const { store } = opened;
        const result = await syncProject(target, {
            root: store.root,
            lock: store.lock,
            recorder: store.recorder,
            ...(store.now === undefined ? {} : { now: store.now }),
        });
        if (result.kind === "not-a-repository") {
            err.write(`dorothy: ${target} is not in a git repository\n`);
            return 1;
        }
        if (result.kind === "failed") {
            err.write(`dorothy: sync failed: ${result.reason}\n`);
            return 1;
        }
        out.write(formatReport(result.report));
        return 0;
    } finally {
        await opened.close();
    }
}

export async function runProjects({
    env = process.env,
    out = process.stdout,
    err = process.stderr,
}: FactCommandOptions = {}): Promise<number> {
    const path = projectsPath(dataRoot(env));
    const read = await readRegistry(path);
    if (read.kind === "unparseable") {
        err.write(`dorothy: ${path}: ${read.reason}\n`);
        return 1;
    }
    const entries =
        read.kind === "ok" ? Object.entries(read.registry.projects) : [];
    if (entries.length === 0) {
        out.write("No projects yet.\n");
        return 0;
    }
    for (const [id, entry] of entries.sort(([a], [b]) => (a < b ? -1 : 1))) {
        out.write(`${id}  ${entry.memoryDir}  ${entry.roots.join(", ")}\n`);
    }
    return 0;
}
