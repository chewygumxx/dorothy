// vim:set expandtab shiftwidth=4 filetype=typescript:
// SPDX-License-Identifier: GPL-3.0-only

//
//
// ~chewygumxx/dorothy.git
// ::: :/packages/eval/src/systems/terms.ts
//
//

// Words as plain grep would weigh them: a question's terms, and how many
// of them a text holds.

const COMMON = new Set([
    "about",
    "after",
    "all",
    "also",
    "and",
    "any",
    "are",
    "before",
    "but",
    "can",
    "could",
    "did",
    "does",
    "for",
    "from",
    "had",
    "has",
    "have",
    "her",
    "hers",
    "him",
    "his",
    "how",
    "into",
    "its",
    "just",
    "may",
    "might",
    "more",
    "most",
    "must",
    "not",
    "our",
    "over",
    "she",
    "should",
    "some",
    "such",
    "than",
    "that",
    "the",
    "their",
    "them",
    "then",
    "there",
    "these",
    "they",
    "this",
    "those",
    "very",
    "was",
    "were",
    "what",
    "when",
    "where",
    "which",
    "who",
    "whom",
    "why",
    "will",
    "with",
    "would",
    "you",
    "your",
    "user",
    "dorothy",
]);

const normalized = (text: string) => text.toLowerCase().normalize("NFKC");
const wordsOf = (text: string) => normalized(text).split(/[^\p{L}\p{N}]+/u);

const graphemes = new Intl.Segmenter(undefined, { granularity: "grapheme" });

// Find a word with the scorer's normalization and boundaries, then map
// its offset back to the original text. A grapheme keeps combining marks
// with their base; its normalized length includes compatibility
// expansions, so neither kind of change shifts the original excerpt.
export function firstTermAt(
    text: string,
    terms: readonly string[],
): number | undefined {
    for (const word of normalized(text).matchAll(/[\p{L}\p{N}]+/gu)) {
        if (!terms.includes(word[0])) {
            continue;
        }
        let end = 0;
        for (const part of graphemes.segment(text)) {
            end += normalized(part.segment).length;
            if (end > word.index) {
                return part.index;
            }
        }
    }
    return undefined;
}

export function termsOf(text: string): string[] {
    const terms = new Set<string>();
    for (const word of wordsOf(text)) {
        if (word.length >= 3 && !COMMON.has(word)) {
            terms.add(word);
        }
    }
    return [...terms];
}

export function scoreOf(text: string, terms: readonly string[]): number {
    const words = new Set(wordsOf(text));
    return terms.filter((term) => words.has(term)).length;
}
