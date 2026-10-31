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
// plugins. Settings preparation also runs in disposable checkouts.

import { describe, expect, it } from "bun:test";
import {
    copyFileSync,
    existsSync,
    lstatSync,
    mkdirSync,
    mkdtempSync,
    readdirSync,
    readFileSync,
    realpathSync,
    rmSync,
    statSync,
    symlinkSync,
    writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, relative } from "node:path";
import {
    parseSettings,
    pointMemoryDirectory,
    withMemoryDirectory,
} from "./scripts/agent-memory.js";

const ROOT = import.meta.dir;
const at = (...parts: string[]) => join(ROOT, ...parts);
const read = (path: string) => readFileSync(path, "utf8");

type Lock = {
    skills: Record<
        string,
        { source: string; sourceType: string; ref?: string }
    >;
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

// The repository's own skills: committed beside the links, as
// `.gitignore` negates them, and never recorded in the lock.
const OWN = ["agent-stewardship", "worktrees"];

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

// Every file and link beneath a directory, skipping dependencies and git,
// and never following a link into a directory.
const walk = (dir: string, found: string[] = []): string[] => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
        if (entry.name === "node_modules" || entry.name === ".git") {
            continue;
        }
        const path = join(dir, entry.name);
        if (entry.isDirectory()) {
            walk(path, found);
        } else if (entry.isFile() || entry.isSymbolicLink()) {
            found.push(path);
        }
    }
    return found;
};

const guidanceUnder = (dir: string): string[] =>
    walk(dir).filter((path) => basename(path) === "AGENTS.md");

// The relative link targets in Markdown, without their fragments: inline
// links, titled or in angle brackets, and reference definitions. Code is
// skipped, as a link there is only an example.
const linkTargets = (markdown: string): string[] => {
    const prose = markdown
        .replace(/^(```|~~~)[^\n]*\n[\s\S]*?^\1[^\n]*$/gm, "")
        .replace(/`[^`\n]*`/g, "");
    const inline = [...prose.matchAll(/\]\(\s*(?:<([^>\n]*)>|([^)\s]+))/g)];
    const defined = [
        ...prose.matchAll(/^ {0,3}\[[^\]\n]+\]:\s*(?:<([^>\n]*)>|(\S+))/gm),
    ];
    return [...inline, ...defined]
        .map(
            (match) =>
                ((match[1] ?? match[2]) as string).split("#")[0] as string,
        )
        .filter((target) => target !== "" && !/^[a-z][a-z+.-]*:/i.test(target));
};

// Relative links that resolve to nothing, a leading slash meaning the
// repository's root; remark checks none of them.
const brokenLinks = (path: string): string[] =>
    linkTargets(read(path)).filter(
        (target) =>
            !existsSync(
                target.startsWith("/")
                    ? join(ROOT, target)
                    : join(dirname(path), target),
            ),
    );

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

    it("pins every remote skill source to a commit", () => {
        const manifest = JSON.parse(read(at("package.json"))) as {
            skills: { source: string; ref?: string }[];
        };
        expect(manifest.skills.length).toBeGreaterThan(0);
        for (const entry of manifest.skills) {
            expect(entry.ref ?? "").toMatch(/^[0-9a-f]{40}$/);
            const locked = Object.values(lock().skills).find(
                (skill) => skill.source === entry.source,
            );
            expect(locked?.ref).toBe(entry.ref);
        }
    });

    it("syncs without reporting to skills.sh", () => {
        expect(skillsScript()).toStartWith("DO_NOT_TRACK=1 ");
    });

    for (const [name, entry] of Object.entries(lock().skills)) {
        // A remote skill (herdr) arrives with `skills add`, which the
        // sync skips, or in a worktree's copy of the main checkout's;
        // never in CI, so it is checked only where it is installed.
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
        const recorded = [...Object.keys(lock().skills), ...OWN];
        for (const dir of LINKS) {
            expect(
                linked(dir).filter((name) => !recorded.includes(name)),
            ).toEqual([]);
        }
    });

    it("commits its own skills, linked for every agent", () => {
        const tracked = Bun.spawnSync(["git", "ls-files", ...LINKS], {
            cwd: ROOT,
        })
            .stdout.toString()
            .trim()
            .split("\n");
        for (const name of OWN) {
            const dir = at(".agents/skills", name);
            expect(lstatSync(dir).isDirectory()).toBe(true);
            expect(skillName(dir)).toBe(name);
            expect(tracked).toContain(`.agents/skills/${name}/SKILL.md`);
            expect(tracked).toContain(`.claude/skills/${name}`);
            expect(realpathSync(at(".claude/skills", name))).toBe(
                realpathSync(dir),
            );
            expect(Object.keys(lock().skills)).not.toContain(name);
        }
    });
});

describe("the link check", () => {
    it("reads every form of relative link, outside code", () => {
        const markdown = [
            '[a](./a.md) [b](./b.md "Title") [c](<./c d.md>)',
            "[e](https://example.com) [f](#here) [g](./g.md#part)",
            "Not a link: `[h](./h.md)`.",
            "```",
            "[i](./i.md)",
            "```",
            "[j]: ./j.md",
            '[k]: <./k.md> "Title"',
        ].join("\n");
        expect(linkTargets(markdown)).toEqual([
            "./a.md",
            "./b.md",
            "./c d.md",
            "./g.md",
            "./j.md",
            "./k.md",
        ]);
    });

    it("resolves a repository-absolute link from the root", () => {
        const dir = mkdtempSync(join(tmpdir(), "agents-links-"));
        try {
            const path = join(dir, "AGENTS.md");
            writeFileSync(path, "[r](/README.md) [s](/no-such-file.md)\n");
            expect(brokenLinks(path)).toEqual(["/no-such-file.md"]);
        } finally {
            rmSync(dir, { recursive: true });
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

    for (const file of ["AGENTS.md", "docs/AGENTS.md"]) {
        it(`resolves every link in ${file}`, () => {
            expect(brokenLinks(at(file))).toEqual([]);
        });
    }

    // `ln -s AGENTS.md CLAUDE.md` is the usual way one comes back.
    it("finds a CLAUDE.md that is a link", () => {
        const dir = mkdtempSync(join(tmpdir(), "agents-walk-"));
        try {
            writeFileSync(join(dir, "AGENTS.md"), "# AGENTS.md\n");
            symlinkSync("AGENTS.md", join(dir, "CLAUDE.md"));
            expect(walk(dir).map((path) => basename(path))).toContain(
                "CLAUDE.md",
            );
        } finally {
            rmSync(dir, { recursive: true });
        }
    });

    it("leaves no CLAUDE.md to switch them off", () => {
        const found = walk(ROOT)
            .filter((path) => CLAUDE_FILES.includes(basename(path)))
            .map((path) => relative(ROOT, path));
        expect(found).toEqual([]);
    });
});

const MEMORY = at(".agents/memory");

// The memories an index links, as `./name.md` (the house form) or as
// `name.md` (the form Claude Code's own memory instructions write).
const indexEntries = (index: string): string[] =>
    [...index.matchAll(/\]\((?:\.\/)?([^)/]+\.md)\)/g)]
        .map((match) => match[1] as string)
        .sort();

describe("agent memory", () => {
    it("lives in .agents/memory, not .claude/memory", () => {
        expect(existsSync(join(MEMORY, "MEMORY.md"))).toBe(true);
        expect(existsSync(at(".claude/memory"))).toBe(false);
    });

    it("reads index entries linked with or without ./", () => {
        const index = "- [A](./a.md)\n  a hook\n- [B](b.md) a hook\n";
        expect(indexEntries(index)).toEqual(["a.md", "b.md"]);
    });

    it("indexes every memory there, and nothing else", () => {
        const indexed = indexEntries(read(join(MEMORY, "MEMORY.md")));
        const memories = readdirSync(MEMORY)
            .filter((name) => name.endsWith(".md") && name !== "MEMORY.md")
            .sort();
        expect(indexed).toEqual(memories);
    });

    it("names the file when its settings are not a JSON object", () => {
        for (const text of ["{oops", "[]", "null", "", " \n"]) {
            expect(() => parseSettings(text, "/x/settings.local.json")).toThrow(
                "/x/settings.local.json is not a JSON object",
            );
        }
    });

    it("writes the setting privately and whole, keeping the others", () => {
        const root = mkdtempSync(join(tmpdir(), "agent-memory-"));
        try {
            mkdirSync(join(root, ".claude"));
            const path = join(root, ".claude", "settings.local.json");
            writeFileSync(path, '{ "enabledMcpjsonServers": ["github"] }\n');
            pointMemoryDirectory(root, () => true);
            expect(JSON.parse(read(path))).toEqual({
                autoMemoryDirectory: join(root, ".agents", "memory"),
                enabledMcpjsonServers: ["github"],
            });
            expect(statSync(path).mode & 0o777).toBe(0o600);
            expect(readdirSync(join(root, ".claude"))).toEqual([
                "settings.local.json",
            ]);
        } finally {
            rmSync(root, { recursive: true });
        }
    });

    it("leaves a settings file git would commit alone", () => {
        const root = mkdtempSync(join(tmpdir(), "agent-memory-"));
        try {
            mkdirSync(join(root, ".claude"));
            expect(() => pointMemoryDirectory(root, () => false)).toThrow(
                "is not gitignored",
            );
            expect(
                existsSync(join(root, ".claude", "settings.local.json")),
            ).toBe(false);
        } finally {
            rmSync(root, { recursive: true });
        }
    });

    it("points auto memory at .agents/memory, keeping other settings", () => {
        const settings = {
            autoMemoryDirectory: "/checkout/.claude/memory",
            enabledMcpjsonServers: ["github"],
        };
        expect(withMemoryDirectory(settings, "/checkout")).toEqual({
            autoMemoryDirectory: "/checkout/.agents/memory",
            enabledMcpjsonServers: ["github"],
        });
    });
});

// Run the real prepare and memory setup in a disposable checkout. Other
// prepare steps are no-ops here; only the memory script uses the real Bun.
const preparedCheckout = () => {
    const root = mkdtempSync(join(tmpdir(), "agent-memory-prepare-"));
    const bin = join(root, "bin");
    mkdirSync(bin);
    mkdirSync(join(root, "node_modules", "husky"), { recursive: true });
    mkdirSync(join(root, "scripts"));
    for (const name of ["prepare.sh", "agent-memory.ts"]) {
        copyFileSync(at("scripts", name), join(root, "scripts", name));
    }
    writeFileSync(join(bin, "husky"), "#!/bin/sh\nexit 0\n", { mode: 0o755 });
    writeFileSync(
        join(bin, "bun"),
        [
            "#!/bin/sh",
            'if [ "$1" = scripts/agent-memory.ts ]; then',
            '    exec "$PREPARE_TEST_BUN" --no-env-file "$@"',
            "fi",
            "exit 0",
            "",
        ].join("\n"),
        { mode: 0o755 },
    );
    const path = join(root, ".claude", "settings.local.json");
    return {
        root,
        path,
        write(text: string) {
            mkdirSync(dirname(path), { recursive: true });
            writeFileSync(path, text, { mode: 0o640 });
        },
        run: () =>
            Bun.spawnSync(["sh", "scripts/prepare.sh"], {
                cwd: root,
                env: {
                    HOME: root,
                    PATH: `${bin}:/usr/bin:/bin`,
                    PREPARE_TEST_BUN: process.execPath,
                    GIT_CONFIG_GLOBAL: "/dev/null",
                    GIT_CONFIG_NOSYSTEM: "1",
                    XDG_DATA_HOME: join(root, "data"),
                    XDG_STATE_HOME: join(root, "state"),
                    XDG_CONFIG_HOME: join(root, "config"),
                    XDG_CACHE_HOME: join(root, "cache"),
                },
            }),
        remove: () => rmSync(root, { recursive: true, force: true }),
    };
};

describe("agent memory preparation", () => {
    it("creates private settings in a checkout with no .claude directory", () => {
        const checkout = preparedCheckout();
        try {
            expect(checkout.run().exitCode).toBe(0);
            expect(JSON.parse(read(checkout.path))).toEqual({
                autoMemoryDirectory: join(checkout.root, ".agents", "memory"),
            });
            expect(statSync(checkout.path).mode & 0o777).toBe(0o600);
        } finally {
            checkout.remove();
        }
    });

    for (const existing of [false, true]) {
        it(`warns without following a .claude symlink (${existing ? "existing" : "missing"} settings)`, () => {
            const checkout = preparedCheckout();
            const outside = mkdtempSync(
                join(tmpdir(), "agent-memory-outside-"),
            );
            const path = join(outside, "settings.local.json");
            try {
                const text = '{ "other": "kept" }\n';
                if (existing) writeFileSync(path, text, { mode: 0o640 });
                const before = existing ? statSync(path) : undefined;
                symlinkSync(outside, join(checkout.root, ".claude"));
                const result = checkout.run();
                expect(result.exitCode).toBe(0);
                expect(result.stderr.toString()).toContain("warning");
                expect(result.stderr.toString()).toContain(".claude");
                expect(
                    lstatSync(join(checkout.root, ".claude")).isSymbolicLink(),
                ).toBe(true);
                if (before) {
                    expect(read(path)).toBe(text);
                    expect(statSync(path).ino).toBe(before.ino);
                    expect(statSync(path).mtimeMs).toBe(before.mtimeMs);
                    expect(statSync(path).mode).toBe(before.mode);
                } else {
                    expect(existsSync(path)).toBe(false);
                }
                expect(readdirSync(outside)).toEqual(
                    existing ? ["settings.local.json"] : [],
                );
            } finally {
                checkout.remove();
                rmSync(outside, { recursive: true, force: true });
            }
        });
    }

    it("uses each checkout's own root and keeps all other settings", () => {
        for (let index = 0; index < 2; index++) {
            const checkout = preparedCheckout();
            try {
                checkout.write(
                    JSON.stringify({
                        autoMemoryDirectory: "/another/checkout/.agents/memory",
                        permissions: { allow: ["Read"], deny: ["Write"] },
                        env: { FIXTURE: "kept" },
                        enabledMcpjsonServers: ["fixture"],
                        enabled: false,
                    }),
                );
                expect(checkout.run().exitCode).toBe(0);
                expect(JSON.parse(read(checkout.path))).toEqual({
                    autoMemoryDirectory: join(
                        checkout.root,
                        ".agents",
                        "memory",
                    ),
                    permissions: { allow: ["Read"], deny: ["Write"] },
                    env: { FIXTURE: "kept" },
                    enabledMcpjsonServers: ["fixture"],
                    enabled: false,
                });
            } finally {
                checkout.remove();
            }
        }
    });

    it("does not rewrite or chmod settings already pointing at this checkout", () => {
        const checkout = preparedCheckout();
        try {
            const text = `{ "other": 2, "autoMemoryDirectory": ${JSON.stringify(join(checkout.root, ".agents", "memory"))} }\n`;
            checkout.write(text);
            const before = statSync(checkout.path);
            expect(checkout.run().exitCode).toBe(0);
            const after = statSync(checkout.path);
            expect(read(checkout.path)).toBe(text);
            expect(after.ino).toBe(before.ino);
            expect(after.mtimeMs).toBe(before.mtimeMs);
            expect(after.mode).toBe(before.mode);
        } finally {
            checkout.remove();
        }
    });

    for (const [kind, text] of [
        ["invalid JSON", "{oops"],
        ["array", "[]"],
        ["null", "null"],
        ["empty", ""],
        ["whitespace", " \n"],
    ] as const) {
        it(`warns and preserves ${kind} settings without failing prepare`, () => {
            const checkout = preparedCheckout();
            try {
                checkout.write(text);
                const before = statSync(checkout.path);
                const result = checkout.run();
                expect(result.exitCode).toBe(0);
                expect(result.stderr.toString()).toContain("warning");
                expect(result.stderr.toString()).toContain(
                    "settings.local.json",
                );
                expect(read(checkout.path)).toBe(text);
                expect(statSync(checkout.path).ino).toBe(before.ino);
                expect(statSync(checkout.path).mtimeMs).toBe(before.mtimeMs);
                expect(statSync(checkout.path).mode).toBe(before.mode);
            } finally {
                checkout.remove();
            }
        });
    }
});

// Each stays because nothing neutral does its job, and is declared here
// rather than left to a user's settings; a plugin added later is a
// decision a review sees.
const PLUGINS = {
    "agent-sdk-dev@claude-plugins-official": true,
    "claude-code-setup@claude-plugins-official": true,
    "claude-md-management@claude-plugins-official": true,
    "code-simplifier@claude-plugins-official": true,
    "repo-metadata@chewygumxx": true,
    "superpowers@claude-plugins-official": false,
    "typescript-lsp@claude-plugins-official": true,
};

describe("Claude's settings", () => {
    it("enables exactly the agreed plugins", () => {
        const settings = JSON.parse(read(at(".claude/settings.json")));
        expect(settings.enabledPlugins).toEqual(PLUGINS);
    });
});

// A scratch repository for the install hooks, its git shut out of the
// user's configuration, and a stand-in `bun` that records each install
// instead of running it.
const scratchRepository = () => {
    const dir = mkdtempSync(join(tmpdir(), "agents-hooks-"));
    const bin = join(dir, "bin");
    const repo = join(dir, "repo");
    const log = join(dir, "installs");
    mkdirSync(bin);
    mkdirSync(repo);
    writeFileSync(join(bin, "bun"), `#!/bin/sh\necho "$*" >>"${log}"\n`, {
        mode: 0o755,
    });
    const env = {
        GIT_AUTHOR_EMAIL: "test@example.com",
        GIT_AUTHOR_NAME: "test",
        GIT_COMMITTER_EMAIL: "test@example.com",
        GIT_COMMITTER_NAME: "test",
        GIT_CONFIG_GLOBAL: "/dev/null",
        GIT_CONFIG_NOSYSTEM: "1",
        HOME: dir,
        PATH: `${bin}:${process.env.PATH}`,
    };
    const git = (...args: string[]): string => {
        const run = Bun.spawnSync(["git", ...args], { cwd: repo, env });
        if (run.exitCode !== 0) {
            throw new Error(`git ${args.join(" ")}: ${run.stderr}`);
        }
        return run.stdout.toString().trim();
    };
    const commit = (file: string, text: string): string => {
        writeFileSync(join(repo, file), text);
        git("add", file);
        git("commit", "-q", "-m", file);
        return git("rev-parse", "HEAD");
    };
    git("init", "-q", "-b", "main");
    const run = (name: string, args: string[]) =>
        Bun.spawnSync(["sh", at(".husky", name), ...args], { cwd: repo, env });
    return {
        commit,
        git,
        hook: (name: string, ...args: string[]) => run(name, args).exitCode,
        hookErrors: (name: string, ...args: string[]) =>
            run(name, args).stderr.toString(),
        installs: (): string[] =>
            existsSync(log) ? read(log).trim().split("\n") : [],
        remove: () => rmSync(dir, { recursive: true }),
    };
};

describe("the install hooks", () => {
    it("reinstall after a branch checkout changing the dependencies", () => {
        const repo = scratchRepository();
        try {
            const one = repo.commit("package.json", "{}\n");
            const two = repo.commit("bun.lock", "{}\n");
            expect(repo.hook("post-checkout", one, two, "1")).toBe(0);
            expect(repo.installs()).toEqual(["install"]);
        } finally {
            repo.remove();
        }
    });

    it("install on a new worktree's checkout, from the null commit", () => {
        const repo = scratchRepository();
        try {
            const head = repo.commit("README.md", "# Readme\n");
            // SHA-1's null id and SHA-256's.
            for (const length of [40, 64]) {
                const none = "0".repeat(length);
                expect(repo.hookErrors("post-checkout", none, head, "1")).toBe(
                    "",
                );
            }
            expect(repo.installs()).toEqual(["install", "install"]);
        } finally {
            repo.remove();
        }
    });

    it("leave file checkouts and unchanged dependencies alone", () => {
        const repo = scratchRepository();
        try {
            const one = repo.commit("package.json", "{}\n");
            const two = repo.commit("README.md", "# Readme\n");
            const three = repo.commit("bun.lock", "{}\n");
            expect(repo.hook("post-checkout", one, two, "1")).toBe(0);
            expect(repo.hook("post-checkout", one, three, "0")).toBe(0);
            expect(repo.installs()).toEqual([]);
        } finally {
            repo.remove();
        }
    });

    it("reinstall after a merge changing the dependencies", () => {
        const repo = scratchRepository();
        try {
            repo.commit("package.json", "{}\n");
            repo.git("checkout", "-q", "-b", "feature");
            repo.commit("package.json", '{ "name": "x" }\n');
            repo.git("checkout", "-q", "main");
            repo.git("merge", "-q", "feature");
            expect(repo.hook("post-merge", "0")).toBe(0);
            expect(repo.installs()).toEqual(["install"]);
        } finally {
            repo.remove();
        }
    });

    it("reinstall after a squash merge changing the dependencies", () => {
        const repo = scratchRepository();
        try {
            repo.commit("package.json", "{}\n");
            repo.git("checkout", "-q", "-b", "feature");
            repo.commit("package.json", '{ "name": "x" }\n');
            repo.git("checkout", "-q", "main");
            repo.git("merge", "-q", "--squash", "feature");
            expect(repo.git("rev-parse", "ORIG_HEAD")).toBe(
                repo.git("rev-parse", "HEAD"),
            );
            expect(repo.hook("post-merge", "1")).toBe(0);
            expect(repo.installs()).toEqual(["install"]);
        } finally {
            repo.remove();
        }
    });

    it("leave a merge with unchanged dependencies alone", () => {
        const repo = scratchRepository();
        try {
            repo.commit("package.json", "{}\n");
            repo.git("checkout", "-q", "-b", "feature");
            repo.commit("README.md", "# Readme\n");
            repo.git("checkout", "-q", "main");
            repo.git("merge", "-q", "feature");
            expect(repo.hook("post-merge", "0")).toBe(0);
            expect(repo.installs()).toEqual([]);
        } finally {
            repo.remove();
        }
    });
});
