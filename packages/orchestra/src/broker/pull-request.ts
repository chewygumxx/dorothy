// vim:set expandtab shiftwidth=4 filetype=typescript:
// SPDX-License-Identifier: GPL-3.0-only

//
//
// ~chewygumxx/dorothy.git
// ::: :/packages/orchestra/src/broker/pull-request.ts
//
//

// Pull requests: gh, resolved once, in the broker repository with the
// sealed environment, naming the repository and the branch explicitly,
// in a process group of its own killed at its deadline. One whose gh
// dies or passes its deadline is reconciled against the repository's
// pull requests for the branch.

import type { Env } from "@dorothy/core";
import { runGroup } from "./git.js";
import type { Outcome } from "./push.js";
import type { Broker } from "./repository.js";

export const GH_DEADLINE = 60_000;

// gh from PATH, resolved once, at the server's start.
export function resolveGh(env: Env): string {
    const gh = Bun.which("gh", { PATH: env.PATH ?? "" });
    if (gh === null) {
        throw new Error("no gh on PATH");
    }
    return gh;
}

export type GhInput = {
    // resolveGh's.
    gh: string;
    branch: string;
    deadline?: number;
};

// After a push of the branch, which the operations layer checks.
export type PullRequestInput = GhInput & { title: string; body: string };

const runGh = (broker: Broker, input: GhInput, args: string[]) =>
    runGroup([input.gh, ...args], {
        cwd: broker.repo,
        env: broker.env,
        deadline: input.deadline ?? GH_DEADLINE,
    });

export async function openPullRequest(
    broker: Broker,
    input: PullRequestInput,
): Promise<Outcome> {
    const result = await runGh(broker, input, [
        "pr",
        "create",
        "--repo",
        broker.identity,
        "--head",
        input.branch,
        "--title",
        input.title,
        "--body",
        input.body,
    ]);
    if (result.timedOut || result.code > 128) {
        return reconcilePullRequest(broker, input);
    }
    return result.code === 0
        ? { status: "succeeded", detail: result.stdout.trim() }
        : {
              status: "failed",
              detail: result.stderr.trim().split("\n").at(-1) ?? "",
          };
}

type Listed = { url: string; isCrossRepository: boolean }[];

function listed(text: string): Listed | null {
    try {
        const value = JSON.parse(text);
        return Array.isArray(value) ? value : null;
    } catch {
        return null;
    }
}

// A pull request of the branch from the repository itself: succeeded;
// none: failed; no answer: unknown.
export async function reconcilePullRequest(
    broker: Broker,
    input: GhInput,
): Promise<Outcome> {
    const result = await runGh(broker, input, [
        "pr",
        "list",
        "--repo",
        broker.identity,
        "--head",
        input.branch,
        "--state",
        "all",
        "--json",
        "url,isCrossRepository",
    ]);
    const requests =
        result.code === 0 && !result.timedOut ? listed(result.stdout) : null;
    if (requests === null) {
        return { status: "unknown", detail: "gh cannot list pull requests" };
    }
    const own = requests.find((request) => !request.isCrossRepository);
    return own === undefined
        ? { status: "failed", detail: "no pull request of the branch" }
        : { status: "succeeded", detail: own.url };
}
