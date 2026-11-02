// vim:set expandtab shiftwidth=4 filetype=typescript:
// SPDX-License-Identifier: GPL-3.0-only

//
//
// ~chewygumxx/dorothy.git
// ::: :/packages/orchestra/src/gate.ts
//
//

import type { Clock, StructuredCall, Timers } from "@dorothy/core";
import type { OrchestraConfig } from "./config.js";
import { beforeDeadline } from "./deadline.js";
import { judgeRequest } from "./judge.js";
import type { Decision, PermissionRequest, RuleContext } from "./rules.js";
import { ruleRequest } from "./rules.js";

export type GateWorker = RuleContext & {
    id: string;
    task: string;
    recentOutput: string;
};
export type Verdict = {
    decision: Decision;
    source: "rule" | "judge" | "user" | "timeout";
    reason: string;
    costUsd?: number;
};
export type Question = {
    workerId: string;
    request: PermissionRequest;
    reason: string;
    deadline: number;
};
export type Answer = {
    decision: "allow" | "deny";
    source: "user" | "timeout";
    reason: string;
};
export type Ask = (question: Question, signal: AbortSignal) => Promise<Answer>;
export type GateLog = {
    event: "request" | "decision";
    workerId: string;
    request: PermissionRequest;
    at: number;
} & Partial<Verdict>;
export type GateOptions = {
    config: OrchestraConfig;
    call: StructuredCall;
    ask: Ask;
    log: (entry: GateLog) => void | Promise<void>;
    clock: Clock;
    timers: Timers;
};
export type GateDecision =
    | { outcome: "selected"; optionId: string }
    | { outcome: "cancel" };
export function createGate(options: GateOptions) {
    const { clock, timers, config } = options;
    return async (
        request: PermissionRequest,
        worker: GateWorker,
        signal: AbortSignal,
    ): Promise<GateDecision> => {
        const record = (verdict: Verdict) =>
            options.log({
                event: "decision",
                workerId: worker.id,
                request,
                at: clock.now(),
                ...verdict,
            });
        let verdict: Verdict = {
            decision: "deny",
            source: "rule",
            reason: "Permission callback failed",
        };
        try {
            await options.log({
                event: "request",
                workerId: worker.id,
                request,
                at: clock.now(),
            });
            if (signal.aborted)
                verdict = {
                    decision: "deny",
                    source: "user",
                    reason: "Worker stopped",
                };
            else {
                const ruling = ruleRequest(request, worker, config);
                verdict =
                    ruling.decision === "judge"
                        ? await judgeRequest(
                              request,
                              worker,
                              {
                                  call: options.call,
                                  clock,
                                  timers,
                                  timeoutSeconds: config.judgeTimeoutSeconds,
                              },
                              signal,
                          )
                        : {
                              ...ruling,
                              decision: ruling.decision,
                              source: "rule",
                          };
                if (verdict.decision === "ask") {
                    await record(verdict);
                    const deadline =
                        clock.now() + config.askTimeoutSeconds * 1000;
                    const question: Question = {
                        workerId: worker.id,
                        request,
                        reason: verdict.reason,
                        deadline,
                    };
                    const response = await beforeDeadline(
                        (signal) => options.ask(question, signal),
                        deadline,
                        signal,
                        clock,
                        timers,
                    );
                    verdict =
                        response.status === "value"
                            ? response.value
                            : {
                                  decision: "deny",
                                  source:
                                      response.status === "timeout"
                                          ? "timeout"
                                          : "user",
                                  reason: `Permission question ${response.status}`,
                              };
                    if (!["allow", "deny"].includes(verdict.decision)) {
                        verdict = {
                            decision: "deny",
                            source: "user",
                            reason: "Invalid permission answer",
                        };
                    }
                }
            }
            if (signal.aborted)
                verdict = {
                    decision: "deny",
                    source: "user",
                    reason: "Worker stopped",
                };
            await record(verdict);
        } catch {
            verdict = {
                decision: "deny",
                source: "rule",
                reason: "Permission callback failed",
            };
            try {
                await record(verdict);
            } catch {
                /* A failed logger cannot grant permission. */
            }
        }
        const kind =
            verdict.decision === "allow" ? "allow_once" : "reject_once";
        const option = request.options.find((option) => option.kind === kind);
        return option
            ? { outcome: "selected", optionId: option.optionId }
            : { outcome: "cancel" };
    };
}
