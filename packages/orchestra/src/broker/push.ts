// vim:set expandtab shiftwidth=4 filetype=typescript:
// SPDX-License-Identifier: GPL-3.0-only

//
//
// ~chewygumxx/dorothy.git
// ::: :/packages/orchestra/src/broker/push.ts
//
//

// The push: one fetched commit to one branch of the remote's URL, under
// a lease on what the remote holds there, recorded before it is sent so
// that a worker's branch moving afterwards changes nothing. A fast-forward
// of the last push goes by rule; a forced lease, or a change to a
// dependency manifest or lockfile since the base, asks the user. A push
// whose process dies or passes its deadline is reconciled against the
// remote. Never another branch, a tag, a deletion or a submodule.

import type { Broker } from "./repository.js";

// The user's answer, from the gate's user step.
export type Ask = (question: string) => Promise<"allow" | "deny">;

// What the operations layer records: pending and running are its own.
export type Outcome = {
    status: "succeeded" | "failed" | "unknown";
    detail: string;
};

export type PushRecord = {
    identity: string;
    url: string;
    // refs/heads/<branch>.
    ref: string;
    // The fetched commit, the one pushed.
    oid: string;
    // What the lease expects the remote to hold: null for no branch.
    expected: string | null;
    force: boolean;
};

export type PushInput = {
    branch: string;
    // fetchWork's.
    oid: string;
    // The last OID the broker pushed of the branch, or null for none.
    last: string | null;
    forceWithLease: boolean;
};

export type PushChecks = {
    // The worker's base OID, which dependency changes are measured from.
    base: string;
    ask: Ask;
};

// At any depth.
export const DEPENDENCY_FILES = [
    "package.json",
    "bun.lock",
    "bun.lockb",
    "package-lock.json",
    "pnpm-lock.yaml",
    "yarn.lock",
    "Cargo.toml",
    "Cargo.lock",
    "pyproject.toml",
    "uv.lock",
    "requirements*.txt",
    "go.mod",
    "go.sum",
];

const OID = /^[0-9a-f]{40}([0-9a-f]{24})?$/;

// The remote's OID for the ref, null for none; undefined where it cannot
// be read.
async function remoteOid(
    broker: Broker,
    url: string,
    ref: string,
): Promise<string | null | undefined> {
    const result = await broker.git.run(["ls-remote", "--", url, ref]);
    if (result.code !== 0 || result.timedOut) {
        return undefined;
    }
    const line = result.stdout
        .split("\n")
        .find((entry) => entry.endsWith(`\t${ref}`));
    return line?.split("\t")[0] ?? null;
}

export async function recordPush(
    broker: Broker,
    { branch, oid, last, forceWithLease }: PushInput,
): Promise<PushRecord> {
    if (!OID.test(oid)) {
        throw new Error(`${oid} is no commit to push`);
    }
    const ref = `refs/heads/${branch}`;
    const expected = forceWithLease
        ? await remoteOid(broker, broker.url, ref)
        : last;
    if (expected === undefined) {
        throw new Error(`${broker.identity}'s remote cannot be read`);
    }
    const { identity, url } = broker;
    return { identity, url, ref, oid, expected, force: forceWithLease };
}

// Every recorded value, then what makes the push ask.
const question = (record: PushRecord, reasons: string[]) =>
    [
        `Push ${record.oid} to ${record.ref} of ${record.identity} ` +
            `(${record.url}), expecting ${record.expected ?? "no branch"} there?`,
        ...reasons,
    ].join("\n\n");

const dependencyDiff = (broker: Broker, base: string, oid: string) =>
    broker.git.out([
        "diff",
        "--no-ext-diff",
        "--no-textconv",
        "--no-color",
        base,
        oid,
        "--",
        ...DEPENDENCY_FILES.map((name) => `:(glob)**/${name}`),
    ]);

// A first push, or one whose commit descends from the last.
async function fastForward(broker: Broker, record: PushRecord) {
    if (record.expected === null) {
        return true;
    }
    const result = await broker.git.run([
        "merge-base",
        "--is-ancestor",
        record.expected,
        record.oid,
    ]);
    return result.code === 0;
}

export async function pushWork(
    broker: Broker,
    record: PushRecord,
    { base, ask }: PushChecks,
): Promise<Outcome> {
    if (!record.force && !(await fastForward(broker, record))) {
        return {
            status: "failed",
            detail: "no fast-forward of the last push; push with forceWithLease",
        };
    }
    const reasons = record.force
        ? ["It replaces the branch, under the lease, as asked."]
        : [];
    const diff = await dependencyDiff(broker, base, record.oid);
    if (diff !== "") {
        reasons.push(
            `It changes dependency manifests or lockfiles:\n\n${diff}`,
        );
    }
    if (
        reasons.length > 0 &&
        (await ask(question(record, reasons))) !== "allow"
    ) {
        return { status: "failed", detail: "denied by the user" };
    }
    const result = await broker.git.run([
        "push",
        "--porcelain",
        "--no-follow-tags",
        "--no-recurse-submodules",
        `--force-with-lease=${record.ref}:${record.expected ?? ""}`,
        "--",
        record.url,
        `${record.oid}:${record.ref}`,
    ]);
    // Killed by its deadline or a signal: its effect may have been sent.
    if (result.timedOut || result.code > 128) {
        return reconcilePush(broker, record);
    }
    const line = result.stdout
        .split("\n")
        .find((entry) => entry.includes(`:${record.ref}\t`));
    return result.code === 0
        ? { status: "succeeded", detail: line ?? "" }
        : {
              status: "failed",
              detail: line ?? result.stderr.trim().split("\n").at(-1) ?? "",
          };
}

// The remote holding the pushed OID: succeeded; holding what the lease
// expected: failed; anything else, or no answer: unknown.
export async function reconcilePush(
    broker: Broker,
    record: PushRecord,
): Promise<Outcome> {
    const remote = await remoteOid(broker, record.url, record.ref);
    if (remote === undefined) {
        return { status: "unknown", detail: "the remote cannot be read" };
    }
    const detail = `the remote holds ${remote ?? "no branch"} at ${record.ref}`;
    if (remote === record.oid) {
        return { status: "succeeded", detail };
    }
    return {
        status: remote === record.expected ? "failed" : "unknown",
        detail,
    };
}
