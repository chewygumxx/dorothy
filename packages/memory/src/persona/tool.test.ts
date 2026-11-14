// vim:set expandtab shiftwidth=4 filetype=typescript:
// SPDX-License-Identifier: GPL-3.0-only

//
//
// ~xxdorothy/dorothy.git
// ::: :/packages/memory/src/persona/tool.test.ts
//
//

import { describe, expect, it } from "bun:test";
import { openLayer, personaDescription } from "./tool.js";

const layers = { lore: "L", voice: "V", judgement: "J" };

describe("persona layers", () => {
    it("opens the named layer as text", () => {
        expect(openLayer(layers, "lore")).toBe("L");
    });

    it.each(["Lore", "../lore", "", "toString"])(
        "rejects the unknown layer %j and names the choices",
        (layer) => {
            expect(() => openLayer(layers, layer)).toThrow(
                "lore, voice and judgement",
            );
        },
    );

    it("describes who the layers are for and what they hold", () => {
        const description = personaDescription(Object.keys(layers));
        for (const name of ["lore", "voice", "judgement"]) {
            expect(description).toContain(name);
        }
        expect(description).toContain("who she is");
        expect(description).toContain("not what she remembers");
        expect(description).toContain("Dorothy alone");
        expect(description).toContain("not for an agent she dispatches");
    });
});
