// vim:set expandtab shiftwidth=4 filetype=typescript:
// SPDX-License-Identifier: GPL-3.0-only

//
//
// ~chewygumxx/dorothy.git
// ::: :/packages/memory/src/engine/baseline.ts
//
//

// The baseline engine: today's memory behind the interface. The FTS5
// index searches, salience ranks conversations, and the reviewer writes
// each conversation's notes; it proposes no knowledge yet, which the
// engine spec brings.

import {
    conversationId,
    type Env,
    knowledgeId,
    type MemoryHit,
} from "@dorothy/core";
import type { FactType } from "../facts/file.js";
import { dataRoot, listFacts } from "../facts/store.js";
import { indexCatalogue } from "../memory/catalogue.js";
import { rank } from "../memory/rank.js";
import type { Reviewer } from "../memory/reviewer.js";
import { vocabularyPath } from "../memory/vocabulary.js";
import { search } from "../recall/query.js";
import type { RecallIndex } from "../recall/store.js";
import { syncIndex } from "../recall/sync.js";
import { transcriptDir } from "../transcript.js";
import {
    type EngineSearch,
    type EpisodeItem,
    type KnowledgeItem,
    knowledgePath,
    type MemoryEngine,
    type RankRequest,
} from "./engine.js";

export type BaselineDeps = {
    env: Env;
    index: RecallIndex;
    halfLifeDays: number;
    // Reviews; null where no model is wired, and extraction does nothing.
    reviewer: Pick<Reviewer, "review"> | null;
    now?: () => number;
    // Where what the catalogue could not read is said, once each.
    warn?: (message: string) => void;
};

const TYPES: FactType[] = ["user", "feedback", "project", "reference"];

// The project a conversation belongs to; null for a personal one, or none
// indexed by that phrase.
export function conversationProject(
    index: RecallIndex,
    phrase: string,
): string | null {
    const row = index.db
        .query("SELECT project FROM conversations WHERE phrase = ?")
        .get(phrase) as { project: string | null } | null;
    return row?.project ?? null;
}

export function baselineEngine(deps: BaselineDeps): MemoryEngine {
    const now = deps.now ?? Date.now;
    const root = dataRoot(deps.env);
    const dir = transcriptDir(deps.env);
    const vocabulary = vocabularyPath(deps.env);
    const projectOf = (phrase: string) =>
        conversationProject(deps.index, phrase);
    const said = new Set<string>();
    const fresh = () => syncIndex(deps.index, dir, now(), vocabulary, root);
    return {
        index: fresh,
        async search(request: EngineSearch): Promise<MemoryHit[]> {
            await fresh();
            const kind =
                request.kind === "knowledge"
                    ? "facts"
                    : request.kind === "episodes"
                      ? "conversations"
                      : undefined;
            // Each conversation's project is read where its hit was found.
            const found = await deps.index.exclusive(async () => {
                const result = await search(
                    deps.index,
                    {
                        query: request.query,
                        kind,
                        after: request.after,
                        before: request.before,
                        limit: request.limit,
                    },
                    {
                        exclude: request.exclude ?? null,
                        now: now(),
                        halfLifeDays: deps.halfLifeDays,
                        project: request.project,
                        within:
                            request.within === "all"
                                ? undefined
                                : request.within,
                    },
                );
                return {
                    ...result,
                    projects: new Map(
                        result.results.map((hit) => [
                            hit.identifier,
                            projectOf(hit.identifier),
                        ]),
                    ),
                };
            });
            const hits: MemoryHit[] = [];
            for (const hit of found.facts) {
                if (hit.retired) {
                    continue;
                }
                hits.push({
                    id: knowledgeId(
                        hit.scope === "personal"
                            ? hit.id
                            : `projects/${hit.id}`,
                    ),
                    kind: "knowledge",
                    scope: hit.scope,
                    title: hit.title,
                    snippet: hit.snippet,
                    ...(hit.unconfirmed === undefined
                        ? {}
                        : { unconfirmed: hit.unconfirmed }),
                });
            }
            for (const hit of found.results) {
                const scope = found.projects.get(hit.identifier) ?? "personal";
                hits.push({
                    id: conversationId(hit.identifier),
                    kind: "episode",
                    scope,
                    title: hit.name ?? hit.identifier,
                    snippet: hit.matches[0]?.text ?? hit.description ?? "",
                    date: hit.dateModified,
                });
            }
            return hits.slice(0, request.limit);
        },
        async rankKnowledge(request: RankRequest): Promise<KnowledgeItem[]> {
            const { facts } = await listFacts(root);
            const live = facts.filter(
                ({ fact, scope }) =>
                    fact.retired === null &&
                    (scope.kind === "personal" || scope.id === request.project),
            );
            const order = ({ scope, fact }: (typeof live)[number]) => [
                scope.kind === "personal" ? 0 : 1,
                TYPES.indexOf(fact.type),
                -(fact.importance ?? 5),
                -Date.parse(fact.provenance.at),
            ];
            live.sort((a, b) => {
                const [x, y] = [order(a), order(b)];
                for (let at = 0; at < x.length; at++) {
                    const difference = (x[at] as number) - (y[at] as number);
                    if (difference !== 0) {
                        return difference;
                    }
                }
                return a.fact.name < b.fact.name ? -1 : 1;
            });
            return live.map(({ scope, fact }) => ({
                id: knowledgeId(knowledgePath(scope, fact.name)),
                scope,
                fact,
            }));
        },
        async rankEpisodes(request: RankRequest): Promise<EpisodeItem[]> {
            const loaded = await indexCatalogue(
                deps.index,
                dir,
                vocabulary,
                root,
            ).load();
            for (const message of loaded.warnings) {
                if (!said.has(message)) {
                    said.add(message);
                    deps.warn?.(message);
                }
            }
            const items = rank(loaded.entries, {
                now: now(),
                halfLifeDays: deps.halfLifeDays,
                exclude: request.exclude ?? null,
            }).map((candidate) => ({
                id: conversationId(candidate.phrase),
                phrase: candidate.phrase,
                note: candidate.note,
                project: projectOf(candidate.phrase),
            }));
            // Personal conversations and the session's own project's: the
            // ones `open` admits, as it refuses another project's.
            const own = items.filter(
                (item) =>
                    item.project !== null && item.project === request.project,
            );
            return [...own, ...items.filter((item) => item.project === null)];
        },
        async extract(phrase, signal) {
            await deps.reviewer?.review(phrase, signal);
            return [];
        },
        async consolidate() {
            return [];
        },
    };
}
