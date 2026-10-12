// vim:set expandtab shiftwidth=4 filetype=typescript:
// SPDX-License-Identifier: GPL-3.0-only

//
//
// ~chewygumxx/dorothy.git
// ::: :/scripts/agent-memory.ts
//
//

// Points Claude Code's auto memory at .agents/memory/. The setting must be
// absolute, so it can live only in the gitignored settings.local.json;
// `prepare` runs this on every install, from the checkout's own path, so
// no one sets it by hand.

import { existsSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";

type Settings = Record<string, unknown>;

// The settings with auto memory pointed at the checkout's .agents/memory/,
// every other setting left as it was.
export const withMemoryDirectory = (
    settings: Settings,
    root: string,
): Settings => ({
    ...settings,
    autoMemoryDirectory: join(root, ".agents", "memory"),
});

// The local settings a file holds, an empty file holding none. Anything
// but a JSON object names the file and how to recover, as an install that
// fails on it otherwise says nothing of where.
export const parseSettings = (text: string, path: string): Settings => {
    if (text.trim() === "") {
        return {};
    }
    try {
        const parsed: unknown = JSON.parse(text);
        if (
            parsed !== null &&
            typeof parsed === "object" &&
            !Array.isArray(parsed)
        ) {
            return parsed as Settings;
        }
    } catch {
        // Reported below, with the path.
    }
    throw new Error(
        `${path} is not a JSON object: fix or delete it, then run ` +
            "`bun run prepare` again",
    );
};

// Whether git would leave the file out of a commit. Outside a repository
// (status 128) there is nothing to commit it to.
const ignoredByGit = (path: string): boolean =>
    Bun.spawnSync(["git", "check-ignore", "-q", "--", path], {
        cwd: join(path, ".."),
    }).exitCode !== 1;

// Writes the setting into the checkout's settings.local.json: never into
// one git would commit, whole through a temporary file, and readable by its
// owner alone, as Claude Code creates it.
export const pointMemoryDirectory = (
    root: string,
    isIgnored: (path: string) => boolean = ignoredByGit,
): void => {
    const path = join(root, ".claude", "settings.local.json");
    if (!isIgnored(path)) {
        throw new Error(`${path} is not gitignored, so it is left alone`);
    }
    const settings = existsSync(path)
        ? parseSettings(readFileSync(path, "utf8"), path)
        : {};
    const next = withMemoryDirectory(settings, root);
    if (next.autoMemoryDirectory === settings.autoMemoryDirectory) {
        return;
    }
    const temporary = `${path}.${process.pid}.tmp`;
    writeFileSync(temporary, `${JSON.stringify(next, null, 2)}\n`, {
        mode: 0o600,
    });
    renameSync(temporary, path);
};

if (import.meta.main) {
    try {
        pointMemoryDirectory(join(import.meta.dir, ".."));
    } catch (error) {
        console.error(`agent-memory: ${(error as Error).message}`);
        process.exit(1);
    }
}
