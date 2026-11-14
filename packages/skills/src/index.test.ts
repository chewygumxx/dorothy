// vim:set expandtab shiftwidth=4 filetype=typescript:
// SPDX-License-Identifier: GPL-3.0-only

//
//
// ~xxdorothy/dorothy.git
// ::: :/packages/skills/src/index.test.ts
//
//

import { describe, expect, it } from "bun:test";
import { accessSync, constants, statSync } from "node:fs";
import { sendInterrupt, sendPrompt } from "./index.js";

const SCRIPTS = "/packages/skills/skills/agent-stewardship/scripts/";

describe("@dorothy/skills", () => {
    it("names the stewardship scripts it ships", () => {
        for (const [path, name] of [
            [sendPrompt, "send-prompt.sh"],
            [sendInterrupt, "send-interrupt.sh"],
        ] as const) {
            expect(path).toEndWith(`${SCRIPTS}${name}`);
            expect(statSync(path).isFile()).toBe(true);
            expect(() => accessSync(path, constants.X_OK)).not.toThrow();
        }
    });
});
