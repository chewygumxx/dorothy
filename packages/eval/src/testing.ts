// vim:set expandtab shiftwidth=4 filetype=typescript:
// SPDX-License-Identifier: GPL-3.0-only

//
//
// ~chewygumxx/dorothy.git
// ::: :/packages/eval/src/testing.ts
//
//

// What the evaluation's tests share: a terminal to play, temporary roots,
// and one small archive with a snapshot of it. Nothing here reads a real
// data directory.

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Env } from "@dorothy/core";
import {
    type ArchiveFixture,
    fixturePhrase,
    writeArchive,
} from "@dorothy/memory/evaluation";
import type { Io } from "./command.js";
import { ROLES } from "./models/config.js";
import { questionId } from "./questions/file.js";
import { takeSnapshot } from "./snapshot/snapshot.js";

export function fakeIo(
    options: {
        env?: Env;
        answers?: string[];
        onEdit?: (path: string) => void;
    } = {},
): { io: Io; out: string[]; err: string[] } {
    const out: string[] = [];
    const err: string[] = [];
    const answers = [...(options.answers ?? [])];
    return {
        out,
        err,
        io: {
            env: options.env ?? {},
            out: (text) => out.push(text),
            err: (text) => err.push(text),
            ask: async (prompt) => {
                out.push(prompt);
                return answers.shift() ?? null;
            },
            edit: async (path) => options.onEdit?.(path),
        },
    };
}

export function tempRoot(prefix: string): { root: string; remove(): void } {
    const root = mkdtempSync(join(tmpdir(), `dorothy-${prefix}-`));
    return {
        root,
        remove: () => rmSync(root, { recursive: true, force: true }),
    };
}

export const [TEA, GARDEN, BIKE, READER] = [1, 2, 3, 4].map(fixturePhrase) as [
    string,
    string,
    string,
    string,
];

export const FIXTURE: ArchiveFixture = {
    conversations: [
        {
            phrase: TEA,
            project: "github.com/me/app",
            title: "Tea at four",
            turns: [
                {
                    role: "user",
                    text: "I drink green tea at four every afternoon.",
                    at: "2026-09-01T16:00:00.000Z",
                },
                {
                    role: "assistant",
                    text: "Green tea at four, noted.",
                    at: "2026-09-01T16:00:05.000Z",
                },
            ],
        },
        {
            phrase: GARDEN,
            title: "The allotment",
            turns: [
                {
                    role: "user",
                    text: "My allotment is plot twelve by the river.",
                    at: "2026-09-05T10:00:00.000Z",
                },
                {
                    role: "assistant",
                    text: "Plot twelve, by the river.",
                    at: "2026-09-05T10:00:05.000Z",
                },
            ],
        },
        {
            phrase: BIKE,
            title: "Bicycle repair",
            turns: [
                {
                    role: "user",
                    text: "The rear derailleur on my bicycle slips in third gear.",
                    at: "2026-09-10T18:00:00.000Z",
                },
                {
                    role: "assistant",
                    text: "Turn the barrel adjuster a quarter turn.",
                    at: "2026-09-10T18:00:05.000Z",
                },
            ],
        },
        {
            phrase: READER,
            title: "Afternoon plans",
            turns: [
                {
                    role: "user",
                    text: "What do I drink in the afternoon?",
                    at: "2026-10-01T15:00:00.000Z",
                },
                {
                    role: "assistant",
                    text: "Green tea, at four.",
                    at: "2026-10-01T15:00:05.000Z",
                },
            ],
            reads: [
                {
                    id: "r1",
                    target: { conversation: TEA },
                    purpose: "what the user drinks in the afternoon",
                    served: "essential",
                },
                {
                    id: "r2",
                    target: { fact: "personal/prefers-mornings" },
                    purpose: "when the user likes to work",
                    served: "useful",
                },
                {
                    id: "r3",
                    target: { conversation: BIKE },
                    purpose: "nothing much",
                    served: "none",
                },
                // A retired file, which no system's search may give.
                {
                    id: "r4",
                    target: { fact: "personal/uses-vim" },
                    purpose: "which editor the user used",
                    served: "useful",
                },
            ],
        },
    ],
    knowledge: [
        {
            scope: "personal",
            name: "prefers-mornings",
            title: "Prefers working in the mornings",
            body: "The user does their best work before noon.",
            at: "2026-08-01T09:00:00.000Z",
        },
        {
            scope: "personal",
            name: "uses-vim",
            title: "Uses Vim",
            body: "The user edits in Vim.",
            at: "2026-07-01T09:00:00.000Z",
            retired: { at: "2026-09-20T09:00:00.000Z", why: "Moved to Helix." },
        },
        {
            scope: "personal",
            name: "uses-helix",
            title: "Uses Helix",
            body: "The user edits in Helix.",
            at: "2026-09-20T09:00:00.000Z",
        },
    ],
};

// A data directory holding FIXTURE, under root/source; returns its path.
export async function writeFixtureData(
    root: string,
    fixture: ArchiveFixture = FIXTURE,
): Promise<string> {
    const env = {
        HOME: join(root, "source"),
        XDG_DATA_HOME: join(root, "source", "data"),
        XDG_CACHE_HOME: join(root, "source", "cache"),
        XDG_STATE_HOME: join(root, "source", "state"),
        XDG_CONFIG_HOME: join(root, "source", "config"),
    };
    await writeArchive(env, fixture);
    return join(root, "source", "data", "dorothy");
}

// A work directory under root/work holding a snapshot of FIXTURE.
export async function snapshotFixture(
    root: string,
    fixture: ArchiveFixture = FIXTURE,
): Promise<string> {
    const work = join(root, "work");
    await takeSnapshot(await writeFixtureData(root, fixture), work);
    return work;
}

let colliding: [string, string] | null = null;

// Two question texts that have one id with the evidence `c:x`: a 32-bit
// hash gives one among some 100,000 texts.
export function collidingTexts(): [string, string] {
    if (colliding === null) {
        const seen = new Map<string, string>();
        for (let n = 0; colliding === null; n++) {
            const text = `Which thing, number ${n}?`;
            const id = questionId(text, ["c:x"]);
            const other = seen.get(id);
            if (other === undefined) {
                seen.set(id, text);
            } else {
                colliding = [other, text];
            }
        }
    }
    return colliding;
}

export type StubRequest = {
    path: string;
    authorization: string | null;
    body: Record<string, unknown>;
};
export type StubReply = {
    status?: number;
    content?: string;
    json?: unknown;
    // The body of a refusal.
    body?: string;
};

// An OpenAI-compatible Chat Completions server on loopback, answering as
// reply says: a status other than 200 refuses; json is sent as the
// message's content, as a model answering a schema does.
export function stubModels(
    reply: (request: StubRequest, count: number) => StubReply,
): { url: string; requests: StubRequest[]; stop(): void } {
    const requests: StubRequest[] = [];
    const server = Bun.serve({
        port: 0,
        hostname: "127.0.0.1",
        async fetch(request) {
            const body = (await request.json()) as Record<string, unknown>;
            const seen: StubRequest = {
                path: new URL(request.url).pathname,
                authorization: request.headers.get("authorization"),
                body,
            };
            requests.push(seen);
            const answer = reply(seen, requests.length);
            if (answer.status !== undefined && answer.status !== 200) {
                return new Response(answer.body ?? "refused", {
                    status: answer.status,
                });
            }
            return Response.json({
                id: "stub",
                object: "chat.completion",
                created: 0,
                model: body.model,
                choices: [
                    {
                        index: 0,
                        message: {
                            role: "assistant",
                            content:
                                answer.json === undefined
                                    ? (answer.content ?? "")
                                    : JSON.stringify(answer.json),
                        },
                        finish_reason: "stop",
                    },
                ],
                usage: {
                    prompt_tokens: 11,
                    completion_tokens: 7,
                    total_tokens: 18,
                },
            });
        },
    });
    return {
        url: `http://127.0.0.1:${server.port}/v1`,
        requests,
        stop: () => server.stop(true),
    };
}

// eval.toml with every role on the stub, each of its own vendor.
export function stubConfig(url: string, key: string | null = null): string {
    return ROLES.map(
        (role) =>
            `[models.${role}]\nbase-url = "${url}"\nmodel = "${role}/model"\n${
                key === null ? "" : `key = "${key}"\n`
            }`,
    ).join("\n");
}
