// vim:set expandtab shiftwidth=4 filetype=typescript:
// SPDX-License-Identifier: GPL-3.0-only

//
//
// ~chewygumxx/dorothy.git
// ::: :/src/compaction/boundary.test.ts
//
//

import { describe, expect, it } from "bun:test";
import { dirname, join } from "node:path";
import { Glob } from "bun";

// Every source file under src/compaction/, nested ones included, by its
// path from here.
async function sources(): Promise<{ path: string; text: string }[]> {
    const files: { path: string; text: string }[] = [];
    for await (const path of new Glob("**/*.ts").scan(import.meta.dir)) {
        if (path !== import.meta.file) {
            files.push({
                path,
                text: await Bun.file(join(import.meta.dir, path)).text(),
            });
        }
    }
    return files;
}

// The modules that hold the SDK, which compaction reaches only through
// what it is given; their types are allowed.
const SDK_HOLDERS = [
    "structured",
    "conversation",
    "memory/review",
    "memory/service",
].map((module) => join(import.meta.dir, "..", `${module}.js`));

// What a file imports at run time, statically or with import(), resolved
// to absolute paths; type-only imports and exports are left out. The scan
// is textual: an import() of a template literal is not caught, and an
// import in a comment is flagged, which fails safe.
function runtimeImports(path: string, text: string): string[] {
    const code = text.replaceAll(/(?:import|export) type [^;]+;/g, "");
    return [...code.matchAll(/(?:from|import\s*\(|import)\s*["']([^"']+)["']/g)]
        .map(([, specifier]) => specifier as string)
        .filter((specifier) => specifier.startsWith("."))
        .map((specifier) =>
            join(dirname(join(import.meta.dir, path)), specifier),
        );
}

describe("compaction", () => {
    it("imports nothing from the Agent SDK", async () => {
        const importers = (await sources())
            .filter(({ text }) =>
                text.includes("@anthropic-ai/claude-agent-sdk"),
            )
            .map(({ path }) => path);
        expect(importers.sort()).toEqual([]);
    });

    it("reaches the SDK only through what it is given", async () => {
        const importers = (await sources())
            .filter(({ path, text }) =>
                runtimeImports(path, text).some((module) =>
                    SDK_HOLDERS.includes(module),
                ),
            )
            .map(({ path }) => path);
        expect(importers.sort()).toEqual([]);
    });
});
