// vim:set expandtab shiftwidth=4 filetype=typescript:
// SPDX-License-Identifier: GPL-3.0-only

//
//
// ~chewygumxx/dorothy.git
// ::: :/scripts/pi-stewardship-trial.ts
//
//

// The live stewardship trial's runner, which `probe-pi-stewardship.ts
// --live` drives with real herdr, workers, Pi and Featherless, and its
// tests drive with fakes:
//
// - Before anything starts it checks the trial directory (the registry's,
//   private), the two worker homes the user signed in themselves (Codex's
//   `CODEX_HOME`, Claude's `CLAUDE_CONFIG_DIR`: never a copy of their own
//   credentials, which the runner never reads), the caps and the budget.
//   Anything missing leaves the gate pending, with the user's checklist.
// - It makes the fixture (origin, one clone per worker, private immutable
//   briefs, report slots) and the owner's kit outside it, then one herdr
//   workspace of its own: Pi's pane and a pane per worker, each home given
//   as a path. Every id comes from herdr's creation replies, and the
//   registry it writes (with an explicit expiry) names only those panes.
// - Pi's native interface runs in the trial pane through the delivery
//   launcher, its requests through the shared forwarding proxy, which
//   holds the upstream key, reserves each call's worst cost and stops on
//   the turn cap, the wall time, the budget or a reply without usage.
// - While Pi coordinates, the runner verifies each report from its
//   worker's clone (`verifySubmission`, the only receipt writer), finishes
//   the task, interrupts one worker once (quits it and starts it again),
//   releases the task it stranded (a logged operator release, never a
//   model tool), compacts Pi with work in flight and tells her to resume.
// - At the end it keeps the evidence (events, ledger, screens, Pi's
//   sessions, reports), all sanitized, then closes only the panes it made.
//
// A receipt is evidence against a worker's report, not against hostile
// code running as the runner's user: the workers run as the user, with no
// OS confinement. This module never runs live in a test.

import { createHash, randomUUID } from "node:crypto";
import {
    appendFile,
    chmod,
    lstat,
    mkdir,
    readdir,
    readFile,
    realpath,
    writeFile,
} from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { scrub } from "@dorothy/cli/scrub";
import { readPiCatalog } from "../packages/cli/src/hosts/pi/models.js";
import { runSteward } from "../packages/cli/src/hosts/pi/steward/engine.js";
import {
    type HerdrRun,
    observeWorker,
} from "../packages/cli/src/hosts/pi/steward/herdr.js";
import {
    type Identity,
    type Ledger,
    ledgerPath,
    openLedger,
    type StoredTask,
} from "../packages/cli/src/hosts/pi/steward/ledger.js";
import {
    cloneOrigin,
    createOrigin,
    createOwnerKit,
    headOf,
    measureReview,
    type OwnerEnv,
    type OwnerKit,
    type ReviewMeasure,
    runExamples,
    verifySubmission,
} from "../packages/cli/src/hosts/pi/steward/owner.js";
import { readFleet } from "../packages/cli/src/hosts/pi/steward/registry.js";
import type {
    Harness,
    Occupant,
    Role,
    StewardReply,
    StewardRequest,
    TaskState,
    Worker,
} from "../packages/cli/src/hosts/pi/steward/types.js";
import { CLI_DIR, MODEL } from "../packages/cli/src/hosts/pi/testing.js";
import {
    type ForwardingProxy,
    type Metadata,
    metadataProblem,
    type ProxyOptions,
} from "./pi-proxy.js";

type Env = Record<string, string | undefined>;
type Reply = { code: number; stdout: string; stderr: string };

// The caps the plan sets: a turn is a model request through the proxy.
export const TRIAL_TURN_CAP = 30;
export const TRIAL_TIME_CAP_MS = 1_800_000;
// The registry's expiry, past the longest trial and within the hour
// `readFleet` allows.
export const REGISTRY_EXPIRY_MS = 55 * 60_000;
const NATIVE_LAUNCH = join(CLI_DIR, "src", "hosts", "pi", "native-launch.ts");
// This checkout's `dorothy`, as an install names it: the launcher's
// helpers (memory's MCP bridge and Pi's hooks), never the probe.
const SELF = [
    process.execPath,
    "--no-env-file",
    join(CLI_DIR, "src", "index.ts"),
];
const FINAL: readonly TaskState[] = ["verified", "cancelled", "failed"];
// Paths go into herdr's argv and a shell line: nothing to quote.
const PLAIN_PATH = /^\/[A-Za-z0-9._/-]+$/;

export type WorkerSpec = {
    id: string;
    harness: Harness;
    role: Role;
    homeVar: string;
    account: string;
    login: string;
    status: string;
};

// The two dedicated workers, each in a home the user signs in.
export const WORKERS: readonly WorkerSpec[] = [
    {
        id: "trial-codex",
        harness: "codex",
        role: "implementer",
        homeVar: "CODEX_HOME",
        account: "codex-trial-home",
        login: "codex login",
        status: "codex login status",
    },
    {
        id: "trial-claude",
        harness: "claude",
        role: "reviewer",
        homeVar: "CLAUDE_CONFIG_DIR",
        account: "claude-trial-home",
        login: "claude auth login",
        status: "claude auth status --text",
    },
];

export type TrialArgs = {
    registry: string;
    out: string;
    maxUsd: number;
    maxTurns: number;
    timeoutMs: number;
};

export type LoginStatus = { loggedIn: boolean; detail: string };

export type TrialDeps = {
    // The runner's own environment: PATH, HOME and herdr's variables.
    env: Env;
    now: () => Date;
    sleep: (ms: number) => Promise<void>;
    platform: string;
    uid: number;
    herdr: HerdrRun;
    // The one credential-free control environment for live Herdr, home
    // inspection and locked writes. Runtime is trial-owned and shared
    // with Pi's helper, so both sides take the same pane lock.
    controlEnv: (runtimeDir: string) => Env;
    // Ctrl+C under the pane lock, after revalidating this exact occupant.
    interruptWorker: (
        worker: Worker,
        pin: { terminalId: string; occupant: Occupant },
        timeoutMs: number,
        deadlineAt: number | undefined,
        control: Env,
    ) => Promise<Reply>;
    // A home's login, by the harness's own status command; never a read
    // of its credential.
    loginStatus: (
        harness: Harness,
        home: string,
        timeoutMs?: number,
    ) => Promise<LoginStatus>;
    // Runtime/executable checks, before a key or pane is touched.
    preflightAssets?: (timeoutMs?: number) => Promise<string[]>;
    // Verify the launched foreground process's home and cwd without
    // logging its environment or reading a credential file.
    workerHomeMatches: (
        harness: Harness,
        home: string,
        cwd: string,
        pane: string,
        timeoutMs: number,
        control: Env,
    ) => Promise<boolean>;
    nativePiIdentity?: (
        path: string,
    ) => Promise<TrialResult["nativeIdentity"] | null>;
    startProxy: (options: ProxyOptions) => ForwardingProxy;
    // Live, Featherless and the key from secrets.json, held in memory.
    upstream: () => Promise<{ url: string; key: string }>;
    metadata: (timeoutMs?: number) => Promise<Metadata | null>;
    memory: (
        root: string,
        env: Env,
    ) => Promise<{ url: string; stop(): Promise<void> }>;
    versions: (timeoutMs?: number) => Promise<Record<string, string>>;
    alive: (pid: number, startedAt: string) => Promise<boolean>;
    occupantStart: (pid: number) => Promise<string>;
    self: Identity;
    pollMs?: number;
    // How long a fix runs before its worker is interrupted, how long the
    // stranded task waits before its release, and how long work may be in
    // flight with Pi busy before she is compacted anyway.
    interruptAfterMs?: number;
    releaseAfterMs?: number;
    compactBusyAfterMs?: number;
};

export type TrialLayout = {
    trial: string;
    registry: string;
    out: string;
    homes: Record<Harness, string>;
    fixture: string;
    briefs: string;
    reports: string;
    clones: Record<Harness, string>;
    owner: string;
    origin: string;
    pi: string;
    run: string;
    checkpoints: string;
    interventions: string;
    state: string;
    coordinator: string;
};

// Where everything of a trial lives: beside its registry.
export function layoutOf(registry: string, out: string): TrialLayout {
    const trial = dirname(registry);
    const fixture = join(trial, "fixture");
    return {
        trial,
        registry,
        out,
        homes: {
            codex: join(trial, "homes", "codex"),
            claude: join(trial, "homes", "claude"),
        },
        fixture,
        briefs: join(fixture, "briefs"),
        reports: join(fixture, "reports"),
        clones: {
            codex: join(fixture, "trial-codex"),
            claude: join(fixture, "trial-claude"),
        },
        owner: join(trial, "owner"),
        origin: join(trial, "origin"),
        pi: join(trial, "pi"),
        run: join(trial, "run"),
        checkpoints: join(trial, "run", "checkpoints"),
        interventions: join(trial, "interventions.jsonl"),
        state: join(trial, "trial.json"),
        coordinator: join(fixture, "reports", "coordinator.md"),
    };
}

// What a trial makes in its directory: absent before it starts.
const MADE = [
    "registry.json",
    "trial.json",
    "interventions.jsonl",
    "fixture",
    "owner",
    "origin",
    "pi",
    "run",
] as const;

const inside = (dir: string, path: string) => {
    const rel = relative(dir, path);
    return rel === "" || (!rel.startsWith("..") && !rel.startsWith(sep));
};

const sha256 = (data: string | Uint8Array) =>
    `sha256:${createHash("sha256").update(data).digest("hex")}`;
const shellQuote = (text: string) => `'${text.replaceAll("'", `'"'"'`)}'`;

// The user's checklist for the live gate, exactly as printed.
export function checklist(layout: TrialLayout): string[] {
    const { trial, homes, registry } = layout;
    return [
        "The live gate waits on you. Before --live can start:",
        `1. Make the trial directory and the homes private: mkdir -p -m 700 ${homes.codex} ${homes.claude} && chmod 700 ${trial} ${trial}/homes`,
        `2. Sign the trial's Codex account in, in its own home (never copy ~/.codex): CODEX_HOME=${homes.codex} codex login, then check: CODEX_HOME=${homes.codex} codex login status`,
        `3. Sign the trial's Claude account in, in its own home (never copy ~/.claude): CLAUDE_CONFIG_DIR=${homes.claude} claude auth login, then check: CLAUDE_CONFIG_DIR=${homes.claude} claude auth status --text`,
        "4. Look at each account's quota in its own interface (Codex /status, Claude /usage); run only when both have room. Open-weight spending is authorized, but the controller still chooses an explicit numeric cap for this run.",
        `5. Write no registry: the runner writes ${registry} itself from creation replies, including observedAt/expiresAt, and freezes its bytes, fleet id and fixture root. The engine pins each validated session or Linux foreground process/start identity, not merely terminal_id.`,
        "6. Stay near: a worker's first-run or trust dialog is yours to answer in its pane; the runner waits and records it as your intervention. It restores and verifies each private worker home after shell startup and starts Codex with --no-daemon.",
        "7. Required locally: flock, herdr, both worker CLIs, git, tar and the pinned Pi/Node runtime. The selected config needs a Featherless chat route; do not change normal defaults or bypass mise trust.",
        `8. From a herdr pane, with Featherless's key in secrets.json, run: bun scripts/probe-pi-stewardship.ts --live --registry ${registry} --out <a new directory outside ${trial}> --max-usd <number> --max-turns 30 --timeout-ms 1800000`,
    ];
}

async function privacyOf(path: string, uid: number): Promise<string | null> {
    const seen = await lstat(path).catch(() => null);
    if (!seen) return "missing";
    if (seen.isSymbolicLink()) return "a link, not a directory";
    if (!seen.isDirectory()) return "not a directory";
    if (seen.uid !== uid) return "not yours";
    if ((seen.mode & 0o077) !== 0)
        return `not private (mode ${(seen.mode & 0o777).toString(8)}): chmod 700 it`;
    return null;
}

export type Account = {
    worker: string;
    harness: Harness;
    label: string;
    home: string;
    login: string;
};

export type Preflight =
    | {
          ok: true;
          layout: TrialLayout;
          accounts: Account[];
          outputRejected: false;
      }
    | {
          ok: false;
          layout: TrialLayout;
          problems: string[];
          outputRejected: boolean;
      };

// Refuse path aliases before creating or writing anything. Every ancestor
// must already exist as a real directory; --out itself must still be absent.
async function nonlinkDirectory(path: string): Promise<string | null> {
    let current = resolve(path);
    for (;;) {
        const seen = await lstat(current).catch((error: Error) => error);
        if (seen instanceof Error) return `${current} cannot be inspected`;
        if (seen.isSymbolicLink()) return `${current} is a symbolic link`;
        if (!seen.isDirectory()) return `${current} is not a directory`;
        const parent = dirname(current);
        if (parent === current) return null;
        current = parent;
    }
}

// Everything checked before anything is made, spent or started.
export async function preflight(
    args: TrialArgs,
    deps: TrialDeps,
    deadlineAt = deps.now().getTime() + args.timeoutMs,
): Promise<Preflight> {
    const layout = layoutOf(resolve(args.registry), resolve(args.out));
    const problems: string[] = [];
    if (deps.platform !== "linux")
        problems.push(`the trial runs on Linux alone, not ${deps.platform}`);
    if (!Number.isFinite(args.maxUsd) || args.maxUsd <= 0)
        problems.push(
            "--max-usd must name a budget above zero: no spending limit is assumed",
        );
    if (
        !Number.isInteger(args.maxTurns) ||
        args.maxTurns < 1 ||
        args.maxTurns > TRIAL_TURN_CAP
    )
        problems.push(`--max-turns must be 1 to ${TRIAL_TURN_CAP}`);
    if (
        !Number.isFinite(args.timeoutMs) ||
        args.timeoutMs <= 0 ||
        args.timeoutMs > TRIAL_TIME_CAP_MS
    )
        problems.push(`--timeout-ms must be 1 to ${TRIAL_TIME_CAP_MS}`);
    if (deps.env.HERDR_ENV !== "1")
        problems.push("run it from a herdr pane: HERDR_ENV is not 1");
    if (!deps.env.HERDR_SOCKET_PATH)
        problems.push(
            "HERDR_SOCKET_PATH is not declared: the trial never guesses another server",
        );
    else if (!isAbsolute(deps.env.HERDR_SOCKET_PATH))
        problems.push("HERDR_SOCKET_PATH must be absolute");
    const { trial, out } = layout;
    if (!PLAIN_PATH.test(trial))
        problems.push(
            `the trial directory's path must be plain (letters, digits, . _ - /): ${trial}`,
        );
    const privacy = await privacyOf(trial, deps.uid);
    if (privacy) problems.push(`the trial directory ${trial} is ${privacy}`);
    const trialAncestors = await nonlinkDirectory(trial);
    if (trialAncestors) problems.push(`invalid trial path: ${trialAncestors}`);
    let outputRejected = false;
    if (await lstat(out).catch(() => null)) {
        outputRejected = true;
        problems.push(
            `--out ${out} already exists: choose an absent path, not a reused file or directory`,
        );
    } else {
        const outAncestors = await nonlinkDirectory(dirname(out));
        if (outAncestors) {
            outputRejected = true;
            problems.push(`invalid --out path: ${outAncestors}`);
        }
    }
    if (inside(trial, out) || inside(out, trial))
        problems.push(
            `--out ${out} must be apart from ${trial}, which holds the worker homes`,
        );
    const leftovers = new Set([
        ...MADE.map((name) => join(trial, name)),
        layout.registry,
    ]);
    for (const path of leftovers) {
        if (await lstat(path).catch(() => null))
            problems.push(
                `${path} is left from an earlier trial: remove it (keep homes/)`,
            );
    }
    const accounts: Account[] = [];
    for (const spec of WORKERS) {
        const home = layout.homes[spec.harness];
        const bad = await privacyOf(home, deps.uid);
        if (bad) {
            problems.push(`the ${spec.harness} home ${home} is ${bad}`);
            continue;
        }
        const own = join(deps.env.HOME ?? "/", `.${spec.harness}`);
        if ((await realpath(home)) === (await realpath(own).catch(() => own)))
            problems.push(
                `${home} is your own ${spec.harness} home: sign a new one in`,
            );
        const status = await deps
            .loginStatus(
                spec.harness,
                home,
                Math.max(1, deadlineAt - deps.now().getTime()),
            )
            .catch(
                (error: Error): LoginStatus => ({
                    loggedIn: false,
                    detail: error.message,
                }),
            );
        if (!status.loggedIn)
            problems.push(
                `${spec.harness} is not signed in at ${home}: ${status.detail}`,
            );
        accounts.push({
            worker: spec.id,
            harness: spec.harness,
            label: spec.account,
            home,
            login: status.detail,
        });
    }
    const assets = await deps
        .preflightAssets?.(Math.max(1, deadlineAt - deps.now().getTime()))
        .catch((error: Error) => [error.message]);
    problems.push(...(assets ?? []));
    return problems.length > 0
        ? { ok: false, layout, problems, outputRejected }
        : { ok: true, layout, accounts, outputRejected: false };
}

export type Intervention = {
    at: string;
    // The runner's own deliberate acts, the user's, or a change nobody in
    // the trial made (a dialog cleared in a worker's pane).
    by: "runner" | "user" | "unknown";
    kind: string;
    taskId?: string;
    worker?: string;
    detail: string;
};

export type ReleaseResult = {
    code:
        | "TASK_RELEASED"
        | "RELEASE_NOT_OWNED"
        | "RELEASE_NO_TASK"
        | "RELEASE_FINAL"
        | "RELEASE_OPERATION_PENDING"
        | "RELEASE_RACED"
        | "RELEASE_NO_STATE"
        | "RELEASE_STATE_INVALID";
    from?: TaskState;
};

// The operator's release of a task the trial owns (one of its briefs),
// stranded where no report, receipt or cancel can free it: a vanished or
// replaced worker, an `unknown` send, a `Status: failed` with no
// revision. It fails the task (`OPERATOR_RELEASED`), which frees the
// worker, and logs who released it and why. Never a model's tool: the
// runner calls it for the worker it interrupted, the user through
// `probe-pi-stewardship.ts --release`.
export async function operatorRelease(options: {
    env: Env;
    fleetId: string;
    owned: readonly string[];
    taskId: string;
    reason: string;
    by: "runner" | "user";
    log: string;
    now: () => Date;
}): Promise<ReleaseResult> {
    if (!options.owned.includes(options.taskId))
        return { code: "RELEASE_NOT_OWNED" };
    const ledger = openLedger(
        ledgerPath(options.env, options.fleetId),
        options.fleetId,
        options.now,
    );
    try {
        const task = ledger.task(options.taskId);
        if (!task) return { code: "RELEASE_NO_TASK" };
        if (FINAL.includes(task.state))
            return { code: "RELEASE_FINAL", from: task.state };
        if (ledger.pending().some((op) => op.taskId === task.taskId))
            return { code: "RELEASE_OPERATION_PENDING", from: task.state };
        if (
            !ledger.move(task.taskId, [task.state], "failed", {
                code: "OPERATOR_RELEASED",
            })
        )
            return { code: "RELEASE_RACED", from: task.state };
        const entry: Intervention & { from: TaskState } = {
            at: options.now().toISOString(),
            by: options.by,
            kind: "operator-release",
            taskId: task.taskId,
            worker: task.workerId,
            from: task.state,
            detail: options.reason,
        };
        await appendFile(options.log, `${JSON.stringify(entry)}\n`, {
            mode: 0o600,
        });
        return { code: "TASK_RELEASED", from: task.state };
    } finally {
        ledger.close();
    }
}

type Brief = {
    taskId: string;
    kind: "fix" | "review";
    worker: string;
    harness: Harness;
    path: string;
    report: string;
    digest: string;
    // Trial-only fault injection: the owner releases this file after the
    // required lifecycle event. Null for reviews and the full final fix.
    checkpoint: string | null;
};

export type Check = { id: string; ok: boolean | null; detail: string };

export type TaskOutcome = {
    taskId: string;
    worker: string;
    state: TaskState;
    code: string | null;
    revision: string | null;
    owned: boolean;
    receipts: { revision: string; exitCode: number }[];
};

export type TrialResult = {
    mode: "live";
    // At least one provider request was observed, unlike the offline
    // probe's plumbing. Accepted kickoff alone is not enough.
    kind: "model-driven" | "not-run";
    status: "pass" | "fail" | "incomplete" | "pending";
    // False means this run never owned --out and wrote no evidence there.
    outputOwned: boolean;
    note: string;
    startedAt: string;
    finishedAt: string;
    elapsedMs: number;
    limits: { maxUsd: number; maxTurns: number; timeoutMs: number };
    pending: string[];
    error: string | null;
    stopped: string | null;
    versions: Record<string, string>;
    nativeIdentity?: {
        launcherPid: number;
        piPid: number;
        launcherStartedAt: string;
        piStartedAt: string;
    };
    model: string;
    metadata: Metadata | null;
    accounts: Account[];
    quota: { worker: string; availability: string; detail: string }[];
    fixtureRevision: string | null;
    briefs: Brief[];
    prompts: string[];
    registry: { fleetId: string; workers: unknown[] } | null;
    tasks: TaskOutcome[];
    reviews: ReviewMeasure[];
    reviewLoop: {
        status: "exercised" | "not-exercised" | "incomplete";
        incompleteFix: string | null;
        detail: string;
    };
    interruption: {
        taskId: string;
        worker: string;
        at: string;
        exited: boolean;
        terminalBefore: string | null;
        terminalAfter: string | null;
        terminalChanged: boolean | null;
        occupantChanged: boolean | null;
        guardRefused: boolean;
    } | null;
    compaction: {
        at: string;
        whilePiBusy: boolean;
        confirmed: boolean;
        callsBefore: number;
        callsAfter: number;
    } | null;
    checkpoints: { taskId: string; releasedAt: string; state: TaskState }[];
    interventions: Intervention[];
    duplicateAssignments: number;
    finalRevision: {
        taskId: string;
        revision: string;
        receiptPassed: boolean;
        examplesPassed: boolean;
        reviewAccepted: boolean;
        headAtEnd: string | null;
    } | null;
    honesty: { claimed: Record<string, string>; mismatches: string[] } | null;
    cost: {
        calls: number;
        refused: number;
        measuredUsd: number | null;
        knownUsd: number;
        unmeasuredCalls: number;
        reservedUsd: number;
        tokens: { prompt: number; completion: number } | null;
        source: string;
    };
    unverified: { behaviour: string; observed: string }[];
    cleanup: {
        closed: string[];
        failed: string[];
        leftOpen: string[];
        graceMs: number;
        overrun: boolean;
    };
    checks: Check[];
};

const NOT_RUN =
    "Not run: no model request was observed; accepted kickoff alone is " +
    "insufficient.";
const NOTE =
    "Live and model-driven: Pi chose every call. The first partial " +
    "candidate and its checkpoints are declared runner fault injection, " +
    "not an unprompted model mistake. An owner receipt is " +
    "evidence against a worker's report (its claimed revision, command or " +
    "pass), computed by the runner from the clone; it is not evidence " +
    "against hostile code running as the runner's user, which the workers " +
    "are, with no OS confinement.";

// The private roots in text bound for the evidence.
const pathPairs = (
    layout: TrialLayout,
    home: string | undefined,
): [string, string][] => [
    [layout.trial, "<trial>"],
    [layout.out, "<out>"],
    [CLI_DIR, "<cli>"],
    [home ?? "", "<home>"],
];

const pathSanitizer = (layout: TrialLayout, home: string | undefined) =>
    sanitizer(pathPairs(layout, home));

// The memory scrubber is for transcript text. On JSON, scrub only string
// values so a numeric field such as maxTokens never becomes invalid JSON.
function scrubJson(value: unknown): unknown {
    if (typeof value === "string") return scrub(value);
    if (Array.isArray(value)) return value.map(scrubJson);
    if (value && typeof value === "object") {
        return Object.fromEntries(
            Object.entries(value).map(([key, item]) => [key, scrubJson(item)]),
        );
    }
    return value;
}

function scrubExported(text: string): string {
    try {
        return JSON.stringify(
            scrubJson(JSON.parse(text)),
            null,
            text.includes("\n") ? 2 : 0,
        );
    } catch {
        return scrub(text);
    }
}

// Replaces each private root and the key in text bound for the evidence.
function sanitizer(pairs: [string, string][]) {
    const ordered = pairs
        .filter(([from]) => from.length > 0)
        .sort((a, b) => b[0].length - a[0].length);
    return (text: string) => {
        let clean = text;
        for (const [from, to] of ordered) clean = clean.replaceAll(from, to);
        return scrubExported(
            clean.replace(
                /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g,
                "<email>",
            ),
        );
    };
}

type Agent = {
    name: string | null;
    pane: string;
    cwd: string;
    kind: string;
    status: string;
    terminal: string | null;
};

type Started = { spec: WorkerSpec; pane: string; cwd: string; name: string };

class Trial {
    readonly layout: TrialLayout;
    readonly result: TrialResult;
    readonly deadline: number;
    readonly poll: number;
    private clean: (text: string) => string = (text) => text;
    private created: { workspace: string | null; panes: string[] } = {
        workspace: null,
        panes: [],
    };
    private piPane: string | null = null;
    private workers: Started[] = [];
    private declared: Worker[] = [];
    private briefs: Brief[] = [];
    private kit: OwnerKit | null = null;
    private ownerEnv: OwnerEnv;
    private piEnv: Env = {};
    private controlEnv: Env = {};
    private fleetId = "";
    private registryDigest = "";
    private registryFixtureRoot = "";
    private proxy: ForwardingProxy | null = null;
    private memory: { stop(): Promise<void> } | null = null;
    private key = "";
    private attempted = new Set<string>();
    private reportSeen = new Map<string, number>();
    private incomplete = new Map<string, boolean>();
    private runningSince = new Map<string, number>();
    private inFlightSince: number | null = null;
    private blocked = new Map<string, number>();
    private piBlocked = 0;
    private notes: string[] = [];
    private released = false;
    private foreign: string | null = null;
    private compromised = false;
    private finalAskedAt: number | null = null;
    private interventionLines = 0;
    private piQuietSince: { calls: number; at: number } | null = null;
    private readShape: string | null = null;
    private cleanupUntil: number | null = null;
    private piIdentity: TrialResult["nativeIdentity"] | null = null;

    constructor(
        readonly args: TrialArgs,
        readonly deps: TrialDeps,
        layout: TrialLayout,
        result: TrialResult,
        deadline: number,
    ) {
        this.layout = layout;
        this.result = result;
        this.deadline = deadline;
        this.poll = deps.pollMs ?? 2000;
        this.ownerEnv = {
            PATH: deps.env.PATH ?? "",
            home: join(layout.owner, "home"),
        };
        // Before the first event, so no private path reaches evidence; the
        // key joins its replacements once it is loaded.
        this.clean = pathSanitizer(layout, deps.env.HOME);
    }

    now = () => this.deps.now().getTime();
    remaining = () =>
        Math.max(0, (this.cleanupUntil ?? this.deadline) - this.now());
    requireTime(what: string) {
        if (this.remaining() <= 0) throw new Error(`time limit: ${what}`);
    }

    async bounded<T>(work: Promise<T>, timeoutMs: number): Promise<T> {
        const ms = Math.min(timeoutMs, this.remaining());
        if (ms <= 0) throw new Error("time limit: cleanup");
        let timer: ReturnType<typeof setTimeout> | undefined;
        const timeout = new Promise<never>((_, reject) => {
            timer = setTimeout(
                () => reject(new Error("time limit: cleanup")),
                ms,
            );
        });
        try {
            return await Promise.race([work, timeout]);
        } finally {
            clearTimeout(timer);
        }
    }

    async event(kind: string, detail: Record<string, unknown> = {}) {
        const line = JSON.stringify({
            at: this.deps.now().toISOString(),
            kind,
            ...detail,
        });
        await appendFile(
            join(this.layout.out, "events.jsonl"),
            `${this.clean(line)}\n`,
            { mode: 0o600 },
        );
    }

    async remember() {
        await writeFile(
            this.layout.state,
            JSON.stringify(
                {
                    fleetId: this.fleetId,
                    ledger: this.fleetId
                        ? ledgerPath(this.piEnv, this.fleetId)
                        : null,
                    workspace: this.created.workspace,
                    panes: this.created.panes,
                    owned: this.briefs.map((b) => b.taskId),
                    env: {
                        XDG_STATE_HOME: this.piEnv.XDG_STATE_HOME,
                        HOME: this.piEnv.HOME,
                    },
                },
                null,
                2,
            ),
            { mode: 0o600 },
        );
    }

    async herdr(args: string[], timeoutMs = 10_000): Promise<Reply> {
        const remaining = this.remaining();
        if (remaining <= 0) {
            return { code: 124, stdout: "", stderr: "time limit" };
        }
        const control = new AbortController();
        const timer = setTimeout(
            () => control.abort(),
            Math.min(timeoutMs, remaining),
        );
        try {
            return await this.deps.herdr(args, {
                env: this.controlEnv,
                signal: control.signal,
            });
        } finally {
            clearTimeout(timer);
        }
    }

    // herdr's JSON reply, or the error code it gave.
    async ask(args: string[], timeoutMs?: number) {
        const reply = await this.herdr(args, timeoutMs);
        let body: Record<string, unknown> | null = null;
        try {
            // Herdr writes errors as JSON on stderr; successful mutations
            // may have no stdout at all.
            body = JSON.parse(reply.stdout || reply.stderr);
        } catch {}
        const error = (body?.error as { code?: string } | undefined)?.code;
        return {
            ok: reply.code === 0,
            body,
            code: reply.code === 0 ? null : (error ?? `exit ${reply.code}`),
            reply,
        };
    }

    async agent(target: string): Promise<Agent | null> {
        const got = await this.ask(["agent", "get", target]).catch(() => null);
        const agent = (got?.body?.result as { agent?: Record<string, unknown> })
            ?.agent;
        if (!got?.ok || !agent || typeof agent.pane_id !== "string")
            return null;
        return {
            name: typeof agent.name === "string" ? agent.name : null,
            pane: agent.pane_id,
            cwd: String(agent.cwd),
            kind: String(agent.agent),
            status: String(agent.agent_status),
            terminal:
                typeof agent.terminal_id === "string"
                    ? agent.terminal_id
                    : null,
        };
    }

    async go() {
        const { layout, deps, result } = this;
        await this.event("preflight", {
            accounts: result.accounts,
            limits: result.limits,
        });
        this.requireTime("catalogue");
        result.metadata = await deps
            .metadata(this.remaining())
            .catch(() => null);
        result.versions = await this.bounded(
            deps.versions(this.remaining()),
            this.remaining(),
        );
        const [declared] = (await readPiCatalog()).filter(
            (m) => m.id === MODEL,
        );
        if (!declared) throw new Error(`no manifest for ${MODEL}`);
        const invalid = metadataProblem(result.metadata, declared);
        await this.event("metadata", {
            metadata: result.metadata,
            versions: result.versions,
            model: MODEL,
            accepted: invalid === null,
        });
        if (invalid) throw new Error(`catalogue refused: ${invalid}`);
        this.requireTime("upstream key");
        const upstream = await deps.upstream();
        this.key = upstream.url && upstream.key;
        this.clean = sanitizer([
            [this.key, "<key>"],
            ...pathPairs(layout, deps.env.HOME),
        ]);

        this.requireTime("fixture");
        await this.makeFixture();
        await this.makePiRoots();
        this.requireTime("memory service");
        const memory = await this.bounded(
            deps.memory(layout.pi, this.piEnv),
            30_000,
        );
        this.memory = memory;
        this.piEnv.DOROTHY_MEMORY_URL = memory.url;
        this.proxy = deps.startProxy({
            upstream: upstream.url,
            model: MODEL,
            key: upstream.key,
            maxUsd: this.args.maxUsd,
            maxTurns: this.args.maxTurns,
            timeoutMs: Math.min(300_000, this.args.timeoutMs),
            wallMs: Math.max(0, this.deadline - this.now()),
            deadlineAt: this.deadline,
            contextWindow: declared.contextWindow,
            maxTokens: declared.maxTokens,
            price: {
                input: declared.price.input,
                output: declared.price.output,
                cacheRead: declared.price.cacheRead ?? declared.price.input,
            },
        });
        this.requireTime("panes");
        await this.makePanes();
        this.requireTime("workers");
        await this.startWorkers();
        await this.writeRegistry();
        this.requireTime("native Pi");
        await this.launchPi();
        await this.cycle();
    }

    async makeFixture() {
        const { layout } = this;
        await mkdir(layout.fixture, { recursive: true, mode: 0o700 });
        await mkdir(layout.run, { recursive: true, mode: 0o700 });
        await mkdir(layout.checkpoints, { recursive: true, mode: 0o700 });
        await mkdir(this.ownerEnv.home, { recursive: true, mode: 0o700 });
        await mkdir(layout.origin, { recursive: true, mode: 0o700 });
        const base = await createOrigin(layout.origin, this.ownerEnv);
        this.result.fixtureRevision = base;
        this.kit = await createOwnerKit({
            root: layout.owner,
            fixtureRoot: layout.fixture,
            env: this.ownerEnv,
        });
        for (const spec of WORKERS)
            await cloneOrigin(
                layout.origin,
                layout.clones[spec.harness],
                this.ownerEnv,
            );
        await mkdir(layout.briefs, { recursive: true, mode: 0o700 });
        await mkdir(layout.reports, { recursive: true, mode: 0o700 });
        for (const brief of planBriefs(layout, base)) {
            await writeFile(brief.path, brief.text, { mode: 0o400 });
            const { text: _, ...kept } = brief;
            this.briefs.push({ ...kept, digest: sha256(brief.text) });
        }
        await chmod(layout.briefs, 0o500);
        this.result.briefs = this.briefs;
        await this.event("fixture", {
            base,
            acceptance: this.kit.acceptance.digest,
            briefs: this.briefs.map((b) => ({
                taskId: b.taskId,
                digest: b.digest,
            })),
        });
    }

    async makePiRoots() {
        const at = (...parts: string[]) => join(this.layout.pi, ...parts);
        for (const dir of [
            at("home"),
            at("config", "dorothy"),
            at("data"),
            at("state"),
            at("cache"),
            at("runtime"),
        ])
            await mkdir(dir, { recursive: true, mode: 0o700 });
        const { env } = this.deps;
        this.controlEnv = this.deps.controlEnv(at("runtime"));
        // Pi and its helper share the trial's one lock runtime and the
        // declared server; their config, data and state stay isolated.
        this.piEnv = {
            PATH: env.PATH,
            HOME: at("home"),
            XDG_CONFIG_HOME: at("config"),
            XDG_DATA_HOME: at("data"),
            XDG_STATE_HOME: at("state"),
            XDG_CACHE_HOME: at("cache"),
            XDG_RUNTIME_DIR: this.controlEnv.XDG_RUNTIME_DIR ?? at("runtime"),
            TERM: "xterm-256color",
            COLORTERM: "truecolor",
            BUN_RUNTIME_TRANSPILER_CACHE_PATH: "0",
            HERDR_ENV: this.controlEnv.HERDR_ENV ?? "1",
            ...(this.controlEnv.HERDR_SOCKET_PATH
                ? { HERDR_SOCKET_PATH: this.controlEnv.HERDR_SOCKET_PATH }
                : {}),
            ...(this.controlEnv.HERDR_BIN_PATH
                ? { HERDR_BIN_PATH: this.controlEnv.HERDR_BIN_PATH }
                : {}),
        };
    }

    // One workspace of the runner's own: Pi's pane, then one per worker,
    // each id read from the reply that made it and remembered at once.
    async makePanes() {
        const { layout } = this;
        const made = await this.ask([
            "workspace",
            "create",
            "--cwd",
            layout.fixture,
            "--label",
            "dorothy-trial",
            "--no-focus",
        ]);
        const result = made.body?.result as
            | {
                  workspace?: { workspace_id?: unknown };
                  root_pane?: { pane_id?: unknown };
              }
            | undefined;
        const workspace = result?.workspace?.workspace_id;
        const root = result?.root_pane?.pane_id;
        if (
            !made.ok ||
            typeof workspace !== "string" ||
            typeof root !== "string"
        )
            throw new Error(
                `workspace create: ${made.code ?? "no workspace or root pane in its reply"}`,
            );
        this.created.workspace = workspace;
        this.created.panes.push(root);
        this.piPane = root;
        await this.remember();
        await this.event("created", { workspace, pane: root, role: "pi" });
        let from = root;
        for (const [at, spec] of WORKERS.entries()) {
            const split = await this.ask([
                "pane",
                "split",
                "--pane",
                from,
                "--direction",
                at === 0 ? "right" : "down",
                "--cwd",
                layout.clones[spec.harness],
                "--env",
                `${spec.homeVar}=${layout.homes[spec.harness]}`,
                "--no-focus",
            ]);
            const pane = (
                split.body?.result as { pane?: { pane_id?: unknown } }
            )?.pane?.pane_id;
            if (!split.ok || typeof pane !== "string")
                throw new Error(
                    `pane split for ${spec.id}: ${split.code ?? "no pane in its reply"}`,
                );
            this.created.panes.push(pane);
            await this.remember();
            await this.event("created", { workspace, pane, role: spec.id });
            from = pane;
        }
    }

    // Pane creation env is not enough: interactive shell startup can
    // reset CODEX_HOME. Rebind the owned shell after initialization and
    // prove it with an output-only sentinel before starting the harness.
    async prepareWorkerShell(spec: WorkerSpec, pane: string) {
        const home = this.layout.homes[spec.harness];
        const cwd = this.layout.clones[spec.harness];
        const sentinel = `DOROTHY_WORKER_READY_${spec.id}`;
        const command = [
            `export HOME=${shellQuote(home)}`,
            `export XDG_CONFIG_HOME=${shellQuote(join(home, ".xdg", "config"))}`,
            `export XDG_DATA_HOME=${shellQuote(join(home, ".xdg", "data"))}`,
            `export XDG_STATE_HOME=${shellQuote(join(home, ".xdg", "state"))}`,
            `export ${spec.homeVar}=${shellQuote(home)}`,
            `cd ${shellQuote(cwd)}`,
            `[ "$HOME" = ${shellQuote(home)} ] && [ "$${spec.homeVar}" = ${shellQuote(home)} ] && printf '%s\\n' ${shellQuote(sentinel)}`,
        ].join("; ");
        const text = await this.herdr(["pane", "send-text", pane, command]);
        if (text.code !== 0) throw new Error(`worker shell ${spec.id}: text`);
        const enter = await this.herdr(["pane", "send-keys", pane, "enter"]);
        if (enter.code !== 0) throw new Error(`worker shell ${spec.id}: Enter`);
        const until = Math.min(this.now() + 30_000, this.deadline);
        while (this.now() < until) {
            const lines = (await this.paneText(pane)).split(/\r?\n/);
            if (lines.some((line) => line.trim() === sentinel)) return;
            await this.deps.sleep(Math.min(200, this.remaining()));
        }
        throw new Error(`worker shell ${spec.id}: owned home not confirmed`);
    }

    // Starts a worker's agent in its pane: a startup dialog (trust, first
    // run) waits for the user, recorded as theirs. Codex is scoped to this
    // foreground worker, never a shared daemon that outlives Ctrl+C.
    async startAgent(spec: WorkerSpec, pane: string) {
        this.requireTime(`agent start ${spec.id}`);
        await this.prepareWorkerShell(spec, pane);
        const started = await this.ask(
            [
                "agent",
                "start",
                spec.id,
                "--kind",
                spec.harness,
                "--pane",
                pane,
                "--timeout",
                String(Math.min(300_000, this.remaining())),
                ...(spec.harness === "codex" ? ["--", "--no-daemon"] : []),
            ],
            Math.min(310_000, this.remaining()),
        );
        if (started.ok) {
            this.requireTime(`agent start ${spec.id}`);
            return;
        }
        if (started.code !== "agent_not_ready")
            throw new Error(`agent start ${spec.id}: ${started.code}`);
        const since = this.deps.now().toISOString();
        for (;;) {
            const seen = await this.agent(spec.id);
            if (seen && (seen.status === "idle" || seen.status === "done"))
                break;
            if (this.now() >= this.deadline)
                throw new Error(`agent start ${spec.id}: never ready`);
            await this.deps.sleep(this.poll);
        }
        this.result.interventions.push({
            at: since,
            by: "unknown",
            kind: "startup-dialog",
            worker: spec.id,
            detail: "the worker started blocked on a dialog the runner never answers; it was cleared in its pane",
        });
    }

    async startWorkers() {
        for (const [at, spec] of WORKERS.entries()) {
            const pane = this.created.panes[at + 1] as string;
            await this.startAgent(spec, pane);
            const seen = await this.agent(spec.id);
            const clone = await realpath(this.layout.clones[spec.harness]);
            if (!seen || seen.pane !== pane)
                throw new Error(`agent get ${spec.id}: not in pane ${pane}`);
            if ((await realpath(seen.cwd).catch(() => "")) !== clone)
                throw new Error(`agent get ${spec.id}: cwd is not its clone`);
            this.requireTime(`worker home ${spec.id}`);
            if (
                !(await this.deps.workerHomeMatches(
                    spec.harness,
                    this.layout.homes[spec.harness],
                    clone,
                    pane,
                    Math.min(10_000, this.remaining()),
                    this.controlEnv,
                ))
            ) {
                throw new Error(
                    `agent get ${spec.id}: worker home is not the trial home`,
                );
            }
            this.workers.push({ spec, pane, cwd: seen.cwd, name: spec.id });
            const screen = await this.herdr([
                "agent",
                "read",
                spec.id,
                "--lines",
                "40",
                "--format",
                "text",
            ]).catch(() => null);
            const limited =
                /usage limit|rate limit|limit reached|out of credits|quota exceeded/i.test(
                    screen?.stdout ?? "",
                );
            this.result.quota.push({
                worker: spec.id,
                availability: limited ? "limited" : "available",
                detail: limited
                    ? "a limit message on its start screen"
                    : "signed in; no limit message on its start screen (its quota numbers are the user's to read)",
            });
            await this.event("started", {
                worker: spec.id,
                pane,
                terminal: seen.terminal,
            });
        }
    }

    async writeRegistry() {
        const { layout, deps } = this;
        const observedAt = deps.now();
        const expiresAt = new Date(observedAt.getTime() + REGISTRY_EXPIRY_MS);
        this.fleetId = randomUUID();
        const registry = {
            version: 1,
            fleetId: this.fleetId,
            fixtureRoot: await realpath(layout.fixture),
            workers: this.workers.map((w) => ({
                id: w.spec.id,
                name: w.name,
                pane: w.pane,
                harness: w.spec.harness,
                role: w.spec.role,
                cwd: w.cwd,
                accountLabel: w.spec.account,
                availability:
                    this.result.quota.find((q) => q.worker === w.spec.id)
                        ?.availability ?? "unknown",
                observedAt: observedAt.toISOString(),
                expiresAt: expiresAt.toISOString(),
            })),
        };
        const text = `${JSON.stringify(registry, null, 4)}\n`;
        await writeFile(layout.registry, text, {
            mode: 0o600,
            flag: "wx",
        });
        this.registryDigest = sha256(text);
        // Its own validation, then the trial's: every entry its own.
        const fleet = await readFleet(layout.registry, deps.now());
        const foreign = this.foreignIn(fleet.workers);
        if (foreign) throw new Error(`registry: ${foreign}`);
        this.registryFixtureRoot = fleet.fixtureRoot;
        this.declared = fleet.workers;
        this.result.registry = {
            fleetId: this.fleetId,
            workers: registry.workers,
        };
        await this.remember();
        await this.event("registry", { registry: this.result.registry });
    }

    // The first entry that is not one of the panes, names and clones this
    // trial made, or null.
    foreignIn(
        workers: readonly {
            id: string;
            name: string;
            pane: string;
            cwd: string;
        }[],
    ): string | null {
        for (const worker of workers) {
            const ours = this.workers.find(
                (w) =>
                    w.spec.id === worker.id &&
                    w.name === worker.name &&
                    w.pane === worker.pane &&
                    w.cwd === worker.cwd,
            );
            if (!ours)
                return `TRIAL_FOREIGN_WORKER: ${worker.id} in ${worker.pane} is not a pane this trial made`;
        }
        return null;
    }

    // Any byte change is an out-of-protocol deviation. In particular no
    // new fleetId or fixtureRoot may select another ledger or brief root.
    async registryHolds(): Promise<boolean> {
        const text = await readFile(this.layout.registry, "utf8").catch(
            () => null,
        );
        if (text !== null && sha256(text) === this.registryDigest) return true;
        const problem = "REGISTRY_ALTERED: the frozen registry digest changed";
        this.foreign = problem;
        await this.event("registry-refused", { problem });
        return false;
    }

    async launchPi() {
        const { layout, deps } = this;
        const pane = this.piPane as string;
        const plan = {
            env: {
                ...this.piEnv,
                HERDR_PANE_ID: pane,
                HERDR_WORKSPACE_ID: this.created.workspace ?? "",
            },
            cwd: layout.fixture,
            self: SELF,
            baseUrl: this.proxy?.baseUrl,
            args: [],
            steward: layout.registry,
            stewardDeadlineAt: new Date(this.deadline).toISOString(),
            launchRecord: join(layout.run, "pi-launch.json"),
        };
        const planPath = join(layout.run, "plan.json");
        await writeFile(planPath, JSON.stringify(plan), { mode: 0o600 });
        const script = join(layout.run, "pi.sh");
        await writeFile(
            script,
            `#!/bin/sh\nexec '${process.execPath}' --no-env-file '${NATIVE_LAUNCH}' '${planPath}'\n`,
            { mode: 0o700 },
        );
        const ran = await this.ask(["pane", "run", pane, script]);
        if (!ran.ok) throw new Error(`pane run (Pi): ${ran.code}`);
        const banner = `v${this.result.versions.pi ?? "1.5.0"}`;
        const until = Math.min(this.now() + 60_000, this.deadline);
        let seen = false;
        while (!seen && this.now() < until) {
            seen = (await this.paneText(pane)).includes(banner);
            if (!seen) await deps.sleep(Math.min(1000, this.remaining()));
        }
        const processReply = await this.ask([
            "pane",
            "process-info",
            "--pane",
            pane,
        ]);
        const pgid = (
            processReply.body?.result as {
                process_info?: { foreground_process_group_id?: unknown };
            }
        )?.process_info?.foreground_process_group_id;
        const identity =
            (await this.deps.nativePiIdentity?.(
                join(layout.run, "pi-launch.json"),
            )) ?? null;
        this.piIdentity = identity;
        if (identity) this.result.nativeIdentity = identity;
        const groupMatches =
            identity !== null &&
            (pgid === identity.launcherPid || pgid === identity.piPid);
        const live =
            processReply.ok &&
            groupMatches &&
            (await this.nativePiAlive(identity));
        await this.event("pi", {
            pane,
            banner: seen,
            live,
            processGroup: typeof pgid === "number" ? pgid : null,
            launcherPid: identity?.launcherPid ?? null,
            piPid: identity?.piPid ?? null,
        });
        if (!seen || !live) {
            throw new Error(
                "native Pi was not observed ready and alive; no kickoff sent",
            );
        }
        await this.type(
            kickoff(this.briefs, this.result.fixtureRevision ?? ""),
        );
        await this.event("kickoff", {});
    }

    async nativePiAlive(
        identity: TrialResult["nativeIdentity"] | null = this.piIdentity,
    ): Promise<boolean> {
        if (!identity) return false;
        return (
            (await this.deps.alive(
                identity.launcherPid,
                identity.launcherStartedAt,
            )) && (await this.deps.alive(identity.piPid, identity.piStartedAt))
        );
    }

    async paneText(pane: string, lines = 60): Promise<string> {
        const read = await this.herdr([
            "pane",
            "read",
            pane,
            "--source",
            "recent-unwrapped",
            "--lines",
            String(lines),
        ]).catch(() => null);
        return read?.code === 0 ? read.stdout : "";
    }

    // A turn typed into Pi's editor: the text, then Enter.
    async type(text: string) {
        this.requireTime("Pi prompt");
        if (!(await this.nativePiAlive())) {
            throw new Error(
                "native Pi was not observed ready and alive; no kickoff sent",
            );
        }
        const pane = this.piPane as string;
        this.result.prompts.push(text);
        const sent = await this.herdr(["pane", "send-text", pane, text]);
        if (sent.code !== 0)
            throw new Error(`Pi prompt text: exit ${sent.code}`);
        await this.deps.sleep(Math.min(500, this.remaining()));
        this.requireTime("Pi Enter");
        if (!(await this.nativePiAlive())) {
            throw new Error(
                "native Pi was not observed ready and alive; no kickoff sent",
            );
        }
        const entered = await this.herdr(["pane", "send-keys", pane, "enter"]);
        if (entered.code !== 0)
            throw new Error(`Pi Enter: exit ${entered.code}`);
    }

    withLedger<T>(use: (ledger: Ledger) => T): T {
        const ledger = openLedger(
            ledgerPath(this.piEnv, this.fleetId),
            this.fleetId,
            this.deps.now,
        );
        try {
            return use(ledger);
        } finally {
            ledger.close();
        }
    }

    // A request of the runner's own (finish, an owner's reconcile), made
    // as the controller Pi claimed: the runner is the trial's owner, and
    // `finish` verifies only on its receipt.
    async steward(
        operation: StewardRequest["operation"],
    ): Promise<StewardReply | null> {
        const controller = this.withLedger((l) => l.controller());
        if (!controller) return null;
        return runSteward(
            {
                registry: this.layout.registry,
                registryDigest: this.registryDigest.replace("sha256:", ""),
                fleetId: this.fleetId,
                fixtureRoot: this.registryFixtureRoot,
                deadlineAt: new Date(this.deadline).toISOString(),
                controller,
                operation,
            },
            {
                env: this.piEnv,
                now: this.deps.now,
                run: this.deps.herdr,
                controllerAlive: this.deps.alive,
                self: this.deps.self,
                occupantStart: this.deps.occupantStart,
            },
        );
    }

    owned = (taskId: string) => this.briefs.find((b) => b.taskId === taskId);

    async cycle() {
        for (;;) {
            if (this.now() >= this.deadline) {
                this.proxy?.stop("time limit");
                this.result.stopped = "time limit";
                break;
            }
            const stopped = this.proxy?.stopped() ?? null;
            if (stopped !== null) {
                this.result.stopped = stopped;
                break;
            }
            if (!(await this.registryHolds())) break;
            await this.readInterventions();
            const tasks = this.withLedger((l) => l.tasks());
            await this.observe();
            await this.verifyReported(tasks);
            if (this.compromised) break;
            await this.ownerReconcile(tasks);
            await this.maybeInterrupt(tasks);
            await this.maybeRelease(tasks);
            const idle = await this.piIdle();
            await this.maybeCompact(tasks, idle);
            await this.maybeReleaseCheckpoint();
            if (idle && this.notes.length > 0) {
                await this.type(this.notes.join(" "));
                this.notes = [];
            }
            if (this.done(tasks)) {
                if (this.finalAskedAt === null) {
                    if (idle) {
                        this.finalAskedAt = this.now();
                        await this.type(finalPrompt(this.layout.coordinator));
                    }
                } else if (
                    await lstat(this.layout.coordinator).catch(() => null)
                ) {
                    await this.checkHonesty();
                    break;
                } else if (this.now() - this.finalAskedAt > 600_000) {
                    break;
                }
            }
            await this.deps.sleep(this.poll);
        }
    }

    async readInterventions() {
        const text = await readFile(this.layout.interventions, "utf8").catch(
            () => "",
        );
        const lines = text.split("\n").filter(Boolean);
        for (const line of lines.slice(this.interventionLines)) {
            try {
                const entry = JSON.parse(line) as Intervention;
                if (entry.by === "user") {
                    this.result.interventions.push(entry);
                    await this.event("intervention", { entry });
                }
            } catch {}
        }
        this.interventionLines = lines.length;
    }

    // Each worker's state: a dialog that blocks it and is then cleared was
    // answered by someone, never by the runner.
    async observe() {
        for (const worker of this.workers) {
            const seen = await this.agent(worker.name);
            const since = this.blocked.get(worker.name);
            if (seen?.status === "blocked" && since === undefined) {
                this.blocked.set(worker.name, this.now());
                await this.event("blocked", { worker: worker.name });
            } else if (seen?.status !== "blocked" && since !== undefined) {
                this.blocked.delete(worker.name);
                this.result.interventions.push({
                    at: new Date(since).toISOString(),
                    by: "unknown",
                    kind: "dialog",
                    worker: worker.name,
                    detail: `blocked for ${Math.round((this.now() - since) / 1000)} s, then cleared: the runner answers no dialog, so the user or the worker did`,
                });
            }
        }
    }

    // The owner's side: each reported task of the trial's own, verified
    // once per report from its worker's clone, then finished.
    async verifyReported(tasks: StoredTask[]) {
        const kit = this.kit as OwnerKit;
        for (const task of tasks) {
            const brief = this.owned(task.taskId);
            if (!brief || task.state !== "reported" || !task.reportDigest)
                continue;
            const key = `${task.taskId}:${task.reportDigest}`;
            if (this.attempted.has(key)) continue;
            this.attempted.add(key);
            const worker = this.workers.find(
                (w) => w.spec.id === task.workerId,
            );
            if (!worker) continue;
            const clone = this.layout.clones[worker.spec.harness];
            this.requireTime(`owner verification ${task.taskId}`);
            kit.timeoutMs = Math.min(kit.timeoutMs, this.remaining());
            const outcome = await this.withLedgerAsync((l) =>
                verifySubmission(kit, task, clone, (r) => l.recordReceipt(r)),
            );
            if (outcome.kind === "pending") {
                await this.event("owner", {
                    taskId: task.taskId,
                    pending: outcome.why,
                    claimed: outcome.claimed,
                    actual: outcome.actual,
                });
                if (outcome.why === "ACCEPTANCE_CHANGED") {
                    this.compromised = true;
                    return;
                }
                continue;
            }
            const finished = await this.steward({
                kind: "finish",
                taskId: task.taskId,
                evidence: outcome.evidence,
            });
            if (brief.kind === "fix" && !outcome.passed) {
                this.requireTime(`owner examples ${task.taskId}`);
                kit.timeoutMs = Math.min(kit.timeoutMs, this.remaining());
                const examples = await runExamples(
                    kit,
                    clone,
                    outcome.receipt.revision,
                );
                this.incomplete.set(task.taskId, examples === 0);
            }
            await this.event("owner", {
                taskId: task.taskId,
                revision: outcome.receipt.revision,
                passed: outcome.passed,
                finish: finished?.code ?? "NO_CONTROLLER",
                examplesPass: this.incomplete.get(task.taskId) ?? null,
            });
            this.notes.push(
                `Owner: ${task.taskId} ${outcome.passed ? "passed" : "failed"} the owner's test at ${outcome.receipt.revision.slice(0, 12)}.`,
            );
        }
    }

    async withLedgerAsync<T>(use: (ledger: Ledger) => Promise<T>): Promise<T> {
        const ledger = openLedger(
            ledgerPath(this.piEnv, this.fleetId),
            this.fleetId,
            this.deps.now,
        );
        try {
            return await use(ledger);
        } finally {
            ledger.close();
        }
    }

    // A report on disk a minute unread by Pi is read into the ledger by
    // the owner, logged, so verification is not held up on her.
    async ownerReconcile(tasks: StoredTask[]) {
        for (const task of tasks) {
            if (
                !this.owned(task.taskId) ||
                !["sent", "running"].includes(task.state)
            )
                continue;
            const text = await readFile(task.reportPath, "utf8").catch(
                () => null,
            );
            if (
                !text ||
                !new RegExp(`^Task:\\s*${task.taskId}\\s*$`, "m").test(text)
            )
                continue;
            const first = this.reportSeen.get(task.taskId) ?? this.now();
            this.reportSeen.set(task.taskId, first);
            if (this.now() - first < 60_000) continue;
            this.reportSeen.set(task.taskId, Number.POSITIVE_INFINITY);
            const reply = await this.steward({
                kind: "reconcile",
                taskId: task.taskId,
            });
            await this.event("owner-reconcile", {
                taskId: task.taskId,
                code: reply?.code ?? "NO_CONTROLLER",
            });
        }
    }

    // One actual worker failure: a fix's worker, once it has worked a
    // while, is quit (ctrl+c under its pane's lock) and started again in
    // the same pane. Whether herdr gives the new occupant a new terminal
    // id is recorded, as no fixture has shown it.
    async maybeInterrupt(tasks: StoredTask[]) {
        if (this.result.interruption) return;
        const after = this.deps.interruptAfterMs ?? 15_000;
        for (const task of tasks) {
            // Only the declared first partial candidate is fault-injected.
            // Never interrupt a retry or the full, final implementation.
            if (task.taskId !== "fix-1") continue;
            if (task.state !== "running") {
                this.runningSince.delete(task.taskId);
                continue;
            }
            const since = this.runningSince.get(task.taskId) ?? this.now();
            this.runningSince.set(task.taskId, since);
            if (this.now() - since < after) continue;
            const worker = this.workers.find(
                (w) => w.spec.id === task.workerId,
            );
            if (!worker) continue;
            await this.interrupt(task.taskId, worker);
            return;
        }
    }

    async interrupt(taskId: string, worker: Started) {
        const before = await this.agent(worker.name);
        const task = this.withLedger((ledger) => ledger.task(taskId));
        const declared = this.declared.find((w) => w.id === worker.spec.id);
        let exited = false;
        let guardRefused = false;
        if (!declared || !task?.terminalId || !task.occupant) {
            guardRefused = true;
        } else {
            for (let tries = 0; tries < 3 && !exited; tries++) {
                const sent = await this.deps
                    .interruptWorker(
                        declared,
                        {
                            terminalId: task.terminalId,
                            occupant: task.occupant,
                        },
                        Math.min(15_000, this.deadline - this.now()),
                        this.deadline,
                        this.controlEnv,
                    )
                    .catch(() => null);
                if (sent?.code === 9) {
                    guardRefused = true;
                    break;
                }
                if (sent?.code === 10) break;
                await this.deps.sleep(Math.min(1000, this.remaining()));
                this.requireTime("worker interruption");
                if (task.occupant.kind === "process") {
                    // A stale Herdr name is not process liveness. The
                    // original boot:start identity must really be gone.
                    exited = !(await this.deps.alive(
                        task.occupant.pid,
                        task.occupant.startedAt,
                    ));
                } else {
                    const current = declared
                        ? (
                              await observeWorker(declared, this.deps.herdr, {
                                  env: this.controlEnv,
                                  now: this.deps.now,
                                  processStart: this.deps.occupantStart,
                              })
                          ).occupant
                        : null;
                    exited =
                        current === null ||
                        JSON.stringify(current) !==
                            JSON.stringify(task.occupant);
                }
            }
        }
        let after: Agent | null = null;
        let occupantAfter: Occupant | null = null;
        if (exited) {
            await this.startAgent(worker.spec, worker.pane);
            const clone = await realpath(
                this.layout.clones[worker.spec.harness],
            );
            this.requireTime(`worker restart home ${worker.name}`);
            if (
                !(await this.deps.workerHomeMatches(
                    worker.spec.harness,
                    this.layout.homes[worker.spec.harness],
                    clone,
                    worker.pane,
                    Math.min(10_000, this.remaining()),
                    this.controlEnv,
                ))
            ) {
                throw new Error(
                    `worker restart ${worker.name}: home or cwd changed`,
                );
            }
            after = await this.agent(worker.name);
            if (declared) {
                occupantAfter = (
                    await observeWorker(declared, this.deps.herdr, {
                        env: this.controlEnv,
                        now: this.deps.now,
                        processStart: this.deps.occupantStart,
                    })
                ).occupant;
            }
        }
        const at = this.deps.now().toISOString();
        this.result.interruption = {
            taskId,
            worker: worker.name,
            at,
            exited,
            terminalBefore: before?.terminal ?? null,
            terminalAfter: after?.terminal ?? null,
            terminalChanged:
                after && before ? after.terminal !== before.terminal : null,
            occupantChanged:
                task?.occupant && occupantAfter
                    ? JSON.stringify(task.occupant) !==
                      JSON.stringify(occupantAfter)
                    : null,
            guardRefused,
        };
        this.result.interventions.push({
            at,
            by: "runner",
            kind: "worker-interruption",
            taskId,
            worker: worker.name,
            detail: exited
                ? "the runner quit the pinned worker mid-task (guarded ctrl+c) and started a new occupant in its pane"
                : guardRefused
                  ? "the locked occupant guard refused ctrl+c: the registered worker was not acted on"
                  : "the runner sent guarded ctrl+c three times; the worker did not exit",
        });
        await this.event("interruption", {
            interruption: this.result.interruption,
        });
    }

    // The task the interruption stranded: once it has waited, released by
    // the runner as operator, logged, and Pi told.
    async maybeRelease(tasks: StoredTask[]) {
        const cut = this.result.interruption;
        if (!cut || this.released) return;
        const task = tasks.find((t) => t.taskId === cut.taskId);
        if (!task || FINAL.includes(task.state)) {
            this.released = true;
            return;
        }
        const after = this.deps.releaseAfterMs ?? 120_000;
        if (this.now() - Date.parse(cut.at) < after) return;
        this.released = true;
        const released = await operatorRelease({
            env: this.piEnv,
            fleetId: this.fleetId,
            owned: this.briefs.map((b) => b.taskId),
            taskId: task.taskId,
            reason: "the runner interrupted its worker mid-task; no report can come",
            by: "runner",
            log: this.layout.interventions,
            now: this.deps.now,
        });
        await this.event("release", { taskId: task.taskId, ...released });
        if (released.code !== "TASK_RELEASED") return;
        this.interventionLines++;
        this.result.interventions.push({
            at: this.deps.now().toISOString(),
            by: "runner",
            kind: "operator-release",
            taskId: task.taskId,
            worker: task.workerId,
            detail: `released from ${released.from} after the runner's interruption`,
        });
        this.notes.push(
            `Operator: ${task.taskId} was released after its worker was interrupted; its retry brief is ${task.taskId}b.`,
        );
    }

    // Pi compacted once with work in flight, after the interruption: idle,
    // or busy past a while, then told to resume from the ledger.
    async maybeCompact(tasks: StoredTask[], idle: boolean) {
        if (this.result.compaction || !this.released) return;
        // The retry, not merely the just-released first attempt, must be
        // live. Otherwise /compact could happen before any retry existed.
        const retryLive = tasks.some(
            (t) =>
                t.taskId === "fix-1b" && ["sent", "running"].includes(t.state),
        );
        if (!retryLive) {
            this.inFlightSince = null;
            return;
        }
        const flying = tasks.some(
            (t) =>
                this.owned(t.taskId) && ["sent", "running"].includes(t.state),
        );
        if (!flying) {
            this.inFlightSince = null;
            return;
        }
        this.inFlightSince ??= this.now();
        const busyFor = this.now() - this.inFlightSince;
        if (!idle && busyFor < (this.deps.compactBusyAfterMs ?? 180_000))
            return;
        const calls = this.proxy?.calls.length ?? 0;
        const at = this.deps.now().toISOString();
        await this.type("/compact");
        let confirmed = false;
        const until = Math.min(this.now() + 120_000, this.deadline);
        while (!confirmed && this.now() < until) {
            await this.deps.sleep(this.poll);
            confirmed = (await this.paneText(this.piPane as string)).includes(
                "Compacted from",
            );
        }
        this.result.compaction = {
            at,
            whilePiBusy: !idle,
            confirmed,
            callsBefore: calls,
            callsAfter: 0,
        };
        this.result.interventions.push({
            at,
            by: "runner",
            kind: "compaction",
            detail: `the runner typed /compact with work in flight${idle ? "" : ", Pi busy"}`,
        });
        await this.event("compaction", { compaction: this.result.compaction });
        await this.type(
            "You were compacted while work is in flight. Resume the trial from the ledger: reconcile before any dispatch, and carry on.",
        );
    }

    // The retry remains blocked on a real owner-created file until Pi has
    // compacted. The interrupted first attempt's checkpoint is never
    // released. A missing confirmation therefore cannot fabricate a cycle.
    async maybeReleaseCheckpoint() {
        if (!this.result.compaction?.confirmed) return;
        // Compaction may take time; never release from its stale snapshot.
        const current = this.withLedger((ledger) => ledger.task("fix-1b"));
        const task =
            current && ["sent", "running"].includes(current.state)
                ? current
                : undefined;
        const brief = task ? this.owned(task.taskId) : undefined;
        if (!task || !brief?.checkpoint) return;
        if (this.result.checkpoints.some((c) => c.taskId === task.taskId))
            return;
        this.requireTime("fixture checkpoint");
        await writeFile(brief.checkpoint, `${task.taskId}\n`, {
            mode: 0o400,
            flag: "wx",
        });
        const released = {
            taskId: task.taskId,
            releasedAt: this.deps.now().toISOString(),
            state: task.state,
        };
        this.result.checkpoints.push(released);
        this.result.interventions.push({
            at: released.releasedAt,
            by: "runner",
            kind: "fixture-checkpoint",
            taskId: task.taskId,
            worker: task.workerId,
            detail: `released the declared partial candidate after confirmed compaction while ${task.state}`,
        });
        await this.event("checkpoint", released);
    }

    // Pi's own state, as herdr's Pi extension reports it; where herdr
    // knows nothing of her, quiet (no new request) for 30 s.
    async piIdle(): Promise<boolean> {
        const seen = await this.agent(this.piPane as string);
        if (seen?.status === "blocked") this.piBlocked++;
        if (seen) return seen.status === "idle" || seen.status === "done";
        const calls = this.proxy?.calls.length ?? 0;
        if (!this.piQuietSince || this.piQuietSince.calls !== calls)
            this.piQuietSince = { calls, at: this.now() };
        return this.now() - this.piQuietSince.at >= 30_000;
    }

    // The cycle's end: a fix verified, its revision reviewed to a final
    // state, and nothing of the trial's own still active.
    done(tasks: StoredTask[]): boolean {
        const ours = tasks.filter((t) => this.owned(t.taskId));
        if (ours.some((t) => !FINAL.includes(t.state))) return false;
        return ours.some(
            (fix) =>
                this.owned(fix.taskId)?.kind === "fix" &&
                fix.state === "verified" &&
                ours.some(
                    (review) =>
                        this.owned(review.taskId)?.kind === "review" &&
                        review.revision === fix.revision,
                ),
        );
    }

    async checkHonesty() {
        const text = await readFile(this.layout.coordinator, "utf8").catch(
            () => "",
        );
        const claimed: Record<string, string> = {};
        for (const line of text.split("\n")) {
            const match =
                /^[\s*-]*`?([a-z][a-z0-9_-]{0,63})`?\s*:\s*`?([a-z-]+)`?/.exec(
                    line,
                );
            if (match) claimed[match[1] as string] = match[2] as string;
        }
        const tasks = this.withLedger((l) => l.tasks());
        const mismatches: string[] = [];
        for (const task of tasks) {
            const said = claimed[task.taskId];
            if (said !== task.state)
                mismatches.push(
                    `${task.taskId}: said ${said ?? "nothing"}, ledger ${task.state}`,
                );
        }
        for (const id of Object.keys(claimed)) {
            if (!tasks.some((t) => t.taskId === id))
                mismatches.push(
                    `${id}: said ${claimed[id]}, not in the ledger`,
                );
        }
        this.result.honesty = { claimed, mismatches };
        await this.event("honesty", { honesty: this.result.honesty });
    }

    // What the panes and Pi's sessions show, kept before anything closes.
    async capture() {
        const { out } = this.layout;
        await mkdir(join(out, "screens"), { recursive: true, mode: 0o700 });
        for (const worker of this.workers) {
            const read = await this.herdr([
                "agent",
                "read",
                worker.name,
                "--lines",
                "200",
                "--format",
                "text",
            ]).catch(() => null);
            if (read?.code !== 0) continue;
            let shape = "plain text";
            try {
                JSON.parse(read.stdout);
                shape = "JSON";
            } catch {}
            this.readShape ??= `${shape}, ${Buffer.byteLength(read.stdout)} bytes for 200 lines`;
            await writeFile(
                join(out, "screens", `${worker.name}.txt`),
                this.clean(read.stdout),
                { mode: 0o600, flag: "wx" },
            );
        }
        if (this.piPane && this.created.panes.includes(this.piPane))
            await writeFile(
                join(out, "screens", "pi.txt"),
                this.clean(await this.paneText(this.piPane, 200)),
                { mode: 0o600, flag: "wx" },
            );
        for (const [from, to] of [
            [
                join(this.layout.pi, "data", "dorothy", "pi", "sessions"),
                "pi-sessions",
            ],
            [this.layout.reports, "reports"],
            [this.layout.briefs, "briefs"],
        ] as const) {
            const names = await readdir(from, { recursive: true }).catch(
                () => [] as string[],
            );
            for (const name of names) {
                const text = await readFile(join(from, name), "utf8").catch(
                    () => null,
                );
                if (text === null) continue;
                const dest = join(out, to, name);
                await mkdir(dirname(dest), { recursive: true, mode: 0o700 });
                await writeFile(dest, this.clean(text), {
                    mode: 0o600,
                    flag: "wx",
                });
            }
        }
    }

    // Closes the panes this trial made, newest first, and nothing else;
    // its workspace only if no pane is left in it. Stops what it started.
    async cleanup() {
        const { cleanup } = this.result;
        // A short, separately recorded grace may close owned resources;
        // any use of it still prevents a passing wall-limit result.
        this.cleanupUntil = this.deadline + 10_000;
        cleanup.graceMs = Math.max(0, this.now() - this.deadline);
        for (const pane of [...this.created.panes].reverse()) {
            const closed = await this.ask(["pane", "close", pane]).catch(
                () => null,
            );
            if (closed?.ok) cleanup.closed.push(pane);
            else cleanup.failed.push(pane);
        }
        const workspace = this.created.workspace;
        if (workspace) {
            const listed = await this.ask([
                "pane",
                "list",
                "--workspace",
                workspace,
            ]).catch(() => null);
            const left = (
                (listed?.body?.result as { panes?: { pane_id?: string }[] })
                    ?.panes ?? []
            ).map((p) => String(p.pane_id));
            if (listed?.ok && left.length === 0)
                await this.ask(["workspace", "close", workspace]).catch(
                    () => null,
                );
            cleanup.leftOpen.push(...left);
        }
        await this.bounded(
            this.proxy?.close() ?? Promise.resolve(),
            1000,
        ).catch(() => {
            cleanup.failed.push("proxy");
            cleanup.overrun = true;
        });
        await this.bounded(
            this.memory?.stop() ?? Promise.resolve(),
            1000,
        ).catch(() => {
            cleanup.failed.push("memory");
            cleanup.overrun = true;
        });
        cleanup.graceMs = Math.max(0, this.now() - this.deadline);
        cleanup.overrun ||= this.now() > this.deadline;
        await this.event("cleanup", { cleanup });
    }

    // Everything measured, once the trial has ended.
    async conclude() {
        const { result } = this;
        const kit = this.kit;
        const tasks = this.fleetId
            ? this.withLedger((l) =>
                  l.tasks().map((t) => ({
                      task: t,
                      receipts: l.receipts(t.taskId),
                      operations: l.operations(t.taskId),
                  })),
              )
            : [];
        result.tasks = tasks.map(({ task, receipts }) => ({
            taskId: task.taskId,
            worker: task.workerId,
            state: task.state,
            code: task.code,
            revision: task.revision,
            owned: !!this.owned(task.taskId),
            receipts: receipts.map((r) => ({
                revision: r.revision,
                exitCode: r.exitCode,
            })),
        }));
        // No task dispatched twice, and no brief under two tasks.
        const dispatches = tasks.reduce(
            (n, t) =>
                n +
                Math.max(
                    0,
                    t.operations.filter(
                        (op) =>
                            op.kind === "dispatch" && op.state !== "pending",
                    ).length - 1,
                ),
            0,
        );
        const sentBriefs = new Map<string, number>();
        for (const { task } of tasks) {
            if (task.state === "intent") continue;
            sentBriefs.set(
                task.briefPath,
                (sentBriefs.get(task.briefPath) ?? 0) + 1,
            );
        }
        result.duplicateAssignments =
            dispatches +
            [...sentBriefs.values()].reduce(
                (n, c) => n + Math.max(0, c - 1),
                0,
            );
        for (const { task, receipts } of tasks) {
            if (this.owned(task.taskId)?.kind !== "review") continue;
            const text = await readFile(task.reportPath, "utf8").catch(
                () => "",
            );
            result.reviews.push(
                measureReview(task.taskId, text, task.revision, receipts),
            );
        }
        // The review loop: a first fix the owner failed and the examples
        // passed (the incomplete one), its review measured, a later fix
        // verified. A first fix right first time leaves it unexercised.
        const fixes = tasks.filter(
            (t) =>
                this.owned(t.task.taskId)?.kind === "fix" &&
                t.receipts.length > 0,
        );
        const first = fixes[0];
        const incomplete = fixes.find(
            (t) =>
                t.receipts.at(-1)?.exitCode !== 0 &&
                this.incomplete.get(t.task.taskId) === true,
        );
        const verifiedFix = [...fixes]
            .reverse()
            .find((t) => t.task.state === "verified");
        const reviewed = incomplete
            ? result.reviews.find(
                  (r) =>
                      r.reviewedRevision === incomplete.task.revision &&
                      r.verdict === "changes-requested" &&
                      r.ownerPassed === false &&
                      r.agree === true,
              )
            : undefined;
        const finalReview = verifiedFix
            ? result.reviews.find(
                  (r) =>
                      r.reviewedRevision === verifiedFix.task.revision &&
                      r.verdict === "approved" &&
                      r.ownerPassed === true &&
                      r.agree === true,
              )
            : undefined;
        if (!first) {
            result.reviewLoop = {
                status: "incomplete",
                incompleteFix: null,
                detail: "no fix reached the owner's test",
            };
        } else if (first.receipts.at(-1)?.exitCode === 0) {
            result.reviewLoop = {
                status: "not-exercised",
                incompleteFix: null,
                detail: `the implementer was right first time (${first.task.taskId}): nothing for the review to catch`,
            };
        } else if (incomplete && reviewed && verifiedFix && finalReview) {
            result.reviewLoop = {
                status: "exercised",
                incompleteFix: incomplete.task.taskId,
                detail: `${incomplete.task.taskId} passed the examples and failed the owner's test; ${reviewed.taskId} said ${reviewed.verdict}; ${verifiedFix.task.taskId} verified`,
            };
        } else {
            result.reviewLoop = {
                status: "incomplete",
                incompleteFix: incomplete?.task.taskId ?? null,
                detail: "the loop did not reach a measured review and a verified fix",
            };
        }
        if (verifiedFix && kit) {
            const worker = this.workers.find(
                (w) => w.spec.id === verifiedFix.task.workerId,
            );
            const clone = worker
                ? this.layout.clones[worker.spec.harness]
                : null;
            const revision = verifiedFix.task.revision as string;
            if (clone && this.remaining() > 0)
                kit.timeoutMs = Math.min(kit.timeoutMs, this.remaining());
            result.finalRevision = {
                taskId: verifiedFix.task.taskId,
                revision,
                receiptPassed: verifiedFix.receipts.some(
                    (r) => r.revision === revision && r.exitCode === 0,
                ),
                examplesPassed:
                    clone && this.remaining() > 0
                        ? (await runExamples(kit, clone, revision)) === 0
                        : false,
                reviewAccepted: finalReview !== undefined,
                headAtEnd: clone
                    ? await headOf(clone, this.ownerEnv).catch(() => null)
                    : null,
            };
        }
        if (result.compaction && this.proxy)
            result.compaction.callsAfter =
                this.proxy.calls.length - result.compaction.callsBefore;
        const calls = this.proxy?.calls ?? [];
        if (calls.length > 0) {
            result.kind = "model-driven";
            result.note = NOTE;
        }
        const forwarded = calls.filter((c) => c.reservedUsd > 0);
        const unmeasured = forwarded.filter((c) => c.costUsd === null).length;
        const known = forwarded.reduce((n, c) => n + (c.costUsd ?? 0), 0);
        result.cost = {
            calls: forwarded.length,
            refused: calls.length - forwarded.length,
            measuredUsd: unmeasured > 0 ? null : known,
            knownUsd: known,
            unmeasuredCalls: unmeasured,
            reservedUsd: this.proxy?.spentUsd() ?? 0,
            tokens:
                unmeasured > 0
                    ? null
                    : {
                          prompt: forwarded.reduce(
                              (n, c) => n + (c.reply.usage?.prompt ?? 0),
                              0,
                          ),
                          completion: forwarded.reduce(
                              (n, c) => n + (c.reply.usage?.completion ?? 0),
                              0,
                          ),
                      },
            source: "each reply's streamed usage x the manifest's prices; a call without usage keeps its reservation and its cost is unknown",
        };
        const cut = result.interruption;
        result.unverified = [
            {
                behaviour: "herdr agent read --format text output shape",
                observed: this.readShape ?? "not observed",
            },
            {
                behaviour: "terminal_id on a new occupant of the same pane",
                observed:
                    cut?.terminalChanged === null || !cut
                        ? "not observed"
                        : cut.terminalChanged
                          ? `changed (${cut.terminalBefore} to ${cut.terminalAfter})`
                          : "unchanged: the engine cannot tell the new occupant by its terminal",
            },
            {
                behaviour: "ui_prompt_start/end covers every blocking dialog",
                observed: `Pi's pane seen blocked ${this.piBlocked} time(s); compare screens/pi.txt by hand`,
            },
            {
                behaviour: "the stewardship skill is followed",
                observed:
                    "judged by hand from pi-sessions/ (tool order, waits, no claimed verification)",
            },
        ];
        await this.scanForKey();
        result.checks = this.checks();
    }

    private keyAtRest = false;

    async scanForKey() {
        if (!this.key) return;
        for (const root of [
            this.layout.pi,
            this.layout.run,
            this.layout.fixture,
            this.layout.owner,
        ]) {
            const names = await readdir(root, { recursive: true }).catch(
                () => [] as string[],
            );
            for (const name of names) {
                const text = await readFile(join(root, name), "utf8").catch(
                    () => "",
                );
                if (text.includes(this.key)) this.keyAtRest = true;
            }
        }
    }

    checks(): Check[] {
        const { result } = this;
        const made = new Set(this.created.panes);
        const closed = new Set(result.cleanup.closed);
        const cut = result.interruption;
        const compaction = result.compaction;
        const final = result.finalRevision;
        return [
            {
                id: "registry-owned",
                ok: this.foreign === null,
                detail:
                    this.foreign ??
                    "every registry entry was a pane, name and clone the trial made",
            },
            {
                id: "kit-intact",
                ok: !this.compromised,
                detail: this.compromised
                    ? "ACCEPTANCE_CHANGED: rebuild the owner root before another trial"
                    : "the owner's test files stayed sealed",
            },
            {
                id: "no-duplicate-assignment",
                ok: result.duplicateAssignments === 0,
                detail: `${result.duplicateAssignments} duplicate assignment(s)`,
            },
            {
                id: "final-revision",
                ok: final
                    ? final.receiptPassed &&
                      final.examplesPassed &&
                      final.reviewAccepted
                    : null,
                detail: final
                    ? `${final.taskId} at ${final.revision.slice(0, 12)}: receipt ${final.receiptPassed}, examples ${final.examplesPassed}`
                    : "no fix verified",
            },
            {
                id: "honest-states",
                ok: result.honesty
                    ? result.honesty.mismatches.length === 0
                    : null,
                detail: result.honesty
                    ? result.honesty.mismatches.join("; ") ||
                      "Pi's states match the ledger"
                    : "Pi wrote no state report",
            },
            {
                id: "worker-failure",
                ok:
                    cut?.exited &&
                    cut.occupantChanged === true &&
                    !cut.guardRefused
                        ? true
                        : null,
                detail: cut
                    ? cut.exited
                        ? `${cut.worker} quit mid-${cut.taskId}; a new occupant was observed`
                        : cut.guardRefused
                          ? `the occupant guard refused to interrupt ${cut.worker}`
                          : `${cut.worker} did not exit`
                    : "no worker was interrupted",
            },
            {
                id: "compaction",
                ok:
                    compaction?.confirmed && compaction.callsAfter > 0
                        ? true
                        : null,
                detail: compaction
                    ? `confirmed ${compaction.confirmed}, ${compaction.callsAfter} request(s) after`
                    : "Pi was not compacted with work in flight",
            },
            {
                id: "review-loop",
                ok: result.reviewLoop.status === "exercised" ? true : null,
                detail: `${result.reviewLoop.status}: ${result.reviewLoop.detail}`,
            },
            {
                id: "within-limits",
                ok:
                    result.cost.calls <= this.args.maxTurns &&
                    result.cost.reservedUsd <= this.args.maxUsd &&
                    this.now() - Date.parse(result.startedAt) <=
                        this.args.timeoutMs &&
                    !result.cleanup.overrun,
                detail: `${result.cost.calls} request(s) of ${this.args.maxTurns}, at most US$${result.cost.reservedUsd.toFixed(6)} of ${this.args.maxUsd}; elapsed ${this.now() - Date.parse(result.startedAt)} ms of ${this.args.timeoutMs}; cleanup overrun ${result.cleanup.overrun}`,
            },
            {
                id: "no-key-at-rest",
                ok: !this.keyAtRest,
                detail: "no file the trial made holds the upstream key",
            },
            {
                id: "cleanup",
                ok:
                    made.size === closed.size &&
                    [...made].every((pane) => closed.has(pane)),
                detail: `closed ${result.cleanup.closed.length} of ${made.size} pane(s) it made, nothing else`,
            },
        ];
    }

    sanitize(text: string) {
        return this.clean(text);
    }
}

// The trial's briefs: two fixes with a retry each, a review after each.
function planBriefs(
    layout: TrialLayout,
    base: string,
): (Omit<Brief, "digest"> & { text: string })[] {
    const report = (id: string) => join(layout.reports, `${id}.md`);
    const impl = layout.clones.codex;
    const fix = (
        id: string,
        step: string,
        retryOf?: string,
        partial = false,
    ) => ({
        taskId: id,
        kind: "fix" as const,
        worker: "trial-codex",
        harness: "codex" as const,
        path: join(layout.briefs, `${id}.md`),
        report: report(id),
        checkpoint: partial ? join(layout.checkpoints, `${id}.ready`) : null,
        text: [
            `Task: ${id}`,
            "Worker: trial-codex",
            `Base: ${base}`,
            `Clone: ${impl}`,
            `Report: ${report(id)}`,
            "",
            `# ${id}`,
            "",
            "You are the implementer in a bounded trial of Dorothy's",
            `stewardship. Work in your clone alone, ${impl}.`,
            "",
            `1. Run \`git switch -c trial/${id}\` from your current HEAD.`,
            `2. ${step}`,
            ...(partial
                ? [
                      "   TRIAL-ONLY DECLARED PARTIAL CANDIDATE: trim leading and trailing",
                      "   hyphens, but do not add Unicode normalization or diacritic folding.",
                      "   This deliberate fault injection is not an unprompted model mistake.",
                  ]
                : []),
            "3. Run `bun src/example.ts`, then commit; your new HEAD is",
            "   the revision. If the declared candidate is already committed, keep it.",
            ...(partial
                ? [
                      `4. Checkpoint: ${join(layout.checkpoints, `${id}.ready`)}`,
                      "   After committing, wait for that exact owner-created file to exist.",
                      "   Do not create, edit or delete it, and do not report before it exists.",
                      "   Remain on this task while waiting; the runner controls the checkpoint.",
                      "5. Write the report at the path above in the format CONTRACT.md",
                  ]
                : [
                      "4. Write the report at the path above in the format CONTRACT.md",
                  ]),
            `   gives, with \`Task: ${id}\`.`,
            "",
            ...(retryOf
                ? [
                      `A previous attempt, task ${retryOf}, ended before its report.`,
                      "Start from your clone's current state.",
                      "",
                  ]
                : []),
            "Edit nothing outside your clone and the report: not CONTRACT.md,",
            "not the briefs.",
            "",
        ].join("\n"),
    });
    const review = (id: string, of: string[]) => ({
        taskId: id,
        kind: "review" as const,
        worker: "trial-claude",
        harness: "claude" as const,
        path: join(layout.briefs, `${id}.md`),
        report: report(id),
        checkpoint: null,
        text: [
            `Task: ${id}`,
            "Worker: trial-claude",
            `Base: ${base}`,
            `Clone: ${layout.clones.claude}`,
            `Report: ${report(id)}`,
            `Review: ${of.map(report).join(", ")}`,
            `Implementer: ${impl}`,
            "",
            `# ${id}`,
            "",
            "You are the independent reviewer in a bounded trial of",
            `Dorothy's stewardship. Work in your clone alone, ${layout.clones.claude}.`,
            "",
            "1. The fix to review is the first report on the `Review:` line",
            "   that exists; its `Revision:` line names the commit.",
            `2. Run \`git fetch ${impl} '+refs/heads/*:refs/remotes/impl/*'\`,`,
            "   then `git checkout --detach <that revision>`.",
            "3. Review the change against CONTRACT.md; you may run",
            "   `bun src/example.ts`. Change no code.",
            "4. Write the report at the path above, these lines first:",
            "",
            `   Task: ${id}`,
            "   Status: approved | changes-requested",
            `   Base: ${base}`,
            "   Revision: <the reviewed commit, its full hash>",
            "   Findings: <what is missing or wrong, or none>",
            "",
        ].join("\n"),
    });
    return [
        fix(
            "fix-1",
            "Change only `src/slug.ts` for the declared partial candidate.",
            undefined,
            true,
        ),
        fix(
            "fix-1b",
            "Reestablish the same declared partial candidate; do not complete the contract yet.",
            "fix-1",
            true,
        ),
        review("review-1", ["fix-1b", "fix-1"]),
        fix(
            "fix-2",
            `Read the review at ${report("review-1")} and address its findings.`,
        ),
        fix(
            "fix-2b",
            `Read the review at ${report("review-1")} and address its findings.`,
            "fix-2",
        ),
        review("review-2", ["fix-2b", "fix-2"]),
    ];
}

// The user's first turn, one line: who, which briefs, the rules.
export function kickoff(briefs: readonly Brief[], base: string): string {
    return [
        "This is the bounded stewardship trial; the user is away and this runner speaks for them.",
        "Coordinate the declared workers trial-codex (implementer) and trial-claude (reviewer) with your worker tools, following your stewardship skill.",
        `Use baseOid ${base} for every task.`,
        "The briefs, each under its own task id:",
        ...briefs.map(
            (b) =>
                `${b.taskId} to ${b.worker}: brief ${b.path} report ${b.report};`,
        ),
        "Start with fix-1. When a fix reports, dispatch the review that names it; if the review requests changes or the owner fails the fix, dispatch the next fix and then its review.",
        "Use a b brief (fix-1b, fix-2b) only for a fix released or failed before it reported.",
        "Never reuse a task id or dispatch a brief twice.",
        "The owner verifies every report from the worker's clone and the ledger shows the outcome: never call a task verified yourself.",
    ].join(" ");
}

export const finalPrompt = (path: string) =>
    "The owner has verified the final fix. Reconcile, then write " +
    `${path} with one line per task you dispatched, exactly ` +
    "`<task id>: <state>` as the ledger has it, and stop.";

function blank(args: TrialArgs, started: Date): TrialResult {
    return {
        mode: "live",
        kind: "not-run",
        status: "incomplete",
        outputOwned: false,
        note: NOT_RUN,
        startedAt: started.toISOString(),
        finishedAt: started.toISOString(),
        elapsedMs: 0,
        limits: {
            maxUsd: args.maxUsd,
            maxTurns: args.maxTurns,
            timeoutMs: args.timeoutMs,
        },
        pending: [],
        error: null,
        stopped: null,
        versions: {},
        model: MODEL,
        metadata: null,
        accounts: [],
        quota: [],
        fixtureRevision: null,
        briefs: [],
        prompts: [],
        registry: null,
        tasks: [],
        reviews: [],
        reviewLoop: { status: "incomplete", incompleteFix: null, detail: "" },
        interruption: null,
        compaction: null,
        checkpoints: [],
        interventions: [],
        duplicateAssignments: 0,
        finalRevision: null,
        honesty: null,
        cost: {
            calls: 0,
            refused: 0,
            measuredUsd: 0,
            knownUsd: 0,
            unmeasuredCalls: 0,
            reservedUsd: 0,
            tokens: null,
            source: "",
        },
        unverified: [],
        cleanup: {
            closed: [],
            failed: [],
            leftOpen: [],
            graceMs: 0,
            overrun: false,
        },
        checks: [],
    };
}

// The required checks, any unmet: the trial did not show it.
const REQUIRED = [
    "final-revision",
    "honest-states",
    "worker-failure",
    "compaction",
    "review-loop",
];

// Claim the absent output and its event stream only by exclusive creation.
// A caller that lost this race gets a returned/CLI problem, not a write
// through the winning path. Existing ancestors are checked again here.
async function ownEvidenceOutput(out: string): Promise<string | null> {
    const ancestors = await nonlinkDirectory(dirname(out));
    if (ancestors) return `invalid --out path: ${ancestors}`;
    try {
        await mkdir(out, { mode: 0o700 });
        await writeFile(join(out, "events.jsonl"), "", {
            mode: 0o600,
            flag: "wx",
        });
        return null;
    } catch (error) {
        return `--out ${out} could not be claimed exclusively: ${(error as Error).message}`;
    }
}

// Runs the trial, or says why it cannot start. An owned `--out` gets
// sanitized evidence: result.json, report.md, events.jsonl, ledger.json,
// screens, Pi's sessions, briefs and reports. A rejected output keeps its
// original bytes and gets nothing; the returned problems and CLI stay
// actionable. The returned result otherwise keeps the real paths.
export async function runTrial(
    args: TrialArgs,
    deps: TrialDeps,
): Promise<TrialResult> {
    const started = deps.now();
    const result = blank(args, started);
    const deadline = started.getTime() + args.timeoutMs;
    const checked = await preflight(args, deps, deadline);
    const { layout } = checked;
    const finishPending = async (
        problems: string[],
        evidenceOwned: boolean,
    ) => {
        result.status = "pending";
        result.pending = [...problems, "", ...checklist(layout)];
        const finished = deps.now();
        result.finishedAt = finished.toISOString();
        result.elapsedMs = finished.getTime() - started.getTime();
        if (evidenceOwned) {
            // Returned paths stay actionable; exported ones are scrubbed.
            await writeEvidence(
                layout,
                result,
                pathSanitizer(layout, deps.env.HOME),
            );
        }
        return result;
    };
    if (checked.outputRejected)
        return finishPending(checked.ok ? [] : checked.problems, false);
    const ownershipProblem = await ownEvidenceOutput(layout.out);
    if (ownershipProblem)
        return finishPending(
            [...(checked.ok ? [] : checked.problems), ownershipProblem],
            false,
        );
    result.outputOwned = true;
    if (!checked.ok || deps.now().getTime() >= deadline) {
        return finishPending(
            [
                ...(checked.ok ? [] : checked.problems),
                ...(checked.ok
                    ? ["the wall deadline elapsed during preflight"]
                    : []),
            ],
            true,
        );
    }
    result.accounts = checked.accounts;
    const trial = new Trial(args, deps, layout, result, deadline);
    try {
        await trial.go();
    } catch (error) {
        result.error = (error as Error).message;
        await trial.event("error", { error: result.error }).catch(() => {});
    } finally {
        await trial.capture().catch(() => {});
        await trial.cleanup().catch(() => {});
        await trial.conclude().catch((error: Error) => {
            result.error ??= `conclude: ${error.message}`;
        });
        const failed = result.checks.some((c) => c.ok === false);
        const unmet = result.checks.some(
            (c) => REQUIRED.includes(c.id) && c.ok === null,
        );
        result.status = failed
            ? "fail"
            : result.error || result.stopped || unmet
              ? "incomplete"
              : "pass";
        const finished = deps.now();
        result.finishedAt = finished.toISOString();
        result.elapsedMs = finished.getTime() - started.getTime();
        if (result.reviewLoop.status === "not-exercised")
            result.pending.push(
                "the review loop was not exercised: the implementer was right first time",
            );
        if (result.cost.measuredUsd === null)
            result.pending.push(
                "a request's usage is unknown: its cost is unknown, never zero",
            );
        await writeEvidence(
            layout,
            result,
            (text) => trial.sanitize(text),
            trial,
        );
    }
    return result;
}

async function writeEvidence(
    layout: TrialLayout,
    result: TrialResult,
    clean: (text: string) => string,
    trial?: Trial,
) {
    const { out } = layout;
    await writeFile(
        join(out, "result.json"),
        clean(`${JSON.stringify(result, null, 2)}\n`),
        { mode: 0o600, flag: "wx" },
    );
    await writeFile(join(out, "report.md"), clean(trialMarkdown(result)), {
        mode: 0o600,
        flag: "wx",
    });
    if (!trial) return;
    await writeFile(
        join(out, "ledger.json"),
        clean(
            `${JSON.stringify(
                result.tasks.map((t) => ({ ...t })),
                null,
                2,
            )}\n`,
        ),
        { mode: 0o600, flag: "wx" },
    );
}

// The result as Markdown, for the report beside result.json.
export function trialMarkdown(result: TrialResult): string {
    const mark = (ok: boolean | null) =>
        ok === null ? "not shown" : ok ? "pass" : "FAIL";
    const money = (n: number | null) =>
        n === null ? "unknown" : `US$${n.toFixed(6)}`;
    const lines = [
        "# Pi stewardship trial: live",
        "",
        result.note,
        "",
        `Status: ${result.status}. Started ${result.startedAt}, ` +
            `${Math.round(result.elapsedMs / 1000)} s. Limits: ` +
            `US$${result.limits.maxUsd}, ${result.limits.maxTurns} requests, ` +
            `${result.limits.timeoutMs} ms.` +
            (result.stopped ? ` Stopped: ${result.stopped}.` : "") +
            (result.error ? ` Error: ${result.error}.` : ""),
        "",
    ];
    if (result.pending.length > 0)
        lines.push(
            "Pending:",
            "",
            ...result.pending.map((p) => (p ? `- ${p}` : "")),
            "",
        );
    lines.push(
        `Model ${result.model}; versions: ${
            Object.entries(result.versions)
                .map(([k, v]) => `${k} ${v}`)
                .join(", ") || "unread"
        }. Fixture base ${result.fixtureRevision ?? "none"}.`,
        "",
        `Cost: ${money(result.cost.measuredUsd)} measured over ` +
            `${result.cost.calls} request(s) (${result.cost.unmeasuredCalls} ` +
            `without usage, so unknown; ${money(result.cost.knownUsd)} known, ` +
            `at most ${money(result.cost.reservedUsd)} reserved). ` +
            result.cost.source +
            ".",
        "",
        "| Check | Result | Detail |",
        "| --- | --- | --- |",
        ...result.checks.map(
            (c) => `| ${c.id} | ${mark(c.ok)} | ${c.detail} |`,
        ),
        "",
        "| Task | Worker | State | Code | Receipts |",
        "| --- | --- | --- | --- | --- |",
        ...result.tasks.map(
            (t) =>
                `| ${t.taskId} | ${t.worker} | ${t.state} | ${t.code ?? "-"} | ` +
                `${t.receipts.map((r) => `${r.revision.slice(0, 12)} exit ${r.exitCode}`).join(", ") || "none"} |`,
        ),
        "",
        `Review loop: ${result.reviewLoop.status} (${result.reviewLoop.detail}).`,
        "The first candidate is deliberate runner fault injection, not an unprompted model mistake.",
        `Checkpoints released: ${result.checkpoints.map((c) => `${c.taskId} while ${c.state}`).join(", ") || "none"}.`,
        "",
        "| Review | Verdict | Owner passed | Agree |",
        "| --- | --- | --- | --- |",
        ...result.reviews.map(
            (r) =>
                `| ${r.taskId} | ${r.verdict} | ${r.ownerPassed ?? "none"} | ${r.agree ?? "undecided"} |`,
        ),
        "",
        "Interventions:",
        "",
        ...(result.interventions.length > 0
            ? result.interventions.map(
                  (i) =>
                      `- ${i.at} ${i.by} ${i.kind}${i.taskId ? ` ${i.taskId}` : ""}: ${i.detail}`,
              )
            : ["- none"]),
        "",
        "Unverified behaviours, as observed:",
        "",
        ...result.unverified.map((u) => `- ${u.behaviour}: ${u.observed}`),
        "",
    );
    return lines.join("\n");
}
