// vim:set expandtab shiftwidth=4 filetype=typescript:
// SPDX-License-Identifier: GPL-3.0-only

//
//
// ~chewygumxx/dorothy.git
// ::: :/src/tui/recall.test.ts
//
//

import { describe, expect, it } from "bun:test";
import { newer, older, type Recall, startRecall } from "./recall.js";

// Walks older() until it stops, collecting what each step shows.
function walkOlder(recall: Recall, draft: string) {
    const shown: string[] = [];
    let current = recall;
    for (let step = older(current, draft); step; step = older(current, draft)) {
        shown.push(step.text);
        current = step.recall;
    }
    return { shown, recall: current };
}

describe("recall", () => {
    it("walks back from the newest message, collapsing repeats", () => {
        const { shown } = walkOlder(
            startRecall(["one", "two", "two", "three"]),
            "draft",
        );
        expect(shown).toEqual(["three", "two", "one"]);
    });

    it("walks forward again and restores the unsent draft", () => {
        const { recall } = walkOlder(startRecall(["one", "two"]), "wip");
        const first = newer(recall);
        expect(first?.text).toBe("two");
        const back = newer(first?.recall ?? recall);
        expect(back?.text).toBe("wip");
        expect(back?.recall.index).toBeNull();
        expect(newer(back?.recall ?? recall)).toBeNull();
    });

    it("has nothing to recall without messages", () => {
        expect(older(startRecall([]), "x")).toBeNull();
        expect(newer(startRecall(["a"]))).toBeNull();
    });
});
