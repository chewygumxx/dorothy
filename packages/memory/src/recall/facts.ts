// vim:set expandtab shiftwidth=4 filetype=typescript:
// SPDX-License-Identifier: GPL-3.0-only

//
//
// ~chewygumxx/dorothy.git
// ::: :/packages/memory/src/recall/facts.ts
//
//

// The store's facts in the recall index, synced by each file's mtime: a
// changed fact is read again, a gone one dropped, and one that cannot be
// read left out with a warning.

import { readFile, stat } from "node:fs/promises";
import { relative, sep } from "node:path";
import { type Fact, parseFact } from "../facts/file.js";
import { migrateFacts } from "../facts/migrate.js";
import { factFiles, scopeLabel } from "../facts/store.js";
import type { RecallIndex } from "./store.js";

const codeOf = (error: unknown) => (error as { code?: unknown }).code;
const describeError = (error: unknown) =>
    error instanceof Error ? error.message : String(error);

function drop(index: RecallIndex, path: string): void {
    index.db.run("DELETE FROM fact_tags WHERE path = ?", [path]);
    index.db.run("DELETE FROM facts WHERE path = ?", [path]);
}

export async function syncFacts(
    index: RecallIndex,
    root: string,
): Promise<string[]> {
    const warnings: string[] = [];
    await index.exclusive(async () => {
        warnings.push(...(await migrateFacts(root)));
        const known = new Map(
            (
                index.db.query("SELECT path, mtime FROM facts").all() as {
                    path: string;
                    mtime: number;
                }[]
            ).map(({ path, mtime }) => [path, mtime]),
        );
        let files: FactFile[];
        try {
            files = await factFiles(root);
        } catch (error) {
            // The store cannot be listed: what is indexed stays.
            warnings.push(`${root}: ${describeError(error)}`);
            return;
        }
        const seen = new Set<string>();
        for (const file of files) {
            const key = relative(root, file.path).split(sep).join("/");
            if (await syncFile(index, file, key, known.get(key), warnings)) {
                seen.add(key);
            }
        }
        for (const path of known.keys()) {
            if (!seen.has(path)) {
                drop(index, path);
            }
        }
    });
    return warnings;
}

type FactFile = Awaited<ReturnType<typeof factFiles>>[number];

// One fact file into the index under key; false for one gone since it was
// listed. One unreadable or broken is left out with a warning.
async function syncFile(
    index: RecallIndex,
    file: FactFile,
    key: string,
    mtime: number | undefined,
    warnings: string[],
): Promise<boolean> {
    const read = await readChanged(file.path, mtime);
    if (read.kind === "gone") {
        return false;
    }
    if (read.kind === "same") {
        return true;
    }
    drop(index, key);
    if (read.kind === "unreadable") {
        warnings.push(`${file.path}: ${read.reason}`);
        return true;
    }
    const parsed = parseFact(read.text, file.name);
    if (parsed.kind === "ok") {
        insertFact(index, key, file, parsed.fact, read.mtime);
    } else {
        warnings.push(`${file.path}: ${parsed.reason}`);
    }
    return true;
}

type Changed =
    | { kind: "same" }
    | { kind: "gone" }
    | { kind: "unreadable"; reason: string }
    | { kind: "read"; text: string; mtime: number };

// A fact file read again only if its mtime is not the one indexed.
async function readChanged(
    path: string,
    known: number | undefined,
): Promise<Changed> {
    try {
        const mtime = (await stat(path)).mtimeMs;
        if (known === mtime) {
            return { kind: "same" };
        }
        return { kind: "read", text: await readFile(path, "utf8"), mtime };
    } catch (error) {
        return codeOf(error) === "ENOENT"
            ? { kind: "gone" }
            : { kind: "unreadable", reason: describeError(error) };
    }
}

function insertFact(
    index: RecallIndex,
    key: string,
    file: FactFile,
    fact: Fact,
    mtime: number,
): void {
    index.db.run(
        "INSERT INTO facts (path, scope, name, title, description, type, body, origin, importance, created, retired, mtime) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        [
            key,
            scopeLabel(file.scope),
            fact.name,
            fact.title,
            fact.description,
            fact.type,
            fact.body,
            fact.provenance.origin,
            fact.importance,
            Date.parse(fact.provenance.created),
            fact.retired === null ? 0 : 1,
            mtime,
        ],
    );
    for (const [n, id] of fact.tags.entries()) {
        index.db.run(
            "INSERT OR IGNORE INTO fact_tags (path, n, id) VALUES (?, ?, ?)",
            [key, n, id],
        );
    }
}
