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
import {
    foreignAfter,
    listFacts,
    putFact,
    type Scope,
} from "../facts/store.js";
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
    type SyncRecord,
    syncRecord,
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
    // The memory directory exists.
    present: boolean;
};

async function readRepo(dir: string): Promise<RepoSide> {
    const side: RepoSide = {
        forms: new Map(),
        skipped: [],
        titles: new Map(),
        index: null,
        indexBlocked: false,
        present: true,
    };
    let names: string[];
    try {
        names = (await readdir(dir)).sort();
    } catch (error) {
        if (codeOf(error) === "ENOENT") {
            return { ...side, present: false };
        }
        throw error;
    }
    for (const file of names.filter((name) => name.endsWith(".md"))) {
        const path = join(dir, file);
        if (file === INDEX) {
            await readIndex(path, side);
            continue;
        }
        // One unreadable file does not stop the rest.
        const read = await readFactFile(path, file.slice(0, -3));
        if (read.kind === "fact") {
            side.forms.set(read.name, read.form);
        } else {
            side.skipped.push({ name: read.name, reason: read.reason });
        }
    }
    return side;
}

// MEMORY.md, never read or written through a symlink.
async function readIndex(path: string, side: RepoSide): Promise<void> {
    try {
        const info = await lstat(path);
        if (info.isSymbolicLink()) {
            side.indexBlocked = true;
        } else if (info.isFile()) {
            side.index = await readFile(path, "utf8");
            side.titles = indexTitles(side.index);
        }
    } catch {
        side.indexBlocked = true;
    }
}

type FileRead =
    | { kind: "fact"; name: string; form: ExportedFact }
    | { kind: "skipped"; name: string; reason: string };

// A repository file as a fact's exported form, or why it is skipped.
async function readFactFile(path: string, name: string): Promise<FileRead> {
    // A hostile file name must not reach a terminal as it is; a fact's
    // name is safe.
    const shown = name.replace(/\p{C}/gu, "?");
    const skip = (reason: string, as = shown): FileRead => ({
        kind: "skipped",
        name: as,
        reason,
    });
    try {
        const info = await lstat(path);
        if (info.isSymbolicLink()) {
            return skip("it is a symlink");
        }
        if (!info.isFile()) {
            return skip("it is not a regular file");
        }
        if (!FACT_NAME.test(name)) {
            return skip("its name is not a fact's");
        }
        if (info.size > MAX_FILE_BYTES) {
            return skip("it is over 64 KiB", name);
        }
        const read = parseExported(await readFile(path, "utf8"), name);
        return read.kind === "ok"
            ? { kind: "fact", name, form: read.form }
            : skip(read.reason, name);
    } catch (error) {
        return skip(`it cannot be read, ${String(codeOf(error) ?? "error")}`);
    }
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
    const repo = await readRepo(dir);
    const listed = await listFacts(root, scope);
    const store = new Map(listed.facts.map(({ fact }) => [fact.name, fact]));
    const sync: Sync = {
        root,
        scope,
        dir,
        at: now.toISOString(),
        report: {
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
        },
        // Each memory directory keeps its own record, so one switched away
        // from and back is synced from what it last held there. With none,
        // or for a directory moved away since, the sync is this root and
        // directory's first, and adopts and exports rather than retiring.
        synced: {
            ...syncRecord(known, project.root, memoryDir, repo.present),
        },
        written: [],
        ...adoption(repo, now),
    };
    const { report, synced, written } = sync;
    const passed = new Set(report.skipped.map(({ name }) => name));
    const names = new Set([
        ...store.keys(),
        ...repo.forms.keys(),
        ...Object.keys(synced),
    ]);
    for (const name of [...names].sort()) {
        if (!passed.has(name)) {
            await syncFact(
                name,
                store.get(name) ?? null,
                repo.forms.get(name) ?? null,
                sync,
            );
        }
    }
    const lives = (await listFacts(root, scope)).facts
        .map(({ fact }) => fact)
        .filter((fact) => fact.retired === null);
    await syncIndex(repo, dir, lives, report);
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

// What syncing a project's facts shares.
type Sync = {
    root: string;
    scope: Scope;
    // The memory directory.
    dir: string;
    at: string;
    report: SyncReport;
    synced: SyncRecord;
    // The store's files written, for history.
    written: string[];
} & Adoption;

// The title and creation time of a fact adopted from the repository.
type Adoption = {
    titleFor: (name: string, held: Fact | null) => string;
    createdFor: (name: string) => string;
};

function adoption(repo: RepoSide, now: Date): Adoption {
    // Creation times in the index's order, then by name, a millisecond
    // apart.
    const order = [
        ...repo.titles.keys(),
        ...[...repo.forms.keys()].filter((name) => !repo.titles.has(name)),
    ];
    return {
        createdFor: (name) =>
            new Date(
                now.getTime() + Math.max(0, order.indexOf(name)),
            ).toISOString(),
        // The index's entry, else the store's title, else the name.
        titleFor: (name, held) => {
            const title = normalise(repo.titles.get(name) ?? "");
            return title !== "" && characters(title) <= FACT_LIMITS.title
                ? title
                : (held?.title ??
                      [...name].slice(0, FACT_LIMITS.title).join(""));
        },
    };
}

// One fact, by what each side holds against what both last held. A file
// that cannot be written is skipped; the rest go on.
async function syncFact(
    name: string,
    held: Fact | null,
    theirs: ExportedFact | null,
    sync: Sync,
): Promise<void> {
    const live =
        held !== null && held.retired === null ? exportedForm(held) : null;
    const ours = live === null ? null : formHash(live);
    const their = theirs === null ? null : formHash(theirs);
    // A name such as constructor is no record of the prototype's.
    const last = Object.hasOwn(sync.synced, name)
        ? sync.synced[name]
        : undefined;
    if (ours === their) {
        setRecord(sync.synced, name, ours);
        return;
    }
    const oursChanged = last === undefined ? ours !== null : ours !== last;
    const theirsChanged = last === undefined ? their !== null : their !== last;
    try {
        if (oursChanged && !theirsChanged) {
            await exportFact(name, live, their, sync);
            return;
        }
        // The repository changed, alone or with the store: its version
        // wins, and the store's stays in history.
        if (theirs === null) {
            await retireFact(name, held, sync);
        } else {
            await importFact(name, theirs, held, sync);
        }
        if (oursChanged) {
            sync.report.conflicts.push(name);
        }
    } catch (error) {
        sync.report.skipped.push({ name, reason: describeError(error) });
    }
}

// Both sides hold this hash now; null for neither holding the fact.
function setRecord(synced: SyncRecord, name: string, hash: string | null) {
    if (hash === null) {
        delete synced[name];
    } else {
        synced[name] = hash;
    }
}

// The store's version to the repository, once its file is found as sync
// read it; a fact no longer live has its file removed.
async function exportFact(
    name: string,
    live: ExportedFact | null,
    their: string | null,
    { dir, report, synced }: Sync,
): Promise<void> {
    const path = join(dir, `${name}.md`);
    if (!(await holds(path, name, their))) {
        throw new Error("it changed while syncing");
    }
    if (live === null) {
        await rm(path);
        report.removed.push(name);
        delete synced[name];
        return;
    }
    await writeRepoFile(path, renderExported(live));
    report.exported.push(name);
    synced[name] = formHash(live);
}

// A fact deleted in the repository is retired in the store.
async function retireFact(
    name: string,
    held: Fact | null,
    { root, scope, at, report, synced, written }: Sync,
): Promise<void> {
    if (held !== null && held.retired === null) {
        written.push(
            await putFact(root, scope, {
                ...held,
                provenance: { ...held.provenance, by: "repo", at },
                retired: { at, by: "repo", why: "deleted in the repository" },
            }),
        );
        report.retired.push(name);
    }
    delete synced[name];
}

// The repository's version into the store, keeping what only the store
// holds: tags, importance, when it was made, the keys and sources another
// producer wrote. A verification stays only if the user made the write,
// as it confirmed words this one replaces.
async function importFact(
    name: string,
    theirs: ExportedFact,
    held: Fact | null,
    sync: Sync,
): Promise<void> {
    const { at } = sync;
    const fact: Fact = {
        ...theirs,
        title: sync.titleFor(name, held),
        tags: held?.tags ?? [],
        importance: held?.importance ?? null,
        provenance: {
            origin: nextOrigin(held?.provenance.origin ?? null, "repo", "repo"),
            by: "repo",
            at,
            created: held?.provenance.created ?? sync.createdFor(name),
            ...(held?.provenance.from === undefined
                ? {}
                : { from: held.provenance.from }),
        },
        retired: null,
        ...foreignAfter(held?.foreign, "repo"),
        ...(held?.otherSources === undefined
            ? {}
            : { otherSources: held.otherSources }),
    };
    sync.written.push(await putFact(sync.root, sync.scope, fact));
    sync.report.imported.push(name);
    sync.synced[name] = formHash(theirs);
}

// Whether MEMORY.md is still the text it was read as, or still absent.
async function indexHolds(
    path: string,
    snapshot: string | null,
): Promise<boolean> {
    try {
        const info = await lstat(path);
        return (
            info.isFile() &&
            snapshot !== null &&
            (await readFile(path, "utf8")) === snapshot
        );
    } catch (error) {
        return codeOf(error) === "ENOENT" && snapshot === null;
    }
}

// MEMORY.md is regenerated only when it holds nothing a hand wrote and
// nothing it links could not be read, and there is something to list, so
// a hand-kept index never loses an entry or a line.
async function syncIndex(
    repo: RepoSide,
    dir: string,
    lives: readonly Fact[],
    report: SyncReport,
): Promise<void> {
    const reason = indexLeftReason(repo, lives, report.skipped);
    if (reason !== null) {
        report.indexReason = reason;
        return;
    }
    // A fact whose file could not be written is not listed.
    const skipped = new Set(report.skipped.map(({ name }) => name));
    const { text, omitted } = renderIndex(
        lives
            .filter((fact) => !skipped.has(fact.name))
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
        return;
    }
    try {
        // As a fact's file is, only once it is found as it first was read.
        if (!(await indexHolds(join(dir, INDEX), repo.index))) {
            report.indexReason = "it changed while syncing";
            return;
        }
        await writeRepoFile(join(dir, INDEX), text);
        report.index = "written";
    } catch (error) {
        report.indexReason = describeError(error);
    }
}

function indexLeftReason(
    repo: RepoSide,
    lives: readonly Fact[],
    skipped: SyncReport["skipped"],
): string | null {
    if (lives.length === 0) {
        return "no fact is live";
    }
    if (repo.indexBlocked) {
        return "it is a symlink or cannot be read";
    }
    if (repo.index !== null && !isGeneratedIndex(repo.index)) {
        return "it holds lines sync did not write";
    }
    const linked = skipped.find(({ name }) => repo.titles.has(name));
    return linked === undefined
        ? null
        : `it links ${linked.name}, which was skipped`;
}
