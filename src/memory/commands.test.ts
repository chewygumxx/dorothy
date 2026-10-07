// vim:set expandtab shiftwidth=4 filetype=typescript:
// SPDX-License-Identifier: GPL-3.0-only

//
//
// ~chewygumxx/dorothy.git
// ::: :/src/memory/commands.test.ts
//
//

import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { newPhrase } from "../session-id.js";
import type { EditResult } from "../tui/external-editor.js";
import { runList, runMemoryEdit, runTags, runTagsEdit } from "./commands.js";
import {
    type HistoryHandle,
    type OpenHistory,
    readSidecar,
    sidecarPath,
} from "./sidecar.js";

const NOW = new Date("2026-10-05T00:00:00.000Z");
const phrase = (seed: number) =>
    newPhrase(() => Uint8Array.from([seed, 1, 2, 3, 4, 5, 6, 7]));
const line = (kind: string, fields: object) =>
    JSON.stringify({ v: 1, kind, at: NOW.toISOString(), ...fields });
const chat = [
    line("user", { text: "Hi" }),
    line("assistant", { text: "Hello", interrupted: false }),
].join("\n");

function capture() {
    let text = "";
    return {
        write: (chunk: string) => {
            text += chunk;
        },
        get text() {
            return text;
        },
    };
}

let dir = "";
let transcripts = "";
let env: Record<string, string> = {};
beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "dorothy-commands-"));
    transcripts = join(dir, "dorothy", "transcripts");
    await mkdir(transcripts, { recursive: true });
    env = { XDG_DATA_HOME: dir, XDG_CONFIG_HOME: dir, HOME: dir };
});
afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
});

describe("runList", () => {
    it("prints the catalogue and names broken sidecars on stderr", async () => {
        const [a, b] = [phrase(1), phrase(2)];
        await writeFile(join(transcripts, `${a}.jsonl`), chat);
        await writeFile(
            sidecarPath(transcripts, a),
            JSON.stringify({
                v: 1,
                title: "Memory",
                description: "About memory.",
                reviewedThrough: 2,
            }),
        );
        await writeFile(join(transcripts, `${b}.jsonl`), chat);
        await writeFile(sidecarPath(transcripts, b), "{ broken");
        const out = capture();
        const err = capture();
        expect(await runList({ env, out, err, now: NOW.getTime() })).toBe(0);
        expect(out.text).toStartWith("   last active  tier");
        expect(out.text).toMatch(new RegExp(`described +${a} +Memory\\n`));
        expect(out.text).toMatch(
            new RegExp(`omitted +${b} +\\(untitled\\)\\n`),
        );
        expect(err.text).toContain(sidecarPath(transcripts, b));
    });

    it("lists what Dorothy remembers even with memory switched off", async () => {
        const a = phrase(1);
        await writeFile(join(transcripts, `${a}.jsonl`), chat);
        await writeFile(
            sidecarPath(transcripts, a),
            JSON.stringify({ v: 1, title: "Memory" }),
        );
        await writeFile(
            join(dir, "dorothy", "config.toml"),
            "[memory]\nenabled = false\n",
        );
        const out = capture();
        expect(
            await runList({ env, out, err: capture(), now: NOW.getTime() }),
        ).toBe(0);
        expect(out.text).toContain("Memory");
    });

    it("sweeps history before reading, and closes it", async () => {
        const history = fakeHistory();
        const out = capture();
        expect(
            await runList({
                env,
                out,
                err: capture(),
                now: NOW.getTime(),
                openHistory: history.openHistory,
            }),
        ).toBe(0);
        expect(history.calls).toEqual(["open", "close"]);
    });
});

// Plays the user at the editor, one reply per opening.
function editor(...replies: ((text: string) => EditResult)[]) {
    const seen: string[] = [];
    const edit = async (text: string): Promise<EditResult> => {
        seen.push(text);
        return (
            replies.shift()?.(text) ?? { ok: false, message: "no more edits" }
        );
    };
    return { edit, seen };
}

// A history that notes what each command asks of it.
function fakeHistory() {
    const calls: string[] = [];
    const recorded: { paths: readonly string[]; message: string }[] = [];
    const handle: HistoryHandle = {
        recorder: async (paths, message) => {
            recorded.push({ paths, message });
        },
        lock: (work) => work(),
        sweep: async () => {
            calls.push("sweep");
        },
        heal: async () => false,
        close: () => {
            calls.push("close");
        },
    };
    const openHistory: OpenHistory = async (index) => {
        calls.push(index === null ? "open without index" : "open");
        return handle;
    };
    return { openHistory, calls, recorded };
}

describe("runMemoryEdit", () => {
    const a = phrase(1);
    const run = (
        edit: (text: string) => Promise<EditResult>,
        err = capture(),
    ) => runMemoryEdit(a, { env, err, edit, now: () => NOW });
    const sidecar = async () => {
        const read = await readSidecar(transcripts, a);
        return read.kind === "ok" ? read.sidecar : null;
    };

    it("saves the user's edit as theirs", async () => {
        await writeFile(join(transcripts, `${a}.jsonl`), chat);
        const { edit } = editor((text) => ({
            ok: true,
            text: text.replace("Title:", "Title: Mine"),
        }));
        expect(await run(edit)).toBe(0);
        expect(await sidecar()).toMatchObject({
            title: "Mine",
            fields: { title: { by: "user", at: NOW.toISOString() } },
        });
    });

    it("reopens the editor on a mistake, saying what it was", async () => {
        await writeFile(join(transcripts, `${a}.jsonl`), chat);
        const { edit, seen } = editor(
            (text) => ({
                ok: true,
                text: text.replace("Pinned: no", "Pinned: maybe"),
            }),
            (text) => ({
                ok: true,
                text: text.replace("Pinned: maybe", "Pinned: yes"),
            }),
        );
        expect(await run(edit)).toBe(0);
        expect(seen[1]).toStartWith(
            `# error: Pinned takes yes or no, not "maybe"\n# Dorothy's notes on ${a}.`,
        );
        expect((await sidecar())?.pinned).toBe(true);
    });

    it("writes nothing when the template is saved unchanged", async () => {
        await writeFile(join(transcripts, `${a}.jsonl`), chat);
        const { edit } = editor((text) => ({ ok: true, text }));
        expect(await run(edit)).toBe(0);
        expect(await readSidecar(transcripts, a)).toEqual({ kind: "none" });
    });

    it("exits 1 for a chat that does not exist", async () => {
        const err = capture();
        const { edit, seen } = editor();
        expect(await run(edit, err)).toBe(1);
        expect(err.text).toContain(`${a}.jsonl`);
        expect(seen).toEqual([]);
    });

    it("exits 1 for a sidecar it cannot parse, and leaves it be", async () => {
        await writeFile(join(transcripts, `${a}.jsonl`), chat);
        await writeFile(sidecarPath(transcripts, a), "{ broken");
        const err = capture();
        const { edit, seen } = editor();
        expect(await run(edit, err)).toBe(1);
        expect(err.text).toContain(sidecarPath(transcripts, a));
        expect(seen).toEqual([]);
        expect(await readFile(sidecarPath(transcripts, a), "utf8")).toBe(
            "{ broken",
        );
    });

    it("exits 1 when the editor fails", async () => {
        await writeFile(join(transcripts, `${a}.jsonl`), chat);
        const err = capture();
        const { edit } = editor(() => ({
            ok: false,
            message: "editor exited with 1",
        }));
        expect(await run(edit, err)).toBe(1);
        expect(err.text).toContain("editor exited with 1");
    });

    it("sets a chat's tags by label", async () => {
        await writeFile(join(transcripts, `${a}.jsonl`), chat);
        await writeFile(
            join(dir, "dorothy", "tags.json"),
            JSON.stringify({
                v: 1,
                rev: 1,
                concepts: {
                    k00000001: {
                        prefLabel: "memory",
                        scopeNote: "Remembering.",
                        by: "dorothy",
                        at: NOW.toISOString(),
                    },
                },
            }),
        );
        const err = capture();
        const code = await run(
            async (text: string): Promise<EditResult> => ({
                ok: true,
                text: text.replace(/^Tags:.*$/m, "Tags: Memory"),
            }),
            err,
        );
        expect(err.text).toBe("");
        expect(code).toBe(0);
        const read = await readSidecar(transcripts, a);
        expect(read.kind === "ok" && read.sidecar.tags).toEqual(["k00000001"]);
        expect(read.kind === "ok" && read.sidecar.fields.tags?.by).toBe("user");
    });

    it("records the user's edit with the vocabulary beside it", async () => {
        await writeFile(join(transcripts, `${a}.jsonl`), chat);
        const history = fakeHistory();
        const { edit } = editor((text) => ({
            ok: true,
            text: text.replace("Title:", "Title: Mine"),
        }));
        expect(
            await runMemoryEdit(a, {
                env,
                err: capture(),
                edit,
                now: () => NOW,
                openHistory: history.openHistory,
            }),
        ).toBe(0);
        expect(history.recorded).toEqual([
            {
                paths: [
                    sidecarPath(transcripts, a),
                    join(dir, "dorothy", "tags.json"),
                ],
                message: `edit: ${a} (user)`,
            },
        ]);
        expect(history.calls).toEqual(["open", "close"]);
    });

    describe("with a review landing while the editor is open", () => {
        const tagsFile = () => join(dir, "dorothy", "tags.json");
        const concept = (prefLabel: string) => ({
            prefLabel,
            scopeNote: `About ${prefLabel}.`,
            by: "dorothy",
            at: NOW.toISOString(),
        });
        const theirs = {
            by: "dorothy",
            at: NOW.toISOString(),
            model: "claude-test",
            throughTurn: 1,
        };
        // What a review does meanwhile: coins memory and tags the chat.
        const review = async () => {
            await writeFile(
                tagsFile(),
                JSON.stringify({
                    v: 1,
                    rev: 2,
                    concepts: {
                        k00000001: concept("memory"),
                        k00000002: concept("tui"),
                    },
                }),
            );
            await writeFile(
                sidecarPath(transcripts, a),
                JSON.stringify({
                    v: 1,
                    rev: 1,
                    tags: ["k00000001"],
                    reviewedThrough: 1,
                    fields: { tags: theirs },
                }),
            );
        };

        it.each([
            ["missing", null],
            [
                "older",
                { v: 1, rev: 1, concepts: { k00000002: concept("tui") } },
            ],
        ])("keeps her tags when tags.json was %s at open", async (_, at) => {
            await writeFile(join(transcripts, `${a}.jsonl`), chat);
            if (at !== null) {
                await writeFile(tagsFile(), JSON.stringify(at));
            }
            const { edit } = editor((text) => ({
                ok: true,
                text: text.replace("Pinned: no", "Pinned: yes"),
            }));
            const err = capture();
            const code = await run(async (text) => {
                await review();
                return edit(text);
            }, err);
            expect(err.text).toBe("");
            expect(code).toBe(0);
            expect(await sidecar()).toMatchObject({
                pinned: true,
                tags: ["k00000001"],
                fields: { tags: theirs },
            });
        });

        it("takes a label coined after it opened", async () => {
            await writeFile(join(transcripts, `${a}.jsonl`), chat);
            const { edit } = editor((text) => ({
                ok: true,
                text: text.replace(/^Tags:.*$/m, "Tags: tui; memory"),
            }));
            const err = capture();
            const code = await run(async (text) => {
                await review();
                return edit(text);
            }, err);
            expect(err.text).toBe("");
            expect(code).toBe(0);
            expect(await sidecar()).toMatchObject({
                tags: ["k00000002", "k00000001"],
                fields: { tags: { by: "user" } },
            });
        });

        it("keeps the tags as they are if tags.json broke meanwhile", async () => {
            await writeFile(join(transcripts, `${a}.jsonl`), chat);
            await review();
            await writeFile(
                sidecarPath(transcripts, a),
                JSON.stringify({
                    v: 1,
                    rev: 1,
                    tags: ["k00000001", "k00000009"],
                    fields: { tags: theirs },
                }),
            );
            const { edit, seen } = editor(
                (text) => ({
                    ok: true,
                    text: text
                        .replace("Pinned: no", "Pinned: yes")
                        .replace(/^Tags:.*$/m, "Tags: tui"),
                }),
                (text) => ({
                    ok: true,
                    text: text.replace(/^Tags:.*\n/m, ""),
                }),
            );
            const code = await run(async (text) => {
                await writeFile(tagsFile(), "{ broken");
                return edit(text);
            });
            expect(code).toBe(0);
            expect(seen[1]).toStartWith(
                "# error: Tags can't be set while the vocabulary can't be read\n",
            );
            expect(await sidecar()).toMatchObject({
                pinned: true,
                tags: ["k00000001", "k00000009"],
                fields: { tags: theirs },
            });
        });
    });
});

describe("runTags", () => {
    const tagsFile = () => join(dir, "dorothy", "tags.json");

    it("prints the tree, counting hidden chats too", async () => {
        const [a, b] = [phrase(1), phrase(2)];
        await writeFile(
            tagsFile(),
            JSON.stringify({
                v: 1,
                rev: 1,
                concepts: {
                    k00000001: {
                        prefLabel: "memory",
                        scopeNote: "Remembering.",
                        by: "dorothy",
                        at: NOW.toISOString(),
                    },
                },
            }),
        );
        for (const [of, hidden] of [
            [a, false],
            [b, true],
        ] as const) {
            await writeFile(join(transcripts, `${of}.jsonl`), chat);
            await writeFile(
                sidecarPath(transcripts, of),
                JSON.stringify({ v: 1, hidden, tags: ["k00000001"] }),
            );
        }
        const out = capture();
        const err = capture();
        expect(await runTags({ env, out, err })).toBe(0);
        expect(out.text).toBe("memory (2)\n");
        expect(err.text).toBe("");
    });

    it("names a broken vocabulary and fails", async () => {
        await writeFile(tagsFile(), "{ broken");
        const err = capture();
        expect(await runTags({ env, out: capture(), err })).toBe(1);
        expect(err.text).toStartWith(`dorothy: ${tagsFile()}: `);
    });
});

describe("runTagsEdit", () => {
    const tagsFile = () => join(dir, "dorothy", "tags.json");
    const vocabulary = {
        v: 1,
        rev: 1,
        concepts: {
            k00000001: {
                prefLabel: "memory",
                scopeNote: "Remembering.",
                by: "dorothy",
                at: NOW.toISOString(),
            },
        },
    };

    it("records the edit, counting the concepts it changed", async () => {
        await writeFile(tagsFile(), JSON.stringify(vocabulary));
        const history = fakeHistory();
        expect(
            await runTagsEdit({
                env,
                err: capture(),
                edit: async (text: string): Promise<EditResult> => ({
                    ok: true,
                    text: text.replace("Tag: memory", "Tag: remembering"),
                }),
                now: () => NOW,
                openHistory: history.openHistory,
            }),
        ).toBe(0);
        expect(history.recorded).toEqual([
            { paths: [tagsFile()], message: "edit-tags: 1 concepts (user)" },
        ]);
    });

    it("reopens with the error until the edit holds, then saves it", async () => {
        await writeFile(tagsFile(), JSON.stringify(vocabulary));
        const seen: string[] = [];
        const answers = [
            (text: string) => text.replace("Tag: memory", "Tag: a;b"),
            (text: string) =>
                text
                    .replace(/^# error: .*\n/, "")
                    .replace("Tag: a;b", "Tag: remembering"),
        ];
        const err = capture();
        const code = await runTagsEdit({
            env,
            err,
            edit: async (text: string): Promise<EditResult> => {
                seen.push(text);
                return {
                    ok: true,
                    text: (answers.shift() as (t: string) => string)(text),
                };
            },
            now: () => NOW,
        });
        expect(err.text).toBe("");
        expect(code).toBe(0);
        expect(seen[1]).toStartWith('# error: "a;b" contains ;\n');
        const saved = JSON.parse(await readFile(tagsFile(), "utf8"));
        expect(saved.rev).toBe(2);
        expect(saved.concepts.k00000001.prefLabel).toBe("remembering");
        expect(saved.concepts.k00000001.edited).toBe(NOW.toISOString());
    });

    it("refuses a broken vocabulary before opening the editor", async () => {
        await writeFile(tagsFile(), "{ broken");
        const err = capture();
        let opened = false;
        const code = await runTagsEdit({
            env,
            err,
            edit: async () => {
                opened = true;
                return { ok: true, text: "" };
            },
        });
        expect(code).toBe(1);
        expect(opened).toBe(false);
        expect(err.text).toStartWith(`dorothy: ${tagsFile()}: `);
    });
});
