// vim:set expandtab shiftwidth=4 filetype=typescript:
// SPDX-License-Identifier: GPL-3.0-only

//
//
// ~chewygumxx/dorothy.git
// ::: :/packages/cli/src/hosts/pi/steward/pi-scenario.ts
//
//

// One scenario through the published Pi 1.5.0 with a scripted provider: Pi
// is offered Dorothy's worker tools, the scripted "model" lists the fleet,
// dispatches the fixture task and waits, and between its replies a simulated
// worker commits a fix and writes a report. Each tool call is a real helper
// process running the engine over shell stubs of herdr, the sender and the
// interrupter, so nothing reaches a pane. Pi has no tool that verifies: once
// it exits, the runner takes the coordinator's claim over, runs the owner's
// test on the exact revision and finishes the task. The scripted calls prove
// the tools and the plumbing, not a model's choices.

import { mkdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import {
    type Captured,
    type Chunk,
    CLI_DIR,
    called,
    finish,
    fixtureManifest,
    piRoots,
    reply,
    runPi,
    startFakeProvider,
    usage,
} from "../testing.js";
import type { ScenarioResult } from "./scenarios.js";
import { DEFAULT_CAST, Sim } from "./simulation.js";
import { setAgent, writeStubs } from "./stand-in.js";

const SKILL = join(CLI_DIR, "assets/pi/stewardship/SKILL.md");

const lines = async (path: string) =>
    (await readFile(path, "utf8").catch(() => "")).split("\n").filter(Boolean);

const toolResults = (request: Captured) =>
    (
        (request.body.messages ?? []) as { role?: string; content?: unknown }[]
    ).filter((message) => message.role === "tool");

export async function runPiScenario(): Promise<ScenarioResult> {
    // The helper reads the real clock, so the registry is dated by it.
    const s = await Sim.boot(DEFAULT_CAST, { now: new Date() });
    const roots = await piRoots();
    const stub = join(roots.root, "stub");
    await mkdir(stub, { recursive: true });
    await writeStubs(stub);
    for (const worker of s.fleet.workers) {
        await setAgent(stub, worker, "idle", {
            terminalId: s.terminalOf(worker),
        });
    }
    const { impl } = s.w;
    const id = s.id("pi-fix");
    const brief = await s.brief(id, impl);
    let committed = "";
    const provider = startFakeProvider(async (request) => {
        const answered = toolResults(request).length;
        const call = (name: string, args: unknown): Chunk[] => [
            called(`call-${answered}`, name, args),
            finish("tool_calls"),
            usage,
        ];
        s.note(`scripted provider, step ${answered}`);
        if (answered === 0) {
            return call("workers_list", {});
        }
        if (answered === 1) {
            return call("worker_dispatch", {
                taskId: id,
                workerId: impl.id,
                briefPath: brief.briefPath,
                reportPath: brief.reportPath,
                baseOid: brief.baseOid,
            });
        }
        if (answered === 2) {
            // The worker works and reports while Dorothy waits.
            committed = await s.commit(impl, "complete", id);
            await s.report(id, { revision: committed });
            return call("worker_wait", { taskId: id, timeoutMs: 5000 });
        }
        return reply(
            "The worker reported. It is not done until the owner's receipt.",
        );
    });
    try {
        const manifest = await fixtureManifest(roots, provider.baseUrl, {
            self: [process.execPath, "--no-env-file", join(stub, "standin.ts")],
            steward: { registry: s.registry },
            helperEnv: {
                PATH: roots.env.PATH ?? "",
                HOME: roots.root,
                XDG_STATE_HOME: s.env.XDG_STATE_HOME,
                XDG_RUNTIME_DIR: s.env.XDG_RUNTIME_DIR,
                HERDR_ENV: "1",
                STEWARD_STUB: stub,
            },
        });
        const run = await runPi(roots, manifest.path, [
            "--skill",
            SKILL,
            "-p",
            "Get the slug bug fixed by the implementer.",
        ]);
        s.check("Pi exits cleanly", run.code, 0);

        const helper = (await lines(join(stub, "helper.jsonl"))).map(
            (line) =>
                JSON.parse(line) as {
                    kind: string | null;
                    controller: { pid: number; startedAt: string };
                },
        );
        const kinds = helper.map((h) => h.kind).filter(Boolean);
        const at = (kind: string) => kinds.indexOf(kind);
        s.check(
            "her tools reached the engine: list, a reconcile, one dispatch, a wait",
            [
                kinds.filter((k) => k === "dispatch").length,
                at("list") < at("dispatch"),
                kinds.slice(0, at("dispatch")).includes("reconcile"),
                at("dispatch") < at("wait"),
            ],
            [1, true, true, true],
        );
        const sent = await lines(join(stub, "send.log"));
        s.check(
            "one labelled pointer reached the sender",
            sent.map((line) => line.split("|")),
            [
                [
                    `--from dorothy --expect-pane ${impl.pane} --require-ready --expect-session stub-${impl.id} ${impl.name}`,
                    `Read ${brief.briefPath} for task ${id}.`,
                ],
            ],
        );
        s.check(
            "nothing was interrupted",
            await lines(join(stub, "interrupt.log")),
            [],
        );
        s.check(
            "the ledger holds the report as a claim",
            [s.stateOf(id), s.task(id)?.revision],
            ["reported", committed],
        );

        // Pi has exited: the runner takes the coordinator's claim over.
        const pi = helper.find((h) => h.controller)?.controller;
        if (pi) {
            s.alive.set(s.key(pi), false);
        }
        const done = await s.ownerFinish(id, impl);
        s.check(
            "the owner's receipt verifies it",
            done.reply?.code,
            "TASK_VERIFIED",
        );

        const tasks = s.tasks();
        const duplicates = new Map<string, number>();
        for (const line of sent) {
            const key = /for task (\S+)\./.exec(line)?.[1] ?? "?";
            duplicates.set(key, (duplicates.get(key) ?? 0) + 1);
        }
        return {
            name: "pi-scripted-turn",
            cast: s.cast.label,
            kind: "plumbing",
            decisions: s.decisions,
            checks: s.checks,
            duplicateDispatches: [...duplicates.values()].reduce(
                (n, c) => n + Math.max(0, c - 1),
                0,
            ),
            falseVerifiedTasks: s.falseVerifiedTasks(),
            unresolvedTasks: tasks
                .filter(
                    (t) =>
                        !["verified", "cancelled", "failed"].includes(t.state),
                )
                .map((t) => t.taskId),
            states: Object.fromEntries(tasks.map((t) => [t.taskId, t.state])),
            verified: s.ledger((db) =>
                tasks
                    .filter((t) => t.state === "verified")
                    .map((t) => ({
                        taskId: t.taskId,
                        revision: t.revision ?? "",
                        receiptRevision:
                            db.receipts(t.taskId).find((r) => r.exitCode === 0)
                                ?.revision ?? "",
                    })),
            ),
            sends: sent.length,
            interrupts: 0,
            reviews: [],
        };
    } finally {
        await provider.close();
        await roots.close();
        await s.close();
    }
}
