// vim:set expandtab shiftwidth=4 filetype=typescript:
// SPDX-License-Identifier: GPL-3.0-only

//
//
// ~chewygumxx/dorothy.git
// ::: :/src/capture.test.ts
//
//

import { describe, expect, it } from "bun:test";
import { type CaptureQueryFn, captureServer, dumpRequest } from "./capture.js";

// Stands in for the CLI: sends the system prompt to whatever API the
// options name, as the CLI would send the whole request.
const posting = (
    body: (options: Parameters<CaptureQueryFn>[0]["options"]) => unknown = (
        o,
    ) => ({
        system: o.systemPrompt,
    }),
): CaptureQueryFn & { options?: Parameters<CaptureQueryFn>[0]["options"] } => {
    const fn = (({ options }) => {
        fn.options = options;
        return (async function* () {
            await fetch(`${options.env?.ANTHROPIC_BASE_URL}/v1/messages`, {
                method: "POST",
                body: JSON.stringify(body(options)),
            }).catch(() => {});
        })();
    }) as CaptureQueryFn & {
        options?: Parameters<CaptureQueryFn>[0]["options"];
    };
    return fn;
};

describe("captureServer", () => {
    it("records the request bodies it is sent, and answers every call with an error", async () => {
        const server = captureServer();
        try {
            const hello = await fetch(`${server.url}/api/hello`, {
                method: "HEAD",
            });
            const sent = await fetch(`${server.url}/v1/messages`, {
                method: "POST",
                body: JSON.stringify({ messages: [] }),
            });
            expect(hello.status).toBe(400);
            expect(sent.status).toBe(400);
            expect(server.bodies).toEqual([{ messages: [] }]);
        } finally {
            server.stop();
        }
    });
});

describe("dumpRequest", () => {
    it("returns the first request, sent to a stand-in for the API", async () => {
        const fake = posting();
        const body = await dumpRequest({
            prompt: "hi",
            options: { systemPrompt: "SYSTEM", env: { HOME: "/home/u" } },
            queryFn: fake,
        });
        expect(body).toEqual({ system: "SYSTEM" });
        expect(fake.options?.env?.ANTHROPIC_BASE_URL).toMatch(
            /^http:\/\/127\.0\.0\.1:\d+$/,
        );
        expect(fake.options?.env?.HOME).toBe("/home/u");
    });

    it("returns null when nothing was sent", async () => {
        const silent: CaptureQueryFn = () => (async function* () {})();
        expect(
            await dumpRequest({ prompt: "hi", options: {}, queryFn: silent }),
        ).toBeNull();
    });

    it("stops the stand-in afterwards", async () => {
        const fake = posting();
        await dumpRequest({ prompt: "hi", options: {}, queryFn: fake });
        const url = fake.options?.env?.ANTHROPIC_BASE_URL;
        await expect(
            fetch(`${url}/v1/messages`, { method: "POST" }),
        ).rejects.toThrow();
    });
});
