// vim:set expandtab shiftwidth=4 filetype=typescript:
// SPDX-License-Identifier: GPL-3.0-only

//
//
// ~chewygumxx/dorothy.git
// ::: :/agents.test.ts
//
//

// The agent assets' layout, as the agentic asset refactor agreed it: the
// guidance and its budgets, the linked skills, agent memory and Claude's
// plugins. It reads only the repository.

import { describe, expect, it } from "bun:test";
import {
    existsSync,
    lstatSync,
    readdirSync,
    readFileSync,
    realpathSync,
} from "node:fs";
import { basename, dirname, join, relative } from "node:path";

const ROOT = import.meta.dir;
const at = (...parts: string[]) => join(ROOT, ...parts);
const read = (path: string) => readFileSync(path, "utf8");

type Lock = {
    skills: Record<string, { source: string; sourceType: string }>;
};

// Superpowers' skills less the four the `skills` script excludes.
const SKILLS = [
    "brainstorming",
    "dispatching-parallel-agents",
    "executing-plans",
    "finishing-a-development-branch",
    "receiving-code-review",
    "requesting-code-review",
    "subagent-driven-development",
    "systematic-debugging",
    "test-driven-development",
    "verification-before-completion",
    "writing-plans",
];

const EXCLUDED = [
    "diagnosing-superpowers",
    "using-git-worktrees",
    "using-superpowers",
    "writing-skills",
];

const LINKS = [".agents/skills", ".claude/skills"];

const lock = (): Lock => JSON.parse(read(at("skills-lock.json")));

const skillsScript = (): string =>
    JSON.parse(read(at("package.json"))).scripts.skills;

const linked = (dir: string): string[] =>
    existsSync(at(dir)) ? readdirSync(at(dir)).sort() : [];

const skillName = (dir: string): string | undefined =>
    read(join(dir, "SKILL.md")).match(/^name:\s*["']?([^"'\s]+)/m)?.[1];

// Lines, header included, each kind of guidance file may run to. A
// package that outgrows its budget gains a nested AGENTS.md instead.
const BUDGET = { docs: 60, package: 150, root: 100 };

const lines = (path: string) => read(path).trimEnd().split("\n").length;

// Every file beneath a directory, skipping dependencies, git and links.
const walk = (dir: string, found: string[] = []): string[] => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
        if (entry.name === "node_modules" || entry.name === ".git") {
            continue;
        }
        const path = join(dir, entry.name);
        if (entry.isDirectory()) {
            walk(path, found);
        } else if (entry.isFile()) {
            found.push(path);
        }
    }
    return found;
};

const guidanceUnder = (dir: string): string[] =>
    walk(dir).filter((path) => basename(path) === "AGENTS.md");

// Relative links that resolve to nothing; remark checks none of them.
const brokenLinks = (path: string): string[] =>
    [...read(path).matchAll(/\]\(([^)\s]+)\)/g)]
        .map((match) => (match[1] as string).split("#")[0] as string)
        .filter((target) => target !== "" && !/^[a-z]+:/i.test(target))
        .filter((target) => !existsSync(join(dirname(path), target)));

const PACKAGES = at("packages");

describe("the skills", () => {
    it("records superpowers' skills less the excluded four", () => {
        const fromPackages = Object.entries(lock().skills)
            .filter(([, entry]) => entry.sourceType === "node_modules")
            .map(([name]) => name)
            .sort();
        expect(fromPackages).toEqual(SKILLS);
    });

    it("excludes the four in the skills script, and links none", () => {
        const named = [
            ...skillsScript().matchAll(/--exclude '[^#']+#([^']+)'/g),
        ]
            .map((match) => match[1] as string)
            .sort();
        expect(named).toEqual(EXCLUDED);
        for (const dir of LINKS) {
            expect(
                linked(dir).filter((name) => EXCLUDED.includes(name)),
            ).toEqual([]);
        }
    });

    it("syncs without reporting to skills.sh", () => {
        expect(skillsScript()).toStartWith("DO_NOT_TRACK=1 ");
    });

    for (const [name, entry] of Object.entries(lock().skills)) {
        // A remote skill (herdr) arrives with `bun run skills`, never in
        // CI, so it is checked only where it is installed.
        const fromPackage = entry.sourceType === "node_modules";
        const present = fromPackage || existsSync(at(".agents/skills", name));
        it.if(present)(`links ${name} for every agent`, () => {
            const canonical = realpathSync(at(".agents/skills", name));
            expect(realpathSync(at(".claude/skills", name))).toBe(canonical);
            expect(skillName(canonical)).toBe(name);
            if (fromPackage) {
                expect(
                    lstatSync(at(".agents/skills", name)).isSymbolicLink(),
                ).toBe(true);
                expect(canonical).toContain("/node_modules/");
            }
        });
    }

    it("links nothing the lock does not record", () => {
        const recorded = Object.keys(lock().skills);
        for (const dir of LINKS) {
            expect(
                linked(dir).filter((name) => !recorded.includes(name)),
            ).toEqual([]);
        }
    });
});

describe("the packages' guidance", () => {
    it("gives every package an AGENTS.md", () => {
        const missing = readdirSync(PACKAGES).filter(
            (name) => !existsSync(join(PACKAGES, name, "AGENTS.md")),
        );
        expect(missing).toEqual([]);
    });

    for (const path of guidanceUnder(PACKAGES)) {
        const shown = relative(ROOT, path);

        it(`keeps ${shown} within ${BUDGET.package} lines`, () => {
            expect(lines(path)).toBeLessThanOrEqual(BUDGET.package);
        });

        it(`resolves every link in ${shown}`, () => {
            expect(brokenLinks(path)).toEqual([]);
        });
    }
});

// Claude Code reads AGENTS.md only where the project has no instruction
// file of its own by these names, ignored or not.
const CLAUDE_FILES = ["CLAUDE.md", "CLAUDE.local.md"];

describe("the root's guidance", () => {
    it(`keeps AGENTS.md within ${BUDGET.root} lines`, () => {
        expect(lines(at("AGENTS.md"))).toBeLessThanOrEqual(BUDGET.root);
    });

    it(`keeps docs/AGENTS.md within ${BUDGET.docs} lines`, () => {
        expect(lines(at("docs/AGENTS.md"))).toBeLessThanOrEqual(BUDGET.docs);
    });

    it("resolves every link in them", () => {
        expect([
            ...brokenLinks(at("AGENTS.md")),
            ...brokenLinks(at("docs/AGENTS.md")),
        ]).toEqual([]);
    });

    it("leaves no CLAUDE.md to switch them off", () => {
        const found = walk(ROOT)
            .filter((path) => CLAUDE_FILES.includes(basename(path)))
            .map((path) => relative(ROOT, path));
        expect(found).toEqual([]);
    });
});
