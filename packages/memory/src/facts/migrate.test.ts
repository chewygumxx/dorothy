// vim:set expandtab shiftwidth=4 filetype=typescript:
// SPDX-License-Identifier: GPL-3.0-only

//
//
// ~chewygumxx/dorothy.git
// ::: :/packages/memory/src/facts/migrate.test.ts
//
//

import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import {
    chmodSync,
    existsSync,
    mkdirSync,
    mkdtempSync,
    readFileSync,
    rmSync,
    writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { syncFacts } from "../recall/facts.js";
import { RecallIndex } from "../recall/store.js";
import { type Fact, parseFact, renderFact } from "./file.js";
import { renderLegacyFact } from "./legacy.js";
import { migrateFacts } from "./migrate.js";

const AT = "2026-10-15T09:30:00.000Z";
const TEA: Fact = {
    name: "likes-tea",
    title: "Likes tea",
    description: "Prefers tea.",
    type: "user",
    extra: {},
    tags: [],
    importance: null,
    provenance: { origin: "dorothy", by: "review", at: AT, created: AT },
    retired: null,
    body: "Tea.",
};
const RUST: Fact = { ...TEA, name: "uses-rust", title: "Uses Rust" };

let root: string;
const put = (path: string, text: string) => {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), text);
};

beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "dorothy-migrate-"));
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

describe("migrateFacts", () => {
    it("moves each fact to knowledge/ in OKF, the same fact", async () => {
        put("facts/personal/likes-tea.md", renderLegacyFact(TEA));
        put(
            "facts/projects/github.com/me/app/uses-rust.md",
            renderLegacyFact(RUST),
        );
        expect(await migrateFacts(root)).toEqual([]);
        const tea = readFileSync(
            join(root, "knowledge/personal/likes-tea.md"),
            "utf8",
        );
        expect(parseFact(tea, "likes-tea")).toEqual({ kind: "ok", fact: TEA });
        const rust = readFileSync(
            join(root, "knowledge/projects/github.com/me/app/uses-rust.md"),
            "utf8",
        );
        expect(parseFact(rust, "uses-rust")).toEqual({
            kind: "ok",
            fact: RUST,
        });
        expect(existsSync(join(root, "facts"))).toBe(false);
    });

    it("leaves a file it cannot read in facts/, and says so", async () => {
        put("facts/personal/likes-tea.md", renderLegacyFact(TEA));
        put("facts/personal/broken.md", "title: null\n");
        const warnings = await migrateFacts(root);
        expect(warnings).toHaveLength(1);
        expect(warnings[0]).toStartWith("facts/personal/broken.md was left");
        expect(existsSync(join(root, "facts/personal/broken.md"))).toBe(true);
        expect(existsSync(join(root, "knowledge/personal/likes-tea.md"))).toBe(
            true,
        );
    });

    it("keeps a fact already in knowledge/, and says so", async () => {
        put("facts/personal/likes-tea.md", renderLegacyFact(TEA));
        const newer = renderFact({ ...TEA, body: "Newer tea." });
        put("knowledge/personal/likes-tea.md", newer);
        const warnings = await migrateFacts(root);
        expect(warnings).toHaveLength(1);
        expect(warnings[0]).toStartWith(
            "facts/personal/likes-tea.md was left in facts/",
        );
        expect(
            readFileSync(join(root, "knowledge/personal/likes-tea.md"), "utf8"),
        ).toBe(newer);
        expect(existsSync(join(root, "facts/personal/likes-tea.md"))).toBe(
            true,
        );
    });

    it("is safe to run again after a partial move", async () => {
        put("facts/personal/likes-tea.md", renderLegacyFact(TEA));
        put("facts/personal/uses-rust.md", renderLegacyFact(RUST));
        put("knowledge/personal/likes-tea.md", renderFact(TEA));
        const first = await migrateFacts(root);
        expect(first).toHaveLength(1);
        const second = await migrateFacts(root);
        expect(second).toEqual(first);
        expect(
            readFileSync(join(root, "knowledge/personal/likes-tea.md"), "utf8"),
        ).toBe(renderFact(TEA));
        expect(existsSync(join(root, "knowledge/personal/uses-rust.md"))).toBe(
            true,
        );
        expect(existsSync(join(root, "facts/personal/uses-rust.md"))).toBe(
            false,
        );
    });

    it("warns of a file it cannot read and moves the rest", async () => {
        put("facts/personal/likes-tea.md", renderLegacyFact(TEA));
        put("facts/personal/uses-rust.md", renderLegacyFact(RUST));
        chmodSync(join(root, "facts/personal/likes-tea.md"), 0o000);
        try {
            const warnings = await migrateFacts(root);
            expect(warnings).toHaveLength(1);
            expect(warnings[0]).toStartWith(
                "facts/personal/likes-tea.md was left in facts/",
            );
            expect(
                existsSync(join(root, "knowledge/personal/uses-rust.md")),
            ).toBe(true);
            expect(existsSync(join(root, "facts/personal/likes-tea.md"))).toBe(
                true,
            );
        } finally {
            chmodSync(join(root, "facts/personal/likes-tea.md"), 0o644);
        }
    });

    it("warns of a file it cannot write and moves the rest", async () => {
        put("facts/personal/likes-tea.md", renderLegacyFact(TEA));
        put(
            "facts/projects/github.com/me/app/uses-rust.md",
            renderLegacyFact(RUST),
        );
        // A file where the personal directory should go.
        put("knowledge/personal", "not a directory");
        const warnings = await migrateFacts(root);
        expect(warnings).toHaveLength(1);
        expect(warnings[0]).toStartWith(
            "facts/personal/likes-tea.md was left in facts/",
        );
        expect(existsSync(join(root, "facts/personal/likes-tea.md"))).toBe(
            true,
        );
        expect(
            existsSync(
                join(root, "knowledge/projects/github.com/me/app/uses-rust.md"),
            ),
        ).toBe(true);
    });

    it("does nothing without facts/", async () => {
        expect(await migrateFacts(root)).toEqual([]);
        expect(existsSync(join(root, "knowledge"))).toBe(false);
    });

    it("runs before the index syncs facts", async () => {
        put("facts/personal/likes-tea.md", renderLegacyFact(TEA));
        const index = RecallIndex.open(join(root, "recall.sqlite"));
        try {
            await syncFacts(index, root);
            const row = index.db.query("SELECT path FROM facts").get() as {
                path: string;
            } | null;
            expect(row?.path).toBe("knowledge/personal/likes-tea.md");
        } finally {
            index.close();
        }
    });
});
