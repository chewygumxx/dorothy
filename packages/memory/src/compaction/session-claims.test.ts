// vim:set expandtab shiftwidth=4 filetype=typescript:
// SPDX-License-Identifier: GPL-3.0-only

//
//
// ~chewygumxx/dorothy.git
// ::: :/packages/memory/src/compaction/session-claims.test.ts
//
//

import { describe, expect, it } from "bun:test";
import { CLAIM_RETRY_MS, type Claim } from "./session.js";
import {
    CLUSTERED,
    HISTORY,
    harness,
    seedSize,
    settle,
    sized,
    through,
    turn,
    until,
} from "./testing.js";

describe("Compaction: claims", () => {
    it("leaves an idle compaction to whoever holds the claim", async () => {
        const taken: boolean[] = [];
        const claim: Claim = {
            take: async () => {
                taken.push(false);
                return false;
            },
            release: async () => {},
        };
        const h = harness({ claim });
        const session = h.open();
        session.send("abcd");
        h.sessions[0]?.reply(150);
        h.timers.advance(1000);
        await until(() => taken.length === 1);
        await settle();
        expect(h.calls).toHaveLength(0);
        expect(h.timers.pending.size).toBe(0);
    });

    it("gives each run its own claim, so a reconnected session's waits for the old run's", async () => {
        // The index's claims: one holder for the conversation, by owner.
        let holder: symbol | null = null;
        const claims = (): Claim => {
            const owner = Symbol("run");
            return {
                take: async () => {
                    holder ??= owner;
                    return holder === owner;
                },
                release: async () => {
                    if (holder === owner) {
                        holder = null;
                    }
                },
            };
        };
        const h = harness({ claims });
        const old = h.open();
        old.send("abcd");
        h.sessions[0]?.reply(150);
        h.timers.advance(1000);
        await until(() => h.calls.length === 1);
        // App reconnects while the old run is still in Dorothy's call.
        const next = h.open([...HISTORY, turn("user"), turn("assistant")]);
        next.send("abcd");
        h.sessions[1]?.reply(250);
        next.send("held");
        await until(() => h.timers.pending.size === 1);
        expect(h.calls).toHaveLength(1);
        h.calls[0]?.answer(CLUSTERED);
        await until(() => holder === null);
        h.timers.advance(CLAIM_RETRY_MS);
        await until(() => h.calls.length === 2);
        expect(holder).not.toBeNull();
    });

    it("holds one claim through a chain of runs, so a review waiting for it runs after the chain", async () => {
        // The index's claims, by owner; a review waiting for this
        // conversation's takes it the moment it is let go.
        const review = Symbol("review");
        let holder: symbol | null = null;
        let made = 0;
        let released = 0;
        const claims = (): Claim => {
            made++;
            const owner = Symbol("chain");
            return {
                take: async () => {
                    holder ??= owner;
                    return holder === owner;
                },
                release: async () => {
                    released++;
                    if (holder === owner) {
                        holder = review;
                    }
                },
            };
        };
        const history = Array.from({ length: 10 }, (_, i) =>
            sized(i % 2 === 0 ? "user" : "assistant", 40),
        );
        const h = harness({ estimate: seedSize, claims });
        const session = h.open(history);
        session.send("early");
        for (const [n, last] of [2, 4, 6].entries()) {
            await until(() => h.calls.length === n + 1);
            expect(holder === review).toBe(false);
            h.calls[n]?.answer(through(last));
        }
        await until(() => h.sessions[0]?.sent.length === 1);
        await until(() => released === 1);
        expect(made).toBe(1);
        expect(holder === review).toBe(true);
    });

    it("lets go of a chain's claim when quitting between its runs", async () => {
        let released = 0;
        const claim: Claim = {
            take: async () => true,
            release: async () => {
                released++;
            },
        };
        const history = Array.from({ length: 10 }, (_, i) =>
            sized(i % 2 === 0 ? "user" : "assistant", 40),
        );
        const h = harness({ estimate: seedSize, claim });
        const session = h.open(history);
        let stopped: Promise<void> | null = null;
        session.subscribe((event) => {
            if (event.type === "compacted") {
                stopped = h.compaction.stop();
            }
        });
        session.send("early");
        await until(() => h.calls.length === 1);
        h.calls[0]?.answer(through(2));
        await until(() => stopped !== null);
        await stopped;
        expect(released).toBe(1);
        await settle();
        expect(h.calls).toHaveLength(1);
    });

    it("asks again for the claim while holding a message", async () => {
        const answers = [false, true];
        let released = 0;
        const claim: Claim = {
            take: async () => answers.shift() ?? true,
            release: async () => {
                released++;
            },
        };
        const h = harness({ claim });
        const session = h.open();
        session.send("abcd");
        h.sessions[0]?.reply(250);
        session.send("next");
        await until(() => h.timers.pending.size === 1);
        expect(h.calls).toHaveLength(0);
        h.timers.advance(CLAIM_RETRY_MS);
        await until(() => h.calls.length === 1);
        h.calls[0]?.answer(CLUSTERED);
        await until(() => h.sessions.length === 2);
        await until(() => released === 1);
    });

    it("asks again for the claim when a message is held while an idle compaction waits for it", async () => {
        let refuse = (_taken: boolean) => {};
        const answers = [
            new Promise<boolean>((resolve) => {
                refuse = resolve;
            }),
        ];
        const claim: Claim = {
            take: () => answers.shift() ?? Promise.resolve(true),
            release: async () => {},
        };
        const h = harness({ claim });
        const session = h.open();
        session.send("abcd");
        h.sessions[0]?.reply(150);
        h.timers.advance(1000);
        // While the claim is asked for, a reply crosses hard and the next
        // message is held.
        session.send("during");
        h.sessions[0]?.reply(250);
        session.send("next");
        refuse(false);
        await settle();
        expect(h.sessions[0]?.sent).toEqual(["abcd", "during"]);
        h.timers.advance(CLAIM_RETRY_MS);
        await until(() => h.calls.length === 1);
        // The exchange sent meanwhile moves the outgoing turns on.
        h.calls[0]?.answer({
            ...CLUSTERED,
            output: { clusters: [{ through: 5, abstract: "The start." }] },
        });

        await until(() => h.sessions[1]?.sent.length === 1);
        expect(h.sessions[1]?.sent).toEqual(["next"]);
    });
});
