// vim:set expandtab shiftwidth=4 filetype=typescript:
// SPDX-License-Identifier: GPL-3.0-only

//
//
// ~chewygumxx/dorothy.git
// ::: :/packages/memory/src/recording/watermark.ts
//
//

// Where a host's recording began: the time of its first sweep, kept in the
// data directory beside the archive, as history commits it. Sessions that
// ended before it wait for the backfill. It is not a skip hint, so
// sweep.json, which may be lost, does not hold it.

import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { FactStore } from "../facts/store.js";
import { writeAtomic } from "../memory/sidecar.js";
import type { Host } from "./sources.js";

const HOSTS = new Set<string>(["claude-code", "codex", "hermes"]);
type Marks = Partial<Record<Host, string>>;

export const watermarkPath = (root: string) => join(root, "recording.json");

function iso(value: unknown): value is string {
    if (typeof value !== "string") return false;
    const time = Date.parse(value);
    return Number.isFinite(time) && new Date(time).toISOString() === value;
}
async function load(root: string, warn: (message: string) => void) {
    let parsed: unknown;
    try {
        parsed = JSON.parse(await readFile(watermarkPath(root), "utf8"));
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") return {};
        // Never name the parser's error: it can quote the contents.
        warn("recording: watermarks unreadable; starting fresh");
        return {};
    }
    const marks = (parsed as { watermarks?: unknown } | null)?.watermarks;
    const entries =
        marks !== null && typeof marks === "object" && !Array.isArray(marks)
            ? Object.entries(marks)
            : null;
    if (
        (parsed as { v?: unknown } | null)?.v !== 1 ||
        entries === null ||
        entries.some(([host, at]) => !HOSTS.has(host) || !iso(at))
    ) {
        warn("recording: watermarks invalid; starting fresh");
        return {};
    }
    return Object.fromEntries(entries) as Marks;
}

// The host's watermark, stored as `at` if it has none yet. Takes the
// store's lock, and commits a new one to history.
export async function hostWatermark(
    store: FactStore,
    host: Host,
    at: string,
    warn: (message: string) => void,
): Promise<string> {
    if (!HOSTS.has(host) || !iso(at))
        throw new RangeError("invalid sweep watermark");
    return store.lock(async () => {
        const marks = await load(store.root, warn);
        const kept = marks[host];
        if (kept !== undefined) return kept;
        marks[host] = at;
        const path = watermarkPath(store.root);
        await writeAtomic(
            path,
            `${JSON.stringify({ v: 1, watermarks: marks })}\n`,
        );
        await store.recorder?.([path], `recording: ${host} watermark`);
        return at;
    });
}
