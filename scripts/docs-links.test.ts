// vim:set expandtab shiftwidth=4 filetype=typescript:
// SPDX-License-Identifier: GPL-3.0-only

//
//
// ~chewygumxx/dorothy.git
// ::: :/scripts/docs-links.test.ts
//
//

import { afterEach, beforeEach, expect, it } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { catalogueFailures, linkFailures, resolveLink } from "./docs-links.js";

let root: string;
let page: string;

beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "docs-links-"));
    mkdirSync(join(root, "docs"));
    page = join(root, "docs/page.md");
    writeFileSync(page, "# Page\n");
    writeFileSync(join(root, "docs/a b.md"), "# Café\n");
    writeFileSync(join(root, "README.md"), "# Home\n");
});

afterEach(() => {
    rmSync(root, { recursive: true });
});

it("resolves an escaped root-relative path from the supplied root", () => {
    expect(resolveLink(root, page, "/docs/a%20b.md")).toBe(
        join(root, "docs/a b.md"),
    );
});

it("accepts escaped relative paths and fragments", () => {
    writeFileSync(page, "[yes](./a%20b.md#caf%C3%A9)\n");
    expect(linkFailures(root, [page])).toEqual([]);
});

it("reports a missing fragment in the current page", () => {
    writeFileSync(page, "[no](#absent)\n");
    expect(linkFailures(root, [page])).toEqual(["docs/page.md: #absent"]);
});

it("reports a missing relative target", () => {
    writeFileSync(page, "[no](./missing.md)\n");
    expect(linkFailures(root, [page])).toEqual(["docs/page.md: ./missing.md"]);
});

it("preserves malformed percent escapes in paths and fragments", () => {
    writeFileSync(join(root, "docs/a%.md"), "# Café\n");
    writeFileSync(page, "[yes](./a%.md#café) [no](./a%.md#caf%)\n");
    expect(resolveLink(root, page, "./a%.md")).toBe(join(root, "docs/a%.md"));
    expect(linkFailures(root, [page])).toEqual(["docs/page.md: ./a%.md#caf%"]);
});

it("allows repeated links to pages outside the record list", () => {
    writeFileSync(page, "[home](../README.md) [home](../README.md)\n");
    expect(catalogueFailures(root, page, [])).toEqual({
        missing: [],
        duplicates: [],
    });
});

it("counts aliases and fragments as duplicate entries for one record", () => {
    writeFileSync(page, "[one](./a%20b.md) [two](/docs/a%20b.md#caf%C3%A9)\n");
    expect(catalogueFailures(root, page, ["docs/a b.md"])).toEqual({
        missing: [],
        duplicates: ["docs/a b.md"],
    });
});

it("reports every duplicated record once in sorted order", () => {
    writeFileSync(join(root, "docs/z.md"), "# Z\n");
    writeFileSync(
        page,
        "[z](./z.md) [z](/docs/z.md#z) [z](./z.md)\n" +
            "[a](./a%20b.md) [a](/docs/a%20b.md#caf%C3%A9)\n",
    );
    expect(catalogueFailures(root, page, ["docs/z.md", "docs/a b.md"])).toEqual(
        {
            missing: [],
            duplicates: ["docs/a b.md", "docs/z.md"],
        },
    );
});

it("reports an expected record missing from the catalogue", () => {
    expect(catalogueFailures(root, page, ["docs/missing.md"])).toEqual({
        missing: ["docs/missing.md"],
        duplicates: [],
    });
});
