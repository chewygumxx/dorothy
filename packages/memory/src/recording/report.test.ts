// vim:set expandtab shiftwidth=4 filetype=typescript:
// SPDX-License-Identifier: GPL-3.0-only

//
//
// ~chewygumxx/dorothy.git
// ::: :/packages/memory/src/recording/report.test.ts
//
//

import { describe, expect, it } from "bun:test";
import { hostLines, sweepSummary } from "./report.js";
import type { HostSweep } from "./sweep.js";

const result = (over: Partial<HostSweep>): HostSweep => ({
    host: "codex",
    sessions: 0,
    events: 0,
    skipped: 0,
    waiting: 0,
    private: 0,
    halted: 0,
    failed: 0,
    error: null,
    ...over,
});

describe("a sweep told", () => {
    it("gives a host and its count a line", () => {
        expect(
            hostLines([
                result({ host: "claude-code", sessions: 3, events: 12 }),
                result({ host: "codex" }),
            ]),
        ).toEqual([
            "claude-code: 12 events in 3 sessions",
            "codex: 0 events in 0 sessions",
        ]);
    });

    it("says what else it found, only when there is some", () => {
        expect(
            hostLines([
                result({
                    sessions: 1,
                    events: 1,
                    waiting: 4,
                    private: 2,
                    halted: 1,
                    failed: 3,
                }),
            ]),
        ).toEqual([
            "codex: 1 events in 1 sessions (4 waiting for the backfill, 2 private, 1 halted, 3 unreadable)",
        ]);
    });

    it("says why a host stopped", () => {
        expect(hostLines([result({ error: "no store" })])).toEqual([
            "codex: 0 events in 0 sessions (stopped: no store)",
        ]);
    });

    it("sums a sweep into one line for the log", () => {
        expect(
            sweepSummary([
                result({ host: "claude-code", sessions: 3, events: 12 }),
                result({ events: 2, sessions: 1, error: "boom" }),
            ]),
        ).toBe(
            "recording: swept claude-code: 12 events in 3 sessions; codex: 2 events in 1 sessions (stopped: boom)",
        );
    });
});
