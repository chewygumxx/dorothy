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
import { join } from "node:path";

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
