// vim:set expandtab shiftwidth=4 filetype=typescript:
// SPDX-License-Identifier: GPL-3.0-only

//
//
// ~xxdorothy/dorothy.git
// ::: :/packages/identity/src/layers.ts
//
//

import judgement from "../layers/judgement.md" with { type: "text" };
import lore from "../layers/lore.md" with { type: "text" };
import voice from "../layers/voice.md" with { type: "text" };
import { stripHouseHeader } from "./strip.js";

export type LayerName = "lore" | "voice" | "judgement";
export const LAYER_NAMES: readonly LayerName[] = ["lore", "voice", "judgement"];
export type PersonaLayers = Readonly<Record<string, string>>;

export function personaLayers(): PersonaLayers {
    return {
        lore: stripHouseHeader(lore),
        voice: stripHouseHeader(voice),
        judgement: stripHouseHeader(judgement),
    };
}
