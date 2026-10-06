// vim:set expandtab shiftwidth=4 filetype=typescript:
// SPDX-License-Identifier: GPL-3.0-only

//
//
// ~chewygumxx/dorothy.git
// ::: :/src/recall/types.ts
//
//

// The server's name; the CLI calls its tools mcp__memory__search,
// mcp__memory__open and mcp__memory__recollect.
export const SERVER_NAME = "memory";
export const TOOLS = ["search", "open", "recollect"] as const;
export type Tool = (typeof TOOLS)[number];
// The external pair, over other conversations, allowed in every session
// with recall.
export const ALLOWED_TOOLS = ["search", "open"].map(
    (tool) => `mcp__${SERVER_NAME}__${tool}`,
);
// The internal tool, over this conversation's clusters, allowed only in a
// session seeded with clusters.
export const RECOLLECT_TOOL = `mcp__${SERVER_NAME}__recollect`;

const PREFIX = `mcp__${SERVER_NAME}__`;

// A tool's name as the model calls it, or null for any other tool.
export function toolOf(name: string): Tool | null {
    const tool = name.startsWith(PREFIX) ? name.slice(PREFIX.length) : "";
    return (TOOLS as readonly string[]).includes(tool) ? (tool as Tool) : null;
}

export type SearchInput = {
    query: string;
    after?: string | undefined;
    before?: string | undefined;
    limit?: number | undefined;
};
export type OpenInput = {
    conversation: string;
    purpose: string;
    turn?: number | undefined;
};
export type RecollectInput = {
    cluster: number;
    words?: string | undefined;
    turn?: number | undefined;
};

// Results use schema.org's names for a conversation's properties.
export type Match = { turn: number; role: "user" | "assistant"; text: string };
export type ConversationObject = {
    "@type": "Conversation";
    identifier: string;
    name?: string;
    description?: string;
    dateCreated: string;
    dateModified: string;
};
export type SearchHit = ConversationObject & { matches: Match[] };
export type SearchResult = { results: SearchHit[]; more: number };
export type WindowTurn = {
    turn: number;
    role: "user" | "assistant";
    at: string;
    text: string;
};
export type OpenResult = ConversationObject & {
    abstract?: string;
    turns: number;
    window: WindowTurn[];
};
// A cluster of this conversation, word for word from where reading
// started. matched says whether words were found, when words were given.
export type RecollectResult = {
    cluster: number;
    turns: [number, number];
    total: number;
    matched?: boolean;
    window: WindowTurn[];
};

// What the transcript keeps of a lookup: its input and a summary of what
// came back, never the results, which can be found again.
export type SearchLookup = {
    tool: "search";
    query: string;
    after?: string;
    before?: string;
    hits: number;
};
export type OpenLookup = {
    tool: "open";
    conversation: string;
    // The conversation's title when it was opened, else its identifier.
    name: string;
    purpose: string;
    turns: [number, number] | null;
};
export type RecollectLookup = {
    tool: "recollect";
    cluster: number;
    words?: string;
    turns: [number, number] | null;
};
export type Lookup = SearchLookup | OpenLookup | RecollectLookup;

const isRecord = (value: unknown): value is Record<string, unknown> =>
    typeof value === "object" && value !== null && !Array.isArray(value);
const textOf = (value: unknown) => (typeof value === "string" ? value : "");

function parse<T>(text: string | null): T | null {
    if (text === null) {
        return null;
    }
    try {
        return JSON.parse(text) as T;
    } catch {
        return null;
    }
}

// The first and last turn of a window, or null for none.
function windowRange(window: unknown): [number, number] | null {
    const turns = Array.isArray(window) ? (window as WindowTurn[]) : [];
    const first = turns[0];
    const last = turns.at(-1);
    return first !== undefined && last !== undefined
        ? [first.turn, last.turn]
        : null;
}

// result: the tool's text, or null when the call failed. The result is read
// through the server's own types, so a change to their shape fails the
// typecheck here.
export function describeLookup(
    tool: Tool,
    input: unknown,
    result: string | null,
): Lookup {
    const fields = isRecord(input) ? input : {};
    if (tool === "search") {
        const lookup: SearchLookup = {
            tool,
            query: textOf(fields.query),
            hits: 0,
        };
        if (typeof fields.after === "string") {
            lookup.after = fields.after;
        }
        if (typeof fields.before === "string") {
            lookup.before = fields.before;
        }
        const found = parse<SearchResult>(result);
        if (Array.isArray(found?.results) && typeof found.more === "number") {
            lookup.hits = found.results.length + found.more;
        }
        return lookup;
    }
    if (tool === "recollect") {
        const lookup: RecollectLookup = {
            tool,
            cluster:
                typeof fields.cluster === "number" &&
                Number.isFinite(fields.cluster)
                    ? Math.round(fields.cluster)
                    : 0,
            turns: null,
        };
        if (typeof fields.words === "string") {
            lookup.words = fields.words;
        }
        lookup.turns = windowRange(parse<RecollectResult>(result)?.window);
        return lookup;
    }
    const conversation = textOf(fields.conversation);
    const lookup: OpenLookup = {
        tool,
        conversation,
        name: conversation,
        purpose: textOf(fields.purpose),
        turns: null,
    };
    const opened = parse<OpenResult>(result);
    if (typeof opened?.name === "string") {
        lookup.name = opened.name;
    }
    lookup.turns = windowRange(opened?.window);
    return lookup;
}
