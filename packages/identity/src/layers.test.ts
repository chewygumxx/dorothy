// vim:set expandtab shiftwidth=4 filetype=typescript:
// SPDX-License-Identifier: GPL-3.0-only

//
//
// ~xxdorothy/dorothy.git
// ::: :/packages/identity/src/layers.test.ts
//
//

import { describe, expect, it } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import {
    identityPrompt,
    LAYER_NAMES,
    personaLayers,
    personaVersion,
    versionOf,
} from "./index.js";
import { stripHouseHeader } from "./strip.js";

const sourceOf = (name: string) =>
    readFileSync(new URL(`../layers/${name}.md`, import.meta.url), "utf8");

describe("personaLayers", () => {
    it("serves every layer soul.md names, and no other", () => {
        const soul = readFileSync(
            new URL("../soul.md", import.meta.url),
            "utf8",
        );
        const section = soul.split("## Layers\n")[1]?.split("\n## ")[0] ?? "";
        const named = new Set(
            [...section.matchAll(/^- `([^`]+)`:/gm)].map(
                (match) => match[1] as string,
            ),
        );
        const files = readdirSync(new URL("../layers/", import.meta.url)).map(
            (name) => name.replace(/\.md$/, ""),
        );
        expect(named).toEqual(new Set(["lore", "voice", "judgement"]));
        expect(new Set(Object.keys(personaLayers()))).toEqual(named);
        expect(new Set<string>(LAYER_NAMES)).toEqual(named);
        expect(new Set(files)).toEqual(named);
        expect(LAYER_NAMES).toEqual(["lore", "voice", "judgement"]);
    });

    it("strips each layer, and none is empty", () => {
        for (const name of LAYER_NAMES) {
            const text = personaLayers()[name];
            expect(text).toBe(stripHouseHeader(sourceOf(name)));
            expect(text).not.toBe("");
            expect(text).toBe(text?.trim());
            for (const marker of ["---\n", ":::", "vim:set"]) {
                expect(text).not.toContain(marker);
            }
        }
    });

    it("versions the core and every layer", () => {
        const core = identityPrompt();
        const layers = personaLayers();
        const version = personaVersion();
        expect(version).toMatch(/^xxh3:[0-9a-f]{16}$/);
        expect(version).toBe(versionOf(core, layers));
        expect(versionOf(`${core} changed`, layers)).not.toBe(version);
        for (const name of LAYER_NAMES) {
            expect(
                versionOf(core, {
                    ...layers,
                    [name]: `${layers[name]} changed`,
                }),
            ).not.toBe(version);
        }
        const joined = [core, layers.lore, layers.voice, layers.judgement].join(
            "\n\0",
        );
        expect(version).toBe(
            `xxh3:${Bun.hash.xxHash3(joined).toString(16).padStart(16, "0")}`,
        );
        expect(
            versionOf(core, {
                judgement: layers.judgement as string,
                voice: layers.voice as string,
                lore: layers.lore as string,
            }),
        ).toBe(version);
    });

    it("ignores header-only edits", () => {
        const core = identityPrompt();
        const layers = personaLayers();
        for (const name of LAYER_NAMES) {
            const source = sourceOf(name);
            const edited = source.replace(/^mtime: .*$/m, "mtime: 2099-12-31");
            expect(edited).not.toBe(source);
            expect(
                versionOf(core, {
                    ...layers,
                    [name]: stripHouseHeader(edited),
                }),
            ).toBe(versionOf(core, layers));
        }
    });
});
