// vim:set expandtab shiftwidth=4 filetype=typescript:
// SPDX-License-Identifier: GPL-3.0-only

//
//
// ~chewygumxx/dorothy.git
// ::: :/packages/gateway/src/anthropic.test.ts
//
//

import { describe, expect, it } from "bun:test";
import { identityPrompt } from "@dorothy/identity";
import { injectIdentity, MARKER, rewriteRequest } from "./anthropic.js";

const BILLING = { type: "text", text: "x-anthropic-billing-header: cc=1;" };
const HOST = { type: "text", text: "You are Claude Code." };
const ME = "You are Dorothy.";
const mine = { type: "text", text: ME };
const ttl = { type: "ephemeral", ttl: "1h" };

describe("injectIdentity", () => {
    it("puts the identity after the host's line, the marker gone", () => {
        const body = {
            model: "m",
            system: [
                BILLING,
                { ...HOST, cache_control: ttl },
                {
                    type: "text",
                    text: `Rules.\n\n${MARKER}`,
                    cache_control: ttl,
                },
            ],
            messages: [{ role: "user", content: "hi" }],
        };
        expect(injectIdentity(body, ME)).toEqual({
            model: "m",
            system: [
                BILLING,
                { ...HOST, cache_control: ttl },
                mine,
                { type: "text", text: "Rules.", cache_control: ttl },
            ],
            messages: [{ role: "user", content: "hi" }],
        });
    });

    // Claude Code's last block, as the probe found it, opens with a
    // newline: only the marker and the space around it go.
    it("leaves the rest of the host's text as it was", () => {
        const body = {
            system: [
                BILLING,
                HOST,
                { type: "text", text: `\nRules.\n\n${MARKER}` },
            ],
        };
        expect(injectIdentity(body, ME)?.system).toEqual([
            BILLING,
            HOST,
            mine,
            { type: "text", text: "\nRules." },
        ]);
    });

    it("keeps the user's own appended text beside the marker", () => {
        const body = {
            system: [
                BILLING,
                HOST,
                { type: "text", text: `Rules.\n\n${MARKER}\n\nUser text.` },
            ],
        };
        expect(injectIdentity(body, ME)?.system).toEqual([
            BILLING,
            HOST,
            mine,
            { type: "text", text: "Rules.\n\nUser text." },
        ]);
    });

    it("drops a block that held only the marker, keeping its breakpoint", () => {
        const body = {
            system: [
                BILLING,
                HOST,
                { type: "text", text: "Rules." },
                { type: "text", text: MARKER, cache_control: ttl },
            ],
        };
        expect(injectIdentity(body, ME)?.system).toEqual([
            BILLING,
            HOST,
            mine,
            { type: "text", text: "Rules.", cache_control: ttl },
        ]);
    });

    it("gives the identity an emptied first block's breakpoint", () => {
        const body = {
            system: [{ type: "text", text: MARKER, cache_control: ttl }, HOST],
        };
        expect(injectIdentity(body, ME)?.system).toEqual([
            HOST,
            { ...mine, cache_control: ttl },
        ]);
    });

    it("turns a string system into blocks", () => {
        expect(injectIdentity({ system: `Rules. ${MARKER}` }, ME)).toEqual({
            system: [{ type: "text", text: "Rules." }, mine],
        });
        expect(injectIdentity({ system: MARKER }, ME)).toEqual({
            system: [mine],
        });
    });

    it("leaves a request without the marker in system alone", () => {
        expect(injectIdentity({ system: [BILLING, HOST] }, ME)).toBeNull();
        expect(injectIdentity({ system: "Rules." }, ME)).toBeNull();
        expect(
            injectIdentity(
                {
                    system: [HOST],
                    messages: [{ role: "user", content: MARKER }],
                },
                ME,
            ),
        ).toBeNull();
        expect(injectIdentity("nonsense", ME)).toBeNull();
    });

    it("gives Dorothy's identity by default", () => {
        expect(injectIdentity({ system: MARKER })).toEqual({
            system: [{ type: "text", text: identityPrompt() }],
        });
    });
});

describe("the section", () => {
    it("follows her identity in the marker's place, a blank line between", () => {
        const body = { system: [{ type: "text", text: `Host.\n\n${MARKER}` }] };
        expect(injectIdentity(body, "ID", "<memory>m</memory>")).toEqual({
            system: [
                { type: "text", text: "Host." },
                { type: "text", text: "ID\n\n<memory>m</memory>" },
            ],
        });
    });

    it("leaves her identity alone when empty, and an unmarked request whole", () => {
        const body = { system: [{ type: "text", text: MARKER }] };
        expect(injectIdentity(body, "ID", "")).toEqual({
            system: [{ type: "text", text: "ID" }],
        });
        expect(injectIdentity({ system: "plain" }, "ID", "S")).toBeNull();
        const bytes = new TextEncoder().encode(
            JSON.stringify({ system: "plain" }),
        );
        expect(rewriteRequest(bytes, null, "S")).toEqual({ kind: "unmarked" });
    });
});

describe("rewriteRequest", () => {
    const encode = (value: unknown) =>
        new TextEncoder().encode(JSON.stringify(value));
    const decode = (bytes: Uint8Array) =>
        JSON.parse(new TextDecoder().decode(bytes));

    it("passes a request without the marker as it is", () => {
        expect(rewriteRequest(encode({ system: "Rules." }), null)).toEqual({
            kind: "unmarked",
        });
        expect(rewriteRequest(new Uint8Array([0xff, 0x00]), null)).toEqual({
            kind: "unmarked",
        });
    });

    it("rewrites a marked request, plain or gzipped", () => {
        const body = encode({ system: MARKER });
        for (const [bytes, encoding] of [
            [body, null],
            [body, "identity"],
            [Bun.gzipSync(body), "gzip"],
        ] as const) {
            const result = rewriteRequest(bytes, encoding);
            expect(result.kind).toBe("injected");
            if (result.kind === "injected") {
                expect(decode(result.bytes)).toEqual({
                    system: [{ type: "text", text: identityPrompt() }],
                });
            }
        }
    });

    it("counts as drift what it cannot read or place", () => {
        const truncated = new TextEncoder().encode(`{"system":"${MARKER}`);
        expect(rewriteRequest(truncated, null)).toEqual({ kind: "drift" });
        expect(rewriteRequest(new Uint8Array([1, 2, 3]), "gzip")).toEqual({
            kind: "drift",
        });
        expect(rewriteRequest(encode({ system: MARKER }), "br")).toEqual({
            kind: "drift",
        });
        const unplaceable = encode({
            system: [{ type: "image", note: MARKER }],
        });
        expect(rewriteRequest(unplaceable, null)).toEqual({ kind: "drift" });
    });

    it("passes a conversation that only quotes the marker", () => {
        const quoted = encode({
            system: "Rules.",
            messages: [
                {
                    role: "user",
                    content: [
                        {
                            type: "tool_result",
                            content: `const M = "${MARKER}";`,
                        },
                    ],
                },
            ],
        });
        expect(rewriteRequest(quoted, null)).toEqual({ kind: "unmarked" });
    });
});
