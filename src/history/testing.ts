// vim:set expandtab shiftwidth=4 filetype=typescript:
// SPDX-License-Identifier: GPL-3.0-only

//
//
// ~chewygumxx/dorothy.git
// ::: :/src/history/testing.ts
//
//

// Helpers for history's tests: temporary roots, files in them and a bare
// repository to push to. Nothing here touches the user's git setup.

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { isolatedEnv } from "./binary.js";

const roots: string[] = [];

// The environment tests run git with: the user's global configuration
// shut out.
export const TEST_ENV = isolatedEnv(process.env);

export function tempRoot(): string {
    const root = mkdtempSync(join(tmpdir(), "dorothy-history-"));
    roots.push(root);
    return root;
}

export function removeRoots(): void {
    for (const root of roots.splice(0)) {
        rmSync(root, { recursive: true, force: true });
    }
}

export function put(root: string, path: string, text: string): void {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), text);
}

export async function bareRepo(): Promise<string> {
    const path = join(tempRoot(), "mirror.git");
    const proc = Bun.spawn(["git", "init", "-q", "--bare", path], {
        env: TEST_ENV,
        stdout: "ignore",
        stderr: "ignore",
    });
    if ((await proc.exited) !== 0) {
        throw new Error("git init --bare failed");
    }
    return path;
}
