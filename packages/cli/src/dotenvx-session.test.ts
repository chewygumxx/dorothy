// vim:set expandtab shiftwidth=4 filetype=typescript:
// SPDX-License-Identifier: GPL-3.0-only

//
//
// ~chewygumxx/dorothy.git
// ::: :/packages/cli/src/dotenvx-session.test.ts
//
//

import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
    findSession,
    passSession,
    SESSION_DIR,
    useSession,
} from "./dotenvx-session.js";

let root = "";
beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "dorothy-session-"));
});
afterEach(() => {
    rmSync(root, { recursive: true, force: true });
});

// A directory holding a session file, as dotenvx keeps one.
const session = (dir: string) => {
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, ".env"), "SESSION=held\n");
    return dir;
};

describe("findSession", () => {
    it("finds the directory DOTENVX_CONFIG names, and only that", () => {
        const dir = session(join(root, "named"));
        // The default is not looked in where one is named.
        session(join(root, "config", "dotenvx"));
        const env = { HOME: root, XDG_CONFIG_HOME: join(root, "config") };
        expect(findSession({ ...env, DOTENVX_CONFIG: dir })).toBe(dir);
        expect(
            findSession({ ...env, DOTENVX_CONFIG: join(root, "empty") }),
        ).toBeNull();
    });

    it("finds dotenvx in the configuration directory, by XDG_CONFIG_HOME or the home", () => {
        const xdg = session(join(root, "config", "dotenvx"));
        expect(
            findSession({
                HOME: "/nowhere",
                XDG_CONFIG_HOME: join(root, "config"),
            }),
        ).toBe(xdg);
        if (process.platform !== "darwin") {
            const home = session(join(root, "home", ".config", "dotenvx"));
            expect(findSession({ HOME: join(root, "home") })).toBe(home);
        }
    });

    it("finds none where no session is kept", () => {
        expect(findSession({ HOME: root })).toBeNull();
    });
});

describe("passSession", () => {
    it("names the directory it finds, and drops an outer launch's otherwise", () => {
        const dir = session(join(root, "named"));
        expect(
            passSession({ [SESSION_DIR]: "/outer" }, { DOTENVX_CONFIG: dir }),
        ).toEqual({ [SESSION_DIR]: dir });
        expect(
            passSession({ [SESSION_DIR]: "/outer" }, { HOME: root }),
        ).toEqual({});
    });
});

describe("useSession", () => {
    it("points dotenvx at the directory given, else leaves it", () => {
        const env: Record<string, string> = {};
        useSession(env, {});
        useSession(env, { [SESSION_DIR]: "" });
        expect(env).toEqual({});
        useSession(env, { [SESSION_DIR]: "/held" });
        expect(env).toEqual({ DOTENVX_CONFIG: "/held" });
    });
});
