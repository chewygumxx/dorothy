// vim:set expandtab shiftwidth=4 filetype=typescript:
// SPDX-License-Identifier: GPL-3.0-only

//
//
// ~chewygumxx/dorothy.git
// ::: :/src/config.test.ts
//
//

import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
    configPath,
    DEFAULT_CONFIG,
    parseConfig,
    readConfig,
} from "./config.js";

describe("parseConfig", () => {
    it("gives the defaults for an empty file", () => {
        expect(parseConfig("")).toEqual({
            config: DEFAULT_CONFIG,
            warnings: [],
        });
    });

    it("reads both tables", () => {
        const text = [
            "[statusline]",
            'modules = ["cost", "in"]',
            "max-lines = 2",
            "",
            "[reply-stats]",
            "modules = []",
        ].join("\n");
        expect(parseConfig(text)).toEqual({
            config: {
                statusline: { modules: ["cost", "in"], maxLines: 2 },
                replyStats: { modules: [], maxLines: 1 },
            },
            warnings: [],
        });
    });

    it("keeps a table's defaults for the keys it leaves out", () => {
        expect(parseConfig("[statusline]\nmax-lines = 3").config).toEqual({
            ...DEFAULT_CONFIG,
            statusline: {
                modules: DEFAULT_CONFIG.statusline.modules,
                maxLines: 3,
            },
        });
    });

    it("reads comments, CRLF and a BOM", () => {
        const text = "\uFEFF# mine\r\n[statusline]\r\nmax-lines = 2\r\n";
        expect(parseConfig(text)).toEqual({
            config: {
                ...DEFAULT_CONFIG,
                statusline: { ...DEFAULT_CONFIG.statusline, maxLines: 2 },
            },
            warnings: [],
        });
    });

    it("falls back to the defaults on invalid TOML, saying why", () => {
        expect(parseConfig("[statusline]\nmax-lines =")).toEqual({
            config: DEFAULT_CONFIG,
            warnings: ["config.toml line 2: Missing value after '='"],
        });
    });

    it("names the line a mistake is on, past a list that spans lines", () => {
        const fine = '[statusline]\nmodules = [\n  "cost",\n  "in",\n]\n';
        const { warnings } = parseConfig(
            `${fine}max-lines = 2\nmax-lines = 3\n`,
        );
        expect(warnings).toHaveLength(1);
        expect(warnings[0]).toStartWith("config.toml line 7: ");
    });

    it("names the line a list opens on for a mistake inside it", () => {
        const text = '[statusline]\nmodules = [\n  "cost"\n  "in",\n]';
        expect(parseConfig(text).warnings[0]).toStartWith(
            "config.toml line 2: ",
        );
    });

    it("skips unknown and repeated modules, one warning each", () => {
        const text = '[statusline]\nmodules = ["cost", "tokens", "cost", "in"]';
        expect(parseConfig(text)).toEqual({
            config: {
                ...DEFAULT_CONFIG,
                statusline: { modules: ["cost", "in"], maxLines: 1 },
            },
            warnings: [
                "config.toml: unknown module tokens in statusline",
                "config.toml: cost repeated in statusline",
            ],
        });
    });

    it("keeps the default modules when modules is not a list of names", () => {
        for (const value of ['"cost"', "[1, 2]"]) {
            expect(parseConfig(`[reply-stats]\nmodules = ${value}`)).toEqual({
                config: DEFAULT_CONFIG,
                warnings: [
                    "config.toml: reply-stats.modules is not a list of module names",
                ],
            });
        }
    });

    it("takes one line when max-lines is not a whole number from 1 to 5", () => {
        for (const value of ["0", "6", "2.5", '"2"']) {
            expect(parseConfig(`[statusline]\nmax-lines = ${value}`)).toEqual({
                config: DEFAULT_CONFIG,
                warnings: [
                    "config.toml: statusline.max-lines must be a whole number from 1 to 5",
                ],
            });
        }
    });

    it("ignores unknown tables and keys, naming each", () => {
        const text = "colours = 1\n[statusline]\nmax_lines = 2";
        expect(parseConfig(text)).toEqual({
            config: DEFAULT_CONFIG,
            warnings: [
                "config.toml: unknown key colours",
                "config.toml: unknown key statusline.max_lines",
            ],
        });
    });

    it("keeps a table's defaults when it is not a table", () => {
        expect(parseConfig("statusline = 3")).toEqual({
            config: DEFAULT_CONFIG,
            warnings: ["config.toml: statusline is not a table"],
        });
    });
});

describe("readConfig", () => {
    let dir = "";
    beforeEach(async () => {
        dir = await mkdtemp(join(tmpdir(), "dorothy-config-"));
    });
    afterEach(async () => {
        await rm(dir, { recursive: true, force: true });
    });

    it("reads $XDG_CONFIG_HOME/dorothy/config.toml", async () => {
        await mkdir(join(dir, "dorothy"));
        await writeFile(
            join(dir, "dorothy", "config.toml"),
            "[statusline]\nmax-lines = 2\n",
        );
        const { config } = await readConfig({ XDG_CONFIG_HOME: dir });
        expect(config.statusline.maxLines).toBe(2);
    });

    it("gives the defaults, quietly, when there is no file", async () => {
        expect(await readConfig({ XDG_CONFIG_HOME: dir })).toEqual({
            config: DEFAULT_CONFIG,
            warnings: [],
        });
    });

    it("warns and gives the defaults when the file cannot be read", async () => {
        await mkdir(join(dir, "dorothy", "config.toml"), { recursive: true });
        const { config, warnings } = await readConfig({ XDG_CONFIG_HOME: dir });
        expect(config).toEqual(DEFAULT_CONFIG);
        expect(warnings).toHaveLength(1);
        expect(warnings[0]).toStartWith("config.toml: ");
    });

    it("looks under HOME when XDG_CONFIG_HOME is unset, empty or relative", () => {
        for (const value of [undefined, "", "conf"]) {
            expect(
                configPath({ XDG_CONFIG_HOME: value, HOME: "/home/u" }),
            ).toBe("/home/u/.config/dorothy/config.toml");
        }
    });
});
