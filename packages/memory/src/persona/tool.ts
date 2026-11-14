// vim:set expandtab shiftwidth=4 filetype=typescript:
// SPDX-License-Identifier: GPL-3.0-only

//
//
// ~xxdorothy/dorothy.git
// ::: :/packages/memory/src/persona/tool.ts
//
//

import { PERSONA } from "@dorothy/core";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

export type PersonaLayers = Readonly<Record<string, string>>;

const namesOf = (names: readonly string[]): string => {
    if (names.length < 2) {
        return names[0] ?? "";
    }
    return `${names.slice(0, -1).join(", ")} and ${names.at(-1)}`;
};

export function personaDescription(names: readonly string[]): string {
    return [
        `Open one of Dorothy's persona layers: ${namesOf(names)}.`,
        "These layers are who she is, not what she remembers.",
        "They are for Dorothy alone, not for an agent she dispatches.",
    ].join(" ");
}

export function openLayer(layers: PersonaLayers, layer: string): string {
    if (!Object.hasOwn(layers, layer)) {
        throw new Error(
            `Unknown persona layer. Choose ${namesOf(Object.keys(layers))}.`,
        );
    }
    return layers[layer] as string;
}

export function registerPersonaTool(
    server: McpServer,
    layers: PersonaLayers | null | undefined,
): void {
    if (layers == null || Object.keys(layers).length === 0) {
        return;
    }
    server.registerTool(
        PERSONA,
        {
            description: personaDescription(Object.keys(layers)),
            inputSchema: { layer: z.string() },
        },
        ({ layer }) => {
            try {
                return {
                    content: [
                        {
                            type: "text" as const,
                            text: openLayer(layers, layer),
                        },
                    ],
                };
            } catch (error) {
                return {
                    isError: true,
                    content: [
                        {
                            type: "text" as const,
                            text: (error as Error).message,
                        },
                    ],
                };
            }
        },
    );
}
