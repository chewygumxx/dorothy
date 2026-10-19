// vim:set expandtab shiftwidth=4 filetype=typescript:
// SPDX-License-Identifier: GPL-3.0-only

//
//
// ~chewygumxx/dorothy.git
// ::: :/packages/memory/src/memory/commands.ts
//
//

import { access } from "node:fs/promises";
import { join } from "node:path";
import { type Editor, type Env, readConfig } from "@dorothy/core";
import { dataRoot } from "../facts/store.js";
import { indexPath, RecallIndex } from "../recall/store.js";
import { syncIndex } from "../recall/sync.js";
import { carrierCounts } from "../recall/tags.js";
import { transcriptDir } from "../transcript.js";
import { indexCatalogue } from "./catalogue.js";
import {
    parseEditView,
    renderEditView,
    TAGS_BROKEN,
    type TagsContext,
} from "./edit-view.js";
import { formatList, listRows } from "./list.js";
import { rank, tier } from "./rank.js";
import {
    type EditChanges,
    type Lock,
    mergeEdit,
    type OpenHistory,
    readSidecar,
    sidecarPath,
    updateSidecar,
} from "./sidecar.js";
import {
    applyTagsEdit,
    parseTagsView,
    renderTagsTree,
    renderTagsView,
    type TagsEdit,
} from "./tags-view.js";
import {
    EMPTY_VOCABULARY,
    readVocabulary,
    resolveTags,
    updateVocabulary,
    type VocabularyRead,
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
    openHistory,
}: {
    env?: Env;
    out?: Output;
    err?: Output;
    now?: number;
    openHistory?: OpenHistory;
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
    // Whatever changed while Dorothy was away is committed, or restored,
    // before anything is read.
    const versions = (await openHistory?.(index)) ?? null;
    try {
        const loaded = await indexCatalogue(
            index,
            transcriptDir(env),
            null,
            dataRoot(env),
        ).load();
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
        await versions?.close();
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
    openHistory,
}: {
    env?: Env;
    out?: Output;
    err?: Output;
    now?: number;
    openHistory?: OpenHistory;
} = {}): Promise<number> {
    const path = vocabularyPath(env);
    let index: RecallIndex;
    try {
        index = RecallIndex.open(indexPath(env));
    } catch (error) {
        err.write(
            `dorothy: the memory index can't be opened: ${describeError(error)}\n`,
        );
        return 1;
    }
    // Whatever changed while Dorothy was away is committed, or restored,
    // before anything is read.
    const versions = (await openHistory?.(index)) ?? null;
    try {
        const read = await readVocabulary(path);
        if (read.kind === "unparseable") {
            err.write(`dorothy: ${path}: ${read.reason}\n`);
            return 1;
        }
        for (const warning of await syncIndex(
            index,
            transcriptDir(env),
            now,
            path,
            dataRoot(env),
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
        await versions?.close();
        index.close();
    }
}

// The error lines a reopened template carried, wherever the user left them:
// it starts with the new one alone.
const ERROR_LINES = /^# error: .*(\n|$)/gm;

const tagsContext = (read: VocabularyRead): TagsContext =>
    read.kind === "unparseable"
        ? { kind: "broken", reason: read.reason }
        : {
              kind: "ok",
              vocabulary:
                  read.kind === "ok" ? read.vocabulary : EMPTY_VOCABULARY,
          };

// The index, if it opens, and history, which commits or restores whatever
// changed while Dorothy was away before anything is read. Without the
// index a write takes history's lock, or none, as before recall.
async function openStores(
    env: Env,
    openHistory: OpenHistory | undefined,
): Promise<{ index: RecallIndex | null; versions: Versions }> {
    let index: RecallIndex | null = null;
    try {
        index = RecallIndex.open(indexPath(env));
    } catch {
        // Left without the index.
    }
    return { index, versions: (await openHistory?.(index)) ?? null };
}

type Versions = Awaited<ReturnType<OpenHistory>> | null;

// An edit's outcome: an exit code, or why the editor opens again.
type Attempt = number | { reopen: string };

// Opens text in $EDITOR until attempt settles what the user wrote; each
// time it does not, the editor opens again on their text, the reason
// above it.
async function editLoop(
    edit: Editor,
    err: Output,
    text: string,
    attempt: (edited: string) => Promise<Attempt>,
): Promise<number> {
    let shown = text;
    for (;;) {
        const result = await edit(shown);
        if (!result.ok) {
            err.write(`dorothy: ${result.message}\n`);
            return 1;
        }
        const outcome = await attempt(result.text);
        if (typeof outcome === "number") {
            return outcome;
        }
        shown = `# error: ${outcome.reopen}\n${result.text.replace(ERROR_LINES, "")}`;
    }
}

// Opens a conversation's notes in $EDITOR until they parse, then writes
// only what the user changed.
export async function runMemoryEdit(
    phrase: string,
    {
        env = process.env,
        err = process.stderr,
        edit,
        now = () => new Date(),
        openHistory,
    }: {
        env?: Env;
        err?: Output;
        edit: Editor;
        now?: () => Date;
        openHistory?: OpenHistory;
    },
): Promise<number> {
    const dir = transcriptDir(env);
    try {
        await access(join(dir, `${phrase}.jsonl`));
    } catch (error) {
        err.write(`dorothy: no chat ${phrase}: ${describeError(error)}\n`);
        return 1;
    }
    const { index, versions } = await openStores(env, openHistory);
    try {
        const read = await readSidecar(dir, phrase);
        if (read.kind === "unparseable") {
            err.write(`dorothy: ${sidecarPath(dir, phrase)}: ${read.reason}\n`);
            return 1;
        }
        const shown = read.kind === "ok" ? read.sidecar : null;
        const path = vocabularyPath(env);
        const tags = tagsContext(await readVocabulary(path));
        return await editLoop(
            edit,
            err,
            renderEditView(phrase, shown, tags),
            async (edited) => {
                // Labels resolve against the vocabulary as it is now, so
                // one coined while the editor was open is known. Broken
                // meanwhile, it leaves the line to be checked against what
                // was shown.
                const fresh = tagsContext(await readVocabulary(path));
                const parsed = parseEditView(
                    edited,
                    shown,
                    fresh.kind === "ok" ? fresh : tags,
                    tags,
                );
                if (parsed.kind !== "edit") {
                    return parsed.kind === "unchanged"
                        ? 0
                        : { reopen: parsed.reason };
                }
                return saveNotes(phrase, parsed.changes, {
                    dir,
                    path,
                    lock: versions?.lock ?? index?.lock,
                    versions,
                    at: now().toISOString(),
                    err,
                });
            },
        );
    } finally {
        await versions?.close();
        index?.close();
    }
}

// The user's changes merged into the notes as they are by then. Under the
// sidecar's lock the vocabulary is read once more: the tags as they are
// now, a review's among them, are pruned only against one that reads, and
// kept as they are otherwise; a change to them waits for one that reads.
async function saveNotes(
    phrase: string,
    changes: EditChanges,
    {
        dir,
        path,
        lock,
        versions,
        at,
        err,
    }: {
        dir: string;
        path: string;
        lock: Lock | undefined;
        versions: Versions;
        at: string;
        err: Output;
    },
): Promise<Attempt> {
    const refused = { tags: false };
    const update = await updateSidecar(
        dir,
        phrase,
        async (current) => {
            const latest = await readVocabulary(path);
            if (latest.kind === "unparseable") {
                if (changes.tags !== undefined) {
                    refused.tags = true;
                    return null;
                }
                return mergeEdit(current, changes, at);
            }
            const next = mergeEdit(current, changes, at);
            return {
                ...next,
                tags: resolveTags(
                    latest.kind === "ok" ? latest.vocabulary : EMPTY_VOCABULARY,
                    next.tags,
                ),
            };
        },
        lock,
        versions === null
            ? undefined
            : {
                  recorder: versions.recorder,
                  message: `edit: ${phrase} (user)`,
              },
    );
    if (refused.tags) {
        return { reopen: TAGS_BROKEN };
    }
    if (update.kind === "unparseable" || update.kind === "failed") {
        err.write(`dorothy: ${sidecarPath(dir, phrase)}: ${update.reason}\n`);
        return 1;
    }
    return 0;
}

// How many concepts an edit touches, for its commit.
const edited = (edit: TagsEdit) =>
    edit.changed.size +
    edit.created.length +
    edit.deleted.length +
    edit.merged.size;

// Opens the vocabulary in $EDITOR until the edit parses and applies, then
// writes it over what the file holds by then, so concepts Dorothy coined
// meanwhile are kept.
export async function runTagsEdit({
    env = process.env,
    err = process.stderr,
    edit,
    now = () => new Date(),
    openHistory,
}: {
    env?: Env;
    err?: Output;
    edit: Editor;
    now?: () => Date;
    openHistory?: OpenHistory;
}): Promise<number> {
    const path = vocabularyPath(env);
    const { index, versions } = await openStores(env, openHistory);
    try {
        const read = await readVocabulary(path);
        if (read.kind === "unparseable") {
            err.write(`dorothy: ${path}: ${read.reason}\n`);
            return 1;
        }
        const shown = read.kind === "ok" ? read.vocabulary : EMPTY_VOCABULARY;
        const counts = await viewCounts(index, env, now, path, err);
        return await editLoop(
            edit,
            err,
            renderTagsView(shown, counts),
            async (text) => {
                const parsed = parseTagsView(text, shown);
                if (parsed.kind !== "edit") {
                    return parsed.kind === "unchanged"
                        ? 0
                        : { reopen: parsed.reason };
                }
                return saveTags(parsed.edit, {
                    path,
                    lock: versions?.lock ?? index?.lock,
                    versions,
                    at: now().toISOString(),
                    err,
                });
            },
        );
    } finally {
        await versions?.close();
        index?.close();
    }
}

// How many conversations carry each concept, from the index synced first;
// none without the index, or when the sync fails, which leaves it holding
// the lock all the same.
async function viewCounts(
    index: RecallIndex | null,
    env: Env,
    now: () => Date,
    path: string,
    err: Output,
): Promise<Map<string, number>> {
    if (index === null) {
        return new Map();
    }
    try {
        for (const warning of await syncIndex(
            index,
            transcriptDir(env),
            now().getTime(),
            path,
            dataRoot(env),
        ))
            err.write(`dorothy: ${warning}\n`);
        return await index.exclusive(() => carrierCounts(index));
    } catch (error) {
        err.write(
            `dorothy: conversation counts are unavailable: ${describeError(error)}\n`,
        );
        return new Map();
    }
}

// The edit applied to the vocabulary as it is by then; one that no longer
// applies reopens the editor with why.
async function saveTags(
    edit: TagsEdit,
    {
        path,
        lock,
        versions,
        at,
        err,
    }: {
        path: string;
        lock: Lock | undefined;
        versions: Versions;
        at: string;
        err: Output;
    },
): Promise<Attempt> {
    const refused: { reason: string | null } = { reason: null };
    const update = await updateVocabulary(
        path,
        (current) => {
            const applied = applyTagsEdit(current, edit, at);
            if (!applied.ok) {
                refused.reason = applied.reason;
                return null;
            }
            return applied.vocabulary;
        },
        lock,
        versions === null
            ? undefined
            : {
                  recorder: versions.recorder,
                  message: `edit-tags: ${edited(edit)} concepts (user)`,
              },
    );
    if (refused.reason !== null) {
        return { reopen: refused.reason };
    }
    if (update.kind === "unparseable" || update.kind === "failed") {
        err.write(`dorothy: ${path}: ${update.reason}\n`);
        return 1;
    }
    return 0;
}
