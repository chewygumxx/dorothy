// vim:set expandtab shiftwidth=4 filetype=typescript:
// SPDX-License-Identifier: GPL-3.0-only

//
//
// ~chewygumxx/dorothy.git
// ::: :/packages/core/src/models/routes.test.ts
//
//

import { describe, expect, it } from "bun:test";
import { label, ROLES } from "../contracts/model.js";
import { DEFAULT_MODELS, defaultRoutes } from "./routes.js";

describe("defaultRoutes", () => {
    it("gives every role its default model on Anthropic, one entry each", () => {
        const routes = defaultRoutes();
        expect(Object.keys(routes).sort()).toEqual([...ROLES].sort());
        for (const role of ROLES) {
            expect(routes[role]).toEqual([
                {
                    provider: "anthropic",
                    kind: "anthropic",
                    model: DEFAULT_MODELS[role],
                    baseUrl: "https://api.anthropic.com",
                    key: "ANTHROPIC_API_KEY",
                    price: null,
                },
            ]);
        }
    });

    it("chooses the spec's models", () => {
        expect(DEFAULT_MODELS).toEqual({
            chat: "claude-opus-5-5",
            review: "claude-sonnet-5-5",
            compaction: "claude-sonnet-5-5",
            maintenance: "claude-haiku-5-5",
            approval: "claude-haiku-5-5",
        });
    });

    it("labels an entry by provider and model", () => {
        const [entry] = defaultRoutes().chat;
        if (entry === undefined) {
            throw new Error("no chat entry");
        }
        expect(label(entry)).toBe("anthropic:claude-opus-5-5");
    });
});
