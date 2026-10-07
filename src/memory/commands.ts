// vim:set expandtab shiftwidth=4 filetype=typescript:
// SPDX-License-Identifier: GPL-3.0-only

//
//
// ~chewygumxx/dorothy.git
// ::: :/src/memory/commands.ts
//
//

import { access } from "node:fs/promises";
import { join } from "node:path";
import { readConfig } from "../config.js";
import { indexPath, RecallIndex } from "../recall/store.js";
import { syncIndex } from "../recall/sync.js";
import { carrierCounts } from "../recall/tags.js";
import { transcriptDir } from "../transcript.js";
import { type EditResult, editInEditor } from "../tui/external-editor.js";
import type { Env } from "../xdg.js";
import { indexCatalogue } from "./catalogue.js";
import {
    parseEditView,
    renderEditView,
    type TagsContext,
} from "./edit-view.js";
import { formatList, listRows } from "./list.js";
import { rank, tier } from "./rank.js";
import {
    mergeEdit,
    readSidecar,
    sidecarPath,
    updateSidecar,
} from "./sidecar.js";
import {
    applyTagsEdit,
    parseTagsView,
    renderTagsTree,
    renderTagsView,
} from "./tags-view.js";
import {
    EMPTY_VOCABULARY,
    readVocabulary,
    resolveTags,
    updateVocabulary,
    vocabularyPath,
} from "./vocabulary.js";

export type Output = { write(text: string): unknown };

const describeError = (error: unknown) =>
    error instanceof Error ? error.message : String(error);

// What Dorothy remembers, as a new session would see it. It works whether
// memory is on or not: it is the user's view, not hers.
export async function runList({
    env = process.env,
    out = process.stdout,
    err = process.stderr,
    now = Date.now(),
}: {
    env?: Env;
    out?: Output;
    err?: Output;
    now?: number;
} = {}): Promise<number> {
    const { config, warnings } = await readConfig(env);
    let index: RecallIndex;
    try {
        index = RecallIndex.open(indexPath(env));
    } catch (error) {
        err.write(
            `dorothy: the memory index can't be opened: ${describeError(error)}\n`,
        );
        return 1;
    }
    try {
        const loaded = await indexCatalogue(index, transcriptDir(env)).load();
        for (const warning of [...warnings, ...loaded.warnings]) {
            err.write(`dorothy: ${warning}\n`);
        }
        const tiered = tier(
            rank(loaded.entries, {
                now,
                halfLifeDays: config.memory.halfLifeDays,
            }),
            config.memory.budget,
        );
        out.write(`${formatList(listRows(loaded.entries, tiered))}\n`);
        return 0;
    } finally {
        index.close();
    }
}

// The vocabulary as a tree, each concept with how many chats carry it,
// hidden ones too: the user's view, not hers.
export async function runTags({
    env = process.env,
    out = process.stdout,
    err = process.stderr,
    now = Date.now(),
}: {
    env?: Env;
    out?: Output;
    err?: Output;
    now?: number;
} = {}): Promise<number> {
    const path = vocabularyPath(env);
    const read = await readVocabulary(path);
    if (read.kind === "unparseable") {
        err.write(`dorothy: ${path}: ${read.reason}\n`);
        return 1;
    }
    let index: RecallIndex;
    try {
        index = RecallIndex.open(indexPath(env));
    } catch (error) {
        err.write(
            `dorothy: the memory index can't be opened: ${describeError(error)}\n`,
        );
        return 1;
    }
    try {
        for (const warning of await syncIndex(
            index,
            transcriptDir(env),
            now,
            path,
        )) {
            err.write(`dorothy: ${warning}\n`);
        }
        const counts = await index.exclusive(() => carrierCounts(index));
        const tree = renderTagsTree(
            read.kind === "ok" ? read.vocabulary : EMPTY_VOCABULARY,
            counts,
        );
        if (tree !== "") {
            out.write(`${tree}\n`);
        }
        return 0;
    } catch (error) {
        err.write(
            `dorothy: the memory index failed: ${describeError(error)}\n`,
        );
        return 1;
    } finally {
        index.close();
    }
}

// The error line a reopened template starts with, never more than one.
const ERROR_LINES = /^(# error: .*\n)+/;

// Opens a conversation's notes in $EDITOR until they parse, then writes
// only what the user changed.
export async function runMemoryEdit(
    phrase: string,
    {
        env = process.env,
        err = process.stderr,
        edit = (text: string) => editInEditor(text),
        now = () => new Date(),
    }: {
        env?: Env;
        err?: Output;
        edit?: (text: string) => Promise<EditResult>;
        now?: () => Date;
    } = {},
): Promise<number> {
    const dir = transcriptDir(env);
    const transcript = join(dir, `${phrase}.jsonl`);
    try {
        await access(transcript);
    } catch (error) {
        err.write(`dorothy: no chat ${phrase}: ${describeError(error)}\n`);
        return 1;
    }
    const read = await readSidecar(dir, phrase);
    if (read.kind === "unparseable") {
        err.write(`dorothy: ${sidecarPath(dir, phrase)}: ${read.reason}\n`);
        return 1;
    }
    const shown = read.kind === "ok" ? read.sidecar : null;
    const vocabulary = await readVocabulary(vocabularyPath(env));
    const tags: TagsContext =
        vocabulary.kind === "unparseable"
            ? { kind: "broken", reason: vocabulary.reason }
            : {
                  kind: "ok",
                  vocabulary:
                      vocabulary.kind === "ok"
                          ? vocabulary.vocabulary
                          : EMPTY_VOCABULARY,
              };
    let text = renderEditView(phrase, shown, tags);
    let index: RecallIndex | null = null;
    try {
        index = RecallIndex.open(indexPath(env));
    } catch {
        // Without the index the edit goes unlocked, as before recall.
    }
    try {
        for (;;) {
            const result = await edit(text);
            if (!result.ok) {
                err.write(`dorothy: ${result.message}\n`);
                return 1;
            }
            const parsed = parseEditView(result.text, shown, tags);
            if (parsed.kind === "unchanged") {
                return 0;
            }
            if (parsed.kind === "error") {
                text = `# error: ${parsed.reason}\n${result.text.replace(ERROR_LINES, "")}`;
                continue;
            }
            const at = now().toISOString();
            const update = await updateSidecar(
                dir,
                phrase,
                (current) => {
                    const next = mergeEdit(current, parsed.changes, at);
                    return tags.kind === "ok"
                        ? {
                              ...next,
                              tags: resolveTags(tags.vocabulary, next.tags),
                          }
                        : next;
                },
                index?.lock,
            );
            if (update.kind === "unparseable" || update.kind === "failed") {
                err.write(
                    `dorothy: ${sidecarPath(dir, phrase)}: ${update.reason}\n`,
                );
                return 1;
            }
            return 0;
        }
    } finally {
        index?.close();
    }
}

// Opens the vocabulary in $EDITOR until the edit parses and applies, then
// writes it over what the file holds by then, so concepts Dorothy coined
// meanwhile are kept.
export async function runTagsEdit({
    env = process.env,
    err = process.stderr,
    edit = (text: string) => editInEditor(text),
    now = () => new Date(),
}: {
    env?: Env;
    err?: Output;
    edit?: (text: string) => Promise<EditResult>;
    now?: () => Date;
} = {}): Promise<number> {
    const path = vocabularyPath(env);
    const read = await readVocabulary(path);
    if (read.kind === "unparseable") {
        err.write(`dorothy: ${path}: ${read.reason}\n`);
        return 1;
    }
    const shown = read.kind === "ok" ? read.vocabulary : EMPTY_VOCABULARY;
    let index: RecallIndex | null = null;
    let counts = new Map<string, number>();
    try {
        const opened = RecallIndex.open(indexPath(env));
        index = opened;
        await syncIndex(opened, transcriptDir(env), now().getTime(), path);
        counts = await opened.exclusive(() => carrierCounts(opened));
    } catch {
        // Without the index the view has no counts and the save goes
        // unlocked, as --memory's does.
    }
    let text = renderTagsView(shown, counts);
    try {
        for (;;) {
            const result = await edit(text);
            if (!result.ok) {
                err.write(`dorothy: ${result.message}\n`);
                return 1;
            }
            const reopen = (reason: string) =>
                `# error: ${reason}\n${result.text.replace(ERROR_LINES, "")}`;
            const parsed = parseTagsView(result.text, shown);
            if (parsed.kind === "unchanged") {
                return 0;
            }
            if (parsed.kind === "error") {
                text = reopen(parsed.reason);
                continue;
            }
            const at = now().toISOString();
            const refused: { reason: string | null } = { reason: null };
            const update = await updateVocabulary(
                path,
                (current) => {
                    const applied = applyTagsEdit(current, parsed.edit, at);
                    if (!applied.ok) {
                        refused.reason = applied.reason;
                        return null;
                    }
                    return applied.vocabulary;
                },
                index?.lock,
            );
            if (refused.reason !== null) {
                text = reopen(refused.reason);
                continue;
            }
            if (update.kind === "unparseable" || update.kind === "failed") {
                err.write(`dorothy: ${path}: ${update.reason}\n`);
                return 1;
            }
            return 0;
        }
    } finally {
        index?.close();
    }
}
