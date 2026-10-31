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
// its SOUL.md, her plugin, dorothy.json and three configuration keys,
// and nothing else in it or in any other profile.

import { cp, mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
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
};

const profileDir = (home: string) => join(home, "profiles", PROFILE);
const read = (path: string) => readFile(path, "utf8").catch(() => null);
const exists = (path: string) =>
    stat(path).then(
        () => true,
        () => false,
    );

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

export async function installHermes(deps: HermesDeps): Promise<number> {
    if (!(await (deps.answers ?? answersHook)(deps.self))) {
        deps.write(`dorothy: ${deps.self.join(" ")} does not answer --hook\n`);
        return 1;
    }
    const dir = profileDir(deps.home);
    const config = join(dir, "config.yaml");
    const marker = await readMarker(dir);
    let made = false;
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
    // Her keys alone, merged into a document whose comments and other
    // keys stay as the user left them.
    const document = parseDocument((await read(config)) ?? "{}\n");
    document.setIn(["memory", "provider"], PROFILE);
    document.setIn(["memory", "memory_enabled"], false);
    document.setIn(["memory", "user_profile_enabled"], false);
    document.setIn(["mcp_servers", PROFILE], {
        command: deps.self[0],
        args: [...deps.self.slice(1), "--mcp", "--host", "hermes"],
    });
    await writeFile(config, document.toString());
    for (const file of [
        "SOUL.md",
        "plugins/dorothy/",
        "dorothy.json",
        "config.yaml",
    ]) {
        deps.write(`dorothy: wrote ${join(dir, file)}\n`);
    }
    deps.write("dorothy: start her with `hermes -p dorothy`\n");
    return 0;
}

export async function uninstallHermes(deps: HermesDeps): Promise<number> {
    if ((await readMarker(profileDir(deps.home))) === null) {
        deps.write("dorothy: no profile of hers to remove\n");
        return 1;
    }
    return deps.run(["hermes", "profile", "delete", PROFILE, "--yes"]);
}
