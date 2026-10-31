// vim:set expandtab shiftwidth=4 filetype=typescript:
// SPDX-License-Identifier: GPL-3.0-only

//
//
// ~chewygumxx/dorothy.git
// ::: :/packages/memory/src/contract/terms.ts
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
// its offset back to the original text. Search normalized prefixes at
// grapheme boundaries to keep combining marks with their base. Normalize
// each whole prefix: compatibility characters can compose across the
// original graphemes, so their lengths cannot be added independently.
export function firstTermAt(
    text: string,
    terms: readonly string[],
): number | undefined {
    for (const word of normalized(text).matchAll(/[\p{L}\p{N}]+/gu)) {
        if (!terms.includes(word[0])) {
            continue;
        }
        const ends = Array.from(
            graphemes.segment(text),
            (part) => part.index + part.segment.length,
        );
        let low = 0;
        let high = ends.length - 1;
        while (low < high) {
            const middle = Math.floor((low + high) / 2);
            if (normalized(text.slice(0, ends[middle])).length > word.index) {
                high = middle;
            } else {
                low = middle + 1;
            }
        }
        return low === 0 ? 0 : ends[low - 1];
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
