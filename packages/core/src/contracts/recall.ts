// vim:set expandtab shiftwidth=4 filetype=typescript:
// SPDX-License-Identifier: GPL-3.0-only

//
//
// ~chewygumxx/dorothy.git
// ::: :/packages/core/src/contracts/recall.ts
//
//

// Chat's server, whose tools the model calls as mcp__memory__search and
// so on. Claude Code's has a name of its own, so that a user's own
// server called memory, as the reference MCP memory server is, does not
// collide.
export const SERVER_NAME = "memory";
export const CLAUDE_SERVER_NAME = "dorothy-memory";
// The lookups: tools that read memory, recorded as recall events.
export const TOOLS = ["search", "open", "recollect", "tags"] as const;
export type Tool = (typeof TOOLS)[number];
// The one tool that writes memory, recorded as a tool event.
export const REMEMBER = "remember";

const named = (server: string, tool: string) => `mcp__${server}__${tool}`;
// The tools allowed in every session with recall: every one but
// recollect, which reads only the live conversation's clusters.
const EXTERNAL = [...TOOLS.filter((tool) => tool !== "recollect"), REMEMBER];
export const ALLOWED_TOOLS = EXTERNAL.map((tool) => named(SERVER_NAME, tool));
export const CLAUDE_ALLOWED_TOOLS = EXTERNAL.map((tool) =>
    named(CLAUDE_SERVER_NAME, tool),
);
// The internal tool, over this conversation's clusters, allowed only in a
// session seeded with clusters.
export const RECOLLECT_TOOL = named(SERVER_NAME, "recollect");
export const REMEMBER_TOOL = named(SERVER_NAME, REMEMBER);
export const CLAUDE_REMEMBER_TOOL = named(CLAUDE_SERVER_NAME, REMEMBER);

// A lookup's name as the model calls it on a server, chat's unless
// another is named, or null for any other tool, remember among them.
export function toolOf(
    name: string,
    server: string = SERVER_NAME,
): Tool | null {
    const prefix = `mcp__${server}__`;
    const tool = name.startsWith(prefix) ? name.slice(prefix.length) : "";
    return (TOOLS as readonly string[]).includes(tool) ? (tool as Tool) : null;
}

export const SEARCH_KINDS = ["conversations", "facts"] as const;
export type SearchKind = (typeof SEARCH_KINDS)[number];
export type SearchInput = {
    query?: string | undefined;
    tags?: string[] | undefined;
    after?: string | undefined;
    before?: string | undefined;
    limit?: number | undefined;
    kind?: SearchKind | undefined;
};
export type TagsInput = {
    under?: string | undefined;
    limit?: number | undefined;
};
// Exactly one of conversation and fact.
export type OpenInput = {
    conversation?: string | undefined;
    fact?: string | undefined;
    purpose: string;
    turn?: number | undefined;
};
// remember: write takes name, scope, type, title, description and body;
// retire takes name, scope and why.
export type RememberInput = {
    action: "write" | "retire";
    name: string;
    scope: "personal" | "project";
    type?: string | undefined;
    title?: string | undefined;
    description?: string | undefined;
    body?: string | undefined;
    why?: string | undefined;
};
export type RememberResult = {
    action: "written" | "corrected" | "retired" | "unchanged";
    id: string;
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
    keywords?: string[];
    dateCreated: string;
    dateModified: string;
};
export type SearchHit = ConversationObject & { matches: Match[] };
// A fact as search finds it; id is how open takes it, personal/<name>
// or <project id>/<name>.
export type FactHit = {
    id: string;
    scope: string;
    type: string;
    title: string;
    description: string;
    origin: string;
    snippet: string;
    retired?: true;
    // Knowledge the user has not confirmed carries a warning.
    unconfirmed?: string;
};
// Two groups, each ranked and capped at the limit: FTS5's scores from
// two tables do not compare.
export type SearchResult = {
    facts: FactHit[];
    moreFacts: number;
    results: SearchHit[];
    more: number;
};
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
// The whole fact: its fields, its provenance and its body. keywords
// are its concepts' labels.
export type OpenFactResult = {
    id: string;
    scope: string;
    name: string;
    type: string;
    title: string;
    description: string;
    keywords: string[];
    importance: number | null;
    provenance: {
        origin: string;
        by: string;
        at: string;
        created: string;
        model?: string;
        from?: string;
    };
    retired: { at: string; by: string; why: string } | null;
    body: string;
    // Knowledge the user has not confirmed carries a warning.
    unconfirmed?: string;
};
// A concept, under schema.org's name for a term in a vocabulary.
export type TagObject = {
    "@type": "DefinedTerm";
    name: string;
    alternateName?: string[];
    description: string;
    broader?: string[];
    narrower?: string[];
    conversations: number;
    // The facts that carry it, when any do.
    facts?: number;
    dateCreated?: string;
    dateModified?: string;
};
export type TagsResult = { results: TagObject[]; more: number };
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
// hits counts conversations; facts counts facts, when facts were
// searched.
export type SearchLookup = {
    tool: "search";
    query: string;
    tags?: string[];
    after?: string;
    before?: string;
    // Not kind: a recall event's kind is "recall".
    searched?: SearchKind;
    hits: number;
    facts?: number;
};
type OpenBase = {
    tool: "open";
    // The title when it was opened, else what was asked for.
    name: string;
    purpose: string;
    turns: [number, number] | null;
};
export type OpenLookup =
    | (OpenBase & { conversation: string })
    | (OpenBase & { fact: string });
export type RecollectLookup = {
    tool: "recollect";
    cluster: number;
    words?: string;
    turns: [number, number] | null;
};
export type TagsLookup = {
    tool: "tags";
    under?: string;
    hits: number;
};
export type Lookup = SearchLookup | OpenLookup | RecollectLookup | TagsLookup;

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
    switch (tool) {
        case "search":
            return searchLookup(fields, result);
        case "recollect":
            return recollectLookup(fields, result);
        case "tags":
            return tagsLookup(fields, result);
        default:
            return openLookup(fields, result);
    }
}

type Fields = Record<string, unknown>;

function searchLookup(fields: Fields, result: string | null): SearchLookup {
    const lookup: SearchLookup = {
        tool: "search",
        query: textOf(fields.query),
        hits: 0,
    };
    if (typeof fields.after === "string") {
        lookup.after = fields.after;
    }
    if (typeof fields.before === "string") {
        lookup.before = fields.before;
    }
    const tags = Array.isArray(fields.tags)
        ? fields.tags.filter((tag): tag is string => typeof tag === "string")
        : [];
    if (tags.length > 0) {
        lookup.tags = tags;
    }
    if (fields.kind === "conversations" || fields.kind === "facts") {
        lookup.searched = fields.kind;
    }
    return { ...lookup, ...searchHits(parse<SearchResult>(result), lookup) };
}

// What a search found: its conversations, and its facts unless it
// searched conversations alone.
function searchHits(
    found: SearchResult | null,
    lookup: SearchLookup,
): Pick<SearchLookup, "hits" | "facts"> {
    const hits =
        Array.isArray(found?.results) && typeof found.more === "number"
            ? found.results.length + found.more
            : 0;
    return lookup.searched !== "conversations" &&
        Array.isArray(found?.facts) &&
        typeof found.moreFacts === "number"
        ? { hits, facts: found.facts.length + found.moreFacts }
        : { hits };
}

function recollectLookup(
    fields: Fields,
    result: string | null,
): RecollectLookup {
    const { cluster } = fields;
    return {
        tool: "recollect",
        cluster:
            typeof cluster === "number" &&
            Number.isInteger(cluster) &&
            cluster >= 1
                ? cluster
                : 0,
        turns: windowRange(parse<RecollectResult>(result)?.window),
        ...(typeof fields.words === "string" ? { words: fields.words } : {}),
    };
}

function tagsLookup(fields: Fields, result: string | null): TagsLookup {
    const listed = parse<TagsResult>(result);
    return {
        tool: "tags",
        hits:
            Array.isArray(listed?.results) && typeof listed.more === "number"
                ? listed.results.length + listed.more
                : 0,
        ...(typeof fields.under === "string" ? { under: fields.under } : {}),
    };
}

function openLookup(fields: Fields, result: string | null): OpenLookup {
    const purpose = textOf(fields.purpose);
    if (typeof fields.fact === "string") {
        const fact = fields.fact;
        const opened = parse<OpenFactResult>(result);
        return {
            tool: "open",
            fact,
            name: typeof opened?.title === "string" ? opened.title : fact,
            purpose,
            turns: null,
        };
    }
    const conversation = textOf(fields.conversation);
    const opened = parse<OpenResult>(result);
    return {
        tool: "open",
        conversation,
        name: typeof opened?.name === "string" ? opened.name : conversation,
        purpose,
        turns: windowRange(opened?.window),
    };
}

// A lookup Dorothy made mid-reply. offset is where in the reply's text it
// happened, in UTF-16 code units, so a resumed chat can place it.
type RecallBase = {
    v: 1;
    kind: "recall";
    at: string;
    id: string;
    ok: boolean;
    offset: number;
};
export type RecallEvent = RecallBase & Lookup;
