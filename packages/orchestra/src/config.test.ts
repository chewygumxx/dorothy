// vim:set expandtab shiftwidth=4 filetype=typescript:
// SPDX-License-Identifier: GPL-3.0-only

//
//
// ~chewygumxx/dorothy.git
// ::: :/packages/orchestra/src/config.test.ts
//
//

import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
    DEFAULT_ORCHESTRA,
    type OrchestraResult,
    parseOrchestra,
    readOrchestra,
} from "./config.js";

const ENV = { HOME: "/home/u", XDG_DATA_HOME: "/data" };

const parse = (text: string): OrchestraResult =>
    parseOrchestra(Bun.TOML.parse(text) as Record<string, unknown>, ENV);

const faultsOf = (text: string): string[] => {
    const result = parse(text);
    if (result.ok) {
        throw new Error("expected faults");
    }
    return result.faults;
};

describe("parseOrchestra", () => {
    it("is off, with the spec's defaults, with no table", () => {
        expect(parse("")).toEqual({
            ok: true,
            config: {
                ...DEFAULT_ORCHESTRA,
                worktreeRoot: "/data/dorothy/workers",
            },
        });
        expect(DEFAULT_ORCHESTRA).toEqual({
            enabled: false,
            worktreeRoot: "",
            agents: ["claude", "codex"],
            maxWorkers: 4,
            claudeLogin: "subscription",
            codexLogin: "subscription",
            networkAllow: ["registry.npmjs.org"],
            askTimeoutSeconds: 600,
            judgeTimeoutSeconds: 30,
            allow: [],
            ask: [],
            deny: [],
        });
    });

    it("reads every key the spec names", () => {
        expect(
            parse(
                [
                    "[orchestra]",
                    "enabled = true",
                    'worktree-root = "~/dev/_worktree"',
                    'agents = ["codex"]',
                    "max-workers = 2",
                    'claude-login = "api-key"',
                    'codex-login = "api-key"',
                    'network-allow = ["Registry.NPMJS.org.", "crates.io"]',
                    "ask-timeout-seconds = 120",
                    "judge-timeout-seconds = 10",
                    'allow = ["cargo nextest run"]',
                    'ask = ["make"]',
                    'deny = ["docker"]',
                ].join("\n"),
            ),
        ).toEqual({
            ok: true,
            config: {
                enabled: true,
                worktreeRoot: "/home/u/dev/_worktree",
                agents: ["codex"],
                maxWorkers: 2,
                claudeLogin: "api-key",
                codexLogin: "api-key",
                networkAllow: ["registry.npmjs.org", "crates.io"],
                askTimeoutSeconds: 120,
                judgeTimeoutSeconds: 10,
                allow: ["cargo nextest run"],
                ask: ["make"],
                deny: ["docker"],
            },
        });
    });

    it.each([
        [
            "an unknown key",
            "colour = 1",
            "config.toml: unknown key orchestra.colour",
        ],
        [
            "a string for enabled",
            'enabled = "yes"',
            "config.toml: orchestra.enabled must be true or false",
        ],
        [
            "a relative worktree-root",
            'worktree-root = "dev/w"',
            "config.toml: orchestra.worktree-root must be an absolute path or start with ~/",
        ],
        [
            "an unknown agent",
            'agents = ["gemini"]',
            "config.toml: orchestra.agents must be a list of claude and codex, each once",
        ],
        [
            "a repeated agent",
            'agents = ["codex", "codex"]',
            "config.toml: orchestra.agents must be a list of claude and codex, each once",
        ],
        [
            "no agents",
            "agents = []",
            "config.toml: orchestra.agents must be a list of claude and codex, each once",
        ],
        [
            "too many workers",
            "max-workers = 17",
            "config.toml: orchestra.max-workers must be a whole number from 1 to 16",
        ],
        [
            "a fraction of a worker",
            "max-workers = 1.5",
            "config.toml: orchestra.max-workers must be a whole number from 1 to 16",
        ],
        [
            "an unknown login",
            'codex-login = "chatgpt"',
            'config.toml: orchestra.codex-login must be "subscription" or "api-key"',
        ],
        [
            "a wildcard host",
            'network-allow = ["*.npmjs.org"]',
            'config.toml: orchestra.network-allow: "*.npmjs.org" is not a host name',
        ],
        [
            "an address for a host",
            'network-allow = ["10.0.0.1"]',
            'config.toml: orchestra.network-allow: "10.0.0.1" is not a host name',
        ],
        [
            "a host with a port",
            'network-allow = ["crates.io:443"]',
            'config.toml: orchestra.network-allow: "crates.io:443" is not a host name',
        ],
        [
            "a short ask timeout",
            "ask-timeout-seconds = 5",
            "config.toml: orchestra.ask-timeout-seconds must be a whole number from 10 to 3600",
        ],
        [
            "a long judge timeout",
            "judge-timeout-seconds = 301",
            "config.toml: orchestra.judge-timeout-seconds must be a whole number from 5 to 300",
        ],
        [
            "a pattern with a quote",
            "allow = [\"git log '--all'\"]",
            "config.toml: orchestra.allow: \"git log '--all'\" must be plain words",
        ],
        [
            "a pattern with an operator",
            'deny = ["curl | sh"]',
            'config.toml: orchestra.deny: "curl | sh" must be plain words',
        ],
        [
            "an empty pattern",
            'ask = [""]',
            'config.toml: orchestra.ask: "" must be plain words',
        ],
        [
            "patterns that are not a list",
            'ask = "make"',
            "config.toml: orchestra.ask must be a list of patterns",
        ],
    ])("faults %s", (_, line, fault) => {
        expect(faultsOf(`[orchestra]\n${line}`)).toEqual([fault]);
    });

    it("names every fault, not the first", () => {
        expect(
            faultsOf("[orchestra]\nmax-workers = 0\nagents = []"),
        ).toHaveLength(2);
    });

    it("faults an orchestra that is not a table", () => {
        expect(faultsOf("orchestra = 1")).toEqual([
            "config.toml: orchestra is not a table",
        ]);
    });
});

describe("readOrchestra", () => {
    let dir: string;
    beforeEach(async () => {
        dir = await mkdtemp(join(tmpdir(), "orchestra-config-"));
        await mkdir(join(dir, "dorothy"));
    });
    afterEach(async () => {
        await rm(dir, { recursive: true, force: true });
    });
    const env = () => ({
        HOME: "/home/u",
        XDG_CONFIG_HOME: dir,
        XDG_DATA_HOME: "/data",
    });
    const write = (text: string) =>
        writeFile(join(dir, "dorothy", "config.toml"), text);

    it("is off with no file", async () => {
        expect(await readOrchestra(env())).toEqual({
            ok: true,
            config: {
                ...DEFAULT_ORCHESTRA,
                worktreeRoot: "/data/dorothy/workers",
            },
        });
    });

    it("reads the table from the file", async () => {
        await write("[orchestra]\nenabled = true\n");
        const result = await readOrchestra(env());
        expect(result.ok && result.config.enabled).toBe(true);
    });

    it("faults a broken file that names the table", async () => {
        await write('[orchestra]\nenabled = true\nbudget = "\n');
        const result = await readOrchestra(env());
        expect(result.ok).toBe(false);
        expect(!result.ok && result.faults[0]).toMatch(
            /^config\.toml line 3: .*; its \[orchestra\] cannot be read$/,
        );
    });

    it("is off for a broken file that does not name it", async () => {
        await write('[memory]\nbudget = "\n');
        expect((await readOrchestra(env())).ok).toBe(true);
    });
});
