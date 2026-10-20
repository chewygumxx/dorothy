// vim:set expandtab shiftwidth=4 filetype=typescript:
// SPDX-License-Identifier: GPL-3.0-only

//
//
// ~chewygumxx/dorothy.git
// ::: :/packages/core/src/xdg.test.ts
//
//

import { describe, expect, it } from "bun:test";
import { homedir } from "node:os";
import { join } from "node:path";
import { type Env, xdgDir } from "./xdg.js";

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

    it("finds the cache directory", () => {
        expect(
            xdgDir({ XDG_CACHE_HOME: "/c" }, "XDG_CACHE_HOME", ".cache"),
        ).toBe("/c");
        expect(xdgDir({ HOME: "/h" }, "XDG_CACHE_HOME", ".cache")).toBe(
            "/h/.cache",
        );
    });

    it("takes a relative or empty state directory for none", () => {
        for (const value of ["", "state", "./state"]) {
            expect(
                xdgDir(
                    { XDG_STATE_HOME: value, HOME: "/h" },
                    "XDG_STATE_HOME",
                    ".local/state",
                ),
            ).toBe("/h/.local/state");
        }
        // Only the state variable counts for it.
        expect(
            xdgDir(
                { XDG_DATA_HOME: "/d", XDG_CACHE_HOME: "/c", HOME: "/h" },
                "XDG_STATE_HOME",
                ".local/state",
            ),
        ).toBe("/h/.local/state");
    });

    it("names only the directories it knows, which tsc holds to", () => {
        // A variable outside the union is a type error: if xdgDir took
        // any string, this directive would be the error instead.
        // @ts-expect-error XDG_RUNTIME_DIR has no fallback under HOME.
        const asked: (env: Env, name: "XDG_RUNTIME_DIR", to: string) => string =
            xdgDir;
        // At run time it falls back as any other unset one does.
        expect(asked({ HOME: "/h" }, "XDG_RUNTIME_DIR", "run")).toBe("/h/run");
    });

    it("takes the state directory, falling back under HOME", () => {
        expect(
            xdgDir({ XDG_STATE_HOME: "/s" }, "XDG_STATE_HOME", ".local/state"),
        ).toBe("/s");
        expect(xdgDir({ HOME: "/h" }, "XDG_STATE_HOME", ".local/state")).toBe(
            "/h/.local/state",
        );
    });

    it("uses the user's home directory when HOME is empty", () => {
        expect(xdgDir({ HOME: "" }, "XDG_CONFIG_HOME", ".config")).toBe(
            join(homedir(), ".config"),
        );
    });
});
