// vim:set expandtab shiftwidth=4 filetype=typescript:
// SPDX-License-Identifier: GPL-3.0-only

//
//
// ~chewygumxx/dorothy.git
// ::: :/packages/memory/src/projects/registry.ts
//
//

// projects.json: each project Dorothy has synced, its roots on this
// machine, its repository's memory directory and, root by root, the
// directory last synced and the hash of each fact as both sides last held
// it there.

import { lstat, readFile } from "node:fs/promises";
import { isAbsolute, join } from "node:path";
import { FACT_NAME, hiddenCharacter } from "../facts/file.js";
import { isProjectId } from "../facts/store.js";
import { writeAtomic } from "../memory/sidecar.js";
import type { Project } from "./identify.js";

// What a root last synced: the memory directory it synced with, and the
// hash of every fact as both sides last held it, by the fact's name. A
// record of another directory than the project's is none.
export type SyncRecord = { dir: string; facts: Record<string, string> };
export type ProjectEntry = {
    name: string;
    roots: string[];
    memoryDir: string;
    // By root: two checkouts of one remote sync at their own pace.
    synced: Record<string, SyncRecord>;
};
export type Registry = { v: 1; projects: Record<string, ProjectEntry> };
export type RegistryRead =
    | { kind: "ok"; registry: Registry }
    | { kind: "none" }
    | { kind: "unparseable"; reason: string };

export const EMPTY_REGISTRY: Registry = Object.freeze({
    v: 1,
    projects: Object.freeze({}),
}) as Registry;

export const projectsPath = (root: string) => join(root, "projects.json");

const isRecord = (value: unknown): value is Record<string, unknown> =>
    typeof value === "object" && value !== null && !Array.isArray(value);
const HASH = /^[0-9a-f]{64}$/;
const codeOf = (error: unknown) => (error as { code?: unknown }).code;

// Null when dir is a relative path that stays inside the repository.
export function memoryDirProblem(dir: string): string | null {
    // Said without the path, which would carry the character to a
    // terminal. Facts allow a tab or a line feed; a path does not.
    if (/\p{Cc}/u.test(dir)) {
        return "the path holds a control character";
    }
    const hidden = hiddenCharacter(dir);
    if (hidden !== null) {
        return `the path holds a hidden character, ${hidden}`;
    }
    if (dir === "" || isAbsolute(dir) || dir.includes("\\")) {
        return `${dir || "an empty path"} is not a relative path`;
    }
    const parts = dir.split("/");
    if (parts.some((part) => part === "" || part === "." || part === "..")) {
        return `${dir} leaves the repository or names it oddly`;
    }
    if (parts.some((part) => part.toLowerCase() === ".git")) {
        return `${dir} is inside the repository's own .git`;
    }
    return null;
}

// A project is named by its place in the file, never by its id: a hand
// may have keyed it by a URL with a token in it, and the reason reaches a
// terminal.
function entryProblem(
    place: number,
    id: string,
    entry: unknown,
): string | null {
    const it = `project ${place}`;
    if (!isProjectId(id)) {
        return `${it}'s id is not a project id`;
    }
    if (!isRecord(entry) || typeof entry.name !== "string") {
        return `${it} has no name`;
    }
    if (
        !Array.isArray(entry.roots) ||
        !entry.roots.every(
            (root) => typeof root === "string" && isAbsolute(root),
        )
    ) {
        return `${it}'s roots are not absolute paths`;
    }
    if (typeof entry.memoryDir !== "string") {
        return `${it} has no memory directory`;
    }
    const dir = memoryDirProblem(entry.memoryDir);
    if (dir !== null) {
        return `${it}'s memory directory: ${dir}`;
    }
    if (
        !isRecord(entry.synced) ||
        !Object.entries(entry.synced).every(
            ([root, record]) =>
                isAbsolute(root) &&
                isRecord(record) &&
                typeof record.dir === "string" &&
                memoryDirProblem(record.dir) === null &&
                isRecord(record.facts) &&
                Object.entries(record.facts).every(
                    ([name, hash]) =>
                        FACT_NAME.test(name) &&
                        typeof hash === "string" &&
                        HASH.test(hash),
                ),
        )
    ) {
        return `${it}'s synced records are not a directory and facts' hashes by root`;
    }
    return null;
}

export function parseRegistry(text: string): RegistryRead {
    let value: unknown;
    try {
        value = JSON.parse(text);
    } catch {
        return { kind: "unparseable", reason: "it is not JSON" };
    }
    if (!isRecord(value) || value.v !== 1 || !isRecord(value.projects)) {
        return {
            kind: "unparseable",
            reason: "it is not a version 1 registry",
        };
    }
    for (const [place, [id, entry]] of Object.entries(
        value.projects,
    ).entries()) {
        const problem = entryProblem(place + 1, id, entry);
        if (problem !== null) {
            return { kind: "unparseable", reason: problem };
        }
    }
    return { kind: "ok", registry: value as Registry };
}

export async function readRegistry(path: string): Promise<RegistryRead> {
    try {
        return parseRegistry(await readFile(path, "utf8"));
    } catch (error) {
        if (codeOf(error) === "ENOENT") {
            return { kind: "none" };
        }
        return {
            kind: "unparseable",
            reason: error instanceof Error ? error.message : String(error),
        };
    }
}

export function writeRegistry(path: string, registry: Registry): Promise<void> {
    return writeAtomic(path, `${JSON.stringify(registry, null, 2)}\n`);
}

const isDirectory = async (path: string) => {
    try {
        return (await lstat(path)).isDirectory();
    } catch {
        return false;
    }
};

// Where a repository keeps its memory: .agents/memory if it exists, else
// .claude/memory if that does, else .agents/memory.
export async function chooseMemoryDir(root: string): Promise<string> {
    if (await isDirectory(join(root, ".agents", "memory"))) {
        return ".agents/memory";
    }
    return (await isDirectory(join(root, ".claude", "memory")))
        ? ".claude/memory"
        : ".agents/memory";
}

const sorted = <T>(entries: Record<string, T>) =>
    Object.fromEntries(
        Object.entries(entries).sort(([a], [b]) =>
            a < b ? -1 : a > b ? 1 : 0,
        ),
    );

export function withProject(
    registry: Registry,
    project: Project,
    memoryDir: string,
    synced: Record<string, string>,
): Registry {
    const known = registry.projects[project.id];
    const roots = known?.roots ?? [];
    return {
        v: 1,
        projects: {
            ...registry.projects,
            [project.id]: {
                name: known?.name ?? project.name,
                roots: roots.includes(project.root)
                    ? roots
                    : [...roots, project.root],
                memoryDir,
                synced: sorted({
                    ...known?.synced,
                    [project.root]: { dir: memoryDir, facts: sorted(synced) },
                }),
            },
        },
    };
}
