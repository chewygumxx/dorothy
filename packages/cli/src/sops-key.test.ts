// vim:set expandtab shiftwidth=4 filetype=typescript:
// SPDX-License-Identifier: GPL-3.0-only

//
//
// ~chewygumxx/dorothy.git
// ::: :/packages/cli/src/sops-key.test.ts
//
//

import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import type { Env } from "@dorothy/core";
import { passSopsKey } from "./sops-key.js";

let root: string;
beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "dorothy-sops-path-"));
});
afterEach(() => {
    rmSync(root, { recursive: true, force: true });
});

function key(path: string): string {
    mkdirSync(dirname(path), { recursive: true });
    // The helper only stats this file; it is not an age key.
    writeFileSync(path, "synthetic key placeholder", { mode: 0o000 });
    return path;
}

describe("passSopsKey", () => {
    it("passes an existing XDG default as a path before the child changes config", () => {
        const path = key(join(root, "config", "sops", "age", "keys.txt"));
        const target: Env = { XDG_CONFIG_HOME: join(root, "child-config") };
        passSopsKey(target, {
            HOME: root,
            XDG_CONFIG_HOME: join(root, "config"),
        });
        expect(target.SOPS_AGE_KEY_FILE).toBe(path);
        expect(target.XDG_CONFIG_HOME).toBe(join(root, "child-config"));
    });

    it("uses HOME/.config when XDG_CONFIG_HOME is absent or empty", () => {
        const path = key(join(root, ".config", "sops", "age", "keys.txt"));
        expect(passSopsKey({}, { HOME: root }).SOPS_AGE_KEY_FILE).toBe(path);
        expect(
            passSopsKey({}, { HOME: root, XDG_CONFIG_HOME: "" })
                .SOPS_AGE_KEY_FILE,
        ).toBe(path);
    });

    it("keeps an explicit key path even when it is missing", () => {
        const path = join(root, "explicit.txt");
        key(join(root, ".config", "sops", "age", "keys.txt"));
        expect(
            passSopsKey({}, { HOME: root, SOPS_AGE_KEY_FILE: path })
                .SOPS_AGE_KEY_FILE,
        ).toBe(path);
    });

    it("does not replace a target's nonempty choice", () => {
        const chosen = join(root, "chosen.txt");
        const other = key(join(root, ".config", "sops", "age", "keys.txt"));
        expect(
            passSopsKey(
                { SOPS_AGE_KEY_FILE: chosen },
                { HOME: root, SOPS_AGE_KEY_FILE: other },
            ).SOPS_AGE_KEY_FILE,
        ).toBe(chosen);
    });

    it("fills an empty key variable when the default exists", () => {
        const path = key(join(root, ".config", "sops", "age", "keys.txt"));
        expect(
            passSopsKey({ SOPS_AGE_KEY_FILE: "" }, { HOME: root })
                .SOPS_AGE_KEY_FILE,
        ).toBe(path);
    });

    it("leaves an absent key unset and accepts no directory as a key", () => {
        expect(passSopsKey({}, { HOME: root })).toEqual({});
        mkdirSync(join(root, ".config", "sops", "age", "keys.txt"), {
            recursive: true,
        });
        expect(passSopsKey({}, { HOME: root })).toEqual({});
    });
});
