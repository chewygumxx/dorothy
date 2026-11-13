// vim:set expandtab shiftwidth=4 filetype=typescript:
// SPDX-License-Identifier: GPL-3.0-only

//
//
// ~xxdorothy/dorothy.git
// ::: :/packages/cli/src/models.test.ts
//
//

import { describe, expect, it } from "bun:test";
import { defaultRoutes, type RoutingResult } from "@dorothy/core";
import { chatRouting, loadRouting } from "./models.js";

const ROUTING = { routes: defaultRoutes(), keys: ["ANTHROPIC_API_KEY"] };
const routed = async (): Promise<RoutingResult> => ({
    ok: true,
    routing: ROUTING,
});
const faulted = async (): Promise<RoutingResult> => ({
    ok: false,
    faults: [
        "config.toml: models.chat must be a list of one model or more",
        "config.toml: models.review: no provider is named openrouter",
    ],
});

describe("chatRouting", () => {
    it("gives config.toml's routes, saying nothing", async () => {
        const written: string[] = [];
        expect(
            await chatRouting((text) => written.push(text), {
                env: {},
                readRouting: routed,
            }),
        ).toBe(ROUTING);
        expect(written).toEqual([]);
    });

    it("says each fault on a line of its own, and gives null", async () => {
        const written: string[] = [];
        expect(
            await chatRouting((text) => written.push(text), {
                env: {},
                readRouting: faulted,
            }),
        ).toBeNull();
        expect(written).toEqual([
            "dorothy: config.toml: models.chat must be a list of one model or more\n",
            "dorothy: config.toml: models.review: no provider is named openrouter\n",
        ]);
    });

    it("reads the environment's config.toml", async () => {
        const seen: unknown[] = [];
        const env = { XDG_CONFIG_HOME: "/nowhere" };
        await chatRouting(() => {}, {
            env,
            readRouting: async (given) => {
                seen.push(given);
                return routed();
            },
        });
        expect(seen).toEqual([env]);
    });
});

describe("loadRouting", () => {
    it("gives config.toml's routes", async () => {
        expect(await loadRouting({ env: {}, readRouting: routed })).toBe(
            ROUTING,
        );
    });

    it("throws every fault in one message", async () => {
        await expect(
            loadRouting({ env: {}, readRouting: faulted }),
        ).rejects.toThrow(
            "config.toml: models.chat must be a list of one model or more; config.toml: models.review: no provider is named openrouter",
        );
    });
});
