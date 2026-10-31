// vim:set expandtab shiftwidth=4 filetype=typescript:
// SPDX-License-Identifier: GPL-3.0-only

//
//
// ~chewygumxx/dorothy.git
// ::: :/packages/eval/src/systems/corpus.ts
//
//

// The snapshot's archive, opened once for every system.

import type { Env } from "@dorothy/core";
import {
    type Archive,
    type ArchiveConversation,
    type ArchiveKnowledge,
    type EvidenceSource,
    openArchive,
} from "@dorothy/memory/evaluation";

export type Corpus = {
    archive: Archive;
    // By contract id.
    conversations: Map<string, ArchiveConversation>;
    knowledge: Map<string, ArchiveKnowledge>;
    close(): void;
};

export async function openCorpus(env: Env): Promise<Corpus> {
    const archive = await openArchive(env);
    try {
        return {
            archive,
            conversations: new Map(
                archive.conversations().map((each) => [each.id, each]),
            ),
            knowledge: new Map(
                (await archive.knowledge()).map((each) => [each.id, each]),
            ),
            close: () => archive.close(),
        };
    } catch (error) {
        archive.close();
        throw error;
    }
}

// What delivery reads of the corpus: its own records, by contract id.
export const corpusEvidence = (corpus: Corpus): EvidenceSource => ({
    conversation: async (id) => corpus.conversations.get(id),
    knowledge: async (id) => corpus.knowledge.get(id),
});
