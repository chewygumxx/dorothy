// vim:set expandtab shiftwidth=4 filetype=typescript:
// SPDX-License-Identifier: GPL-3.0-only

//
//
// ~chewygumxx/dorothy.git
// ::: :/src/memory/catalogue.ts
//
//

import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { isPhrase } from "../session-id.js";
import { parseTranscript } from "../transcript.js";
import {
    readSidecar,
    type Served,
    type SidecarRead,
    sidecarPath,
} from "./sidecar.js";

// One session in which the user said something: how much, and when last.
export type Visit = { userTurns: number; lastAt: number };

// A read of this conversation from another, as Dorothy appraised it.
export type Read = { at: number; served: Served };

export type Entry = {
    phrase: string;
    sidecar: SidecarRead;
    visits: Visit[];
    reads: Read[];
    // As parseTranscript counts them; more than reviewedThrough is stale.
    turns: number;
    lastActive: number;
};

// Behind an interface so recall's SQLite index can replace the scan.
export interface Catalogue {
    load(): Promise<{ entries: Entry[]; warnings: string[] }>;
}

const describeError = (error: unknown) =>
    error instanceof Error ? error.message : String(error);
const isRecord = (value: unknown): value is Record<string, unknown> =>
    typeof value === "object" && value !== null && !Array.isArray(value);

// A visit opens at each session event. The user can send before the first
// session is ready, so anything before it belongs to the first visit.
export function visitsOf(text: string): Visit[] {
    const visits: Visit[] = [];
    let opened = false;
    let userTurns = 0;
    let lastAt = Number.NaN;
    const close = () => {
        if (userTurns > 0 && Number.isFinite(lastAt)) {
            visits.push({ userTurns, lastAt });
        }
        userTurns = 0;
        lastAt = Number.NaN;
    };
    for (const line of text.split("\n")) {
        let event: unknown;
        try {
            event = JSON.parse(line);
        } catch {
            continue;
        }
        if (!isRecord(event)) {
            continue;
        }
        if (event.kind === "session") {
            if (opened) {
                close();
            }
            opened = true;
        } else if (event.kind === "user" && typeof event.text === "string") {
            userTurns++;
            const at =
                typeof event.at === "string"
                    ? Date.parse(event.at)
                    : Number.NaN;
            if (Number.isFinite(at)) {
                lastAt = at;
            }
        }
    }
    close();
    return visits;
}

// Reads every transcript at launch. Conversations the user never spoke in
// are left out.
export function scanCatalogue(dir: string): Catalogue {
    return {
        async load() {
            const warnings: string[] = [];
            let names: string[];
            try {
                names = await readdir(dir);
            } catch (error) {
                if ((error as { code?: unknown }).code === "ENOENT") {
                    return { entries: [], warnings };
                }
                return {
                    entries: [],
                    warnings: [`memory: ${dir}: ${describeError(error)}`],
                };
            }
            const entries: Entry[] = [];
            for (const name of names.sort()) {
                const phrase = name.endsWith(".jsonl")
                    ? name.slice(0, -".jsonl".length)
                    : "";
                if (!isPhrase(phrase)) {
                    continue;
                }
                const path = join(dir, name);
                let text: string;
                try {
                    text = await readFile(path, "utf8");
                } catch (error) {
                    warnings.push(`memory: ${path}: ${describeError(error)}`);
                    continue;
                }
                const visits = visitsOf(text);
                if (visits.length === 0) {
                    continue;
                }
                const sidecar = await readSidecar(dir, phrase);
                if (sidecar.kind === "unparseable") {
                    warnings.push(
                        `memory: ${sidecarPath(dir, phrase)}: ${sidecar.reason}`,
                    );
                }
                entries.push({
                    phrase,
                    sidecar,
                    visits,
                    reads: [],
                    turns: parseTranscript(text).turns.length,
                    lastActive: Math.max(
                        ...visits.map((visit) => visit.lastAt),
                    ),
                });
            }
            return { entries, warnings };
        },
    };
}
