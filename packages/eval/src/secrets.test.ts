// vim:set expandtab shiftwidth=4 filetype=typescript:
// SPDX-License-Identifier: GPL-3.0-only

//
//
// ~chewygumxx/dorothy.git
// ::: :/packages/eval/src/secrets.test.ts
//
//

import { describe, expect, it } from "bun:test";
import { loadModelSecrets } from "./secrets.js";
import { fakeIo } from "./testing.js";

const NAMED = "CLAUDE_CODE_OAUTH_TOKEN_TWO";
const NO_TOKEN =
    "eval: DOROTHY_CLAUDE_TOKEN_VAR names no token in secrets.json; no model was called\n";

describe("loadModelSecrets", () => {
    it("is true, and silent, when no token is named", async () => {
        const { io, err } = fakeIo({
            env: { CLAUDE_CODE_OAUTH_TOKEN: "synthetic-own" },
        });
        expect(await loadModelSecrets(io)).toBe(true);
        expect(io.env.CLAUDE_CODE_OAUTH_TOKEN).toBe("synthetic-own");
        expect(err).toEqual([]);
    });

    it("spends the named token over an existing one", async () => {
        const { io, err } = fakeIo({
            env: {
                CLAUDE_CODE_OAUTH_TOKEN: "synthetic-other",
                DOROTHY_CLAUDE_TOKEN_VAR: NAMED,
            },
        });
        io.loadSecrets = async (_path, into) => {
            into[NAMED] = "synthetic-two";
            return null;
        };
        expect(await loadModelSecrets(io)).toBe(true);
        expect(io.env.CLAUDE_CODE_OAUTH_TOKEN).toBe("synthetic-two");
        expect(err).toEqual([]);
    });

    it("is false, saying so, when the named token is missing", async () => {
        const { io, err } = fakeIo({
            env: {
                CLAUDE_CODE_OAUTH_TOKEN: "synthetic-other",
                DOROTHY_CLAUDE_TOKEN_VAR: NAMED,
            },
        });
        expect(await loadModelSecrets(io)).toBe(false);
        expect(err).toEqual([NO_TOKEN]);
        expect(io.env.CLAUDE_CODE_OAUTH_TOKEN).toBe("synthetic-other");
    });

    it("only warns of a failed load when no token is named", async () => {
        const { io, err } = fakeIo();
        io.loadSecrets = async () => "SOPS_FAILED";
        expect(await loadModelSecrets(io)).toBe(true);
        expect(err).toEqual(["eval: secrets not loaded (SOPS_FAILED)\n"]);
    });

    it("still chooses after a failed load, and stops if it fails", async () => {
        const { io, err } = fakeIo({
            env: { DOROTHY_CLAUDE_TOKEN_VAR: NAMED },
        });
        io.loadSecrets = async () => {
            throw new Error("untrusted diagnostic");
        };
        expect(await loadModelSecrets(io)).toBe(false);
        expect(err).toEqual([
            "eval: secrets not loaded (SOPS_FAILED)\n",
            NO_TOKEN,
        ]);
    });
});
