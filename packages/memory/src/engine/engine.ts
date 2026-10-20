// vim:set expandtab shiftwidth=4 filetype=typescript:
// SPDX-License-Identifier: GPL-3.0-only

//
//
// ~chewygumxx/dorothy.git
// ::: :/packages/memory/src/engine/engine.ts
//
//

// What indexes, searches, ranks, extracts and consolidates behind the
// contract. An engine proposes; the service validates and writes, so the
// files stay the truth and an engine can be replaced by rebuilding its
// index from them and the archive.

import type { MemoryHit, MemoryKind } from "@dorothy/core";
import type { Fact, FactType } from "../facts/file.js";
import type { Scope } from "../facts/store.js";
import type { Note } from "../memory/block.js";

// A piece of knowledge's id path: personal/<name>, or the project's.
export const knowledgePath = (scope: Scope, name: string) =>
    scope.kind === "personal"
        ? `personal/${name}`
        : `projects/${scope.id}/${name}`;

export type KnowledgeItem = { id: string; scope: Scope; fact: Fact };
export type EpisodeItem = {
    id: string;
    phrase: string;
    note: Note;
    project: string | null;
};
export type RankRequest = { project: string | null; exclude?: string | null };
// "all", or the scope labels allowed: "personal" and project ids.
export type Within = "all" | readonly string[];
export type EngineSearch = {
    query: string;
    within: Within;
    kind: MemoryKind;
    after?: string | undefined;
    before?: string | undefined;
    limit: number;
    project: string | null;
    exclude?: string | null;
};
export type Proposal =
    | {
          action: "write";
          scope: Scope;
          name: string;
          title: string;
          description: string;
          type: FactType;
          body: string;
          from?: string;
      }
    | { action: "retire"; scope: Scope; name: string; why: string };
export interface MemoryEngine {
    index(): Promise<string[]>;
    search(request: EngineSearch): Promise<MemoryHit[]>;
    rankKnowledge(request: RankRequest): Promise<KnowledgeItem[]>;
    rankEpisodes(request: RankRequest): Promise<EpisodeItem[]>;
    extract(phrase: string, signal: AbortSignal): Promise<Proposal[]>;
    consolidate(scope: Scope): Promise<Proposal[]>;
}
