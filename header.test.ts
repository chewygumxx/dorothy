// vim:set expandtab shiftwidth=4 filetype=typescript:
// SPDX-License-Identifier: GPL-3.0-only

//
//
// ~chewygumxx/dorothy.git
// ::: :/header.test.ts
//
//

// The house header on every file of a headed type. `lint:header` fails a
// header that is out of sync; this fails a file with none.

import { afterAll, describe, expect, it } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { isHeaded, missingHeaders } from "./scripts/header.js";

const ROOT = import.meta.dir;

const roots: string[] = [];
const scratch = (files: Record<string, string>): string => {
    const root = mkdtempSync(join(tmpdir(), "dorothy-header-"));
    roots.push(root);
    for (const [path, text] of Object.entries(files)) {
        mkdirSync(dirname(join(root, path)), { recursive: true });
        writeFileSync(join(root, path), text);
    }
    return root;
};

afterAll(() => {
    for (const root of roots) {
        rmSync(root, { recursive: true, force: true });
    }
});

describe("the house header", () => {
    it("is wanted by code, scripts, config and prose, not by data", () => {
        for (const path of [
            "a.ts",
            "b/c.tsx",
            ".commitlintrc.mts",
            "scripts/prepare.sh",
            ".moxide.toml",
            ".repo-metadata.jsonc",
            ".github/workflows/ci.yaml",
            "docs/roadmap.md",
        ]) {
            expect(isHeaded(path)).toBe(true);
        }
        for (const path of [
            "package.json",
            "bun.lock",
            "LICENSE",
            ".gitignore",
            "docs/reports/2026-10-08-tags/probe/say.sh",
            ".agents/memory/MEMORY.md",
            ".github/pull_request_template.md",
        ]) {
            expect(isHeaded(path)).toBe(false);
        }
    });

    it("is missing from a headed file that has none", () => {
        const root = scratch({
            "bare.ts": "export const x = 1;\n",
            "docs/bare.md": "# Bare\n",
        });
        expect(missingHeaders(root, ["bare.ts", "docs/bare.md"])).toEqual([
            "bare.ts",
            "docs/bare.md",
        ]);
    });

    it("is missing where the breadcrumb names another path", () => {
        const root = scratch({
            "moved.ts": "// ::: :/old.ts\nexport const x = 1;\n",
        });
        expect(missingHeaders(root, ["moved.ts"])).toEqual(["moved.ts"]);
    });

    it("is present in a file whose breadcrumb names its path", () => {
        const root = scratch({
            "ok.ts": "//\n// ~o/r.git\n// ::: :/ok.ts\n//\n",
            "docs/ok.md": "<!--\n   - ::: :/docs/ok.md\n   -->\n",
            "data.json": "{}\n",
        });
        expect(
            missingHeaders(root, ["ok.ts", "docs/ok.md", "data.json"]),
        ).toEqual([]);
    });

    it("is not found past the header's first lines", () => {
        const root = scratch({
            "late.ts": `${"//\n".repeat(40)}// ::: :/late.ts\n`,
        });
        expect(missingHeaders(root, ["late.ts"])).toEqual(["late.ts"]);
    });

    it("is on every file of a headed type in the repository", () => {
        const listed = Bun.spawnSync(
            ["git", "ls-files", "-co", "--exclude-standard"],
            { cwd: ROOT },
        );
        const files = listed.stdout.toString().split("\n").filter(Boolean);
        expect(files.length).toBeGreaterThan(0);
        expect(missingHeaders(ROOT, files)).toEqual([]);
    });
});
