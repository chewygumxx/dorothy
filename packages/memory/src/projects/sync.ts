// vim:set expandtab shiftwidth=4 filetype=typescript:
// SPDX-License-Identifier: GPL-3.0-only

//
//
// ~chewygumxx/dorothy.git
// ::: :/packages/memory/src/projects/sync.ts
//
//

// Reconciles a project's facts in the store with its repository's memory
// directory. The store is the truth: a fact changed only in the store is
// exported, one changed only in the repository imported, and one changed
// in both takes the repository's version, the store's kept in history.
// What the store last held is compared, not the files, so a working
// tree's edit is never overwritten; sync never commits or pushes.

import { randomBytes } from "node:crypto";
import {
    lstat,
    mkdir,
    readdir,
    readFile,
    rename,
    rm,
    writeFile,
} from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import {
    FACT_LIMITS,
    FACT_NAME,
    type Fact,
    nextOrigin,
} from "../facts/file.js";
import { listFacts, putFact, type Scope } from "../facts/store.js";
import {
    characters,
    type Lock,
    normalise,
    type Recorder,
} from "../memory/sidecar.js";
import {
    type ExportedFact,
    exportedForm,
    formHash,
    indexTitles,
    isGeneratedIndex,
    parseExported,
    renderExported,
    renderIndex,
} from "./export.js";
import { identify, type Project } from "./identify.js";
import {
    chooseMemoryDir,
    EMPTY_REGISTRY,
    memoryDirProblem,
    projectsPath,
    readRegistry,
    withProject,
    writeRegistry,
} from "./registry.js";

// A repository file larger than this is no fact, and is not read.
export const MAX_FILE_BYTES = 64 * 1024;
const INDEX = "MEMORY.md";

export type SyncOptions = {
    // The data directory.
    root: string;
    lock: Lock;
    recorder: Recorder | null;
    now?: () => Date;
};

export type SyncReport = {
    project: Project;
    memoryDir: string;
    imported: string[];
    exported: string[];
    removed: string[];
    retired: string[];
    conflicts: string[];
    skipped: { name: string; reason: string }[];
    index: "written" | "unchanged" | "left";
    // Why MEMORY.md was left, when it was.
    indexReason?: string;
    // Live facts MEMORY.md had no room for.
    omitted: number;
};

export type SyncResult =
    | { kind: "ok"; report: SyncReport }
    | { kind: "not-a-repository" }
    | { kind: "failed"; reason: string };

const codeOf = (error: unknown) => (error as { code?: unknown }).code;
const describeError = (error: unknown) =>
    error instanceof Error ? error.message : String(error);

// The memory directory, refused if it leaves the repository or passes
// through a symlink; it need not exist yet.
async function safeDir(root: string, memoryDir: string): Promise<string> {
    const problem = memoryDirProblem(memoryDir);
    if (problem !== null) {
        throw new Error(problem);
    }
    let at = root;
    for (const part of memoryDir.split("/")) {
        at = join(at, part);
        let info: Awaited<ReturnType<typeof lstat>>;
        try {
            info = await lstat(at);
        } catch (error) {
            if (codeOf(error) === "ENOENT") {
                continue;
            }
            throw error;
        }
        if (info.isSymbolicLink()) {
            throw new Error(`${memoryDir} passes through a symlink, ${at}`);
        }
        if (!info.isDirectory()) {
            throw new Error(`${at} is not a directory`);
        }
    }
    return at;
}

type RepoSide = {
    forms: Map<string, ExportedFact>;
    skipped: { name: string; reason: string }[];
    titles: Map<string, string>;
    // MEMORY.md's text; null when there is none.
    index: string | null;
    // MEMORY.md is a symlink, and never written.
    indexBlocked: boolean;
};

async function readRepo(dir: string): Promise<RepoSide> {
    const side: RepoSide = {
        forms: new Map(),
        skipped: [],
        titles: new Map(),
        index: null,
        indexBlocked: false,
    };
    let names: string[];
    try {
        names = (await readdir(dir)).sort();
    } catch (error) {
        if (codeOf(error) === "ENOENT") {
            return side;
        }
        throw error;
    }
    for (const file of names) {
        if (!file.endsWith(".md")) {
            continue;
        }
        const path = join(dir, file);
        const name = file.slice(0, -3);
        // A hostile file name must not reach a terminal as it is.
        const shown = name.replace(/\p{C}/gu, "?");
        try {
            const info = await lstat(path);
            if (file === INDEX) {
                if (info.isSymbolicLink()) {
                    side.indexBlocked = true;
                } else if (info.isFile()) {
                    side.index = await readFile(path, "utf8");
                    side.titles = indexTitles(side.index);
                }
                continue;
            }
            if (info.isSymbolicLink()) {
                side.skipped.push({ name: shown, reason: "it is a symlink" });
            } else if (!info.isFile()) {
                side.skipped.push({
                    name: shown,
                    reason: "it is not a regular file",
                });
            } else {
                if (!FACT_NAME.test(name)) {
                    side.skipped.push({
                        name: shown,
                        reason: "its name is not a fact's",
                    });
                } else if (info.size > MAX_FILE_BYTES) {
                    side.skipped.push({ name, reason: "it is over 64 KiB" });
                } else {
                    const read = parseExported(
                        await readFile(path, "utf8"),
                        name,
                    );
                    if (read.kind === "ok") {
                        side.forms.set(name, read.form);
                    } else {
                        side.skipped.push({ name, reason: read.reason });
                    }
                }
            }
        } catch (error) {
            // One unreadable file does not stop the rest.
            if (file === INDEX) {
                side.indexBlocked = true;
            } else {
                side.skipped.push({
                    name: shown,
                    reason: `it cannot be read, ${String(codeOf(error) ?? "error")}`,
                });
            }
        }
    }
    return side;
}

// Whether a repository file is still as sync read it (a form of this
// hash, or none), so that an edit made while sync runs is not
// overwritten or removed.
async function holds(
    path: string,
    stem: string,
    hash: string | null,
): Promise<boolean> {
    try {
        const info = await lstat(path);
        if (!info.isFile() || info.size > MAX_FILE_BYTES) {
            return false;
        }
        const read = parseExported(await readFile(path, "utf8"), stem);
        return (
            hash !== null && read.kind === "ok" && formHash(read.form) === hash
        );
    } catch (error) {
        return codeOf(error) === "ENOENT" && hash === null;
    }
}

// A repository file, written whole or not at all, as the repository's
// other files are: mode 0644, in ordinary directories. Never through a
// symlink.
async function writeRepoFile(path: string, text: string): Promise<void> {
    await mkdir(dirname(path), { recursive: true });
    try {
        if ((await lstat(path)).isSymbolicLink()) {
            throw new Error(`${path} is a symlink`);
        }
    } catch (error) {
        if (codeOf(error) !== "ENOENT") {
            throw error;
        }
    }
    const temporary = `${path}.${randomBytes(4).toString("hex")}.tmp`;
    try {
        await writeFile(temporary, text, { mode: 0o644, flag: "wx" });
        await rename(temporary, path);
    } catch (error) {
        await rm(temporary, { force: true });
        throw error;
    }
}

export async function syncProject(
    path: string,
    options: SyncOptions,
): Promise<SyncResult> {
    let project: Project | null;
    try {
        project = await identify(path);
    } catch (error) {
        return { kind: "failed", reason: describeError(error) };
    }
    if (project === null) {
        return { kind: "not-a-repository" };
    }
    const found = project;
    try {
        return await options.lock(() => reconcile(found, options));
    } catch (error) {
        return { kind: "failed", reason: describeError(error) };
    }
}

async function reconcile(
    project: Project,
    { root, recorder, now: clock = () => new Date() }: SyncOptions,
): Promise<SyncResult> {
    const now = clock();
    const at = now.toISOString();
    const registryPath = projectsPath(root);
    const registryRead = await readRegistry(registryPath);
    if (registryRead.kind === "unparseable") {
        return {
            kind: "failed",
            reason: `${registryPath}: ${registryRead.reason}`,
        };
    }
    const registry =
        registryRead.kind === "ok" ? registryRead.registry : EMPTY_REGISTRY;
    const known = registry.projects[project.id];
    const memoryDir = known?.memoryDir ?? (await chooseMemoryDir(project.root));
    const dir = await safeDir(project.root, memoryDir);
    const scope: Scope = { kind: "project", id: project.id };
    // A record of another memory directory, the user having edited it,
    // describes files no longer here: the sync is this root's first, and
    // adopts and exports rather than retiring everything.
    const record = known?.synced[project.root];
    const synced: Record<string, string> =
        record !== undefined && record.dir === memoryDir
            ? { ...record.facts }
            : {};

    const repo = await readRepo(dir);
    const listed = await listFacts(root, scope);
    const store = new Map(listed.facts.map(({ fact }) => [fact.name, fact]));
    const report: SyncReport = {
        project,
        memoryDir,
        imported: [],
        exported: [],
        removed: [],
        retired: [],
        conflicts: [],
        skipped: [
            ...repo.skipped,
            ...listed.broken.map(({ path }) => ({
                name: basename(path, ".md"),
                reason: "it is broken in the store",
            })),
        ],
        index: "left",
        omitted: 0,
    };
    const passed = new Set(report.skipped.map(({ name }) => name));
    const written: string[] = [];

    // Facts adopted from the repository take creation times in the
    // index's order, then by name, a millisecond apart.
    const order = [
        ...repo.titles.keys(),
        ...[...repo.forms.keys()].filter((name) => !repo.titles.has(name)),
    ];
    const createdFor = (name: string) =>
        new Date(
            now.getTime() + Math.max(0, order.indexOf(name)),
        ).toISOString();
    // The index's entry, else the store's title, else the name.
    const titleFor = (name: string, held: Fact | null) => {
        const title = normalise(repo.titles.get(name) ?? "");
        return title !== "" && characters(title) <= FACT_LIMITS.title
            ? title
            : (held?.title ?? [...name].slice(0, FACT_LIMITS.title).join(""));
    };

    const names = new Set([
        ...store.keys(),
        ...repo.forms.keys(),
        ...Object.keys(synced),
    ]);
    for (const name of [...names].sort()) {
        if (passed.has(name)) {
            continue;
        }
        const held = store.get(name) ?? null;
        const live =
            held !== null && held.retired === null ? exportedForm(held) : null;
        const theirs = repo.forms.get(name) ?? null;
        const ours = live === null ? null : formHash(live);
        const their = theirs === null ? null : formHash(theirs);
        const last = synced[name];
        if (ours === their) {
            if (ours === null) {
                delete synced[name];
            } else {
                synced[name] = ours;
            }
            continue;
        }
        const oursChanged = last === undefined ? ours !== null : ours !== last;
        const theirsChanged =
            last === undefined ? their !== null : their !== last;
        if (oursChanged && !theirsChanged) {
            // A file that cannot be written is skipped; the rest go on.
            try {
                if (!(await holds(join(dir, `${name}.md`), name, their))) {
                    throw new Error("it changed while syncing");
                }
                if (live === null) {
                    await rm(join(dir, `${name}.md`));
                    report.removed.push(name);
                    delete synced[name];
                } else {
                    await writeRepoFile(
                        join(dir, `${name}.md`),
                        renderExported(live),
                    );
                    report.exported.push(name);
                    synced[name] = ours as string;
                }
            } catch (error) {
                report.skipped.push({ name, reason: describeError(error) });
            }
            continue;
        }
        // The repository changed, alone or with the store: its version
        // wins, and the store's stays in history.
        try {
            if (theirs === null) {
                if (held !== null && held.retired === null) {
                    written.push(
                        await putFact(root, scope, {
                            ...held,
                            provenance: { ...held.provenance, by: "repo", at },
                            retired: {
                                at,
                                by: "repo",
                                why: "deleted in the repository",
                            },
                        }),
                    );
                    report.retired.push(name);
                }
                if (oursChanged) {
                    report.conflicts.push(name);
                }
                delete synced[name];
                continue;
            }
            const fact: Fact = {
                ...theirs,
                title: titleFor(name, held),
                tags: held?.tags ?? [],
                importance: held?.importance ?? null,
                provenance: {
                    origin: nextOrigin(
                        held?.provenance.origin ?? null,
                        "repo",
                        "repo",
                    ),
                    by: "repo",
                    at,
                    created: held?.provenance.created ?? createdFor(name),
                    ...(held?.provenance.from === undefined
                        ? {}
                        : { from: held.provenance.from }),
                },
                retired: null,
            };
            written.push(await putFact(root, scope, fact));
            report.imported.push(name);
            if (oursChanged) {
                report.conflicts.push(name);
            }
            synced[name] = their as string;
        } catch (error) {
            report.skipped.push({ name, reason: describeError(error) });
        }
    }

    // MEMORY.md is regenerated only when it holds nothing a hand wrote
    // and nothing it links could not be read, and there is something to
    // list, so a hand-kept index never loses an entry or a line.
    const lives = (await listFacts(root, scope)).facts
        .map(({ fact }) => fact)
        .filter((fact) => fact.retired === null);
    const skippedNames = new Set(report.skipped.map(({ name }) => name));
    const linked = report.skipped.find(({ name }) => repo.titles.has(name));
    const reason =
        lives.length === 0
            ? "no fact is live"
            : repo.indexBlocked
              ? "it is a symlink or cannot be read"
              : repo.index !== null && !isGeneratedIndex(repo.index)
                ? "it holds lines sync did not write"
                : linked !== undefined
                  ? `it links ${linked.name}, which was skipped`
                  : null;
    if (reason !== null) {
        report.indexReason = reason;
    } else {
        // A fact whose file could not be written is not listed.
        const { text, omitted } = renderIndex(
            lives
                .filter((fact) => !skippedNames.has(fact.name))
                .map((fact) => ({
                    name: fact.name,
                    title: fact.title,
                    description: fact.description,
                    importance: fact.importance,
                    created: fact.provenance.created,
                })),
        );
        report.omitted = omitted;
        if (text === repo.index) {
            report.index = "unchanged";
        } else {
            try {
                await writeRepoFile(join(dir, INDEX), text);
                report.index = "written";
            } catch (error) {
                report.indexReason = describeError(error);
            }
        }
    }

    const next = withProject(registry, project, memoryDir, synced);
    if (JSON.stringify(next) !== JSON.stringify(registry)) {
        await writeRegistry(registryPath, next);
        written.push(registryPath);
    }
    if (written.length > 0) {
        await recorder?.(
            written,
            `sync: ${project.id}: ${report.imported.length + report.retired.length} in, ${report.exported.length + report.removed.length} out`,
        );
    }
    return { kind: "ok", report };
}
