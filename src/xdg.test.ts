// vim:set expandtab shiftwidth=4 filetype=typescript:
// SPDX-License-Identifier: GPL-3.0-only

//
//
// ~chewygumxx/dorothy.git
// ::: :/src/xdg.test.ts
//
//

import { describe, expect, it } from "bun:test";
import { homedir } from "node:os";
import { join } from "node:path";
import { xdgDir } from "./xdg.js";

describe("xdgDir", () => {
    it("uses the variable when it is absolute", () => {
        expect(
            xdgDir(
                { XDG_DATA_HOME: "/data", HOME: "/home/u" },
                "XDG_DATA_HOME",
                ".local/share",
            ),
        ).toBe("/data");
        expect(
            xdgDir(
                { XDG_CONFIG_HOME: "/conf", HOME: "/home/u" },
                "XDG_CONFIG_HOME",
                ".config",
            ),
        ).toBe("/conf");
    });

    it("falls back under HOME when unset, empty or relative", () => {
        for (const value of [undefined, "", "conf"]) {
            expect(
                xdgDir(
                    { XDG_CONFIG_HOME: value, HOME: "/home/u" },
                    "XDG_CONFIG_HOME",
                    ".config",
                ),
            ).toBe("/home/u/.config");
        }
    });

    it("reads only the variable it is asked for", () => {
        expect(
            xdgDir(
                { XDG_DATA_HOME: "/data", HOME: "/home/u" },
                "XDG_CONFIG_HOME",
                ".config",
            ),
        ).toBe("/home/u/.config");
    });

    it("uses the user's home directory when HOME is empty", () => {
        expect(xdgDir({ HOME: "" }, "XDG_CONFIG_HOME", ".config")).toBe(
            join(homedir(), ".config"),
        );
    });
});
