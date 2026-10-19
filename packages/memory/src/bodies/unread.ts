// vim:set expandtab shiftwidth=4 filetype=typescript:
// SPDX-License-Identifier: GPL-3.0-only

//
//
// ~chewygumxx/dorothy.git
// ::: :/packages/memory/src/bodies/unread.ts
//
//

// What Dorothy could not read of Claude Code's transcripts, kept aside
// under $XDG_STATE_HOME/dorothy/unread/: outside the data directory, so
// history, the mirror and the index never see it, and the user's alone,
// as tool output in it was never scrubbed. A halt keeps its record and
// the transcript from the halting line on; a new type, one example
// line. Beside them, the notices a hook leaves for the next start, which
// it cannot tell itself.

import { createHash } from "node:crypto";
import {
    appendFile,
    readdir,
    readFile,
    rename,
    rm,
    writeFile,
} from "node:fs/promises";
import { join } from "node:path";
import { type Env, isUuid } from "@dorothy/core";
import { hookLogPath, logHasErrors } from "./log.js";
import { beside, privateDir, stateDir, writePrivate } from "./state.js";

export type UnreadRecord = {
    v: 1;
    session: string;
    conversation: string | null;
    // Claude Code's transcript, the launch's directory and its start,
    // for reading it again.
    transcript: string;
    dir: string;
    since: number | null;
    // The halting line, from 1, and its type and uuid where it had them.
    line: number;
    type: string | null;
    uuid: string | null;
    reason: string;
    at: string;
    dismissed?: true;
};

const codeOf = (error: unknown) => (error as { code?: unknown }).code;

export const unreadDir = (env: Env) => join(stateDir(env), "unread");
const typesDir = (env: Env) => join(unreadDir(env), "types");
const noticesPath = (env: Env) => join(stateDir(env), "notices.jsonl");

function sessionFile(env: Env, session: string, suffix: string): string {
    if (!isUuid(session)) {
        throw new Error(`not a session id: ${session}`);
    }
    return join(unreadDir(env), `${session}${suffix}`);
}
export const copyPath = (env: Env, session: string) =>
    sessionFile(env, session, ".jsonl");
const recordPath = (env: Env, session: string) =>
    sessionFile(env, session, ".json");

async function list(dir: string): Promise<string[]> {
    try {
        return await readdir(dir);
    } catch {
        return [];
    }
}

export async function readRecord(
    env: Env,
    session: string,
): Promise<UnreadRecord | null> {
    if (!isUuid(session)) {
        return null;
    }
    try {
        const record = JSON.parse(
            await readFile(recordPath(env, session), "utf8"),
        );
        return record?.v === 1 && record.session === session ? record : null;
    } catch {
        return null;
    }
}

// A halt: its record, and its transcript from the halting line on, as
// they were. A later halt of the session writes both again; one
// dismissed stays so while it halts at the same line.
export async function keepHalt(
    env: Env,
    record: Omit<UnreadRecord, "v" | "dismissed">,
    rest: readonly string[],
): Promise<string> {
    await privateDir(unreadDir(env));
    const before = await readRecord(env, record.session);
    const copy = copyPath(env, record.session);
    await writePrivate(copy, rest.map((line) => `${line}\n`).join(""));
    const dismissed = before?.dismissed === true && before.line === record.line;
    await writePrivate(
        recordPath(env, record.session),
        `${JSON.stringify({ v: 1, ...record, ...(dismissed ? { dismissed: true } : {}) })}\n`,
    );
    return copy;
}

// A type's file name: the type itself where that is a plain name, else
// its characters made plain and a hash of the whole, so two types never
// share a file.
function typeFile(type: string): string {
    const plain = type.replaceAll(/[^A-Za-z0-9_-]/g, "_");
    if (plain === type && type !== "" && type.length <= 64) {
        return type;
    }
    const hash = createHash("sha256").update(type).digest("hex").slice(0, 8);
    return `${plain.slice(0, 48) || "_"}-${hash}`;
}

// A line of a type the reader does not know: the first example of each.
export async function keepNewType(
    env: Env,
    type: string,
    line: string,
): Promise<void> {
    await privateDir(typesDir(env));
    try {
        await writeFile(
            join(typesDir(env), `${typeFile(type)}.jsonl`),
            `${line}\n`,
            { mode: 0o600, flag: "wx" },
        );
    } catch (error) {
        if (codeOf(error) !== "EEXIST") {
            throw error;
        }
    }
}

export async function halts(env: Env): Promise<UnreadRecord[]> {
    const records: UnreadRecord[] = [];
    for (const name of (await list(unreadDir(env))).sort()) {
        const session = name.endsWith(".json")
            ? name.slice(0, -".json".length)
            : "";
        const record = await readRecord(env, session);
        if (record !== null) {
            records.push(record);
        }
    }
    return records;
}

// Stops a halt's notice; the copy stays. False when there is none.
export async function dismissHalt(env: Env, session: string): Promise<boolean> {
    const record = await readRecord(env, session);
    if (record === null) {
        return false;
    }
    await writePrivate(
        recordPath(env, session),
        `${JSON.stringify({ ...record, dismissed: true })}\n`,
    );
    return true;
}

// The session reads to its end: its copy and record go.
export async function resolveHalt(env: Env, session: string): Promise<void> {
    if (!isUuid(session)) {
        return;
    }
    await rm(copyPath(env, session), { force: true });
    await rm(recordPath(env, session), { force: true });
}

export async function addNotice(
    env: Env,
    message: string,
    now: Date = new Date(),
): Promise<void> {
    await privateDir(stateDir(env));
    await appendFile(
        noticesPath(env),
        `${JSON.stringify({ at: now.toISOString(), message })}\n`,
        { mode: 0o600 },
    );
}

const haltNotice = (env: Env, record: UnreadRecord) =>
    `memory: a Claude Code session (${record.session}) could not be read past line ${record.line} (${record.reason}); the rest is kept in ${copyPath(env, record.session)}. dorothy --claude-hook --reread tries again; --dismiss ${record.session} stops this notice`;

// The types kept and not yet told, each now marked told: by a file made
// only if none is there, so of starts at once, one tells a type. Types
// an earlier version told are in types.json, which is only read.
async function untoldTypes(env: Env): Promise<string[]> {
    let known: string[] = [];
    try {
        const read: unknown = JSON.parse(
            await readFile(join(unreadDir(env), "types.json"), "utf8"),
        );
        known = Array.isArray(read)
            ? read.filter((t) => typeof t === "string")
            : [];
    } catch {
        // None told yet.
    }
    const fresh: string[] = [];
    for (const type of await keptTypes(env)) {
        if (known.includes(type)) {
            continue;
        }
        try {
            await writeFile(join(typesDir(env), `${type}.told`), "", {
                mode: 0o600,
                flag: "wx",
            });
            fresh.push(type);
        } catch (error) {
            if (codeOf(error) !== "EEXIST") {
                throw error;
            }
        }
    }
    return fresh;
}

const keptTypes = async (env: Env) =>
    (await list(typesDir(env)))
        .filter((name) => name.endsWith(".jsonl"))
        .map((name) => name.slice(0, -".jsonl".length))
        .sort();

// What to tell at a start of either body: each halt not dismissed, every
// time; new types and hooks' notices, once.
export async function startNotices(env: Env): Promise<string[]> {
    const told = (await halts(env))
        .filter((record) => record.dismissed !== true)
        .map((record) => haltNotice(env, record));
    const fresh = await untoldTypes(env);
    if (fresh.length > 0) {
        told.push(
            `memory: Claude Code wrote lines of a type Dorothy does not know (${fresh.join(", ")}); they were passed over, and an example of each is kept in ${typesDir(env)}`,
        );
    }
    // Taken away first, so a notice added meanwhile waits for the next.
    const taking = beside(noticesPath(env), "taking");
    try {
        await rename(noticesPath(env), taking);
    } catch {
        return told;
    }
    const text = await readFile(taking, "utf8").catch(() => "");
    await rm(taking, { force: true });
    for (const line of text.split("\n")) {
        try {
            const notice: unknown = JSON.parse(line);
            const message = (notice as { message?: unknown } | null)?.message;
            if (typeof message === "string") {
                told.push(message);
            }
        } catch {
            // A torn line is lost with the file.
        }
    }
    return told;
}

// For dorothy --check: what is kept aside, and whether the hook's log
// holds errors.
export async function unreadReport(env: Env): Promise<string[]> {
    const lines = (await halts(env)).map(
        (record) =>
            `unread: ${record.session} (${record.conversation ?? "no conversation yet"}), line ${record.line}: ${record.reason}; kept in ${copyPath(env, record.session)}${record.dismissed ? " (dismissed)" : ""}`,
    );
    const types = await keptTypes(env);
    if (types.length > 0) {
        lines.push(
            `unread: new types kept in ${typesDir(env)}: ${types.join(", ")}`,
        );
    }
    if (await logHasErrors(env)) {
        lines.push(`hook: ${hookLogPath(env)} holds errors`);
    }
    return lines;
}
