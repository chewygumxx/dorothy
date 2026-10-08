// vim:set expandtab shiftwidth=4 filetype=typescript:
// SPDX-License-Identifier: GPL-3.0-only

//
//
// ~chewygumxx/dorothy.git
// ::: :/packages/tui/src/recall.ts
//
//

// The user's earlier messages, oldest first, walked newest first. The draft
// being written when recall starts is kept to come back to.
export type Recall = {
    messages: string[];
    index: number | null;
    saved: string;
};

export function startRecall(messages: readonly string[]): Recall {
    return {
        messages: messages.filter(
            (message, index) => message !== messages[index - 1],
        ),
        index: null,
        saved: "",
    };
}

export function older(
    recall: Recall,
    draft: string,
): { recall: Recall; text: string } | null {
    const index =
        recall.index === null ? recall.messages.length - 1 : recall.index - 1;
    const text = recall.messages[index];
    if (text === undefined) {
        return null;
    }
    return {
        recall: {
            ...recall,
            index,
            saved: recall.index === null ? draft : recall.saved,
        },
        text,
    };
}

export function newer(recall: Recall): { recall: Recall; text: string } | null {
    if (recall.index === null) {
        return null;
    }
    const index = recall.index + 1;
    if (index >= recall.messages.length) {
        return { recall: { ...recall, index: null }, text: recall.saved };
    }
    return { recall: { ...recall, index }, text: recall.messages[index] ?? "" };
}
