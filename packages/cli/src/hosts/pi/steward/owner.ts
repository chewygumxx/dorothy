// vim:set expandtab shiftwidth=4 filetype=typescript:
// SPDX-License-Identifier: GPL-3.0-only

//
//
// ~xxdorothy/dorothy.git
// ::: :/packages/cli/src/hosts/pi/steward/owner.ts
//
//

// The trial runner's side of the fixture, which a worker never holds: the
// fixture repository, the owner's acceptance test, and `verifySubmission`,
// the only code that writes a verification receipt. It takes the revision
// from the worker's clone itself (`git rev-parse HEAD`), never from the
// report, exports exactly that commit to a directory under the owner's
// root, runs the owner's acceptance test there (the submitted code in a
// child that only answers, the expected outputs held by the parent), and
// only then records a receipt for the revision it computed. A report that
// claims another revision, or that changed since the ledger saw it, gets
// no receipt.
//
// A receipt is independent evidence against a worker's report: a claimed
// revision, command or pass. It is not evidence against hostile code. That
// code runs as the runner's user, with no OS confinement, and can read the
// expected cases from the test's files, change the owner's files between
// the checks and restore them, or write into the test's output. The child,
// the nonce (which stops a reply printed ahead of the child's own, not code
// that wraps `process.stdout.write`) and the re-reading of the sealed files
// catch accident and in-band forgery only.

import { createHash } from "node:crypto";
import {
    cp,
    lstat,
    mkdir,
    readFile,
    realpath,
    rm,
    writeFile,
} from "node:fs/promises";
import { dirname, join, relative, resolve, sep } from "node:path";
import type { Receipt } from "./ledger.js";
import type { CompletionEvidence, TaskRecord } from "./types.js";

// The fixture template: `repo/` is what a worker clones, `owner/` stays here.
export const FIXTURE = join(
    import.meta.dir,
    "..",
    "..",
    "..",
    "..",
    "assets",
    "pi",
    "stewardship",
    "fixture",
);
const MAX_LOG_BYTES = 64 * 1024;
const MAX_REPORT_BYTES = 64 * 1024;
export const ACCEPTANCE_TIMEOUT_MS = 30_000;

// What the runner's children get: a path to find git and tar, and a home of
// their own. No variable of the caller's passes.
export type OwnerEnv = { PATH: string; home: string };

export type OwnerKit = {
    // Outside the fixture root and every worker's clone.
    root: string;
    env: OwnerEnv;
    // The test's entry point and the digest of every file it is made of
    // (the test, its child, the Bun config), sealed when the kit is made
    // and read again before and after each run.
    acceptance: { path: string; digest: string };
    sealed: { path: string; digest: string }[];
    timeoutMs: number;
};

const sha256 = (data: Uint8Array) =>
    `sha256:${createHash("sha256").update(data).digest("hex")}`;

// One identity and date for every commit the fixture makes, so the same
// change from the same base is the same commit.
const IDENTITY = {
    GIT_AUTHOR_NAME: "Fixture",
    GIT_AUTHOR_EMAIL: "fixture@example.invalid",
    GIT_AUTHOR_DATE: "2026-11-04T09:00:00Z",
    GIT_COMMITTER_NAME: "Fixture",
    GIT_COMMITTER_EMAIL: "fixture@example.invalid",
    GIT_COMMITTER_DATE: "2026-11-04T09:00:00Z",
};

const gitEnv = (env: OwnerEnv): Record<string, string> => ({
    PATH: env.PATH,
    HOME: env.home,
    GIT_CONFIG_NOSYSTEM: "1",
    GIT_CONFIG_GLOBAL: "/dev/null",
    GIT_TERMINAL_PROMPT: "0",
    ...IDENTITY,
});

type Ran = { code: number; stdout: string; stderr: string };

async function run(
    argv: string[],
    cwd: string,
    env: Record<string, string>,
    timeoutMs = 15_000,
): Promise<Ran> {
    const child = Bun.spawn(argv, {
        cwd,
        env,
        stdin: "ignore",
        stdout: "pipe",
        stderr: "pipe",
        timeout: timeoutMs,
        killSignal: "SIGKILL",
    });
    const [stdout, stderr, code] = await Promise.all([
        new Response(child.stdout).text(),
        new Response(child.stderr).text(),
        child.exited,
    ]);
    return { code, stdout, stderr };
}

async function git(args: string[], cwd: string, env: OwnerEnv): Promise<Ran> {
    return run(["git", ...args], cwd, gitEnv(env));
}

async function mustGit(
    args: string[],
    cwd: string,
    env: OwnerEnv,
): Promise<string> {
    const out = await git(args, cwd, env);
    if (out.code !== 0) {
        throw new Error(`git ${args[0]} failed: ${out.stderr.trim()}`);
    }
    return out.stdout.trim();
}

// The fixture repository, one commit on `main` from the template: the
// owner's origin, which each worker clones.
export async function createOrigin(
    dir: string,
    env: OwnerEnv,
): Promise<string> {
    await cp(join(FIXTURE, "repo"), dir, { recursive: true });
    await mustGit(["init", "-q", "-b", "main"], dir, env);
    await mustGit(["add", "-A"], dir, env);
    await mustGit(["commit", "-q", "-m", "Fixture: slugify"], dir, env);
    return mustGit(["rev-parse", "HEAD"], dir, env);
}

export async function cloneOrigin(
    origin: string,
    dest: string,
    env: OwnerEnv,
): Promise<void> {
    await mkdir(dirname(dest), { recursive: true });
    await mustGit(["clone", "-q", origin, dest], dirname(dest), env);
}

// A worker's commit of its clone's changes; the new `HEAD`.
export async function commitAll(
    clone: string,
    message: string,
    env: OwnerEnv,
): Promise<string> {
    await mustGit(["add", "-A"], clone, env);
    await mustGit(["commit", "-q", "--allow-empty", "-m", message], clone, env);
    return mustGit(["rev-parse", "HEAD"], clone, env);
}

export const headOf = (clone: string, env: OwnerEnv) =>
    mustGit(["rev-parse", "HEAD"], clone, env);

// A path is inside a directory when it is the directory or beneath it.
const inside = (dir: string, path: string) => {
    const rel = relative(dir, path);
    return rel === "" || (!rel.startsWith("..") && !rel.startsWith(sep));
};

// The owner's root, made private and outside the fixture root (where every
// worker's clone lives), holding the acceptance test, an empty Bun config
// for the run, the home of the children, the logs and the exports.
export async function createOwnerKit(options: {
    root: string;
    fixtureRoot: string;
    env: OwnerEnv;
    timeoutMs?: number;
}): Promise<OwnerKit> {
    const root = resolve(options.root);
    const fixtureRoot = await realpath(options.fixtureRoot);
    await mkdir(root, { recursive: true, mode: 0o700 });
    const real = await realpath(root);
    if (inside(fixtureRoot, real) || inside(real, fixtureRoot)) {
        throw new Error("OWNER_ROOT_INSIDE_FIXTURE");
    }
    const path = join(real, "acceptance", "acceptance.ts");
    await mkdir(dirname(path), { recursive: true });
    const sealed: OwnerKit["sealed"] = [];
    const place = async (from: string, to: string, content?: Uint8Array) => {
        const source = content ?? (await readFile(from));
        await writeFile(to, source, { mode: 0o400 });
        sealed.push({ path: to, digest: sha256(source) });
    };
    await place(join(FIXTURE, "owner", "acceptance.ts"), path);
    await place(
        join(FIXTURE, "owner", "child.ts"),
        join(dirname(path), "child.ts"),
    );
    await place("", join(real, "bunfig.toml"), new Uint8Array());
    await mkdir(options.env.home, { recursive: true });
    return {
        root: real,
        env: options.env,
        acceptance: {
            path,
            digest: sha256(Buffer.from(sealed.map((f) => f.digest).join("\n"))),
        },
        sealed,
        timeoutMs: options.timeoutMs ?? ACCEPTANCE_TIMEOUT_MS,
    };
}

// True when every sealed file is as it was made. Submitted code runs as the
// runner's user, so the test is read again, never assumed.
async function intact(kit: OwnerKit): Promise<boolean> {
    for (const file of kit.sealed) {
        const now = await readFile(file.path).catch(() => null);
        if (!now || sha256(now) !== file.digest) {
            return false;
        }
    }
    return true;
}

export type Pending =
    | "NOT_REPORTED"
    | "NO_CLAIM"
    | "REPORT_CHANGED"
    | "CLONE_UNREADABLE"
    | "CLAIM_MISMATCH"
    | "NOT_FROM_BASE"
    | "ACCEPTANCE_CHANGED"
    | "EXPORT_FAILED";

export type OwnerOutcome =
    | {
          kind: "receipt";
          receipt: Receipt;
          evidence: CompletionEvidence;
          passed: boolean;
      }
    // Nothing recorded: the task stays as the ledger has it.
    | {
          kind: "pending";
          why: Pending;
          claimed: string | null;
          actual: string | null;
      };

const pending = (
    why: Pending,
    claimed: string | null,
    actual: string | null = null,
): OwnerOutcome => ({ kind: "pending", why, claimed, actual });

// Takes the commit out of the clone as a tree under the owner's root.
async function exportRevision(
    kit: OwnerKit,
    clone: string,
    revision: string,
    into: string,
): Promise<boolean> {
    const tar = `${into}.tar`;
    await rm(into, { recursive: true, force: true });
    await mkdir(into, { recursive: true });
    const made = await git(
        ["archive", "--format=tar", "--output", tar, revision],
        clone,
        kit.env,
    );
    const taken =
        made.code === 0
            ? await run(
                  ["tar", "-xf", tar, "-C", into],
                  kit.root,
                  { PATH: kit.env.PATH },
                  15_000,
              )
            : made;
    await rm(tar, { force: true });
    // A failed export leaves nothing behind.
    if (taken.code !== 0) {
        await rm(into, { recursive: true, force: true });
    }
    return taken.code === 0;
}

// Verifies a reported task from its worker's clone, or says why not. The
// revision is the clone's `HEAD`, read here; the report's claim must equal
// it, and the report must be the one the ledger holds. Only then is the
// owner's acceptance test run, on an export of exactly that commit, the
// test files sealed before and after, and a receipt for it recorded. A failing run is a receipt too (exit nonzero):
// the engine's `finish` turns it into `failed`.
export async function verifySubmission(
    kit: OwnerKit,
    task: TaskRecord,
    clone: string,
    recordReceipt: (receipt: Receipt) => void,
): Promise<OwnerOutcome> {
    const claimed = task.revision;
    if (task.state !== "reported" || !task.reportDigest) {
        return pending("NOT_REPORTED", claimed);
    }
    if (!claimed) {
        return pending("NO_CLAIM", null);
    }
    const seen = await readFile(task.reportPath).catch(() => null);
    if (
        !seen ||
        seen.length > MAX_REPORT_BYTES ||
        sha256(seen) !== task.reportDigest
    ) {
        return pending("REPORT_CHANGED", claimed);
    }
    if (inside(clone, kit.root) || inside(kit.root, clone)) {
        throw new Error("OWNER_ROOT_INSIDE_CLONE");
    }
    const head = await git(
        ["rev-parse", "--verify", "--quiet", "HEAD^{commit}"],
        clone,
        kit.env,
    );
    const actual = head.stdout.trim();
    if (head.code !== 0 || !/^[0-9a-f]{40,64}$/.test(actual)) {
        return pending("CLONE_UNREADABLE", claimed);
    }
    if (actual !== claimed) {
        return pending("CLAIM_MISMATCH", claimed, actual);
    }
    const base = await git(
        ["merge-base", "--is-ancestor", task.baseOid, actual],
        clone,
        kit.env,
    );
    if (base.code !== 0) {
        return pending("NOT_FROM_BASE", claimed, actual);
    }

    if (!(await intact(kit))) {
        return pending("ACCEPTANCE_CHANGED", claimed, actual);
    }
    const short = `${task.taskId}-${actual.slice(0, 12)}`;
    const exported = join(kit.root, "exports", short);
    if (!(await exportRevision(kit, clone, actual, exported))) {
        return pending("EXPORT_FAILED", claimed, actual);
    }
    // The same words in the receipt and in the evidence given to `finish`.
    const command = ["bun", kit.acceptance.path, exported];
    const ran = await run(
        [
            process.execPath,
            "--no-env-file",
            `--config=${join(kit.root, "bunfig.toml")}`,
            kit.acceptance.path,
            exported,
        ],
        kit.root,
        { PATH: kit.env.PATH, HOME: kit.env.home },
        kit.timeoutMs,
    );
    await rm(exported, { recursive: true, force: true });
    // The submitted code ran as this user: if it touched the test, nothing
    // of this run counts, and no later run is made on the same kit.
    if (!(await intact(kit))) {
        return pending("ACCEPTANCE_CHANGED", claimed, actual);
    }

    const logPath = join(kit.root, "logs", `${short}.log`);
    await mkdir(dirname(logPath), { recursive: true });
    const log = [
        `task: ${task.taskId}`,
        `revision: ${actual}`,
        `report: ${task.reportDigest}`,
        `acceptance: ${kit.acceptance.digest}`,
        `command: ${command.join(" ")}`,
        `exit: ${ran.code}`,
        "",
        (ran.stdout + ran.stderr).slice(0, MAX_LOG_BYTES),
    ].join("\n");
    await writeFile(logPath, log, { mode: 0o600 });

    const receipt: Receipt = {
        taskId: task.taskId,
        revision: actual,
        reportDigest: task.reportDigest,
        command,
        exitCode: ran.code,
        logPath,
    };
    recordReceipt(receipt);
    return {
        kind: "receipt",
        receipt,
        evidence: {
            reportDigest: task.reportDigest,
            revision: actual,
            verification: { command, exitCode: ran.code, logPath },
        },
        passed: ran.code === 0,
    };
}

// The contract's examples (`src/example.ts`) run by the runner itself on an
// export of the revision, as the owner's test is: the exit code alone, for
// telling an incomplete fix (examples pass, the owner's test fails) from a
// wrong one. Never a receipt, and its output is not read: the submitted
// code could write anything there. It runs as the runner's user too.
export async function runExamples(
    kit: OwnerKit,
    clone: string,
    revision: string,
): Promise<number | null> {
    const into = join(kit.root, "exports", `examples-${revision.slice(0, 12)}`);
    if (!(await exportRevision(kit, clone, revision, into))) {
        return null;
    }
    const ran = await run(
        [
            process.execPath,
            "--no-env-file",
            `--config=${join(kit.root, "bunfig.toml")}`,
            join(into, "src", "example.ts"),
        ],
        into,
        { PATH: kit.env.PATH, HOME: kit.env.home },
        kit.timeoutMs,
    );
    await rm(into, { recursive: true, force: true });
    return ran.code;
}

// True when the path is a regular file (a test's look).
export const isFile = async (path: string): Promise<boolean> =>
    (await lstat(path).catch(() => null))?.isFile() ?? false;

export type Verdict = "approved" | "changes-requested" | "unknown";

// A reviewer's verdict, from the `Status:` line of its report: a claim.
export function reviewVerdict(report: string): Verdict {
    const status = /^Status:[ \t]*(\S+)/im.exec(report)?.[1]?.toLowerCase();
    if (
        status &&
        ["approved", "approve", "accepted", "lgtm"].includes(status)
    ) {
        return "approved";
    }
    if (
        status &&
        ["changes-requested", "rejected", "reject", "failed"].includes(status)
    ) {
        return "changes-requested";
    }
    return "unknown";
}

// What the ledger cannot say: a review that rightly rejects and one that
// wrongly approves both end `failed` after a failing receipt. This measure
// holds the reviewer's verdict beside the owner's receipt on the reviewed
// revision; `agree` is null while either is missing.
export type ReviewMeasure = {
    taskId: string;
    reviewedRevision: string | null;
    verdict: Verdict;
    ownerPassed: boolean | null;
    agree: boolean | null;
};

export function measureReview(
    taskId: string,
    report: string,
    reviewedRevision: string | null,
    receipts: readonly Receipt[],
): ReviewMeasure {
    const verdict = reviewVerdict(report);
    const receipt = receipts
        .filter((r) => r.revision === reviewedRevision)
        .at(-1);
    const ownerPassed = receipt ? receipt.exitCode === 0 : null;
    return {
        taskId,
        reviewedRevision,
        verdict,
        ownerPassed,
        agree:
            verdict === "unknown" || ownerPassed === null
                ? null
                : (verdict === "approved") === ownerPassed,
    };
}
