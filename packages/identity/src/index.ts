// vim:set expandtab shiftwidth=4 filetype=typescript:
// SPDX-License-Identifier: GPL-3.0-only

//
//
// ~xxdorothy/dorothy.git
// ::: :/packages/identity/src/index.ts
//
//

// @dorothy/identity: Dorothy's core and persona layers.

export { identityPrompt, personaVersion, versionOf } from "./identity.js";
export {
    LAYER_NAMES,
    type LayerName,
    type PersonaLayers,
    personaLayers,
} from "./layers.js";
