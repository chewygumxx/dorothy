// vim:set expandtab shiftwidth=4 filetype=typescript:
// SPDX-License-Identifier: GPL-3.0-only

//
//
// ~xxdorothy/dorothy.git
// ::: :/pairs.test.ts
//
//

// Each contract beside its file: the Markdown that says what a
// configuration file is for must name what the file holds. A pair that
// disagrees fails here, so neither half drifts alone.

import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = import.meta.dir;
const read = (path: string): string => readFileSync(join(ROOT, path), "utf8");

// The leading code span of each top-level bullet in a Markdown list.
const bulletSpans = (markdown: string): string[] =>
    [...markdown.matchAll(/^- `([^`\n]+)`/gm)].map((match) => match[1] ?? "");

// The keys of a workflow's `jobs`.
const jobs = (workflow: string): string[] =>
    Object.keys(
        (Bun.YAML.parse(workflow) as { jobs: Record<string, unknown> }).jobs,
    );

// The age public keys a text names, sorted.
const recipients = (text: string): string[] =>
    [...text.matchAll(/age1[0-9a-z]+/g)].map((match) => match[0]).sort();

// The recipients sops recorded in an encrypted file: public keys only.
const ageRecipients = (secrets: string): string[] =>
    (JSON.parse(secrets) as { sops: { age: { recipient: string }[] } }).sops.age
        .map((entry) => entry.recipient)
        .sort();

// The commands a shell script runs: its lines, continuations joined, but
// for comments, blanks, `set` and a guard that only exits. Any other line
// starting with `[` is a command. A compound construct is not understood,
// so it throws rather than hides a command.
const GUARD = /^\[ .+ \] (\|\||&&) exit( \d+)?$/;
const COMPOUND = /^(if|then|elif|else|fi|for|while|until|do|done|case|esac)\b/;
const commands = (script: string): string[] =>
    script
        .replaceAll(/\s*\\\n\s*/g, " ")
        .split("\n")
        .map((line) => line.trim())
        .filter((line) => line !== "" && !line.startsWith("#"))
        .filter((line) => line !== "set -e" && !GUARD.test(line))
        .map((line) => {
            if (COMPOUND.test(line)) {
                throw new Error(`Unsupported shell construct: ${line}`);
            }
            return line;
        });

// The leading code span of each numbered step in a Markdown list.
const commandSpans = (markdown: string): string[] =>
    [...markdown.matchAll(/^\d+\. `([^`\n]+)`/gm)].map(
        (match) => match[1] ?? "",
    );

describe("ci.md and ci.yaml", () => {
    const ci_md = read(".github/workflows/ci.md");
    const ci_yaml = read(".github/workflows/ci.yaml");

    it("names ci.yaml's jobs, and only those", () => {
        expect(bulletSpans(ci_md)).toEqual(jobs(ci_yaml));
    });

    it("notices a job the contract does not name", () => {
        const extra = `${ci_yaml}\n    deploy:\n        uses: ./x.yaml\n`;
        expect(jobs(extra)).toEqual([...jobs(ci_yaml), "deploy"]);
        expect(bulletSpans(ci_md)).not.toEqual(jobs(extra));
    });

    it("ignores prose that mentions a job elsewhere", () => {
        const prose = `${ci_md}\nThe \`check\` job is mentioned again.\n`;
        expect(bulletSpans(prose)).toEqual(jobs(ci_yaml));
    });
});

describe(".sops.md and .sops.yaml", () => {
    const sops_md = read(".sops.md");
    const sops_yaml = read(".sops.yaml");
    const secrets_json = read("secrets.json");

    it("names .sops.yaml's recipients, which secrets.json uses", () => {
        expect(recipients(sops_md)).toEqual(recipients(sops_yaml));
        expect(recipients(sops_yaml)).toEqual(ageRecipients(secrets_json));
    });

    it("notices a recipient the contract does not name", () => {
        const other = `${sops_yaml}\n      age: age1${"q".repeat(58)}\n`;
        expect(recipients(sops_md)).not.toEqual(recipients(other));
        const sealed = JSON.stringify({
            sops: { age: [{ recipient: "age1x" }] },
        });
        expect(ageRecipients(sealed)).not.toEqual(recipients(sops_yaml));
    });
});

describe("prepare.md and prepare.sh", () => {
    const prepare_md = read("scripts/prepare.md");
    const prepare_sh = read("scripts/prepare.sh");

    it("names the commands prepare.sh runs, in order", () => {
        expect(commandSpans(prepare_md)).toEqual(commands(prepare_sh));
    });

    it("notices a command the contract does not name", () => {
        const extra = `${prepare_sh}\nbun run build\n`;
        expect(commands(extra)).toEqual([
            ...commands(prepare_sh),
            "bun run build",
        ]);
        expect(commandSpans(prepare_md)).not.toEqual(commands(extra));
    });

    it("notices a guarded command", () => {
        const guarded = `${prepare_sh}\n[ -f x ] && bun foo\n`;
        expect(commands(guarded)).toEqual([
            ...commands(prepare_sh),
            "[ -f x ] && bun foo",
        ]);
        expect(commandSpans(prepare_md)).not.toEqual(commands(guarded));
    });

    it("joins continuations and refuses compound constructs", () => {
        expect(commands("bun a \\\n  --b\n")).toEqual(["bun a --b"]);
        expect(() => commands("if true; then\n bun a\nfi\n")).toThrow();
    });
});
