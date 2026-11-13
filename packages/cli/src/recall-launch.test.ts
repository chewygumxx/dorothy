// vim:set expandtab shiftwidth=4 filetype=typescript:
// SPDX-License-Identifier: GPL-3.0-only

//
//
// ~xxdorothy/dorothy.git
// ::: :/packages/cli/src/recall-launch.test.ts
//
//

import { describe, expect, it } from "bun:test";
import { recallLaunch } from "./recall-launch.js";

describe("recallLaunch", () => {
    it("gives the server the conversation to leave out and the project", () => {
        expect(recallLaunch("a-b-c-d", "/work").args.slice(2)).toEqual([
            "--recall-server",
            "--exclude",
            "a-b-c-d",
            "--project",
            "/work",
        ]);
        expect(recallLaunch("a-b-c-d", null).args.slice(2)).toEqual([
            "--recall-server",
            "--exclude",
            "a-b-c-d",
        ]);
    });

    it("has Bun read no .env, before the script", () => {
        expect(recallLaunch("a-b-c-d", null).args[0]).toBe("--no-env-file");
    });
});
