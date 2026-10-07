// vim:set expandtab shiftwidth=4 filetype=typescript:
// SPDX-License-Identifier: GPL-3.0-only

//
//
// ~chewygumxx/dorothy.git
// ::: :/src/compaction/clusters.ts
//
//

import { escapeXml, renderClusters, unescapeXml } from "../memory/block.js";
import {
    type Cluster,
    LIMITS,
    normalise,
    overLimit,
} from "../memory/sidecar.js";
import type { Turn } from "../persona.js";
import type { Range } from "./plan.js";

// She is told she can reopen the turns, and asked to note what she might
// look up, only when her sessions will offer recollect.
export function clusterInstructions(recollect: boolean): string {
    return [
        "This time you are not chatting. The message holds the oldest turns of",
        "your current conversation with the user that are still word for word in",
        "your context; they are about to leave it. Divide them into consecutive",
        "clusters, starting a new cluster where the topic changes; one cluster is",
        "fine when they hold one topic. For each cluster give the number of its",
        "last turn, and write an abstract of at most 1,000 characters, in your",
        "own words and from your point of view, of what was said, decided and",
        recollect
            ? "left open, noting what you might want to look up later."
            : "left open.",
        "Your abstracts stay in your context for the rest of the",
        recollect
            ? "conversation, and you can open any cluster's turns word for word."
            : "conversation.",
        "If you said you were in development mode, say so in the abstract. The",
        "message escapes &, < and > as &amp;, &lt; and &gt;; write the abstracts",
        "as plain text, not escaped.",
    ].join(" ");
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
    typeof value === "object" && value !== null && !Array.isArray(value);

// The earlier abstracts for context, then the outgoing turns by number.
export function clusterPrompt(
    turns: readonly Turn[],
    range: Range,
    clusters: readonly Cluster[],
): string {
    const earlier =
        clusters.length === 0
            ? []
            : [
                  "Your summaries of the turns before these, for context; do not repeat them:",
                  ...renderClusters(clusters),
                  "",
              ];
    const outgoing = turns
        .slice(range.from - 1, range.through)
        .map(
            (turn, at) =>
                `<turn n="${range.from + at}">${turn.role === "user" ? "User" : "Dorothy"}: ${escapeXml(turn.text)}</turn>`,
        );
    return [
        ...earlier,
        "The turns leaving your context, numbered:",
        "<turns>",
        ...outgoing,
        "</turns>",
    ].join("\n");
}

export function clusterSchema(range: Range): Record<string, unknown> {
    return {
        type: "object",
        properties: {
            clusters: {
                type: "array",
                minItems: 1,
                items: {
                    type: "object",
                    properties: {
                        through: {
                            type: "integer",
                            minimum: range.from,
                            maximum: range.through,
                        },
                        abstract: {
                            type: "string",
                            minLength: 1,
                            maxLength: LIMITS.abstract,
                        },
                    },
                    required: ["through", "abstract"],
                    additionalProperties: false,
                },
            },
        },
        required: ["clusters"],
        additionalProperties: false,
    };
}

// The schema asked for this; the model's output is checked again. Each
// cluster starts on the turn after the one before, so only the ends need
// checking: in order, within the range, the last at its end.
export function validateClusters(
    output: unknown,
    range: Range,
    stamp: { at: string; model: string },
): { ok: true; clusters: Cluster[] } | { ok: false; reason: string } {
    const list = isRecord(output) ? output.clusters : undefined;
    if (!Array.isArray(list) || list.length === 0) {
        return { ok: false, reason: "no clusters in the result" };
    }
    const clusters: Cluster[] = [];
    let from = range.from;
    for (const [at, item] of list.entries()) {
        const n = at + 1;
        const fields = isRecord(item) ? item : {};
        const through = fields.through;
        if (
            typeof through !== "number" ||
            !Number.isInteger(through) ||
            through < from ||
            through > range.through
        ) {
            return {
                ok: false,
                reason: `cluster ${n} ends at ${String(through)}, outside ${from}-${range.through}`,
            };
        }
        const abstract =
            typeof fields.abstract === "string"
                ? normalise(unescapeXml(fields.abstract))
                : "";
        if (abstract === "") {
            return {
                ok: false,
                reason: `the abstract of cluster ${n} is empty`,
            };
        }
        const problem = overLimit("abstract", abstract);
        if (problem !== null) {
            return { ok: false, reason: `cluster ${n}: ${problem}` };
        }
        clusters.push({ from, through, abstract, ...stamp });
        from = through + 1;
    }
    const last = (clusters.at(-1) as Cluster).through;
    if (last !== range.through) {
        return {
            ok: false,
            reason: `the last cluster ends at ${last}, not ${range.through}`,
        };
    }
    return { ok: true, clusters };
}
