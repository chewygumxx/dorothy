// vim:set expandtab shiftwidth=4 filetype=typescript:
// SPDX-License-Identifier: GPL-3.0-only

//
//
// ~chewygumxx/dorothy.git
// ::: :/packages/cli/src/recall-launch.test.ts
//
//

import { describe, expect, it } from "bun:test";
import { recallLaunch } from "./recall-launch.js";

describe("recallLaunch", () => {
    it("gives the server the conversation to leave out and the project", () => {
        expect(recallLaunch("a-b-c-d", "/work").args.slice(1)).toEqual([
            "--recall-server",
            "--exclude",
            "a-b-c-d",
            "--project",
            "/work",
        ]);
        expect(recallLaunch("a-b-c-d", null).args.slice(1)).toEqual([
            "--recall-server",
            "--exclude",
            "a-b-c-d",
        ]);
    });
});
