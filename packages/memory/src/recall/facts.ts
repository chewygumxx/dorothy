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
import { parseFact } from "../facts/file.js";
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
        const known = new Map(
            (
                index.db.query("SELECT path, mtime FROM facts").all() as {
                    path: string;
                    mtime: number;
                }[]
            ).map(({ path, mtime }) => [path, mtime]),
        );
        let files: Awaited<ReturnType<typeof factFiles>>;
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
            let mtime: number;
            let text: string;
            try {
                mtime = (await stat(file.path)).mtimeMs;
                if (known.get(key) === mtime) {
                    seen.add(key);
                    continue;
                }
                text = await readFile(file.path, "utf8");
            } catch (error) {
                if (codeOf(error) !== "ENOENT") {
                    // Unreadable: left out like a broken fact.
                    seen.add(key);
                    drop(index, key);
                    warnings.push(`${file.path}: ${describeError(error)}`);
                }
                continue;
            }
            seen.add(key);
            drop(index, key);
            const read = parseFact(text, file.name);
            if (read.kind !== "ok") {
                warnings.push(`${file.path}: ${read.reason}`);
                continue;
            }
            const { fact } = read;
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
        for (const path of known.keys()) {
            if (!seen.has(path)) {
                drop(index, path);
            }
        }
    });
    return warnings;
}
