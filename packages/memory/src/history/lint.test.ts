// vim:set expandtab shiftwidth=4 filetype=typescript:
// SPDX-License-Identifier: GPL-3.0-only

//
//
// ~chewygumxx/dorothy.git
// ::: :/packages/memory/src/history/lint.test.ts
//
//

import { describe, expect, it } from "bun:test";
import { EMPTY_SIDECAR } from "../memory/sidecar.js";
import { fileKind, lint } from "./lint.js";

const bytes = (text: string) => new TextEncoder().encode(text);
const event = (kind: string, text = "hi") =>
    `${JSON.stringify({ v: 1, kind, at: "2026-10-08T00:00:00.000Z", text })}\n`;
const GROWS = "it changed before its end, and a transcript only grows";

describe("fileKind", () => {
    it("knows the vocabulary, sidecars and transcripts by where they sit", () => {
        expect(fileKind("tags.json")).toBe("vocabulary");
        expect(fileKind("transcripts/a-b-c-d.meta.json")).toBe("sidecar");
        expect(fileKind("transcripts/a-b-c-d.jsonl")).toBe("transcript");
        expect(fileKind("broken/tags.json.2026-10-08T00-00-00-000Z")).toBe(
            "other",
        );
        expect(fileKind("transcripts/nested/x.jsonl")).toBe("other");
        expect(fileKind(".gitignore")).toBe("other");
    });
});

describe("lint", () => {
    it("passes a vocabulary that parses and says why one does not", () => {
        expect(
            lint("tags.json", bytes('{"v":1,"rev":0,"concepts":{}}\n'), null),
        ).toBeNull();
        expect(lint("tags.json", bytes("{"), null)).not.toBeNull();
        expect(
            lint("tags.json", bytes('{"v":2,"rev":0,"concepts":{}}'), null),
        ).not.toBeNull();
    });

    it("passes a sidecar that parses", () => {
        const path = "transcripts/a-b-c-d.meta.json";
        expect(
            lint(path, bytes(JSON.stringify(EMPTY_SIDECAR)), null),
        ).toBeNull();
        expect(lint(path, bytes("[]"), null)).toBe("not a JSON object");
        expect(lint(path, bytes('{"v":2}'), null)).toBe("unknown version 2");
    });

    it("refuses a vocabulary or sidecar that is not UTF-8", () => {
        expect(lint("tags.json", new Uint8Array([0xff, 0xfe]), null)).toBe(
            "it is not UTF-8",
        );
    });

    it("passes anything else", () => {
        expect(lint(".gitignore", new Uint8Array([0xff]), null)).toBeNull();
    });
});

describe("lint on transcripts", () => {
    const path = "transcripts/a-b-c-d.jsonl";
    const two = event("user") + event("assistant");

    it("passes whole events, and a torn last line", () => {
        expect(lint(path, bytes(two), null)).toBeNull();
        expect(lint(path, bytes(`${two}{"v":1,"ki`), null)).toBeNull();
        expect(lint(path, bytes(""), null)).toBeNull();
    });

    it("names the first line that is not an event", () => {
        expect(lint(path, bytes(`${event("user")}not json\n`), null)).toBe(
            "line 2 is not JSON",
        );
        expect(lint(path, bytes(`${event("user")}{"v":1}\n`), null)).toBe(
            "line 2 is not an event with v and kind",
        );
        expect(lint(path, bytes(`${event("user")}[1]\n`), null)).toBe(
            "line 2 is not an event with v and kind",
        );
        expect(lint(path, new Uint8Array([0xff, 0x0a]), null)).toBe(
            "line 1 is not JSON",
        );
    });

    it("passes what grows from the committed text", () => {
        expect(lint(path, bytes(two), bytes(event("user")))).toBeNull();
        expect(lint(path, bytes(two), bytes(two))).toBeNull();
    });

    it("refuses a truncation or a rewritten earlier line", () => {
        expect(lint(path, bytes(event("user")), bytes(two))).toBe(GROWS);
        expect(
            lint(
                path,
                bytes(event("user", "edited") + event("assistant")),
                bytes(two),
            ),
        ).toBe(GROWS);
    });

    it("checks only the lines that start after the committed end", () => {
        // A torn line was committed, and a resumed chat appended after it.
        const torn = `${event("user")}{"v":1,"ki`;
        expect(
            lint(path, bytes(`${torn}${event("assistant")}`), bytes(torn)),
        ).toBeNull();
        expect(
            lint(
                path,
                bytes(`${torn}${event("assistant")}oops\n`),
                bytes(torn),
            ),
        ).toBe("line 3 is not JSON");
    });
});
