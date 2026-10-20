// vim:set expandtab shiftwidth=4 filetype=typescript:
// SPDX-License-Identifier: GPL-3.0-only

//
//
// ~chewygumxx/dorothy.git
// ::: :/packages/memory/src/recording/report.ts
//
//

// A sweep told in words: a host and its count a line for `dorothy
// --sweep`, and one line of them all for the service's log.

import type { HostSweep } from "./sweep.js";

function hostLine(result: HostSweep): string {
    const also = [
        result.waiting > 0 ? `${result.waiting} waiting for the backfill` : "",
        result.private > 0 ? `${result.private} private` : "",
        result.halted > 0 ? `${result.halted} halted` : "",
        result.failed > 0 ? `${result.failed} unreadable` : "",
        result.error === null ? "" : `stopped: ${result.error}`,
    ].filter((note) => note !== "");
    return `${result.host}: ${result.events} events in ${result.sessions} sessions${also.length === 0 ? "" : ` (${also.join(", ")})`}`;
}

export const hostLines = (results: readonly HostSweep[]): string[] =>
    results.map(hostLine);

export const sweepSummary = (results: readonly HostSweep[]): string =>
    `recording: swept ${hostLines(results).join("; ")}`;
