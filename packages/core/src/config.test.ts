// vim:set expandtab shiftwidth=4 filetype=typescript:
// SPDX-License-Identifier: GPL-3.0-only

//
//
// ~chewygumxx/dorothy.git
// ::: :/packages/core/src/config.test.ts
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
        expect(DEFAULT_CONFIG.memory.recall).toBe(true);
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
                memory: DEFAULT_CONFIG.memory,
                compaction: DEFAULT_CONFIG.compaction,
                history: DEFAULT_CONFIG.history,
                service: DEFAULT_CONFIG.service,
                recording: DEFAULT_CONFIG.recording,
            },
            warnings: [],
        });
    });

    it("reads [history]", () => {
        expect(DEFAULT_CONFIG.history).toEqual({
            enabled: true,
            pushSeconds: 60,
        });
        expect(
            parseConfig("[history]\nenabled = false\npush-seconds = 300\n"),
        ).toEqual({
            config: {
                ...DEFAULT_CONFIG,
                history: { enabled: false, pushSeconds: 300 },
            },
            warnings: [],
        });
        expect(parseConfig("[history]\npush-seconds = 5\n").warnings).toEqual([
            "config.toml: history.push-seconds must be a whole number from 10 to 86400",
        ]);
    });

    it("reads [service]", () => {
        const { config, warnings } = parseConfig(
            '[service]\nport = 5000\nlisten = ["100.64.0.1", "fd7a::1"]\n',
        );
        expect(warnings).toEqual([]);
        expect(config.service).toEqual({
            port: 5000,
            listen: ["100.64.0.1", "fd7a::1"],
            claudeDirs: [],
        });
    });

    it("listens on loopback alone by default", () => {
        expect(parseConfig("").config.service).toEqual({
            port: 4774,
            listen: [],
            claudeDirs: [],
        });
    });

    it("reads the further Claude Code directories a transcript may be in", () => {
        const { config, warnings } = parseConfig(
            '[service]\nclaude-dirs = ["/home/me/.config/claude-2"]\n',
        );
        expect(warnings).toEqual([]);
        expect(config.service.claudeDirs).toEqual([
            "/home/me/.config/claude-2",
        ]);
    });

    it("warns of claude-dirs that are not absolute paths", () => {
        const { config, warnings } = parseConfig(
            '[service]\nclaude-dirs = ["~/.claude-2"]\n',
        );
        expect(config.service.claudeDirs).toEqual([]);
        expect(warnings).toEqual([
            'config.toml: service.claude-dirs must be a list of absolute paths, such as "/home/me/.config/claude"',
        ]);
    });

    it("records no host by default, sweeping every 300 seconds", () => {
        expect(parseConfig("").config.recording).toEqual({
            hosts: [],
            sweepSeconds: 300,
        });
    });

    it("reads [recording]", () => {
        const { config, warnings } = parseConfig(
            '[recording]\nhosts = ["codex", "claude-code", "codex"]\nsweep-seconds = 60\n',
        );
        expect(warnings).toEqual([]);
        expect(config.recording).toEqual({
            hosts: ["codex", "claude-code"],
            sweepSeconds: 60,
        });
    });

    it("warns of a host it does not record and keeps none", () => {
        const { config, warnings } = parseConfig(
            '[recording]\nhosts = ["codex", "emacs"]\n',
        );
        expect(config.recording.hosts).toEqual([]);
        expect(warnings).toEqual([
            "config.toml: recording.hosts must be a list of hosts from claude-code, codex, hermes",
        ]);
    });

    it("warns of hosts that are no list", () => {
        const { config, warnings } = parseConfig(
            '[recording]\nhosts = "codex"\n',
        );
        expect(config.recording.hosts).toEqual([]);
        expect(warnings).toHaveLength(1);
    });

    it("keeps sweep-seconds from 10 to 86400", () => {
        for (const bad of ["9", "86401", "1.5", '"60"']) {
            const { config, warnings } = parseConfig(
                `[recording]\nsweep-seconds = ${bad}\n`,
            );
            expect(config.recording.sweepSeconds).toBe(300);
            expect(warnings).toEqual([
                "config.toml: recording.sweep-seconds must be a whole number from 10 to 86400",
            ]);
        }
    });

    it("warns of an unknown recording key and of a recording that is no table", () => {
        expect(parseConfig("[recording]\nsweep = 1\n").warnings).toEqual([
            "config.toml: unknown key recording.sweep",
        ]);
        expect(parseConfig("recording = 1\n").warnings).toEqual([
            "config.toml: recording is not a table",
        ]);
    });

    it("warns of a listen that is no list of addresses", () => {
        const { config, warnings } = parseConfig(
            '[service]\nlisten = ["http://x"]\n',
        );
        expect(config.service.listen).toEqual([]);
        expect(warnings).toEqual([
            'config.toml: service.listen must be a list of addresses, such as "100.64.0.1"',
        ]);
    });

    it("keeps a listen to names and IP literals", () => {
        const good = ["100.64.0.1", "fd7a::1", "::1", "box.example.com", "box"];
        const { config, warnings } = parseConfig(
            `[service]\nlisten = ${JSON.stringify(good)}\n`,
        );
        expect(warnings).toEqual([]);
        expect(config.service.listen).toEqual(good);
        for (const bad of ["-", ":", "a:b", "-box", "box-", "a..b", "1:2:3"]) {
            const parsed = parseConfig(`[service]\nlisten = ["${bad}"]\n`);
            expect(parsed.config.service.listen).toEqual([]);
            expect(parsed.warnings).toHaveLength(1);
        }
    });

    it("lists each listen address once", () => {
        const { config } = parseConfig(
            '[service]\nlisten = ["100.64.0.1", "100.64.0.1", "fd7a::1"]\n',
        );
        expect(config.service.listen).toEqual(["100.64.0.1", "fd7a::1"]);
    });

    it("warns of a listen that is not a list at all", () => {
        for (const value of ['"100.64.0.1"', "5", "true"]) {
            const { config, warnings } = parseConfig(
                `[service]\nlisten = ${value}\n`,
            );
            expect(config.service.listen).toEqual([]);
            expect(warnings).toEqual([
                'config.toml: service.listen must be a list of addresses, such as "100.64.0.1"',
            ]);
        }
    });

    it("keeps the port from 1024 to 65535", () => {
        for (const port of ["80", "1023", "65536", "-1", '"4774"', "1.5"]) {
            const { config, warnings } = parseConfig(
                `[service]\nport = ${port}\n`,
            );
            expect(config.service.port).toBe(4774);
            expect(warnings).toEqual([
                "config.toml: service.port must be a whole number from 1024 to 65535",
            ]);
        }
        expect(parseConfig("[service]\nport = 65535\n").warnings).toEqual([]);
    });

    it("reads memory's extract-cap, 10 by default", () => {
        expect(parseConfig("").config.memory.extractCap).toBe(10);
        expect(
            parseConfig("[memory]\nextract-cap = 3\n").config.memory.extractCap,
        ).toBe(3);
        for (const cap of ["0", "101", "1000"]) {
            const { config, warnings } = parseConfig(
                `[memory]\nextract-cap = ${cap}\n`,
            );
            expect(config.memory.extractCap).toBe(10);
            expect(warnings).toEqual([
                "config.toml: memory.extract-cap must be a whole number from 1 to 100",
            ]);
        }
        expect(
            parseConfig("[memory]\nextract-cap = 100\n").config.memory
                .extractCap,
        ).toBe(100);
    });

    it("reads the memory table", () => {
        const text = [
            "[memory]",
            "enabled = false",
            "budget = 500",
            "idle-seconds = 30",
            "half-life-days = 7",
            "catch-up = 0",
        ].join("\n");
        expect(parseConfig(text)).toEqual({
            config: {
                ...DEFAULT_CONFIG,
                memory: {
                    enabled: false,
                    recall: true,
                    budget: 500,
                    idleSeconds: 30,
                    halfLifeDays: 7,
                    catchUp: 0,
                    extractCap: 10,
                },
            },
            warnings: [],
        });
    });

    it("warns of each bad memory value and keeps its default", () => {
        const text = [
            "[memory]",
            'enabled = "yes"',
            "budget = 100",
            "idle-seconds = 1.5",
            "catch-up = 51",
            "half-life-days = 14",
            "mood = 1",
        ].join("\n");
        expect(parseConfig(text)).toEqual({
            config: {
                ...DEFAULT_CONFIG,
                memory: { ...DEFAULT_CONFIG.memory, halfLifeDays: 14 },
            },
            warnings: [
                "config.toml: memory.enabled must be true or false",
                "config.toml: memory.budget must be a whole number from 200 to 20000",
                "config.toml: memory.idle-seconds must be a whole number from 10 to 3600",
                "config.toml: memory.catch-up must be a whole number from 0 to 50",
                "config.toml: unknown key memory.mood",
            ],
        });
    });

    it("turns recall off", () => {
        const { config, warnings } = parseConfig("[memory]\nrecall = false\n");
        expect(config.memory.recall).toBe(false);
        expect(config.memory.enabled).toBe(true);
        expect(warnings).toEqual([]);
    });

    it("warns of a recall that is not true or false", () => {
        const { config, warnings } = parseConfig('[memory]\nrecall = "no"\n');
        expect(config.memory.recall).toBe(true);
        expect(warnings).toEqual([
            "config.toml: memory.recall must be true or false",
        ]);
    });

    it("warns when memory is not a table", () => {
        expect(parseConfig("memory = 3")).toEqual({
            config: DEFAULT_CONFIG,
            warnings: ["config.toml: memory is not a table"],
        });
    });

    it("budgets 4000 tokens of memory by default", () => {
        expect(DEFAULT_CONFIG.memory.budget).toBe(4000);
    });

    it("reads the compaction table", () => {
        const text = [
            "[compaction]",
            "enabled = false",
            "soft = 3000",
            "hard = 5000",
            "tail = 1000",
        ].join("\n");
        expect(parseConfig(text)).toEqual({
            config: {
                ...DEFAULT_CONFIG,
                compaction: {
                    enabled: false,
                    soft: 3000,
                    hard: 5000,
                    tail: 1000,
                },
            },
            warnings: [],
        });
    });

    it("warns of each bad compaction value and keeps its default", () => {
        const text = [
            "[compaction]",
            'enabled = "no"',
            "soft = 1000",
            "hard = 960000",
            "tail = 2.5",
            "speed = 1",
        ].join("\n");
        expect(parseConfig(text)).toEqual({
            config: DEFAULT_CONFIG,
            warnings: [
                "config.toml: compaction.enabled must be true or false",
                "config.toml: compaction.soft must be a whole number from 2000 to 900000",
                "config.toml: compaction.hard must be a whole number from 4000 to 950000",
                "config.toml: compaction.tail must be a whole number from 500 to 200000",
                "config.toml: unknown key compaction.speed",
            ],
        });
    });

    it("takes all three defaults when tail < soft < hard fails", () => {
        const { config, warnings } = parseConfig(
            "[compaction]\nsoft = 9000\nhard = 8000\n",
        );
        expect(config.compaction).toEqual(DEFAULT_CONFIG.compaction);
        expect(warnings).toEqual([
            "config.toml: compaction needs tail < soft < hard; using the defaults for all three",
        ]);
    });

    it("keeps a soft below the default tail as long as tail is lowered too", () => {
        const { config, warnings } = parseConfig(
            "[compaction]\nsoft = 3000\nhard = 6000\ntail = 600\n",
        );
        expect(config.compaction).toEqual({
            enabled: true,
            soft: 3000,
            hard: 6000,
            tail: 600,
        });
        expect(warnings).toEqual([]);
    });

    it("warns when compaction is not a table", () => {
        expect(parseConfig("compaction = 1")).toEqual({
            config: DEFAULT_CONFIG,
            warnings: ["config.toml: compaction is not a table"],
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
