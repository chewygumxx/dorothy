// vim:set expandtab shiftwidth=4 filetype=typescript:
// SPDX-License-Identifier: GPL-3.0-only

//
//
// ~chewygumxx/dorothy.git
// ::: :/packages/memory/src/engine/fixture.ts
//
//

// A small archive written as Dorothy writes hers, for the tests of the
// memory evaluation: transcripts with their sidecars, appraised reads,
// and knowledge files. Every path comes from the environment given.

import { mkdirSync, writeFileSync } from "node:fs";
import { type Env, newPhrase } from "@dorothy/core";
import type { FactType } from "../facts/file.js";
import { dataRoot, PERSONAL, putFact } from "../facts/store.js";
import {
    EMPTY_SIDECAR,
    type Served,
    updateSidecar,
} from "../memory/sidecar.js";
import { transcriptDir, transcriptPath } from "../transcript.js";

export type FixtureRead = {
    id: string;
    // A conversation's phrase, or a fact as recall names it:
    // personal/<name> or <project id>/<name>.
    target: { conversation: string } | { fact: string };
    purpose: string;
    served: Served;
};
export type FixtureConversation = {
    phrase: string;
    project?: string | null;
    title?: string | null;
    hidden?: boolean;
    turns: { role: "user" | "assistant"; text: string; at: string }[];
    // Opens made before the first reply, and how her review judged each.
    reads?: FixtureRead[];
};
export type FixtureKnowledge = {
    // "personal", or a project's id.
    scope: string;
    name: string;
    title: string;
    description?: string;
    type?: FactType;
    body: string;
    at: string;
    retired?: { at: string; why: string };
};
export type ArchiveFixture = {
    conversations: FixtureConversation[];
    knowledge: FixtureKnowledge[];
};

// A valid phrase, the same for the same seed.
export const fixturePhrase = (seed: number) =>
    newPhrase((size) => Uint8Array.from({ length: size }, () => seed));

const line = (at: string, kind: string, fields: object) =>
    `${JSON.stringify({ v: 1, kind, at, ...fields })}\n`;

function transcriptOf(conversation: FixtureConversation): string {
    const first = conversation.turns[0]?.at ?? "2026-01-01T00:00:00.000Z";
    const project = conversation.project ?? null;
    let text = line(first, "session", {
        phrase: conversation.phrase,
        sdkSessionId: "",
        model: "fixture",
        promptHash: "",
        resumed: false,
        ...(project === null ? {} : { project }),
    });
    let read = false;
    for (const turn of conversation.turns) {
        if (turn.role === "assistant" && !read) {
            read = true;
            for (const each of conversation.reads ?? []) {
                text += line(turn.at, "recall", {
                    id: each.id,
                    ok: true,
                    offset: 0,
                    tool: "open",
                    ...each.target,
                    name: "fixture",
                    purpose: each.purpose,
                    turns: null,
                });
            }
        }
        text +=
            turn.role === "user"
                ? line(turn.at, "user", { text: turn.text })
                : line(turn.at, "assistant", {
                      text: turn.text,
                      interrupted: false,
                  });
    }
    return text;
}

export async function writeArchive(
    env: Env,
    fixture: ArchiveFixture,
): Promise<void> {
    const dir = transcriptDir(env);
    mkdirSync(dir, { recursive: true });
    for (const conversation of fixture.conversations) {
        writeFileSync(
            transcriptPath(conversation.phrase, env),
            transcriptOf(conversation),
        );
        const at = conversation.turns.at(-1)?.at ?? "2026-01-01T00:00:00.000Z";
        await updateSidecar(dir, conversation.phrase, () => ({
            ...EMPTY_SIDECAR,
            title: conversation.title ?? null,
            hidden: conversation.hidden ?? false,
            appraisals: Object.fromEntries(
                (conversation.reads ?? []).map((each) => [
                    each.id,
                    { served: each.served, at, model: "fixture" },
                ]),
            ),
        }));
    }
    for (const knowledge of fixture.knowledge) {
        await putFact(
            dataRoot(env),
            knowledge.scope === "personal"
                ? PERSONAL
                : { kind: "project", id: knowledge.scope },
            {
                name: knowledge.name,
                title: knowledge.title,
                description:
                    knowledge.description ?? `About ${knowledge.title}.`,
                type: knowledge.type ?? "user",
                extra: {},
                tags: [],
                importance: null,
                provenance: {
                    origin: "user",
                    by: "user",
                    at: knowledge.at,
                    created: knowledge.at,
                },
                retired:
                    knowledge.retired === undefined
                        ? null
                        : { ...knowledge.retired, by: "user" },
                body: knowledge.body,
            },
        );
    }
}
