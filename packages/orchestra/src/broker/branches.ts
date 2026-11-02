// vim:set expandtab shiftwidth=4 filetype=typescript:
// SPDX-License-Identifier: GPL-3.0-only

//
//
// ~chewygumxx/dorothy.git
// ::: :/packages/orchestra/src/broker/branches.ts
//
//

// The branches the broker pushes, for the server's life: each one's last
// pushed OID, which its next plain push expects, and a push whose
// outcome stayed unknown, which is never retried: the branch's next push
// asks the user, showing that record and what the remote holds now. A
// pull request waits on a successful push of its branch.

import type { Work } from "../operations.js";
import { openPullRequest, type PullRequestInput } from "./pull-request.js";
import {
    type Ask,
    type PushRecord,
    pushWork,
    reconcilePush,
    recordPush,
} from "./push.js";
import type { Broker } from "./repository.js";

export type BranchPush = {
    branch: string;
    // The worker's base OID.
    base: string;
    forceWithLease: boolean;
    ask: Ask;
    // The worker's branch brought back: fetchWork's OID.
    fetch: (signal: AbortSignal) => Promise<string>;
};

type Unknown = { operationId: string; record: PushRecord };

type Branch = {
    last: string | null;
    // Until a push of the branch succeeds.
    unknown: Unknown | null;
};

// The unknown push's record, and what the remote holds now.
async function lost(
    broker: Broker,
    { operationId, record }: Unknown,
    signal: AbortSignal,
) {
    const now = await reconcilePush(broker, record, signal);
    return (
        `Operation ${operationId}'s push of ${record.oid} to ${record.ref}, ` +
        `expecting ${record.expected ?? "no branch"}, ended unknown; ` +
        `${now.detail} now.`
    );
}

export class Branches {
    readonly #branches = new Map<string, Branch>();

    #branch(broker: Broker, name: string): Branch {
        const key = `${broker.identity} ${name}`;
        const branch = this.#branches.get(key) ?? { last: null, unknown: null };
        this.#branches.set(key, branch);
        return branch;
    }

    // push_worker's work: the branch fetched, its push recorded, then sent.
    push(broker: Broker, input: BranchPush): Work {
        const branch = this.#branch(broker, input.branch);
        return async (run) => {
            const oid = await input.fetch(run.signal);
            const record = await recordPush(
                broker,
                {
                    branch: input.branch,
                    oid,
                    last: branch.last,
                    forceWithLease: input.forceWithLease,
                },
                run.signal,
            );
            run.record(record);
            const reasons =
                branch.unknown === null
                    ? []
                    : [await lost(broker, branch.unknown, run.signal)];
            const outcome = await pushWork(
                broker,
                record,
                { base: input.base, ask: input.ask, reasons },
                run.signal,
                run.reconcileSignal,
            );
            if (outcome.status === "succeeded") {
                branch.last = oid;
                branch.unknown = null;
            } else if (outcome.status === "unknown") {
                branch.unknown = { operationId: run.operationId, record };
            }
            return outcome;
        };
    }

    // open_pull_request's work, refused for a branch never pushed.
    pullRequest(broker: Broker, input: PullRequestInput): Work {
        if (this.#branch(broker, input.branch).last === null) {
            throw new Error(`no push of ${input.branch} has succeeded`);
        }
        return (run) =>
            openPullRequest(broker, input, run.signal, run.reconcileSignal);
    }
}
