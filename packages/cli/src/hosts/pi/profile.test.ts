// vim:set expandtab shiftwidth=4 filetype=typescript:
// SPDX-License-Identifier: GPL-3.0-only

//
//
// ~chewygumxx/dorothy.git
// ::: :/packages/cli/src/hosts/pi/profile.test.ts
//
//

import { afterAll, expect, it } from "bun:test";
import {
    mkdir,
    mkdtemp,
    readdir,
    readFile,
    rm,
    stat,
    writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import type { Env } from "@dorothy/core";
import { type PiLaunchManifest, sessionDirFor } from "./models.js";
import { piProfileArgs, preparePiProfile } from "./profile.js";

const roots: string[] = [];
afterAll(async () => {
    await Promise.all(
        roots.map((root) => rm(root, { recursive: true, force: true })),
    );
});

const syntheticKey = "synthetic-key-0123456789abcdef";

async function scratch() {
    const root = await mkdtemp(join(tmpdir(), "dorothy-pi-profile-"));
    roots.push(root);
    return {
        root,
        cwd: join(root, "project"),
        env: {
            HOME: join(root, "home"),
            XDG_CONFIG_HOME: join(root, "config"),
            XDG_DATA_HOME: join(root, "data"),
            XDG_RUNTIME_DIR: join(root, "run"),
            TMPDIR: join(root, "tmp"),
        } as Env,
    };
}

async function put(path: string, text: string) {
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, text);
}

const modes = async (path: string) => (await stat(path)).mode & 0o777;
const exists = (path: string) =>
    stat(path).then(
        () => true,
        () => false,
    );

function manifest(launchId: string, cwd: string): PiLaunchManifest {
    return {
        version: 1,
        launchId,
        cwd,
        self: ["/bin/bun", "--no-env-file", "/d/packages/cli/src/index.ts"],
        entry: {
            provider: "featherless",
            kind: "featherless",
            model: "deepseek-ai/DeepSeek-V4.1-Flash-1017",
            baseUrl: "https://api.featherless.ai/v1",
            key: "FEATHERLESS_API_KEY",
            price: null,
        },
        models: [],
        extensions: ["/d/packages/cli/assets/pi/dorothy.ts"],
        skills: ["/d/skills/memory"],
        helperEnv: { DOROTHY_ROOT: "/d", HOME: "/home/u" },
    };
}

async function prepare(
    s: Awaited<ReturnType<typeof scratch>>,
    launchId = "launch-a",
    persona = "You are Dorothy.",
) {
    return preparePiProfile({
        env: s.env,
        cwd: s.cwd,
        launchId,
        persona,
        manifest: manifest(launchId, s.cwd),
    });
}

it("places the profile, sessions and launch from the injected roots", async () => {
    const s = await scratch();
    const profile = await prepare(s);
    expect(profile.agentDir).toBe(join(s.root, "config/dorothy/pi"));
    expect(profile.sessionDir).toBe(
        join(s.root, "data/dorothy/pi/sessions", sessionDirFor(s.cwd)),
    );
    expect(profile.launchDir).toBe(join(s.root, "run/dorothy/pi-launch-a"));
    expect(profile.personaPath.startsWith(profile.launchDir)).toBe(true);
    expect(profile.manifestPath.startsWith(profile.launchDir)).toBe(true);
    expect(await readFile(profile.personaPath, "utf8")).toBe(
        "You are Dorothy.",
    );
    // The manifest names the persona file, which her extension reads.
    expect(JSON.parse(await readFile(profile.manifestPath, "utf8"))).toEqual({
        ...manifest("launch-a", s.cwd),
        persona: profile.personaPath,
    });
});

it("uses the existing XDG defaults and a private temporary directory", async () => {
    const s = await scratch();
    const env = { HOME: s.env.HOME, TMPDIR: s.env.TMPDIR };
    const profile = await preparePiProfile({
        env,
        cwd: s.cwd,
        launchId: "launch-a",
        persona: "p",
        manifest: manifest("launch-a", s.cwd),
    });
    expect(profile.agentDir).toBe(join(s.root, "home/.config/dorothy/pi"));
    expect(profile.sessionDir).toBe(
        join(
            s.root,
            "home/.local/share/dorothy/pi/sessions",
            sessionDirFor(s.cwd),
        ),
    );
    const uid = process.getuid?.() ?? 0;
    expect(profile.launchDir).toBe(
        join(s.root, `tmp/dorothy-${uid}/pi-launch-a`),
    );
    expect(await modes(dirname(profile.launchDir))).toBe(0o700);
});

it("writes private files and directories and no key", async () => {
    const s = await scratch();
    s.env.FEATHERLESS_API_KEY = syntheticKey;
    const profile = await prepare(s);
    for (const dir of [
        profile.agentDir,
        profile.sessionDir,
        profile.launchDir,
    ]) {
        expect(await modes(dir)).toBe(0o700);
    }
    for (const file of [profile.manifestPath, profile.personaPath]) {
        expect(await modes(file)).toBe(0o600);
    }
    expect(await readdir(profile.launchDir)).toHaveLength(2);
    const text = await readFile(profile.manifestPath, "utf8");
    expect(text).not.toContain(syntheticKey);
    expect(text).toContain("FEATHERLESS_API_KEY");
    for (const name of await readdir(s.root, { recursive: true })) {
        const file = join(s.root, name);
        if ((await stat(file)).isFile()) {
            expect(await readFile(file, "utf8")).not.toContain(syntheticKey);
        }
    }
});

it("gives parallel launches distinct directories and one marker", async () => {
    const s = await scratch();
    const [profileA, profileB] = await Promise.all([
        prepare(s, "launch-a", "A"),
        prepare(s, "launch-b", "B"),
    ]);
    expect(profileA.launchDir).not.toBe(profileB.launchDir);
    expect(await readFile(profileA.personaPath, "utf8")).toBe("A");
    expect(await readFile(profileB.personaPath, "utf8")).toBe("B");
    expect(
        JSON.parse(await readFile(profileA.manifestPath, "utf8")).launchId,
    ).toBe("launch-a");
    expect(
        JSON.parse(await readFile(profileB.manifestPath, "utf8")).launchId,
    ).toBe("launch-b");
    expect(profileA.agentDir).toBe(profileB.agentDir);
    expect(await readdir(profileA.agentDir)).toEqual(["dorothy-owner.json"]);
});

it("survives many racing first launches", async () => {
    const s = await scratch();
    const profiles = await Promise.all(
        Array.from({ length: 8 }, (_, i) => prepare(s, `launch-${i}`)),
    );
    expect(new Set(profiles.map((p) => p.launchDir)).size).toBe(8);
    expect(await readdir(profiles[0]?.agentDir ?? "")).toEqual([
        "dorothy-owner.json",
    ]);
});

it("refuses a launch id that reuses a live launch", async () => {
    const s = await scratch();
    const first = await prepare(s);
    await expect(prepare(s, "launch-a", "other")).rejects.toThrow(
        /pi_launch_exists/,
    );
    expect(await readFile(first.personaPath, "utf8")).toBe("You are Dorothy.");
});

it("refuses a launch id that is a path", async () => {
    const s = await scratch();
    for (const id of ["", "../x", "a/b", ".", ".."]) {
        await expect(prepare(s, id)).rejects.toThrow(/pi_launch_id/);
    }
});

it("refuses a manifest of another launch or directory", async () => {
    const s = await scratch();
    await expect(
        preparePiProfile({
            env: s.env,
            cwd: s.cwd,
            launchId: "launch-a",
            persona: "p",
            manifest: manifest("launch-b", s.cwd),
        }),
    ).rejects.toThrow(/pi_manifest_mismatch/);
    await expect(
        preparePiProfile({
            env: s.env,
            cwd: s.cwd,
            launchId: "launch-a",
            persona: "p",
            manifest: manifest("launch-a", "/elsewhere"),
        }),
    ).rejects.toThrow(/pi_manifest_mismatch/);
    expect(await exists(join(s.root, "config"))).toBe(false);
});

it("refuses a nonempty directory without Dorothy's marker", async () => {
    const s = await scratch();
    const agentDir = join(s.root, "config/dorothy/pi");
    await put(join(agentDir, "settings.json"), '{"theme":"mine"}');
    await expect(prepare(s)).rejects.toThrow(`pi_profile_unowned: ${agentDir}`);
    expect(await readdir(agentDir)).toEqual(["settings.json"]);
    expect(await readFile(join(agentDir, "settings.json"), "utf8")).toBe(
        '{"theme":"mine"}',
    );
    expect(await exists(join(s.root, "run"))).toBe(false);
});

it("refuses a marker that is not Dorothy's", async () => {
    const s = await scratch();
    const agentDir = join(s.root, "config/dorothy/pi");
    await put(join(agentDir, "dorothy-owner.json"), '{"owner":"someone"}');
    await expect(prepare(s)).rejects.toThrow(/pi_profile_unowned/);
    await put(join(agentDir, "dorothy-owner.json"), "not json");
    await expect(prepare(s)).rejects.toThrow(/pi_profile_unowned/);
});

it("claims an empty directory and keeps the user's preferences", async () => {
    const s = await scratch();
    const agentDir = join(s.root, "config/dorothy/pi");
    await mkdir(agentDir, { recursive: true });
    await prepare(s);
    const mine = {
        "settings.json": '{"theme":"mine"}',
        "keybindings.json": '{"app.exit":"ctrl+q"}',
        "trust.json": '{"/p":"trusted"}',
    };
    for (const [name, text] of Object.entries(mine)) {
        await writeFile(join(agentDir, name), text);
    }
    const marker = await readFile(join(agentDir, "dorothy-owner.json"), "utf8");
    const profile = await prepare(s, "launch-b");
    await profile.cleanup();
    for (const [name, text] of Object.entries(mine)) {
        expect(await readFile(join(agentDir, name), "utf8")).toBe(text);
    }
    expect(await readFile(join(agentDir, "dorothy-owner.json"), "utf8")).toBe(
        marker,
    );
});

it("cleans only its launch directory and keeps sessions", async () => {
    const s = await scratch();
    const profileA = await prepare(s, "launch-a");
    const profileB = await prepare(s, "launch-b");
    const session = join(profileA.sessionDir, "2026-11-03_a.jsonl");
    await writeFile(session, '{"type":"session"}\n');
    await writeFile(join(profileA.agentDir, "settings.json"), "{}");
    await profileA.cleanup();
    expect(await exists(profileA.launchDir)).toBe(false);
    expect(await exists(profileB.launchDir)).toBe(true);
    expect(await exists(profileB.manifestPath)).toBe(true);
    expect(await readFile(session, "utf8")).toBe('{"type":"session"}\n');
    expect(await exists(join(profileA.agentDir, "settings.json"))).toBe(true);
    await profileA.cleanup();
    expect(await exists(dirname(profileA.launchDir))).toBe(true);
});

it("cleans its launch directory when setup fails", async () => {
    const s = await scratch();
    const kept = await prepare(s, "launch-a");
    const circular = manifest("launch-b", s.cwd) as PiLaunchManifest & {
        self: unknown[];
    };
    circular.self.push(circular);
    await expect(
        preparePiProfile({
            env: s.env,
            cwd: s.cwd,
            launchId: "launch-b",
            persona: "p",
            manifest: circular,
        }),
    ).rejects.toThrow();
    expect(await readdir(dirname(kept.launchDir))).toEqual(["pi-launch-a"]);
    expect(await exists(kept.manifestPath)).toBe(true);
});

it("reports servers of the profile and project without running them", async () => {
    const s = await scratch();
    const agentDir = join(s.root, "config/dorothy/pi");
    const ran = join(s.root, "ran");
    await put(
        join(agentDir, "mcp.json"),
        JSON.stringify({
            mcpServers: { docs: { command: "touch", args: [ran] } },
        }),
    );
    await put(join(agentDir, "dorothy-owner.json"), ownerMarker);
    await put(
        join(s.cwd, ".pi/mcp.json"),
        JSON.stringify({
            mcpServers: { tools: { command: "touch", args: [ran] } },
        }),
    );
    const profile = await prepare(s);
    expect(profile.mcpServers).toEqual([
        { source: "profile", name: "docs" },
        { source: "project", name: "tools" },
    ]);
    expect(await exists(ran)).toBe(false);
});

const ownerMarker = JSON.stringify({
    owner: "dorothy",
    kind: "pi-profile",
    version: 1,
});

it("rejects a dorothy-memory collision in either file", async () => {
    for (const [name, where] of [
        ["dorothy-memory", "config/dorothy/pi/mcp.json"],
        ["dorothy_memory", "project/.pi/mcp.json"],
    ] as const) {
        const s = await scratch();
        await put(
            join(s.root, "config/dorothy/pi/dorothy-owner.json"),
            ownerMarker,
        );
        await put(
            join(s.root, where),
            JSON.stringify({ mcpServers: { [name]: { enabled: false } } }),
        );
        await expect(prepare(s)).rejects.toThrow(
            `pi_mcp_collision: ${join(s.root, where)}`,
        );
        expect(await exists(join(s.root, "run"))).toBe(false);
    }
});

it("ignores a missing or unreadable MCP configuration", async () => {
    const s = await scratch();
    await put(
        join(s.root, "config/dorothy/pi/dorothy-owner.json"),
        ownerMarker,
    );
    await put(join(s.cwd, ".pi/mcp.json"), "{ not json");
    expect((await prepare(s)).mcpServers).toEqual([]);
    await put(join(s.cwd, ".pi/mcp.json"), '{"mcpServers":[1]}');
    expect((await prepare(s, "launch-b")).mcpServers).toEqual([]);
});

it("passes the profile and sessions, and loads only declared resources", async () => {
    const s = await scratch();
    const profile = await prepare(s);
    expect(piProfileArgs(profile, manifest("launch-a", s.cwd))).toEqual([
        "--session-dir",
        profile.sessionDir,
        "--no-extensions",
        "--no-skills",
        "-e",
        "builtin:mcp",
        "-e",
        "/d/packages/cli/assets/pi/dorothy.ts",
        "--skill",
        "/d/skills/memory",
    ]);
});
