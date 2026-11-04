// vim:set expandtab shiftwidth=4 filetype=typescript:
// SPDX-License-Identifier: GPL-3.0-only

//
//
// ~chewygumxx/dorothy.git
// ::: :/scripts/probe-pi-stewardship.ts
//
//

// The stewardship probe, offline part:
//
//   bun scripts/probe-pi-stewardship.ts --offline --out <dir>
//
// Runs every stewardship scenario with simulated workers (a fake herdr,
// sender and interrupter; no pane is created or written to), under the
// default cast and a held-out one with every worker, pane, terminal and
// task id renamed and the registry, reports and scenarios reordered, then
// one scenario through the published Pi 1.5.0 with a scripted provider on
// loopback. The owner's runner verifies each submission from the worker's
// clone, on an export of the revision it computed itself, outside every
// clone; only its receipt verifies a task.
//
// Everything runs in a temporary root, with that root as HOME, every XDG
// directory and TMPDIR, and only synthetic credentials: the real user's
// directories, `~/.pi` and `secrets.json` are never read. The model is
// scripted, so a pass proves the plumbing and the ledger, never a model's
// competence; each call it makes is recorded as a scripted decision. The
// result goes to <dir>/result.json and <dir>/report.md. Its own test runs
// it once as a process.
//
// This script imports the CLI's sources by relative path, as
// probe-pi-delivery.ts does, a documented exception to the package
// boundary for probes.

import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { runPiScenario } from "../packages/cli/src/hosts/pi/steward/pi-scenario.js";
import {
    runSuite,
    type ScenarioResult,
    summaryOf,
    type Totals,
    totalsOf,
} from "../packages/cli/src/hosts/pi/steward/scenarios.js";
import {
    DEFAULT_CAST,
    HELD_OUT_CAST,
} from "../packages/cli/src/hosts/pi/steward/simulation.js";

export type ProbeArgs = { mode: "offline"; out: string };

const USAGE = "usage: probe-pi-stewardship.ts --offline --out <dir>";

// The probe's arguments, or what is wrong with them.
export function parseProbeArgs(argv: readonly string[]): ProbeArgs | string {
    let offline = false;
    let out: string | null = null;
    for (let i = 0; i < argv.length; i++) {
        const word = argv[i];
        if (word === "--offline") {
            offline = true;
        } else if (word === "--out" && argv[i + 1] !== undefined) {
            out = resolve(argv[++i] as string);
        } else if (word === "--live") {
            return `${USAGE}\n--live is not available yet`;
        } else {
            return `${USAGE}\nunknown argument ${word}`;
        }
    }
    return offline && out !== null ? { mode: "offline", out } : USAGE;
}

export type ProbeResult = {
    mode: "offline";
    // Every decision was scripted: this measures plumbing, not a model.
    kind: "plumbing";
    note: string;
    outcome: "pass" | "fail";
    casts: { cast: string; scenarios: ScenarioResult[]; totals: Totals }[];
    pi: ScenarioResult;
    totals: Totals;
};

const NOTE =
    "The coordinator's decisions are scripted: this run shows the plumbing, " +
    "the ledger and the owner's verification hold, not that a model " +
    "chooses well.";

// The environment variables of the user's own that could name a real root
// or carry a credential; the probe holds none of them.
const SCRUBBED = [
    "XDG_CONFIG_HOME",
    "XDG_DATA_HOME",
    "XDG_STATE_HOME",
    "XDG_CACHE_HOME",
    "XDG_RUNTIME_DIR",
    "PI_CODING_AGENT_DIR",
    "SOPS_AGE_KEY_FILE",
    "DOROTHY_MEMORY_URL",
    "DOROTHY_PI_MANIFEST",
    "FEATHERLESS_API_KEY",
    "ANTHROPIC_API_KEY",
    "OPENAI_API_KEY",
];

export async function probe(): Promise<ProbeResult> {
    const work = await mkdtemp(join(tmpdir(), "dorothy-probe-stewardship-"));
    const keep = new Map(
        [...SCRUBBED, "HOME", "TMPDIR"].map((name) => [
            name,
            process.env[name],
        ]),
    );
    for (const name of SCRUBBED) {
        delete process.env[name];
    }
    process.env.HOME = join(work, "home");
    process.env.XDG_CONFIG_HOME = join(work, "config");
    process.env.XDG_DATA_HOME = join(work, "data");
    process.env.XDG_STATE_HOME = join(work, "state");
    process.env.XDG_CACHE_HOME = join(work, "cache");
    process.env.TMPDIR = join(work, "tmp");
    await mkdir(process.env.TMPDIR, { recursive: true, mode: 0o700 });
    try {
        const casts = [];
        for (const cast of [DEFAULT_CAST, HELD_OUT_CAST]) {
            const scenarios = await runSuite(cast);
            casts.push({
                cast: cast.label,
                scenarios,
                totals: totalsOf(scenarios),
            });
        }
        const pi = await runPiScenario();
        const all = [...casts.flatMap((c) => c.scenarios), pi];
        const totals = totalsOf(all);
        const pass =
            totals.failedChecks.length === 0 &&
            totals.duplicateDispatches === 0 &&
            totals.falseVerifiedTasks.length === 0;
        return {
            mode: "offline",
            kind: "plumbing",
            note: NOTE,
            outcome: pass ? "pass" : "fail",
            casts,
            pi,
            totals,
        };
    } finally {
        for (const [name, value] of keep) {
            if (value === undefined) {
                delete process.env[name];
            } else {
                process.env[name] = value;
            }
        }
        await rm(work, { recursive: true, force: true });
    }
}

export function markdown(result: ProbeResult): string {
    const lines = [
        "# Stewardship probe, offline",
        "",
        result.note,
        "",
        `Outcome: ${result.outcome}. ${result.totals.scenarios} scenario ` +
            `runs, ${result.totals.checks} checks, ` +
            `${result.totals.failedChecks.length} failed, ` +
            `${result.totals.duplicateDispatches} duplicate dispatches, ` +
            `${result.totals.falseVerifiedTasks.length} false verified tasks.`,
        "",
        "| Cast | Scenario | Checks | Failed | Duplicates | False verified | Pending or unknown |",
        "| ---- | -------- | ------ | ------ | ---------- | -------------- | ------------------ |",
    ];
    const row = (r: ScenarioResult) =>
        `| ${r.cast} | ${r.name} | ${r.checks.length} | ` +
        `${r.checks.filter((c) => !c.ok).length} | ${r.duplicateDispatches} | ` +
        `${r.falseVerifiedTasks.length} | ` +
        `${r.unresolvedTasks.map((t) => `${t} (${r.states[t]})`).join(", ") || "none"} |`;
    for (const cast of result.casts) {
        lines.push(...cast.scenarios.map(row));
    }
    lines.push(row(result.pi), "");
    const reviews = [...result.casts.flatMap((c) => c.scenarios)].flatMap((r) =>
        r.reviews.map((m) => ({ ...m, cast: r.cast, scenario: r.name })),
    );
    lines.push(
        "Reviews: the ledger ends a right rejection and a wrong approval " +
            "`failed` alike, so each review's verdict (its report's claim) " +
            "is shown beside the owner's receipt on the reviewed revision. " +
            `${result.totals.reviews.agree} agree, ` +
            `${result.totals.reviews.disagree} disagree, ` +
            `${result.totals.reviews.undecided} undecided.`,
        "",
        "| Cast | Scenario | Review | Verdict | Owner passed | Agree |",
        "| ---- | -------- | ------ | ------- | ------------ | ----- |",
        ...reviews.map(
            (m) =>
                `| ${m.cast} | ${m.scenario} | ${m.taskId} | ${m.verdict} | ` +
                `${m.ownerPassed ?? "none"} | ${m.agree ?? "undecided"} |`,
        ),
        "",
        "Scenarios:",
        "",
    );
    for (const r of result.casts[0]?.scenarios ?? []) {
        lines.push(`- \`${r.name}\`: ${summaryOf(r.name)}`);
    }
    lines.push(
        "- `pi-scripted-turn`: Pi 1.5.0 with a scripted provider lists, " +
            "dispatches and waits; only the owner's receipt verifies.",
        "",
    );
    if (result.totals.failedChecks.length > 0) {
        lines.push("Failed checks:", "");
        lines.push(...result.totals.failedChecks.map((c) => `- ${c}`), "");
    }
    return lines.join("\n");
}

if (import.meta.main) {
    const args = parseProbeArgs(process.argv.slice(2));
    if (typeof args === "string") {
        process.stderr.write(`${args}\n`);
        process.exit(2);
    }
    await mkdir(args.out, { recursive: true, mode: 0o700 });
    const result = await probe();
    await writeFile(
        join(args.out, "result.json"),
        `${JSON.stringify(result, null, 2)}\n`,
    );
    await writeFile(join(args.out, "report.md"), markdown(result));
    const t = result.totals;
    process.stdout.write(
        `probe ${result.mode} (${result.kind}): ${result.outcome}, ` +
            `${t.scenarios} scenario runs, ${t.checks} checks, ` +
            `${t.failedChecks.length} failed, ` +
            `${t.duplicateDispatches} duplicate dispatches, ` +
            `${t.falseVerifiedTasks.length} false verified, ` +
            `${t.unresolvedTasks.length} pending or unknown, ` +
            `${t.reviews.agree}/${t.reviews.total} reviews agree with the ` +
            `owner; ${args.out}\n`,
    );
    process.exit(result.outcome === "pass" ? 0 : 1);
}
