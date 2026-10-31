// vim:set expandtab shiftwidth=4 filetype=typescript:
// SPDX-License-Identifier: GPL-3.0-only

//
//
// ~chewygumxx/dorothy.git
// ::: :/packages/memory/src/evaluation.ts
//
//

// What the memory evaluation (@dorothy/eval) reads of an archive: the
// baseline engine over an environment, and the conversations, knowledge
// and appraised reads it holds; and a writer of small archives for its
// tests.

export {
    type DeliveredItem,
    type Delivery,
    type DeliveryPolicy,
    deliver,
    type EvidenceSource,
    ITEM_SHARE,
    PASSAGE_SEEDS,
    type PassageSeeds,
    packDelivery,
} from "./contract/deliver.js";
export {
    clip,
    conversationText,
    type EvidenceConversation,
    type EvidenceKnowledge,
    type EvidenceTurn,
    knowledgeText,
    type Passage,
    pack,
    passage,
    type TurnRange,
    turnsIn,
} from "./contract/passage.js";
export { firstTermAt, scoreOf, termsOf } from "./contract/terms.js";
export {
    type AppraisedRead,
    type AppraisedReads,
    type Archive,
    type ArchiveConversation,
    type ArchiveKnowledge,
    type ArchiveTurn,
    openArchive,
} from "./engine/archive.js";
export type { MemoryEngine } from "./engine/engine.js";
export {
    type ArchiveFixture,
    type FixtureConversation,
    type FixtureKnowledge,
    type FixtureRead,
    fixturePhrase,
    writeArchive,
} from "./engine/fixture.js";
export { HIT_ORDERS, type HitOrder, mergeHits } from "./engine/merge.js";
