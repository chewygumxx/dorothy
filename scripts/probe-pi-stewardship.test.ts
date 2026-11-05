// vim:set expandtab shiftwidth=4 filetype=typescript:
// SPDX-License-Identifier: GPL-3.0-only

//
//
// ~chewygumxx/dorothy.git
// ::: :/scripts/probe-pi-stewardship.test.ts
//
//

// The offline probe as a process: its arguments, its result files, and
// that it touches nothing of the user's. The user's roots here are
// sentinels, empty directories the probe must leave empty.

import { afterAll, describe, expect, it } from "bun:test";
import { mkdirSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type ProbeResult, parseProbeArgs } from "./probe-pi-stewardship.js";

const roots: string[] = [];
const scratch = () => {
    const root = mkdtempSync(join(tmpdir(), "dorothy-probe-test-"));
    roots.push(root);
    return root;
};
afterAll(() => {
    for (const root of roots) {
        rmSync(root, { recursive: true, force: true });
    }
});

describe("the arguments", () => {
    it("take offline, live and release modes, with their own limits", () => {
        expect(parseProbeArgs(["--offline", "--out", "x"])).toEqual({
            mode: "offline",
            out: join(process.cwd(), "x"),
        });
        expect(
            parseProbeArgs([
                "--live",
                "--registry",
                "r",
                "--out",
                "x",
                "--max-usd",
                "5",
                "--max-turns",
                "6",
                "--timeout-ms",
                "120000",
            ]),
        ).toEqual({
            mode: "live",
            registry: join(process.cwd(), "r"),
            out: join(process.cwd(), "x"),
            maxUsd: 5,
            maxTurns: 6,
            timeoutMs: 120000,
        });
        expect(
            parseProbeArgs(["--release", "fix-1", "--registry", "r"]),
        ).toEqual({
            mode: "release",
            registry: join(process.cwd(), "r"),
            taskId: "fix-1",
            reason: "the user released it from the probe",
        });
        for (const argv of [
            [],
            ["--offline"],
            ["--out", "x"],
            ["--offline", "--out"],
            ["--offline", "--out", "x", "--extra"],
            ["--live", "--out", "x"],
            ["--live", "--registry", "r", "--out", "x"],
            ["--release", "fix-1"],
        ]) {
            expect(typeof parseProbeArgs(argv)).toBe("string");
        }
    });
});

describe("the offline run", () => {
    it("passes with zero duplicates and false verifications, touching no user root", async () => {
        const user = scratch();
        const out = join(scratch(), "out");
        const sentinels = [
            "home",
            "config",
            "data",
            "state",
            "cache",
            "run",
            "tmp",
        ];
        const env: Record<string, string> = {
            PATH: process.env.PATH ?? "",
            HOME: join(user, "home"),
            XDG_CONFIG_HOME: join(user, "config"),
            XDG_DATA_HOME: join(user, "data"),
            XDG_STATE_HOME: join(user, "state"),
            XDG_CACHE_HOME: join(user, "cache"),
            XDG_RUNTIME_DIR: join(user, "run"),
            TMPDIR: join(user, "tmp"),
            // A real-looking credential the run must never use or print.
            FEATHERLESS_API_KEY: "synthetic-must-not-leak-0123456789",
        };
        for (const name of sentinels) {
            Bun.spawnSync(["mkdir", "-p", join(user, name)]);
        }
        const child = Bun.spawnSync(
            [
                process.execPath,
                "--no-env-file",
                join(import.meta.dir, "probe-pi-stewardship.ts"),
                "--offline",
                "--out",
                out,
            ],
            { env, stdout: "pipe", stderr: "pipe" },
        );
        const stdout = child.stdout.toString();
        expect(child.stderr.toString()).toBe("");
        expect(child.exitCode).toBe(0);
        expect(stdout).toContain("pass");

        const result = JSON.parse(
            await readFile(join(out, "result.json"), "utf8"),
        ) as ProbeResult;
        expect(result.outcome).toBe("pass");
        expect(result.kind).toBe("plumbing");
        expect(result.note).toContain("scripted");
        expect(result.totals.duplicateDispatches).toBe(0);
        expect(result.totals.falseVerifiedTasks).toEqual([]);
        expect(result.totals.failedChecks).toEqual([]);
        // Irresolvable fixtures end pending, never dropped or called done.
        expect(result.totals.unresolvedTasks).toEqual(
            expect.arrayContaining([
                "coordinator-crash/trial-uncertain",
                "coordinator-crash/x7q-uncertain",
                "claimed-revision/trial-invented",
            ]),
        );
        // Per review: the verdict beside the owner's receipt. One wrong
        // approval per cast (a disagreement), the rest agreeing.
        expect(result.totals.reviews).toEqual({
            total: 6,
            agree: 4,
            disagree: 2,
            undecided: 0,
        });
        expect(await readFile(join(out, "report.md"), "utf8")).toContain(
            "| Cast | Scenario | Review | Verdict | Owner passed | Agree |",
        );
        expect(result.casts.map((c) => c.cast)).toEqual([
            "default",
            "held-out",
        ]);
        const decisions = [
            ...result.casts.flatMap((c) => c.scenarios),
            result.pi,
        ].flatMap((r) => r.decisions);
        expect(decisions.length).toBeGreaterThan(50);
        expect(decisions.every((d) => d.scripted)).toBe(true);

        const text = stdout + (await readFile(join(out, "report.md"), "utf8"));
        expect(text + JSON.stringify(result)).not.toContain("must-not-leak");
        // The user's roots are as they were: empty, but for Bun's own
        // transpiler cache, which the runtime makes before the probe runs.
        for (const name of sentinels) {
            expect(
                readdirSync(join(user, name)).filter(
                    (entry) => !(name === "cache" && entry === "bun"),
                ),
            ).toEqual([]);
        }
    }, 300_000);

    it("wires live to a pending gate when the worker homes are absent", async () => {
        const root = scratch();
        const trial = join(root, "trial");
        mkdirSync(trial, { recursive: true, mode: 0o700 });
        const out = join(root, "out");
        const child = Bun.spawnSync(
            [
                process.execPath,
                "--no-env-file",
                join(import.meta.dir, "probe-pi-stewardship.ts"),
                "--live",
                "--registry",
                join(trial, "registry.json"),
                "--out",
                out,
                "--max-usd",
                "1",
            ],
            {
                env: {
                    PATH: process.env.PATH ?? "",
                    HOME: join(root, "home"),
                    HERDR_ENV: "1",
                    XDG_STATE_HOME: join(root, "state"),
                },
                stdout: "pipe",
                stderr: "pipe",
            },
        );
        expect(child.exitCode).toBe(2);
        expect(child.stderr.toString()).toBe("");
        expect(child.stdout.toString()).toContain("pending");
        const result = JSON.parse(
            await readFile(join(out, "result.json"), "utf8"),
        );
        expect(result.status).toBe("pending");
        expect(result.pending.join("\n")).toContain("CODEX_HOME=");
        // The evidence left behind carries placeholders, not the trial path.
        const kept = await Promise.all(
            ["result.json", "events.jsonl", "report.md"].map((name) =>
                readFile(join(out, name), "utf8"),
            ),
        );
        expect(kept.join("\n")).not.toContain(trial);
        expect(kept.join("\n")).not.toContain(out);
    });

    it("refuses live without its registry and spending limit", () => {
        const child = Bun.spawnSync(
            [
                process.execPath,
                "--no-env-file",
                join(import.meta.dir, "probe-pi-stewardship.ts"),
                "--live",
                "--out",
                scratch(),
            ],
            { stdout: "pipe", stderr: "pipe" },
        );
        expect(child.exitCode).toBe(2);
        expect(child.stderr.toString()).toContain("--live needs --registry");
    });
});
