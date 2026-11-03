// vim:set expandtab shiftwidth=4 filetype=typescript:
// SPDX-License-Identifier: GPL-3.0-only

//
//
// ~chewygumxx/dorothy.git
// ::: :/scripts/markdown-links.test.ts
//
//

import { expect, it } from "bun:test";
import { headingSlugs, links, linkTargets } from "./markdown-links.js";

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
