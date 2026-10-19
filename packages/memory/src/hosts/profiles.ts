// vim:set expandtab shiftwidth=4 filetype=typescript:
// SPDX-License-Identifier: GPL-3.0-only

//
//
// ~chewygumxx/dorothy.git
// ::: :/packages/memory/src/hosts/profiles.ts
//
//

// Host profiles: one JSON file a harness, so a harness is added without
// changing the service. Each is checked against the schema, and its id
// against its file's name.

import { readdir } from "node:fs/promises";
import { basename, join } from "node:path";
import type { HostProfile } from "@dorothy/core";
import { hostProfileSchema } from "../contract/schemas.js";

export const PROFILES_DIR = import.meta.dir;

export type Profiles = ReadonlyMap<string, HostProfile>;

export async function loadProfiles(
    dir: string = PROFILES_DIR,
): Promise<Profiles> {
    const profiles = new Map<string, HostProfile>();
    const files = (await readdir(dir))
        .filter((name) => name.endsWith(".json"))
        .sort();
    if (files.length === 0) {
        throw new Error(`no host profile in ${dir}`);
    }
    for (const file of files) {
        let json: unknown;
        try {
            json = await Bun.file(join(dir, file)).json();
        } catch (error) {
            throw new Error(
                `hosts/${file}: not JSON (${error instanceof Error ? error.message : String(error)})`,
            );
        }
        const parsed = hostProfileSchema.safeParse(json);
        if (!parsed.success) {
            const issue = parsed.error.issues[0];
            const field = issue?.path.join(".") ?? "";
            throw new Error(
                `hosts/${file}: ${field === "" ? "" : `${field}: `}${issue?.message ?? "not a profile"}`,
            );
        }
        if (parsed.data.id !== basename(file, ".json")) {
            throw new Error(`hosts/${file}: its id is ${parsed.data.id}`);
        }
        profiles.set(parsed.data.id, parsed.data);
    }
    return profiles;
}
