// vim:set expandtab shiftwidth=4 filetype=typescript:
// SPDX-License-Identifier: GPL-3.0-only

//
//
// ~chewygumxx/dorothy.git
// ::: :/packages/core/src/models/fallback.test.ts
//
//

import { describe, expect, it } from "bun:test";
import type { AttemptResult, Failure, RouteEntry } from "../contracts/model.js";
import type { Timers } from "../timers.js";
import { Cooldowns } from "./cooldowns.js";
import { runRoute } from "./fallback.js";
import { anthropicEntry } from "./routes.js";

const A = anthropicEntry("model-a");
const B = { ...anthropicEntry("model-b"), provider: "other" };
const C = { ...anthropicEntry("model-c"), provider: "third" };

const fail = (
    kind: Failure["class"],
    started = false,
    costUsd = 0,
    retryAfterMs: number | null = null,
): AttemptResult<string> => ({
    ok: false,
    failure: { class: kind, message: `${kind} happened`, retryAfterMs },
    started,
    costUsd,
});
const win = (value: string, costUsd = 0): AttemptResult<string> => ({
    ok: true,
    value,
    costUsd,
});

// Answers per entry, in turn; records the entries tried.
function scripted(answers: Record<string, AttemptResult<string>[]>) {
    const tried: string[] = [];
    const attempt = async (entry: RouteEntry, _signal: AbortSignal) => {
        tried.push(entry.model);
        const queue = answers[entry.model] ?? [];
        return queue.shift() ?? fail("server");
    };
    return { tried, attempt };
}

const clockAt = (at: number) => ({ now: () => at });

describe("runRoute", () => {
    it("answers from the first entry that succeeds", async () => {
        const { tried, attempt } = scripted({ "model-a": [win("a", 0.5)] });
        const outcome = await runRoute([A, B], attempt, {
            cooldowns: new Cooldowns(),
            deadlineMs: null,
        });
        expect(outcome).toEqual({
            ok: true,
            value: "a",
            entry: A,
            costUsd: 0.5,
            notes: [],
        });
        expect(tried).toEqual(["model-a"]);
    });

    it("moves to the next entry on a failure, noting it and summing costs", async () => {
        const { tried, attempt } = scripted({
            "model-a": [fail("rate-limit", false, 0.1, 41_000)],
            "model-b": [win("b", 0.2)],
        });
        const outcome = await runRoute([A, B], attempt, {
            cooldowns: new Cooldowns(clockAt(0)),
            deadlineMs: null,
        });
        expect(tried).toEqual(["model-a", "model-b"]);
        expect(outcome.ok).toBe(true);
        expect(outcome.costUsd).toBeCloseTo(0.3, 10);
        expect(outcome.notes).toEqual([
            "anthropic:model-a refused (rate-limit: rate-limit happened, retry in 41s); answering with other:model-b",
        ]);
    });

    it("stops after a started attempt fails", async () => {
        const { tried, attempt } = scripted({
            "model-a": [fail("server", true)],
        });
        const outcome = await runRoute([A, B], attempt, {
            cooldowns: new Cooldowns(),
            deadlineMs: null,
        });
        expect(tried).toEqual(["model-a"]);
        expect(outcome).toMatchObject({
            ok: false,
            started: true,
            reason: "server happened",
        });
    });

    it("stops when the caller cancels, as cancelled", async () => {
        const controller = new AbortController();
        const attempt = async () => {
            controller.abort();
            return fail("cancelled");
        };
        const outcome = await runRoute([A, B], attempt, {
            cooldowns: new Cooldowns(),
            signal: controller.signal,
            deadlineMs: null,
        });
        expect(outcome).toMatchObject({
            ok: false,
            failure: { class: "cancelled" },
            reason: "cancelled",
        });
    });

    it("tries nothing when the caller has already cancelled", async () => {
        const controller = new AbortController();
        controller.abort();
        const { tried, attempt } = scripted({});
        const outcome = await runRoute([A], attempt, {
            cooldowns: new Cooldowns(),
            signal: controller.signal,
            deadlineMs: null,
        });
        expect(tried).toEqual([]);
        expect(outcome).toMatchObject({ ok: false, reason: "cancelled" });
    });

    it("ends at the deadline as a timeout, trying no later entry", async () => {
        let fire = () => {};
        const timers: Timers = {
            set: (fn) => {
                fire = fn;
                return 1;
            },
            clear: () => {},
        };
        const tried: string[] = [];
        const attempt = async (entry: RouteEntry, signal: AbortSignal) => {
            tried.push(entry.model);
            fire();
            expect(signal.aborted).toBe(true);
            return fail("cancelled");
        };
        const outcome = await runRoute([A, B], attempt, {
            cooldowns: new Cooldowns(),
            deadlineMs: 120_000,
            timers,
        });
        expect(tried).toEqual(["model-a"]);
        expect(outcome).toMatchObject({
            ok: false,
            failure: { class: "timeout" },
            reason: "timed out after 120s",
        });
    });

    it("lists every entry's failure when all fail", async () => {
        const { attempt } = scripted({
            "model-a": [fail("overload")],
            "model-b": [fail("rejected")],
        });
        const outcome = await runRoute([A, B], attempt, {
            cooldowns: new Cooldowns(),
            deadlineMs: null,
        });
        expect(outcome).toMatchObject({
            ok: false,
            reason: "anthropic:model-a: overload: overload happened; other:model-b: rejected: rejected happened",
        });
    });

    it("gives the reason for an empty route", async () => {
        const { tried, attempt } = scripted({});
        const outcome = await runRoute([], attempt, {
            cooldowns: new Cooldowns(),
            deadlineMs: null,
        });
        expect(tried).toEqual([]);
        expect(outcome).toMatchObject({
            ok: false,
            reason: "the route has no entry",
        });
    });

    it("skips an entry in cooldown, saying so", async () => {
        const cooldowns = new Cooldowns(clockAt(0));
        cooldowns.note(A, {
            class: "usage",
            message: "spent",
            retryAfterMs: 60_000,
        });
        const { tried, attempt } = scripted({ "model-b": [win("b")] });
        const outcome = await runRoute([A, B], attempt, {
            cooldowns,
            deadlineMs: null,
        });
        expect(tried).toEqual(["model-b"]);
        expect(outcome.notes).toHaveLength(1);
        expect(outcome.notes[0]).toMatch(
            /^anthropic:model-a in cooldown until \d\d:\d\d; answering with other:model-b$/,
        );
    });

    it("tries only the soonest entry when every entry is in cooldown", async () => {
        const cooldowns = new Cooldowns(clockAt(0));
        cooldowns.note(A, {
            class: "usage",
            message: "spent",
            retryAfterMs: 90_000,
        });
        cooldowns.note(B, {
            class: "usage",
            message: "spent",
            retryAfterMs: 30_000,
        });
        cooldowns.note(C, {
            class: "usage",
            message: "spent",
            retryAfterMs: 60_000,
        });
        const { tried, attempt } = scripted({ "model-b": [fail("usage")] });
        const outcome = await runRoute([A, B, C], attempt, {
            cooldowns,
            deadlineMs: null,
        });
        expect(tried).toEqual(["model-b"]);
        expect(outcome.ok).toBe(false);
        if (!outcome.ok) {
            expect(outcome.reason).toMatch(
                /^anthropic:model-a: in cooldown until \d\d:\d\d; third:model-c: in cooldown until \d\d:\d\d; other:model-b: usage: usage happened$/,
            );
        }
    });

    it("notes a usage refusal as a cooldown for the next call", async () => {
        const cooldowns = new Cooldowns(clockAt(0));
        const { attempt } = scripted({
            "model-a": [fail("usage")],
            "model-b": [win("b"), win("b")],
        });
        await runRoute([A, B], attempt, { cooldowns, deadlineMs: null });
        expect(cooldowns.until(A)).not.toBeNull();
    });
});
