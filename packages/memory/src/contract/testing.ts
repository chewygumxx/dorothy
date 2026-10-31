// vim:set expandtab shiftwidth=4 filetype=typescript:
// SPDX-License-Identifier: GPL-3.0-only

//
//
// ~chewygumxx/dorothy.git
// ::: :/packages/memory/src/contract/testing.ts
//
//

// A fake engine for the contract's tests: fixed items, and the calls it
// was given, in order, and the searches asked of it.

import { conversationId, knowledgeId, type MemoryHit } from "@dorothy/core";
import type {
    EngineSearch,
    EpisodeItem,
    KnowledgeItem,
    MemoryEngine,
} from "../engine/engine.js";
import type { Fact } from "../facts/file.js";
import { PERSONAL, type Scope } from "../facts/store.js";
import type { Note } from "../memory/block.js";
import type { EvidenceSource } from "./deliver.js";
import type { EvidenceConversation, EvidenceKnowledge } from "./passage.js";

const AT = "2026-10-15T09:30:00.000Z";

export function knowledge(
    name: string,
    fields: Partial<Fact> = {},
    scope: Scope = PERSONAL,
): KnowledgeItem {
    const path =
        scope.kind === "personal"
            ? `personal/${name}`
            : `projects/${scope.id}/${name}`;
    return {
        id: knowledgeId(path),
        scope,
        fact: {
            name,
            title: name,
            description: `About ${name}.`,
            type: "user",
            extra: {},
            tags: [],
            importance: null,
            provenance: { origin: "user", by: "user", at: AT, created: AT },
            retired: null,
            body: `Body of ${name}.`,
            ...fields,
        },
    };
}

export function episode(
    phrase: string,
    note: Partial<Note> = {},
    project: string | null = null,
): EpisodeItem {
    return {
        id: conversationId(phrase),
        phrase,
        project,
        note: {
            title: phrase,
            description: `About ${phrase}.`,
            abstract: `What happened in ${phrase}.`,
            pinned: false,
            ...note,
        },
    };
}

export type FakeParts = {
    knowledge: KnowledgeItem[];
    episodes: EpisodeItem[];
    hits: MemoryHit[];
};

export function fakeEngine(parts: Partial<FakeParts> = {}): MemoryEngine & {
    calls: string[];
    searches: EngineSearch[];
    parts: FakeParts;
} {
    const all: FakeParts = {
        knowledge: parts.knowledge ?? [],
        episodes: parts.episodes ?? [],
        hits: parts.hits ?? [],
    };
    const calls: string[] = [];
    const searches: EngineSearch[] = [];
    return {
        calls,
        searches,
        parts: all,
        async index() {
            calls.push("index");
            return [];
        },
        async search(request) {
            calls.push(`search ${request.query}`);
            searches.push(request);
            return all.hits.slice(0, request.limit);
        },
        async rankKnowledge(request) {
            calls.push(`rankKnowledge ${request.project ?? "-"}`);
            return all.knowledge.filter(
                (item) =>
                    item.scope.kind === "personal" ||
                    item.scope.id === request.project,
            );
        },
        async rankEpisodes(request) {
            calls.push(`rankEpisodes ${request.project ?? "-"}`);
            return all.episodes;
        },
        async extract(phrase) {
            calls.push(`extract ${phrase}`);
            return [];
        },
        async consolidate() {
            return [];
        },
    };
}

// An evidence source over the records given, by id.
export function fakeEvidence(
    parts: {
        conversations?: EvidenceConversation[];
        knowledge?: EvidenceKnowledge[];
    } = {},
): EvidenceSource {
    return {
        conversation: async (id) =>
            parts.conversations?.find((each) => each.id === id),
        knowledge: async (id) =>
            parts.knowledge?.find((each) => each.id === id),
    };
}
