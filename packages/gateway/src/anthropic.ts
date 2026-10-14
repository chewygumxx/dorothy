// vim:set expandtab shiftwidth=4 filetype=typescript:
// SPDX-License-Identifier: GPL-3.0-only

//
//
// ~chewygumxx/dorothy.git
// ::: :/packages/gateway/src/anthropic.ts
//
//

import { identityPrompt } from "@dorothy/identity";

// What `dorothy --claude` appends to Claude Code's system prompt, and the
// gateway replaces with Dorothy's identity. Only the main thread and its
// forks carry it; subagents build prompts of their own.
export const MARKER = "<!-- dorothy:identity -->";

const BILLING = "x-anthropic-billing-header:";

type Fields = Record<string, unknown>;

export type Rewritten =
    | { kind: "unmarked" }
    | { kind: "injected"; bytes: Uint8Array<ArrayBuffer> }
    | { kind: "drift" };

const isRecord = (value: unknown): value is Fields =>
    typeof value === "object" && value !== null && !Array.isArray(value);

const isText = (value: unknown): value is Fields & { text: string } =>
    isRecord(value) && value.type === "text" && typeof value.text === "string";

// The text with every marker and the space around it gone, what was
// either side of one rejoined as paragraphs. The text's own ends stay as
// they were.
function unmark(text: string): string {
    const parts = text.split(MARKER);
    const last = parts.length - 1;
    return parts
        .map((part, index) => {
            const start = index === 0 ? part : part.trimStart();
            return index === last ? start : start.trimEnd();
        })
        .filter((part) => part.trim() !== "")
        .join("\n\n");
}

// The request with Dorothy's identity where its system prompt carried the
// marker, or null when the system prompt carries none. Only the marker is
// removed; the billing header, the host's identity line and everything
// else stay as sent.
export function injectIdentity(
    body: unknown,
    identity: string = identityPrompt(),
): Fields | null {
    if (!isRecord(body)) {
        return null;
    }
    const mine: Fields = { type: "text", text: identity };
    const { system } = body;
    if (typeof system === "string") {
        if (!system.includes(MARKER)) {
            return null;
        }
        const rest = unmark(system);
        return {
            ...body,
            system: rest === "" ? [mine] : [{ type: "text", text: rest }, mine],
        };
    }
    if (!Array.isArray(system)) {
        return null;
    }
    const kept: unknown[] = [];
    let marked = false;
    for (const block of system) {
        if (!isText(block) || !block.text.includes(MARKER)) {
            kept.push(block);
            continue;
        }
        marked = true;
        const rest = unmark(block.text);
        if (rest !== "") {
            kept.push({ ...block, text: rest });
            continue;
        }
        // An emptied block goes, and its cache breakpoint moves to the
        // block before it, so the request keeps as many as it had.
        if (block.cache_control !== undefined) {
            const before = kept.at(-1);
            if (isRecord(before)) {
                kept[kept.length - 1] = {
                    ...before,
                    cache_control: block.cache_control,
                };
            } else {
                mine.cache_control = block.cache_control;
            }
        }
    }
    if (!marked) {
        return null;
    }
    // After the first block that is not the billing header: in Claude
    // Code's requests, its identity line.
    const host = kept.findIndex(
        (block) => !(isText(block) && block.text.startsWith(BILLING)),
    );
    kept.splice(host === -1 ? kept.length : host + 1, 0, mine);
    return { ...body, system: kept };
}

// A request body as it arrived, rewritten if its system prompt carries
// the marker. What cannot be read, or carries the marker in its system
// prompt where it cannot be placed, is drift: forwarded as it is, and
// counted, so a client that changes how it sends its prompt is noticed.
// A marker only in the messages is a conversation quoting it, such as a
// subagent reading this code, and passes as unmarked.
export function rewriteRequest(
    bytes: Uint8Array<ArrayBuffer>,
    encoding: string | null,
): Rewritten {
    let plain: Uint8Array;
    if (encoding === null || encoding === "identity") {
        plain = bytes;
    } else if (encoding === "gzip") {
        try {
            plain = Bun.gunzipSync(bytes);
        } catch {
            return { kind: "drift" };
        }
    } else {
        return { kind: "drift" };
    }
    const text = new TextDecoder().decode(plain);
    if (!text.includes(MARKER)) {
        return { kind: "unmarked" };
    }
    let body: unknown;
    try {
        body = JSON.parse(text);
    } catch {
        return { kind: "drift" };
    }
    const injected = injectIdentity(body);
    if (injected !== null) {
        return {
            kind: "injected",
            bytes: new TextEncoder().encode(JSON.stringify(injected)),
        };
    }
    const system = isRecord(body) ? body.system : undefined;
    return JSON.stringify(system ?? null).includes(MARKER)
        ? { kind: "drift" }
        : { kind: "unmarked" };
}
