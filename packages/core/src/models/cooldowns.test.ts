// vim:set expandtab shiftwidth=4 filetype=typescript:
// SPDX-License-Identifier: GPL-3.0-only

//
//
// ~xxdorothy/dorothy.git
// ::: :/packages/core/src/models/cooldowns.test.ts
//
//

import { describe, expect, it } from "bun:test";
import type { Failure } from "../contracts/model.js";
import { Cooldowns, DEFAULT_COOLDOWN_MS } from "./cooldowns.js";
import { anthropicEntry } from "./routes.js";

const clock = (at: number) => ({ now: () => at });
const failure = (
    kind: Failure["class"],
    retryAfterMs: number | null = null,
): Failure => ({
    class: kind,
    message: kind,
    retryAfterMs,
});

describe("Cooldowns", () => {
    const opus = anthropicEntry("claude-opus-5-5");
    const sonnet = anthropicEntry("claude-sonnet-5-5");

    it("cools the whole provider for a usage refusal", () => {
        let now = 1_000;
        const cooldowns = new Cooldowns({ now: () => now });
        cooldowns.note(opus, failure("usage"));
        expect(cooldowns.until(opus)).toBe(1_000 + DEFAULT_COOLDOWN_MS);
        expect(cooldowns.until(sonnet)).toBe(1_000 + DEFAULT_COOLDOWN_MS);
        now = 1_000 + DEFAULT_COOLDOWN_MS;
        expect(cooldowns.until(opus)).toBeNull();
    });

    it("cools only the model for a rate limit, for retry-after", () => {
        const cooldowns = new Cooldowns(clock(0));
        cooldowns.note(opus, failure("rate-limit", 41_000));
        expect(cooldowns.until(opus)).toBe(41_000);
        expect(cooldowns.until(sonnet)).toBeNull();
    });

    it("cools nothing for other failures", () => {
        const cooldowns = new Cooldowns(clock(0));
        for (const kind of [
            "overload",
            "server",
            "timeout",
            "network",
            "rejected",
            "unparsed",
            "secret",
            "cancelled",
        ] as const) {
            cooldowns.note(opus, failure(kind, 1_000));
        }
        expect(cooldowns.until(opus)).toBeNull();
    });

    it("takes the later of the provider's and the model's times", () => {
        const cooldowns = new Cooldowns(clock(0));
        cooldowns.note(opus, failure("usage", 10_000));
        cooldowns.note(opus, failure("rate-limit", 20_000));
        expect(cooldowns.until(opus)).toBe(20_000);
        expect(cooldowns.until(sonnet)).toBe(10_000);
    });

    it("sets a cooldown afresh when noted again", () => {
        let now = 0;
        const cooldowns = new Cooldowns({ now: () => now });
        cooldowns.note(opus, failure("rate-limit", 50_000));
        now = 40_000;
        cooldowns.note(opus, failure("rate-limit", 5_000));
        expect(cooldowns.until(opus)).toBe(45_000);
    });
});
