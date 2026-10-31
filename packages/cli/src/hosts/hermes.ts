// vim:set expandtab shiftwidth=4 filetype=typescript:
// SPDX-License-Identifier: GPL-3.0-only

//
//
// ~chewygumxx/dorothy.git
// ::: :/packages/cli/src/hosts/hermes.ts
//
//

// dorothy --install hermes: a Hermes profile of hers, beside the user's.
// Hermes makes it from the user's own (--clone, no alias); she then owns
// its SOUL.md, her plugin, dorothy.json and four configuration keys,
// and nothing else in it or in any other profile.

import { cp, mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { loadProfiles } from "@dorothy/memory/host-hook";
import { parseDocument } from "yaml";

const PROFILE = "dorothy";
const PLUGIN = join(import.meta.dir, "../../assets/hermes/dorothy");

export type HermesDeps = {
    home: string;
    run: (cmd: string[]) => Promise<number>;
    self: string[];
    persona: string;
    force?: boolean;
    write: (text: string) => void;
    answers?: (self: string[]) => Promise<boolean>;
    // The path of `hermes` on PATH, or null; and its `--version`'s version.
    which: () => string | null;
    version: (hermes: string) => string | null;
};

const profileDir = (home: string) => join(home, "profiles", PROFILE);
const read = (path: string) => readFile(path, "utf8").catch(() => null);
const exists = (path: string) =>
    stat(path).then(
        () => true,
        () => false,
    );

// `hermes --version`'s version, or null.
export const hermesVersion = (hermes: string): string | null => {
    const run = Bun.spawnSync([hermes, "--version"], { stderr: "ignore" });
    return run.stdout.toString().match(/\d+\.\d+\.\d+/)?.[0] ?? null;
};

const digest = (text: string) => Bun.hash(text).toString(16);

type Marker = { command: string[]; soul: string };

// dorothy.json is hers alone: what her install wrote, and so proof that
// the profile is one she made.
const readMarker = async (dir: string): Promise<Marker | null> => {
    const text = await read(join(dir, "dorothy.json"));
    try {
        return text === null ? null : (JSON.parse(text) as Marker);
    } catch {
        return null;
    }
};

// Whether her command answers --hook: an entry from before --hook was
// built exits 2, and the provider would answer nothing, unseen.
const answersHook = async (self: string[]) =>
    (await Bun.spawn([...self, "--hook", "hermes", "prompt"], {
        stdin: new Blob(["{}"]),
        stdout: "ignore",
        stderr: "ignore",
    }).exited) === 0;

// Her keys alone, merged into a document whose comments and other keys
// stay as the user left them, and whose long values are not refolded.
// Throws on a config that is not YAML or whose `memory` is not a mapping.
function mergeConfig(text: string, self: string[]): string {
    const document = parseDocument(text);
    const [problem] = document.errors;
    if (problem) {
        throw problem;
    }
    document.setIn(["memory", "provider"], PROFILE);
    document.setIn(["memory", "memory_enabled"], false);
    document.setIn(["memory", "user_profile_enabled"], false);
    document.setIn(["mcp_servers", PROFILE], {
        command: self[0],
        args: [...self.slice(1), "--mcp", "--host", "hermes"],
    });
    return document.toString({ lineWidth: 0 });
}

const KEYS = [
    "memory.provider",
    "memory.memory_enabled",
    "memory.user_profile_enabled",
    `mcp_servers.${PROFILE}`,
];

// The merged config, or null once the problem is said.
const merged = async (path: string, deps: HermesDeps) => {
    try {
        return mergeConfig((await read(path)) ?? "{}\n", deps.self);
    } catch (error) {
        deps.write(`dorothy: ${path}: ${(error as Error).message}\n`);
        return null;
    }
};

// The binary, or null once its absence is said; a version her profile was
// not checked against is a warning only.
async function hermesBinary(deps: HermesDeps): Promise<string | null> {
    const hermes = deps.which();
    if (hermes === null) {
        deps.write("dorothy: hermes is not on PATH\n");
        return null;
    }
    const checked = (await loadProfiles()).get("hermes")?.checked ?? [];
    const running = deps.version(hermes);
    if (running !== null && !checked.includes(running)) {
        deps.write(
            `dorothy: Hermes ${running} is not one her profile was checked against (${checked.join(", ")})\n`,
        );
    }
    return hermes;
}

export async function installHermes(deps: HermesDeps): Promise<number> {
    if ((await hermesBinary(deps)) === null) {
        return 1;
    }
    if (!(await (deps.answers ?? answersHook)(deps.self))) {
        deps.write(`dorothy: ${deps.self.join(" ")} does not answer --hook\n`);
        return 1;
    }
    const dir = profileDir(deps.home);
    const config = join(dir, "config.yaml");
    const marker = await readMarker(dir);
    let made = false;
    // A config she cannot merge into stops the install before Hermes makes
    // her profile, or she writes a file: the clone would carry it anyway.
    const source = (await exists(dir))
        ? config
        : join(deps.home, "config.yaml");
    if ((await merged(source, deps)) === null) {
        return 1;
    }
    // The directory, not config.yaml, tells whether she has a profile:
    // a clone of a home with no config.yaml makes none.
    if (!(await exists(dir))) {
        const code = await deps.run([
            "hermes",
            "profile",
            "create",
            PROFILE,
            "--no-alias",
            "--clone",
        ]);
        if (code !== 0) {
            deps.write("dorothy: hermes could not make her profile\n");
            return 1;
        }
        made = true;
    } else if (marker === null && !deps.force) {
        deps.write(
            `dorothy: ${dir} is not a profile she made; --force takes it\n`,
        );
        return 1;
    }
    const soul = join(dir, "SOUL.md");
    const persona = `${deps.persona}\n`;
    const present = await read(soul);
    // Hers when this run made the profile (its SOUL.md the clone's), or
    // when it is still what she last wrote.
    const hers =
        made ||
        present === null ||
        present === persona ||
        (marker !== null && digest(present) === marker.soul);
    if (!hers && !deps.force) {
        deps.write(
            `dorothy: ${soul} was edited since she wrote it; --force replaces it\n`,
        );
        return 1;
    }
    const text = await merged(config, deps);
    if (text === null) {
        return 1;
    }
    await writeFile(soul, persona);
    await mkdir(join(dir, "plugins"), { recursive: true });
    await cp(PLUGIN, join(dir, "plugins", PROFILE), {
        recursive: true,
        filter: (path) => !path.includes("__pycache__"),
    });
    await writeFile(
        join(dir, "dorothy.json"),
        `${JSON.stringify({ command: deps.self, soul: digest(persona) }, null, 4)}\n`,
    );
    await writeFile(config, text);
    for (const file of [
        "SOUL.md",
        "plugins/dorothy/",
        "dorothy.json",
        "config.yaml",
    ]) {
        deps.write(`dorothy: wrote ${join(dir, file)}\n`);
    }
    for (const key of KEYS) {
        deps.write(`dorothy: wrote ${key} in ${config}\n`);
    }
    deps.write("dorothy: start her with `hermes -p dorothy`\n");
    return 0;
}

export async function uninstallHermes(deps: HermesDeps): Promise<number> {
    if (deps.which() === null) {
        deps.write("dorothy: hermes is not on PATH\n");
        return 1;
    }
    if ((await readMarker(profileDir(deps.home))) === null) {
        deps.write("dorothy: no profile of hers to remove\n");
        return 1;
    }
    return deps.run(["hermes", "profile", "delete", PROFILE, "--yes"]);
}
