// vim:set expandtab shiftwidth=4 filetype=typescript:
// SPDX-License-Identifier: GPL-3.0-only

//
//
// ~chewygumxx/dorothy.git
// ::: :/scripts/markdown-links.test.ts
//
//

import { expect, it } from "bun:test";
import {
    headingSlugs,
    linkOccurrences,
    links,
    linkTargets,
} from "./markdown-links.js";

it("splits a path from its fragment", () => {
    expect(links("[a](./x.md#Some-Part) [b](#here)")).toEqual([
        { path: "./x.md", fragment: "Some-Part" },
        { path: "", fragment: "here" },
    ]);
});

it("skips code and schemes", () => {
    const md = "`[c](./no.md)`\n```\n[d](./no.md)\n```\n[e](https://x)\n";
    expect(links(md)).toEqual([]);
});

it("skips tilde fences and keeps fragments in reference definitions", () => {
    expect(links("~~~ts\n[x](./no.md)\n~~~\n[r]: ./yes.md#Part\n")).toEqual([
        { path: "./yes.md", fragment: "Part" },
    ]);
});

it("keeps linkTargets as it was", () => {
    expect(linkTargets("[a](<./a b.md>) [b](#x)\n[r]: ./r.md\n")).toEqual([
        "./a b.md",
        "./r.md",
    ]);
});

it("counts inline and full reference occurrences in source order", () => {
    const md =
        "[inline](./inline.md) [first][record] [second][record]\n" +
        "[record]: ./record.md#part\n";
    expect(linkOccurrences(md)).toEqual([
        { path: "./inline.md", fragment: undefined },
        { path: "./record.md", fragment: "part" },
        { path: "./record.md", fragment: "part" },
    ]);
    expect(links(md)).toEqual([
        { path: "./inline.md", fragment: undefined },
        { path: "./record.md", fragment: "part" },
    ]);
    expect(linkTargets(md)).toEqual(["./inline.md", "./record.md"]);
});

it("normalizes full, collapsed and shortcut reference labels", () => {
    const md =
        "[first][ SOME\n record ] [some\trecord][] [Some Record]\n" +
        "[some   RECORD]: <./a b.md#Part>\n";
    expect(linkOccurrences(md)).toEqual([
        { path: "./a b.md", fragment: "Part" },
        { path: "./a b.md", fragment: "Part" },
        { path: "./a b.md", fragment: "Part" },
    ]);
});

it("excludes definitions, unresolved references and external occurrences", () => {
    const md =
        "[absent] [unused][absent] [web][site] [web](https://example.com)\n" +
        '[unused]: ./unused.md "[unused] title"\n' +
        "[site]: https://example.com\n";
    expect(linkOccurrences(md)).toEqual([]);
});

it("consumes inline text without also counting it as a reference", () => {
    expect(
        linkOccurrences("[record](./inline.md)\n[record]: ./reference.md\n"),
    ).toEqual([{ path: "./inline.md", fragment: undefined }]);
});

it("counts inline entries whose label wraps onto the next line", () => {
    expect(linkOccurrences("[A wrapped\n label](./record.md#part)\n")).toEqual([
        { path: "./record.md", fragment: "part" },
    ]);
});

it("counts a wrapped inline title without also counting its label", () => {
    const md =
        '[record](./inline.md\n "Record title")\n' +
        "[record]: ./reference.md\n";
    expect(linkOccurrences(md)).toEqual([
        { path: "./inline.md", fragment: undefined },
    ]);
});

it("ignores code uses and definitions in both kinds of fences", () => {
    const md =
        "`[record]` `[entry][record]` `[inline](./inline.md)`\n" +
        "```md\n[record][]\n[hidden]: ./hidden.md\n```\n" +
        "~~~md\n[entry][record]\n~~~\n[hidden]\n" +
        "[record]: ./record.md\n";
    expect(linkOccurrences(md)).toEqual([]);
});

it("resolves repeated reference definitions to the first destination", () => {
    expect(
        linkOccurrences(
            "[record]\n[record]: ./first.md\n[RECORD]: ./last.md\n",
        ),
    ).toEqual([{ path: "./first.md", fragment: undefined }]);
});

it("slugs headings as GitHub does", () => {
    const md = "# The `deliver` step\n## Why? Because.\n## Why? Because.\n";
    expect([...headingSlugs(md)]).toEqual([
        "the-deliver-step",
        "why-because",
        "why-because-1",
    ]);
});

it("ignores a heading inside a fence", () => {
    expect([...headingSlugs("```\n# not\n```\n# yes\n")]).toEqual(["yes"]);
});

it("slugs Unicode heading links and closing hashes outside tilde fences", () => {
    expect([
        ...headingSlugs("~~~\n# no\n~~~\n# Café [世界](./x.md) ###\n"),
    ]).toEqual(["café-世界"]);
});

it("keeps underscores GitHub keeps", () => {
    const md =
        "# The `snake_case` key\n## An _emphatic_ word\n" +
        "## `__init__` runs\n## Three\n## Three\n## Three\n";
    expect([...headingSlugs(md)]).toEqual([
        "the-snake_case-key",
        "an-emphatic-word",
        "__init__-runs",
        "three",
        "three-1",
        "three-2",
    ]);
});
