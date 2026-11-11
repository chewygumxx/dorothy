// vim:set expandtab shiftwidth=4 filetype=typescript:
// SPDX-License-Identifier: GPL-3.0-only

//
//
// ~chewygumxx/dorothy.git
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

// Every inline code span of a Markdown text, in order.
const codeSpans = (markdown: string): string[] =>
    [...markdown.matchAll(/`([^`\n]+)`/g)].map((match) => match[1] ?? "");

// A job is named by a bare lowercase word; commands, events and files
// carry a space, an underscore or a dot.
const isJob = (span: string): boolean => /^[a-z][a-z-]*$/.test(span);

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

// The commands a shell script runs: its lines but for comments, blanks and
// the control lines (`set`, and the guard test).
const commands = (script: string): string[] =>
    script
        .split("\n")
        .map((line) => line.trim())
        .filter(
            (line) =>
                line !== "" &&
                !line.startsWith("#") &&
                !line.startsWith("set ") &&
                !line.startsWith("["),
        );

// The leading code span of each numbered step in a Markdown list.
const commandSpans = (markdown: string): string[] =>
    [...markdown.matchAll(/^\d+\. `([^`\n]+)`/gm)].map(
        (match) => match[1] ?? "",
    );

describe("ci.md and ci.yaml", () => {
    const ci_md = read(".github/workflows/ci.md");
    const ci_yaml = read(".github/workflows/ci.yaml");

    it("names ci.yaml's jobs, and only those", () => {
        expect(codeSpans(ci_md).filter(isJob)).toEqual(jobs(ci_yaml));
    });

    it("notices a job the contract does not name", () => {
        const extra = `${ci_yaml}\n    deploy:\n        uses: ./x.yaml\n`;
        expect(jobs(extra)).toEqual([...jobs(ci_yaml), "deploy"]);
        expect(codeSpans(ci_md).filter(isJob)).not.toEqual(jobs(extra));
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
});
