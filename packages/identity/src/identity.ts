// vim:set expandtab shiftwidth=4 filetype=typescript:
// SPDX-License-Identifier: GPL-3.0-only

//
//
// ~xxdorothy/dorothy.git
// ::: :/packages/identity/src/identity.ts
//
//

import soul from "../soul.md" with { type: "text" };
import { LAYER_NAMES, type PersonaLayers, personaLayers } from "./layers.js";
import { stripHouseHeader } from "./strip.js";

export function identityPrompt(): string {
    return stripHouseHeader(soul);
}

export function versionOf(core: string, layers: PersonaLayers): string {
    const text = [core, ...LAYER_NAMES.map((name) => layers[name])].join(
        "\n\0",
    );
    return `xxh3:${Bun.hash.xxHash3(text).toString(16).padStart(16, "0")}`;
}

export function personaVersion(): string {
    return versionOf(identityPrompt(), personaLayers());
}
