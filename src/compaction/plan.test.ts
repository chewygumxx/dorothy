// vim:set expandtab shiftwidth=4 filetype=typescript:
// SPDX-License-Identifier: GPL-3.0-only

//
//
// ~chewygumxx/dorothy.git
// ::: :/src/compaction/plan.test.ts
//
//

import { describe, expect, it } from "bun:test";
import type { Cluster } from "../memory/sidecar.js";
import { type Turn, withClusters } from "../persona.js";
import {
    callCap,
    clusterTokens,
    covered,
    outgoing,
    pressure,
    seedTurns,
} from "./plan.js";

// Four characters make a token.
const user = (text = "abcd"): Turn => ({ role: "user", text });
const reply = (text = "abcd"): Turn => ({ role: "assistant", text });
const cluster = (from: number, through: number): Cluster => ({
    from,
    through,
    abstract: "About it.",
    at: "x",
    model: "m",
});
const SIX = [user(), reply(), user(), reply(), user(), reply()];

describe("covered and seedTurns", () => {
    it("start after the last cluster", () => {
        expect(covered([])).toBe(0);
        expect(covered([cluster(1, 2), cluster(3, 4)])).toBe(4);
        expect(seedTurns(SIX, [cluster(1, 4)])).toEqual(SIX.slice(4));
        expect(seedTurns(SIX, [])).toEqual(SIX);
    });
});

describe("outgoing", () => {
    it("keeps the newest turns that fit the tail, compacting the rest", () => {
        expect(outgoing(SIX, [], 4)).toEqual({ from: 1, through: 2 });
    });

    it("starts after what is already compacted", () => {
        expect(outgoing(SIX, [cluster(1, 1)], 3)).toEqual({
            from: 2,
            through: 3,
        });
    });

    it("always keeps the latest exchange, however large", () => {
        const turns = [user(), reply(), user("x".repeat(400)), reply()];
        expect(outgoing(turns, [], 4)).toEqual({ from: 1, through: 2 });
    });

    it("finds nothing when the latest exchange is all there is", () => {
        expect(outgoing([user("x".repeat(400)), reply()], [], 4)).toBeNull();
    });

    it("finds nothing when everything else fits the tail", () => {
        expect(outgoing(SIX, [], 100)).toBeNull();
        expect(outgoing(SIX, [cluster(1, 3)], 3)).toBeNull();
    });

    it("keeps a reply still to come with its message", () => {
        const waiting = [user(), reply(), user(), reply(), user()];
        expect(outgoing(waiting, [], 1)).toEqual({ from: 1, through: 4 });
    });
});

describe("callCap", () => {
    it("is what a live compaction sends: soft less tail", () => {
        expect(callCap({ soft: 64_000, tail: 16_000 })).toBe(48_000);
    });
});

describe("outgoing with a cap", () => {
    it("ends at the last whole turn that fits, oldest first", () => {
        expect(outgoing(SIX, [], 1, 2)).toEqual({ from: 1, through: 2 });
        expect(outgoing(SIX, [cluster(1, 2)], 1, 1)).toEqual({
            from: 3,
            through: 3,
        });
    });

    it("always takes one turn, even one past the cap", () => {
        const turns = [user("x".repeat(400)), reply(), ...SIX];
        expect(outgoing(turns, [], 1, 4)).toEqual({ from: 1, through: 1 });
        expect(outgoing(SIX, [], 1, 0)).toEqual({ from: 1, through: 1 });
    });

    it("changes nothing when the range fits", () => {
        expect(outgoing(SIX, [], 1, 100)).toEqual(outgoing(SIX, [], 1));
    });
});

describe("clusterTokens", () => {
    it("costs what withClusters adds, and nothing without clusters", () => {
        const clusters = [cluster(1, 4)];
        expect(clusterTokens([], true)).toBe(0);
        expect(clusterTokens(clusters, true)).toBe(
            Math.ceil([...withClusters("", clusters, true)].length / 4),
        );
    });
});

describe("pressure", () => {
    it("is soft past soft and hard past hard", () => {
        const limits = { soft: 100, hard: 200 };
        expect(pressure(100, limits)).toBe("none");
        expect(pressure(101, limits)).toBe("soft");
        expect(pressure(201, limits)).toBe("hard");
    });
});
