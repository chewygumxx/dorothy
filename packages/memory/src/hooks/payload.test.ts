// vim:set expandtab shiftwidth=4 filetype=typescript:
// SPDX-License-Identifier: GPL-3.0-only

//
//
// ~chewygumxx/dorothy.git
// ::: :/packages/memory/src/hooks/payload.test.ts
//
//

import { expect, it } from "bun:test";
import {
    CODEX_PROMPT,
    CODEX_SESSION_START,
    HERMES_PROMPT,
    HERMES_SESSION_START,
} from "./fixtures.js";
import { parseHookInput } from "./payload.js";

it("reads Codex's session start", () => {
    expect(parseHookInput("session-start", CODEX_SESSION_START)).toEqual({
        session: CODEX_SESSION_START.session_id,
        cwd: "/tmp/project",
        reason: "startup",
        prompt: null,
    });
});

it("reads a prompt, Codex's and Hermes's alike", () => {
    for (const payload of [CODEX_PROMPT, HERMES_PROMPT]) {
        expect(parseHookInput("prompt", payload)?.prompt).toBe(
            "what did we decide about the engine?",
        );
    }
    expect(parseHookInput("session-start", HERMES_SESSION_START)?.reason).toBe(
        "startup",
    );
});

it("takes an unknown source as a start", () => {
    expect(
        parseHookInput("session-start", {
            ...CODEX_SESSION_START,
            source: "fork",
        })?.reason,
    ).toBe("startup");
});

it("answers null to what it cannot read", () => {
    expect(parseHookInput("prompt", null)).toBeNull();
    expect(parseHookInput("prompt", { session_id: "s" })).toBeNull();
    expect(parseHookInput("prompt", { cwd: "/p", prompt: "x" })).toBeNull();
    expect(
        parseHookInput("prompt", { ...CODEX_PROMPT, prompt: "  " }),
    ).toBeNull();
});
