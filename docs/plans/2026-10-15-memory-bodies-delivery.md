---
ctime: 2026-10-15
mtime: 2026-10-15
spdx: GPL-3.0-only
title: Dorothy's memory in her bodies, delivery plan
description: >-
  Implementation plan for the first of the bodies spec's two plans: the
  memory block through the gateway, facts in search and open, remember in
  chat and Claude Code, the recall server and its permissions in Claude
  Code, auto memory off, and sync at a launch's start and in chat.
tags:
  - dorothy
  - memory
  - plan
---

<!--
   -
   - ~chewygumxx/dorothy.git
   - ::: :/docs/plans/2026-10-15-memory-bodies-delivery.md
   -
   -->

# Dorothy's Memory in Her Bodies: Delivery Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use
> superpowers:subagent-driven-development (recommended) or
> superpowers:executing-plans to implement this plan task-by-task. Steps
> use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Dorothy in Claude Code remembers, recalls and writes facts as
she does in chat: `dorothy --claude` gives her the memory block, the
recall server with `remember`, permission to use them without a prompt,
and auto memory off, and chat gains `remember`, facts in `search` and
`open`, and its project synced.

**Architecture:** `core` names the new tool shapes. `memory` searches
and opens facts, adds `remember` over the fact store, serves it from the
recall server with a `--project`, and exports `claudeBlock` and
`syncDirectory` for the CLI. `gateway` places an opaque `section` after
her identity. `cli` joins them in `launchClaude`. `agent`, `memory`'s
recorder and `tui` carry chat's `remember` call as a `remember` event,
recorded as a tool event marked `memory: true`.

**Tech Stack:** Bun 1.4.2 (`bun:sqlite` FTS5, `Bun.spawn`, `bun test`),
TypeScript 7, zod 4, `@modelcontextprotocol/sdk` 1.31, Biome 2.5,
remark, Claude Code 2.1.300.

**Spec:** `docs/specs/2026-10-15-memory-bodies-design.md` (its Delivery
sections; Recording is the second plan's).

## Global Constraints

- Every new file carries the house header, copied from a sibling;
  `bun run lint:header` checks the breadcrumb against the path.
- No em dash (U+2014) anywhere; Markdown lines at most 80 characters;
  Markdown links, never `[[...]]`.
- Commits in Conventional Commits, scopes the package names, `config`,
  `claude` and `api`; agent assets take `ai`; no agent trailers.
- No test reaches the API, runs a real `claude`, or touches
  `$XDG_DATA_HOME/dorothy`, `$XDG_CACHE_HOME/dorothy` or
  `$XDG_STATE_HOME/dorothy`: every root, key and environment is passed
  in. Probes run `claude` against a loopback stand-in only, with the
  session's `CLAUDE_CODE_*` variables and `CLAUDECODE` unset and every
  Dorothy process given temporary XDG directories.
- Chat's server is `memory`; Claude Code's is exactly `dorothy-memory`
  (`CLAUDE_SERVER_NAME`).
- `remember` writes with writer `dorothy` and origin `dorothy`, never
  higher; it refuses a fact whose origin is `user` or `repo`, and a
  correction of a retired fact.
- `--mcp-config` and `--settings` are passed in their `=` form.
- `claude` gets `CLAUDE_CODE_DISABLE_AUTO_MEMORY=1` whenever
  `[memory] enabled` is true; with it false, `dorothy --claude` runs
  exactly as it does today.
- `claude` still loads no `.env`; nothing secret goes in a flag.
- The package graph is unchanged: `gateway` never imports `memory`;
  `memory` depends on `core` alone; the CLI lazy-loads `@dorothy/memory`.
- Agent guides: the root `AGENTS.md` at most 100 lines (it is at 100),
  each package's at most 150 (`memory`'s is at 150), `docs/AGENTS.md`
  60; `agents.test.ts` enforces them.
- Every commit passes `bun run check`.

## Review Focus

- **The user's own `--settings` or `--mcp-config`.** `dorothy --claude
  --settings ./mine.json` must keep the user's settings and still let
  her tools run without a prompt, and a user's MCP servers still load.
  Probed in Task 1, pinned in Task 8.
- **A prompt after the flags.** `dorothy --claude -p "hi"` must still
  send `hi`: Dorothy's variadic `--mcp-config` must not take it. Probed
  in Task 1, pinned in Task 8.
- **A tag only facts carry, or only hidden conversations.** A search by
  it finds the facts, and a tag only hidden conversations carry is still
  "No tag by that name". Pinned in Task 3.
- **The user edits a fact while she writes it.** The origin is checked
  under the store's lock, so a user's write that lands first is never
  overwritten. Pinned in Task 4.
- **Outside a repository.** `dorothy --claude` and chat in a directory
  that is no git repository start without a sync error, and `remember`
  with `scope: "project"` is refused with a reason. Pinned in Tasks 4, 8
  and 10.

## Rulings on the spec

Made while planning; Task 11 records them in the report and amends the
spec.

- **The resumed session's conversation is left out by Recording.**
  Finding a session's conversation needs `conversation_sessions`, the
  recording plan's, and before Recording no Claude Code session is ever
  recorded, so Delivery's block leaves nothing out.
- **Search results come as `{ facts, moreFacts, results, more }`**, facts
  first, each group capped at `limit`; a search lookup records
  conversations in `hits` and facts in `facts`.
- **Open's fact result** is `OpenFactResult`: id, scope, name, type,
  title, description, keywords (concept labels), importance, provenance,
  retired, body. A fact read's target in the index's `reads` is its id.
- **A tag is hers to see** when a visible conversation or a fact carries
  it, or nothing does yet.
- **Chat's `remember`** reaches the chat as a `remember` conversation
  event, recorded with `toolEntry` as tool `mcp__memory__remember`,
  `memory: true`, and shown as a dim line, as a lookup is.
- **`--recall-server` flags** come in any order: `[--exclude <phrase>]
  [--project <root>] [--recollect]`, `--recollect` only with
  `--exclude`.
- **History in the recall server and `syncDirectory`** is
  `commandHistory({ remindMirror: false })`: swept, committing, never
  pushing or reminding of the mirror.
- **Sync in chat** runs one at a time; a sync asked for while one runs
  runs once after it. Without the index and history there is no lock,
  and chat does not sync.

## File Structure

- `packages/core/src/contracts/recall.ts`, `recall.test.ts`,
  `session.ts`: tool names, search and open shapes, `remember`.
- `packages/memory/src/recall/query.ts`, `query.test.ts`, `tags.ts`:
  facts in `search`, `openFact`.
- `packages/memory/src/transcript.ts`, `transcript.test.ts`,
  `recall/sync.ts`, `memory/review.ts`, `memory/review.test.ts`: fact
  reads.
- `packages/memory/src/facts/store.ts`, `store.test.ts`: `Guard`.
- `packages/memory/src/recall/remember.ts`, `remember.test.ts`: new.
- `packages/memory/src/recall/server.ts`, `server.test.ts`,
  `history/commands.ts`, `commands.test.ts`: the server.
- `packages/memory/src/bodies/launch.ts`, `launch.test.ts`, `AGENTS.md`:
  new; `packages/memory/src/index.ts`: exports.
- `packages/gateway/src/anthropic.ts`, `server.ts` and their tests.
- `packages/cli/src/claude.ts`, `claude-dump.ts`, `index.ts`,
  `recall-launch.ts`, `run-tui.ts` and their tests.
- `packages/agent/src/conversation.ts`, `persona.ts` and their tests.
- `packages/memory/src/memory/record.ts`, `open.ts`,
  `compaction/session.ts` and their tests.
- `packages/tui/src/state.ts`, `state.test.ts`.
- Package `AGENTS.md` files; `docs/reports/2026-10-15-memory-bodies.md`
  and its directory; the spec.

## Branch

Commit this plan on `docs/memory-bodies` as
`docs/plans/2026-10-15-memory-bodies-delivery.md`
(`docs: Plan the delivery of Dorothy's memory to her bodies`), then work
on a new branch `feat/memory-delivery` from it, in the main checkout or
a worktree (the `worktrees` skill).

---

### Task 1: The probes

Fixes how Claude Code takes repeated flags and auto memory before code
depends on them. Spends no tokens: a loopback stand-in answers.

**Files:**

- Create: `docs/reports/2026-10-15-memory-bodies.md`
- Create: `docs/reports/2026-10-15-memory-bodies/auto-memory.json`,
  `flags.json`

**Interfaces:**

- Produces: the decisions in Step 6, which Task 8's `MERGED` constant
  and settings follow.

- [ ] **Step 1: Write the stand-in, outside the repository**

`P=/tmp/claude-1000/dorothy-delivery-probe` throughout. `$P/standin.ts`:

```ts
// Records each POST .../messages body, never a header. A request whose
// tools include the probe's MCP tools, with no tool result yet, is
// answered with a call to both; any other is answered with "done".
const out = process.argv[2] ?? "/tmp/claude-1000/dorothy-delivery-probe/out";
const CALLS = ["mcp__dorothy-memory__tags", "mcp__probe-b__tags"];
let count = 0;
const sse = (events: object[]) =>
    new Response(
        events
            .map((e) => `event: ${(e as { type: string }).type}\ndata: ${JSON.stringify(e)}\n\n`)
            .join(""),
        { headers: { "content-type": "text/event-stream" } },
    );
const start = {
    type: "message_start",
    message: {
        id: "msg_probe", type: "message", role: "assistant",
        model: "claude-probe", content: [], stop_reason: null,
        stop_sequence: null, usage: { input_tokens: 1, output_tokens: 1 },
    },
};
const end = (reason: string) => [
    { type: "message_delta", delta: { stop_reason: reason, stop_sequence: null }, usage: { output_tokens: 1 } },
    { type: "message_stop" },
];
const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    async fetch(request) {
        const { pathname } = new URL(request.url);
        if (request.method !== "POST" || !pathname.endsWith("/messages")) {
            return Response.json({});
        }
        count += 1;
        const body = (await request.json().catch(() => ({}))) as {
            tools?: { name?: string }[];
            messages?: { content?: unknown }[];
        };
        await Bun.write(`${out}/request-${count}.json`, JSON.stringify(body));
        const tools = (body.tools ?? []).map((tool) => tool.name);
        const answered = JSON.stringify(body.messages?.at(-1) ?? {}).includes("tool_result");
        if (!answered && CALLS.some((name) => tools.includes(name))) {
            return sse([
                start,
                ...CALLS.flatMap((name, index) => [
                    { type: "content_block_start", index, content_block: { type: "tool_use", id: `toolu_${index}`, name, input: {} } },
                    { type: "content_block_delta", index, delta: { type: "input_json_delta", partial_json: "{}" } },
                    { type: "content_block_stop", index },
                ]),
                ...end("tool_use"),
            ]);
        }
        return sse([
            start,
            { type: "content_block_start", index: 0, content_block: { type: "text", text: "" } },
            { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "done" } },
            { type: "content_block_stop", index: 0 },
            ...end("end_turn"),
        ]);
    },
});
console.log(server.port);
```

- [ ] **Step 2: A runner that keeps the session and Dorothy's data out**

`$P/run.sh`:

```sh
#!/usr/bin/env bash
# run.sh <outdir> <claude args...>: claude against the stand-in, the
# session's variables unset, in an empty directory.
set -u
P=/tmp/claude-1000/dorothy-delivery-probe
out=$1; shift
mkdir -p "$out" "$P/cwd"
bun "$P/standin.ts" "$out" >"$P/port" &
pid=$!
sleep 1
unset CLAUDECODE $(env | grep -o '^CLAUDE_CODE_[A-Z_]*')
(cd "$P/cwd" &&
    ANTHROPIC_BASE_URL="http://127.0.0.1:$(cat "$P/port")" \
        ENABLE_TOOL_SEARCH=0 \
        timeout 120 claude -p --no-session-persistence "$@") \
    >"$out/stdout.txt" 2>"$out/stderr.txt" || true
kill "$pid"
```

And the two MCP configs and settings, each server the real recall
server on temporary XDG directories (`R` is the repository root):

```sh
P=/tmp/claude-1000/dorothy-delivery-probe
R=/home/chewygumxx/dev/dorothy
mkdir -p "$P/xdg"
server() {
    jq -nc --arg name "$1" --arg bun "$(command -v bun)" \
        --arg entry "$R/packages/cli/src/index.ts" --arg x "$P/xdg" \
        '{mcpServers: {($name): {type: "stdio", command: $bun,
          args: [$entry, "--recall-server"],
          env: {XDG_DATA_HOME: $x, XDG_CACHE_HOME: $x,
                XDG_CONFIG_HOME: $x, XDG_STATE_HOME: $x}}}}'
}
server dorothy-memory >"$P/mcp-a.json"
server probe-b >"$P/mcp-b.json"
echo '{"permissions":{"allow":["mcp__dorothy-memory__tags"]}}' >"$P/settings-a.json"
echo '{"permissions":{"allow":["mcp__probe-b__tags"]}}' >"$P/settings-b.json"
chmod +x "$P/run.sh"
```

- [ ] **Step 3: Probe repeated flags, permissions and the prompt**

```sh
P=/tmp/claude-1000/dorothy-delivery-probe
"$P/run.sh" "$P/both" \
    --settings="$(cat "$P/settings-a.json")" --settings="$(cat "$P/settings-b.json")" \
    --mcp-config="$P/mcp-a.json" --mcp-config="$P/mcp-b.json" hi
"$P/run.sh" "$P/one" \
    --settings="$(cat "$P/settings-a.json")" --mcp-config="$P/mcp-a.json" hi
ls "$P/both" "$P/one"
```

Expected: `request-*.json` files in each. A run whose claude exits
non-zero still leaves its requests.

- [ ] **Step 4: Probe auto memory against a settings file**

```sh
P=/tmp/claude-1000/dorothy-delivery-probe
mkdir -p "$P/cwd/.claude"
echo '{"autoMemoryEnabled":true}' >"$P/cwd/.claude/settings.json"
"$P/run.sh" "$P/memory-on" --settings='{"autoMemoryEnabled":true}' hi
CLAUDE_CODE_DISABLE_AUTO_MEMORY=1 \
    "$P/run.sh" "$P/memory-off" --settings='{"autoMemoryEnabled":true}' hi
rm -r "$P/cwd/.claude"
```

- [ ] **Step 5: Summarise, without anything personal**

```sh
P=/tmp/claude-1000/dorothy-delivery-probe
D=docs/reports/2026-10-15-memory-bodies
mkdir -p "$D"
first='[.[] | select((.tools // []) | length > 0)][0]'
calls='[.[] | .messages[]? | .content[]? | select(.type? == "tool_result")
    | {id: .tool_use_id, is_error: (.is_error // false),
       denied: ((.content | tostring) | test("permission|grant"; "i"))}]'
for run in both one; do
    jq -s "{servers: ($first | [.tools[].name | select(startswith(\"mcp__\"))
              | split(\"__\")[1]] | unique),
            prompt_kept: ($first | .messages[0] | tostring | contains(\"hi\")),
            results: ($calls | unique)}" "$P/$run"/request-*.json
done | jq -s '{both: .[0], one: .[1]}' >"$D/flags.json"
for run in memory-on memory-off; do
    jq -s '[.[] | .system | tostring | test("auto memory"; "i")] | any' \
        "$P/$run"/request-*.json
done | jq -s '{on_with_settings: .[0], off_with_env: .[1]}' >"$D/auto-memory.json"
cat "$D"/*.json
grep -c 'chewygumxx\|/home/' "$D"/*.json || true
```

Expected: the last command prints `0` for each file.

- [ ] **Step 6: Decide**

- `flags.json`'s `both.servers` lists `dorothy-memory` and `probe-b`:
  repeated `--mcp-config` flags accumulate, and Task 8 leaves the user's
  own `--mcp-config` as given. If it lists only `probe-b`, Task 8's
  `MERGED` holds `MCP_CONFIG` too.
- In `both.results`, `toolu_0` (`dorothy-memory`) not `denied`:
  repeated `--settings` merge, and Task 8's `MERGED` is empty. If
  `toolu_0` is denied and `toolu_1` is not: the last wins, and `MERGED`
  holds `SETTINGS`, as written.
- `one.results` has `toolu_0` not denied: permissions from `--settings`
  let her tool run without a prompt. If denied, stop and report to the
  user: the spec's permissions need revising.
- `prompt_kept` true in both: the `=` form keeps the prompt. If false,
  stop and report.
- `auto-memory.json`: `on_with_settings` true and `off_with_env` false:
  the variable wins over a settings file. If `off_with_env` is true,
  Task 8 adds `"autoMemoryEnabled": false` to Dorothy's settings object
  and passes `--settings` whenever memory is on. If `on_with_settings`
  is false the phrase did not match: find the auto-memory section's
  heading in `$P/memory-on/request-1.json` by eye (do not commit it) and
  repeat Step 5 with it.

- [ ] **Step 7: Begin the report**

`docs/reports/2026-10-15-memory-bodies.md`, with the frontmatter and
breadcrumb copied from `docs/reports/2026-10-15-identity-gateway.md`
(title `Dorothy's memory in her bodies report`, description `How
Dorothy's memory reached Claude Code and chat: the probes, the rulings,
the verification and what is left.`, tags `dorothy`, `memory`,
`report`), then:

```markdown
# Dorothy's memory in her bodies report

## Summary

Written last.

## Delivery probes

### Repeated flags and permissions

Command: Steps 1 to 3 and 5 of the delivery plan's Task 1.
Output: [flags.json](./2026-10-15-memory-bodies/flags.json).

<what both and one show, and the decisions taken>

### Auto memory

Command: Steps 4 and 5 of the delivery plan's Task 1.
Output: [auto-memory.json](./2026-10-15-memory-bodies/auto-memory.json).

<what it shows, and the decision taken>

## Rulings

## Verification

## Known limitations
```

Fill the two `<...>` paragraphs with what the JSON shows.

- [ ] **Step 8: Commit**

```bash
git add docs/reports/2026-10-15-memory-bodies.md docs/reports/2026-10-15-memory-bodies
git commit -m "docs: Probe Claude Code's flags and auto memory for delivery"
```

---

### Task 2: The memory tools' contracts

**Files:**

- Modify: `packages/core/src/contracts/recall.ts`
- Modify: `packages/core/src/contracts/session.ts`
- Test: `packages/core/src/contracts/recall.test.ts`

**Interfaces:**

- Produces (all from `@dorothy/core`):
  - `CLAUDE_SERVER_NAME = "dorothy-memory"`, `REMEMBER = "remember"`,
    `REMEMBER_TOOL = "mcp__memory__remember"`, `ALLOWED_TOOLS` (chat's,
    now with `mcp__memory__remember`), `CLAUDE_ALLOWED_TOOLS`
    (`mcp__dorothy-memory__{search,open,tags,remember}`).
  - `SEARCH_KINDS`, `SearchKind`, `SearchInput.kind?`, `FactHit`,
    `SearchResult = { facts: FactHit[]; moreFacts: number; results:
    SearchHit[]; more: number }`.
  - `OpenInput = { conversation?; fact?; purpose; turn? }`,
    `OpenFactResult`.
  - `SearchLookup.kind?`, `SearchLookup.facts?`; `OpenLookup` is
    `{ conversation }` or `{ fact }`, each with `name`, `purpose`,
    `turns`.
  - `RememberInput`, `RememberResult`.
  - `ConversationEvent` gains `{ type: "remember"; id: string; ok:
    boolean; offset: number; input: unknown; output: string }`.

- [ ] **Step 1: Write the failing tests**

Append to `recall.test.ts` (import `ALLOWED_TOOLS`,
`CLAUDE_ALLOWED_TOOLS`, `REMEMBER_TOOL`, `toolOf` beside what it
imports):

```ts
describe("the memory tools' names", () => {
    it("gives chat remember, and Claude Code a server of its own", () => {
        expect(ALLOWED_TOOLS).toEqual([
            "mcp__memory__search",
            "mcp__memory__open",
            "mcp__memory__tags",
            "mcp__memory__remember",
        ]);
        expect(CLAUDE_ALLOWED_TOOLS).toEqual([
            "mcp__dorothy-memory__search",
            "mcp__dorothy-memory__open",
            "mcp__dorothy-memory__tags",
            "mcp__dorothy-memory__remember",
        ]);
        expect(REMEMBER_TOOL).toBe("mcp__memory__remember");
    });

    it("never takes remember for a lookup", () => {
        expect(toolOf(REMEMBER_TOOL)).toBeNull();
    });
});

describe("describeLookup over facts", () => {
    it("counts a search's facts apart, and keeps its kind", () => {
        const result = JSON.stringify({
            facts: [{ id: "personal/tea" }],
            moreFacts: 2,
            results: [],
            more: 0,
        });
        expect(
            describeLookup("search", { query: "tea", kind: "facts" }, result),
        ).toEqual({ tool: "search", query: "tea", kind: "facts", hits: 0, facts: 3 });
    });

    it("records no facts for a search of conversations alone", () => {
        const result = JSON.stringify({ facts: [], moreFacts: 0, results: [], more: 0 });
        expect(
            describeLookup("search", { query: "x", kind: "conversations" }, result),
        ).toEqual({ tool: "search", query: "x", kind: "conversations", hits: 0 });
    });

    it("names an opened fact by its title", () => {
        const result = JSON.stringify({ id: "personal/tea", title: "Tea at four" });
        expect(
            describeLookup("open", { fact: "personal/tea", purpose: "her tea" }, result),
        ).toEqual({
            tool: "open",
            fact: "personal/tea",
            name: "Tea at four",
            purpose: "her tea",
            turns: null,
        });
        expect(
            describeLookup("open", { fact: "personal/tea", purpose: "p" }, null),
        ).toEqual({ tool: "open", fact: "personal/tea", name: "personal/tea", purpose: "p", turns: null });
    });
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `bun test packages/core/src/contracts/recall.test.ts`
Expected: FAIL (`CLAUDE_ALLOWED_TOOLS` is not exported; `facts` absent).

- [ ] **Step 3: Implement**

In `recall.ts`, replace the names at the top (lines 11-31) with:

```ts
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

const PREFIX = `mcp__${SERVER_NAME}__`;

// A lookup's name as the model calls it, or null for any other tool,
// remember among them.
export function toolOf(name: string): Tool | null {
    const tool = name.startsWith(PREFIX) ? name.slice(PREFIX.length) : "";
    return (TOOLS as readonly string[]).includes(tool) ? (tool as Tool) : null;
}
```

Replace `SearchInput` and `OpenInput` with:

```ts
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
```

```ts
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
```

Replace `SearchResult` with:

```ts
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
};
// Two groups, each ranked and capped at the limit: FTS5's scores from
// two tables do not compare.
export type SearchResult = {
    facts: FactHit[];
    moreFacts: number;
    results: SearchHit[];
    more: number;
};
```

After `OpenResult` add:

```ts
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
};
```

Replace `SearchLookup` and `OpenLookup` with:

```ts
// hits counts conversations; facts counts facts, when facts were
// searched.
export type SearchLookup = {
    tool: "search";
    query: string;
    tags?: string[];
    after?: string;
    before?: string;
    kind?: SearchKind;
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
```

In `describeLookup`'s search branch, after the tags block, replace the
`found` lines with:

```ts
        if (fields.kind === "conversations" || fields.kind === "facts") {
            lookup.kind = fields.kind;
        }
        const found = parse<SearchResult>(result);
        if (Array.isArray(found?.results) && typeof found.more === "number") {
            lookup.hits = found.results.length + found.more;
        }
        if (
            lookup.kind !== "conversations" &&
            Array.isArray(found?.facts) &&
            typeof found.moreFacts === "number"
        ) {
            lookup.facts = found.facts.length + found.moreFacts;
        }
        return lookup;
```

Replace the open branch at the end with:

```ts
    const purpose = textOf(fields.purpose);
    if (typeof fields.fact === "string") {
        const fact = fields.fact;
        const opened = parse<OpenFactResult>(result);
        return {
            tool,
            fact,
            name: typeof opened?.title === "string" ? opened.title : fact,
            purpose,
            turns: null,
        };
    }
    const conversation = textOf(fields.conversation);
    const opened = parse<OpenResult>(result);
    return {
        tool,
        conversation,
        name: typeof opened?.name === "string" ? opened.name : conversation,
        purpose,
        turns: windowRange(opened?.window),
    };
```

In `session.ts`, after the `lookup` member of `ConversationEvent`, add:

```ts
    // A call to remember: its input as the model gave it and the tool's
    // text, the reason when it failed; offset as a lookup's.
    | {
          type: "remember";
          id: string;
          ok: boolean;
          offset: number;
          input: unknown;
          output: string;
      }
```

- [ ] **Step 4: Run the tests, then the whole check**

Run: `bun test packages/core/src/contracts/recall.test.ts`
Expected: PASS.

Run: `bun run check`
Expected: type errors in `memory` (`sync.ts`, `review.ts`,
`transcript.ts`, `query.ts`, `record.ts`, `compaction/session.ts`),
`tui` (`state.ts`) and `agent` where they read `conversation` from an
open lookup, or switch over `ConversationEvent`. Make each compile
without new behaviour, so this commit stands alone:

- `memory/src/transcript.ts` `toRecall`: the open branch builds the
  `{ conversation }` form as before (Task 3 adds facts).
- `memory/src/recall/sync.ts` `applyLines`: guard the read with
  `recall?.tool === "open" && recall.ok && "conversation" in recall`.
- `memory/src/memory/review.ts` `pendingReads`: add
  `"conversation" in lookup &&` to the condition.
- `memory/src/recall/query.ts`: `search` returns `facts: []` and
  `moreFacts: 0` before `results`; `openConversation` takes
  `input: OpenInput & { conversation: string }`.
- `memory/src/recall/server.ts`: the `open` handler throws
  `new RecallError("Give a conversation to open.")` when
  `input.conversation` is undefined, else passes
  `{ ...input, conversation: input.conversation }`.
- Any `switch` over `ConversationEvent` that the compiler finds
  non-exhaustive gains `case "remember":` beside `case "lookup":`
  returning the state unchanged (Task 9 gives it behaviour).

Fix test fixtures that build a `SearchResult` to add `facts: []` and
`moreFacts: 0`. Run `bun run check` again.
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages
git commit -m "feat(core): Name remember, facts in search and open, and Claude Code's server"
```

---

### Task 3: Facts in `search` and `open`

**Files:**

- Modify: `packages/memory/src/recall/query.ts`, `tags.ts`
- Modify: `packages/memory/src/transcript.ts`, `recall/sync.ts`,
  `memory/review.ts`
- Test: `packages/memory/src/recall/query.test.ts`,
  `transcript.test.ts`, `memory/review.test.ts`

**Interfaces:**

- Consumes: Task 2's types.
- Produces:
  - `search(index, input, options: QueryOptions)` with
    `QueryOptions = { exclude: string | null; now: number; halfLifeDays:
    number; project?: string | null }`, returning `SearchResult`.
  - `openFact(index: RecallIndex, input: OpenInput, root: string):
    Promise<OpenFactResult>`; `NO_FACT = "No fact by that name."`.
  - `factCarriers(index): { id: string; path: string }[]` and
    `conceptLabels(index, ids: readonly string[]): string[]` in
    `tags.ts`.
  - A successful fact open is a read whose `target` is the fact's id;
    `PendingRead` gains `fact: boolean`.

- [ ] **Step 1: Write the failing tests**

In `query.test.ts`, import `putFact`, `PERSONAL`, `type Scope` from
`../facts/store.js`, `type Fact` from `../facts/file.js`, and `NO_FACT`,
`NO_TAG`, `openFact` from `./query.js`. Then append:

```ts
const PROJECT: Scope = { kind: "project", id: "github.com/u/here" };
const OTHER: Scope = { kind: "project", id: "github.com/u/there" };
const fact = (name: string, fields: Partial<Fact> = {}): Fact => ({
    name,
    title: `About ${name}`,
    description: `What she knows of ${name}.`,
    type: "user",
    extra: {},
    tags: [],
    importance: null,
    provenance: { origin: "dorothy", by: "dorothy", at: day(5), created: day(5) },
    retired: null,
    body: "Body.",
    ...fields,
});
const syncFactsToo = () => syncIndex(index, dir, Date.parse(day(20)), null, dir);
const withProject = { ...OPTIONS, project: PROJECT.id };

describe("search over facts", () => {
    beforeEach(async () => {
        await putFact(dir, PERSONAL, fact("tea", { body: "She drinks render tea." }));
        await putFact(dir, PROJECT, fact("gateway", { type: "project", body: "The render gateway." }));
        await putFact(dir, OTHER, fact("cache", { body: "A render cache elsewhere." }));
        await putFact(
            dir,
            PERSONAL,
            fact("coffee", {
                body: "Render coffee, given up.",
                retired: { at: day(6), by: "user", why: "Stopped." },
            }),
        );
        await syncFactsToo();
    });

    it("finds facts first, live ones, then personal and this project's", () => {
        const found = search(index, { query: "render" }, withProject);
        const ids = found.facts.map((hit) => [hit.id, hit.retired ?? false]);
        // The two near ones rank by match, which this does not pin.
        expect(ids.slice(0, 2).sort()).toEqual([
            ["github.com/u/here/gateway", false],
            ["personal/tea", false],
        ]);
        expect(ids.slice(2)).toEqual([
            ["github.com/u/there/cache", false],
            ["personal/coffee", true],
        ]);
        expect(found.results.map((hit) => hit.identifier)).toContain(A);
        expect(Object.keys(found)).toEqual(["facts", "moreFacts", "results", "more"]);
    });

    it("gives a fact's fields and a snippet", () => {
        const [hit] = search(index, { query: "tea", kind: "facts" }, withProject).facts;
        expect(hit).toEqual({
            id: "personal/tea",
            scope: "personal",
            type: "user",
            title: "About tea",
            description: "What she knows of tea.",
            origin: "dorothy",
            snippet: expect.stringContaining("«tea»"),
        });
    });

    it("searches one group alone by kind, and caps each at the limit", () => {
        expect(search(index, { query: "render", kind: "conversations" }, withProject).facts).toEqual([]);
        expect(search(index, { query: "render", kind: "facts" }, withProject).results).toEqual([]);
        const capped = search(index, { query: "render", limit: 1 }, withProject);
        expect([capped.facts.length, capped.moreFacts]).toEqual([1, 3]);
        expect(() =>
            search(index, { query: "x", kind: "notes" as "facts" }, withProject),
        ).toThrow("kind must be conversations or facts.");
    });

    it("bounds facts by their creation", () => {
        const found = search(index, { query: "render", kind: "facts", after: "2026-10-06" }, withProject);
        expect(found.facts).toEqual([]);
    });
});

describe("search by a tag facts carry", () => {
    beforeEach(async () => {
        await writeFile(
            join(dir, "tags.json"),
            JSON.stringify({
                v: 1,
                rev: 1,
                concepts: {
                    k00000001: { prefLabel: "drinks", scopeNote: "What she drinks.", by: "dorothy", at: day(1) },
                    k00000002: { prefLabel: "secret", scopeNote: "Hidden only.", by: "dorothy", at: day(1) },
                },
            }),
        );
        await putFact(dir, PERSONAL, fact("tea", { tags: ["k00000001"] }));
        await conversation(C, [session(day(12)), user(day(12), "render me a poem")], {
            title: "Poetry",
            hidden: true,
            tags: ["k00000002"],
        });
        await syncIndex(index, dir, Date.parse(day(20)), join(dir, "tags.json"), dir);
    });

    it("finds the facts a tag only facts carry", () => {
        const found = search(index, { tags: ["drinks"] }, withProject);
        expect(found.facts.map((hit) => hit.id)).toEqual(["personal/tea"]);
        expect(found.results).toEqual([]);
    });

    it("still knows no tag only hidden conversations carry", () => {
        expect(() => search(index, { tags: ["secret"] }, withProject)).toThrow(
            `${NO_TAG}: secret.`,
        );
    });
});

describe("openFact", () => {
    it("opens the whole fact", async () => {
        await putFact(dir, PERSONAL, fact("tea", { body: "Four o'clock." }));
        await syncFactsToo();
        expect(
            await openFact(index, { fact: "personal/tea", purpose: "her tea" }, dir),
        ).toEqual({
            id: "personal/tea",
            scope: "personal",
            name: "tea",
            type: "user",
            title: "About tea",
            description: "What she knows of tea.",
            keywords: [],
            importance: null,
            provenance: { origin: "dorothy", by: "dorothy", at: day(5), created: day(5) },
            retired: null,
            body: "Four o'clock.",
        });
    });

    it("relays a fact that is not there, and asks for a purpose", async () => {
        await expect(
            openFact(index, { fact: "personal/none", purpose: "p" }, dir),
        ).rejects.toThrow(NO_FACT);
        await expect(openFact(index, { fact: "nonsense", purpose: "p" }, dir)).rejects.toThrow(
            NO_FACT,
        );
        await expect(openFact(index, { fact: "personal/tea", purpose: " " }, dir)).rejects.toThrow(
            "Say in purpose what you hope to find.",
        );
    });
});
```

In `transcript.test.ts`, beside the existing `toRecall` tests, add:

```ts
it("reads a fact's open and a search's facts", () => {
    const base = { v: 1, kind: "recall", at: "2026-10-15T00:00:00.000Z", id: "r1", ok: true, offset: 0 };
    expect(
        toRecall({ ...base, tool: "open", fact: "personal/tea", name: "Tea", purpose: "p", turns: null }),
    ).toEqual({ ...base, tool: "open", fact: "personal/tea", name: "Tea", purpose: "p", turns: null });
    expect(
        toRecall({ ...base, tool: "search", query: "q", kind: "facts", hits: 0, facts: 2 }),
    ).toEqual({ ...base, tool: "search", query: "q", kind: "facts", hits: 0, facts: 2 });
});
```

In `review.test.ts`, beside the existing `pendingReads` tests, add:

```ts
it("awaits the appraisal of a fact's read, named by its title", () => {
    const turns: ResumedTurn[] = [
        { role: "user", text: "tea?" },
        {
            role: "assistant",
            text: "Yes.",
            lookups: [
                {
                    v: 1, kind: "recall", at: "2026-10-15T00:00:00.000Z", id: "r1",
                    ok: true, offset: 0, tool: "open", fact: "personal/tea",
                    name: "Tea at four", purpose: "her tea", turns: null,
                },
            ],
        },
    ];
    const reads = pendingReads(turns, {}, () => "unused");
    expect(reads).toEqual([
        { id: "r1", name: "Tea at four", purpose: "her tea", turns: null, fact: true },
    ]);
    expect(reviewPrompt(turns, null, reads)).toContain(
        '<read id="r1" fact="Tea at four">her tea</read>',
    );
});
```

Existing `pendingReads` expectations gain `fact: false`.

- [ ] **Step 2: Run them to see them fail**

Run:

```bash
bun test packages/memory/src/recall/query.test.ts packages/memory/src/transcript.test.ts packages/memory/src/memory/review.test.ts
```

Expected: FAIL (`openFact` is not exported; facts are `[]`).

- [ ] **Step 3: Add the fact helpers to `tags.ts`**

```ts
// Each live concept with every fact that carries it or anything
// narrower, merged ids followed, as carriers walks conversations.
export function factCarriers(index: RecallIndex): { id: string; path: string }[] {
    return index.db
        .query(
            `WITH RECURSIVE under (ancestor, id) AS (
                SELECT id, id FROM concepts
                UNION
                SELECT u.ancestor, b.id FROM under u
                JOIN broader b ON b.parent = u.id
            )
            SELECT DISTINCT u.ancestor AS id, ft.path AS path
            FROM fact_tags ft
            LEFT JOIN merged m ON m.id = ft.id
            JOIN under u ON u.id = coalesce(m.into_id, ft.id)`,
        )
        .all() as { id: string; path: string }[];
}

// The preferred labels of concepts by id, in order, merges followed; an
// id naming no live concept is left out.
export function conceptLabels(index: RecallIndex, ids: readonly string[]): string[] {
    const label = index.db.query(
        `SELECT c.label AS label FROM concepts c
         WHERE c.id = coalesce((SELECT into_id FROM merged WHERE id = ?), ?)`,
    );
    const labels = ids.flatMap((id) => {
        const row = label.get(id, id) as { label: string } | null;
        return row === null ? [] : [row.label];
    });
    return [...new Set(labels)];
}
```

- [ ] **Step 4: Implement facts in `query.ts`**

Imports: add `FactHit`, `OpenFactResult`, `SEARCH_KINDS` from
`@dorothy/core`; `factPath`, `parseTarget`, `readFactFile`, `scopeLabel`
from `../facts/store.js`; `conceptLabels`, `factCarriers`,
`type CarrierRow` from `./tags.js`. Add
`export const NO_FACT = "No fact by that name.";` beside `NOT_FOUND`,
and `project?: string | null;` to `QueryOptions`.

Replace `taggedWith` with:

```ts
// Each label's concept, a mistake to relay unless she may see it: a
// visible conversation or a fact carries it, or nothing does yet.
function conceptsOf(
    index: RecallIndex,
    labels: readonly string[],
    exclude: string,
    rows: readonly CarrierRow[],
    facts: readonly { id: string }[],
): string[] {
    const listed = listedConcepts(index, exclude, rows);
    const ofFacts = new Set(facts.map((row) => row.id));
    return labels.map((label) => {
        const id = conceptByLabel(index, label);
        if (id === null || !(listed.has(id) || ofFacts.has(id))) {
            throw new RecallError(`${NO_TAG}: ${label}.`);
        }
        return id;
    });
}

// What carries every one of the concepts, from [concept, carrier] pairs.
function carryingAll(
    pairs: readonly (readonly [string, string])[],
    ids: readonly string[],
): Set<string> {
    let allowed: Set<string> | null = null;
    for (const id of ids) {
        const keys = new Set(pairs.filter(([of]) => of === id).map(([, key]) => key));
        const before: Set<string> | null = allowed;
        allowed =
            before === null ? keys : new Set([...before].filter((key) => keys.has(key)));
    }
    return allowed ?? new Set();
}
```

Add the fact search:

```ts
type FactRow = {
    path: string;
    scope: string;
    name: string;
    title: string;
    description: string;
    type: string;
    origin: string;
    retired: number;
    score: number;
    snippet: string;
};
const FACT_COLUMNS =
    "f.path AS path, f.scope AS scope, f.name AS name, f.title AS title, f.description AS description, f.type AS type, f.origin AS origin, f.retired AS retired";

// BM25 is lower for a better match; the snippet is from whichever of
// title, description and body matched best.
function findFacts(index: RecallIndex, expression: string, from: number, to: number): FactRow[] {
    return index.db
        .query(
            `SELECT ${FACT_COLUMNS}, bm25(facts_fts) AS score,
                snippet(facts_fts, -1, '«', '»', '…', ${SNIPPET_TOKENS}) AS snippet
             FROM facts_fts JOIN facts f ON f.rowid = facts_fts.rowid
             WHERE facts_fts MATCH ? AND f.created BETWEEN ? AND ?`,
        )
        .all(expression, from, to) as FactRow[];
}

// Facts found by tags alone, created within the dates.
function factsAt(index: RecallIndex, paths: ReadonlySet<string>, from: number, to: number): FactRow[] {
    const row = index.db.query(
        `SELECT ${FACT_COLUMNS}, 0 AS score, '' AS snippet FROM facts f
         WHERE f.path = ? AND f.created BETWEEN ? AND ?`,
    );
    return [...paths].flatMap((path) => {
        const found = row.get(path, from, to) as FactRow | null;
        return found === null ? [] : [found];
    });
}

const factHit = (row: FactRow): FactHit => ({
    id: `${row.scope}/${row.name}`,
    scope: row.scope,
    type: row.type,
    title: row.title,
    description: row.description,
    origin: row.origin,
    snippet: row.snippet,
    ...(row.retired !== 0 ? { retired: true as const } : {}),
});

// Live facts before retired ones, personal and this project's before
// other projects', then by match.
function searchFacts(
    index: RecallIndex,
    terms: readonly string[],
    allowed: ReadonlySet<string> | null,
    span: { from: number; to: number; limit: number },
    project: string | null,
): Pick<SearchResult, "facts" | "moreFacts"> {
    const within = (rows: FactRow[]) =>
        allowed === null ? rows : rows.filter((row) => allowed.has(row.path));
    let rows =
        terms.length === 0
            ? factsAt(index, allowed ?? new Set(), span.from, span.to)
            : within(findFacts(index, terms.join(" "), span.from, span.to));
    if (rows.length === 0 && terms.length > 1) {
        rows = within(findFacts(index, terms.join(" OR "), span.from, span.to));
    }
    const far = (scope: string) => (scope === "personal" || scope === project ? 0 : 1);
    rows.sort(
        (a, b) =>
            a.retired - b.retired ||
            far(a.scope) - far(b.scope) ||
            a.score - b.score ||
            a.path.localeCompare(b.path),
    );
    return {
        facts: rows.slice(0, span.limit).map(factHit),
        moreFacts: Math.max(0, rows.length - span.limit),
    };
}
```

Move the body of `search` from `const visits = ...` to its return into

```ts
function rankConversations(
    index: RecallIndex,
    hits: Map<string, Hit>,
    limit: number,
    broken: boolean,
    options: QueryOptions,
): Pick<SearchResult, "results" | "more"> {
    // the existing salience, sort and row mapping, unchanged
}
```

and make `search`:

```ts
export function search(
    index: RecallIndex,
    input: SearchInput,
    options: QueryOptions,
): SearchResult {
    const terms = termsOf(input.query ?? "");
    const labels = (input.tags ?? []).map(normalise).filter((label) => label !== "");
    if (terms.length === 0 && labels.length === 0) {
        throw new RecallError("Give some words or tags to search for.");
    }
    if (labels.length > MAX_TAG_FILTERS) {
        throw new RecallError(`Give at most ${MAX_TAG_FILTERS} tags.`);
    }
    const kind = input.kind;
    if (kind !== undefined && !(SEARCH_KINDS as readonly string[]).includes(kind)) {
        throw new RecallError("kind must be conversations or facts.");
    }
    const broken = vocabularyBroken(index) !== null;
    if (labels.length > 0 && broken) {
        throw new RecallError(TAGS_UNAVAILABLE);
    }
    const from = dayBound(input.after, "after");
    const to = dayBound(input.before, "before");
    const limit = clamp(input.limit, DEFAULT_LIMIT, MAX_LIMIT);
    const exclude = options.exclude ?? "";
    const rows = labels.length === 0 ? [] : carriers(index);
    const factRows = labels.length === 0 ? [] : factCarriers(index);
    const ids = conceptsOf(index, labels, exclude, rows, factRows);
    const tagged = (pairs: (readonly [string, string])[]) =>
        labels.length === 0 ? null : carryingAll(pairs, ids);
    const facts =
        kind === "conversations"
            ? { facts: [], moreFacts: 0 }
            : searchFacts(
                  index,
                  terms,
                  tagged(factRows.map((row) => [row.id, row.path] as const)),
                  { from, to, limit },
                  options.project ?? null,
              );
    if (kind === "facts") {
        return { ...facts, results: [], more: 0 };
    }
    const allowed = tagged(
        rows
            .filter((row) => !row.hidden && row.phrase !== exclude)
            .map((row) => [row.id, row.phrase] as const),
    );
    const within = (found: Map<string, Hit>) =>
        allowed === null
            ? found
            : new Map([...found].filter(([phrase]) => allowed.has(phrase)));
    let hits =
        terms.length === 0
            ? activeIn(index, allowed ?? new Set(), from, to)
            : within(findHits(index, terms.join(" "), from, to, exclude));
    if (hits.size === 0 && terms.length > 1) {
        hits = within(findHits(index, terms.join(" OR "), from, to, exclude));
    }
    return { ...facts, ...rankConversations(index, hits, limit, broken, options) };
}
```

Pull the purpose check out of `openConversation` into
`function checkPurpose(text: string): void` (the normalise, empty and
`PURPOSE_LIMIT` checks, unchanged) and call it there. Add:

```ts
export async function openFact(
    index: RecallIndex,
    input: OpenInput,
    root: string,
): Promise<OpenFactResult> {
    checkPurpose(input.purpose);
    const target = parseTarget(input.fact ?? "");
    if (target === null) {
        throw new RecallError(NO_FACT);
    }
    const read = await readFactFile(factPath(root, target.scope, target.name), target.name);
    if (read.kind === "none") {
        throw new RecallError(NO_FACT);
    }
    if (read.kind === "unparseable") {
        throw new RecallError(`That fact cannot be read: ${read.reason}`);
    }
    const { fact } = read;
    const scope = scopeLabel(target.scope);
    return {
        id: `${scope}/${fact.name}`,
        scope,
        name: fact.name,
        type: fact.type,
        title: fact.title,
        description: fact.description,
        keywords: vocabularyBroken(index) === null ? conceptLabels(index, fact.tags) : [],
        importance: fact.importance,
        provenance: fact.provenance,
        retired: fact.retired,
        body: fact.body,
    };
}
```

- [ ] **Step 5: Fact reads in the transcript, the index and reviews**

In `transcript.ts` `toRecall`, the search branch adds
`...(event.kind === "conversations" || event.kind === "facts" ? { kind:
event.kind } : {})`
and
`...(Number.isInteger(event.facts) ? { facts: event.facts as number } : {})`.
Replace the open branch with:

```ts
    if (
        event.tool === "open" &&
        typeof event.name === "string" &&
        typeof event.purpose === "string" &&
        (event.turns === null || isTurnRange(event.turns))
    ) {
        const open = {
            ...base,
            tool: "open" as const,
            name: event.name,
            purpose: event.purpose,
            turns: event.turns,
        };
        if (typeof event.conversation === "string") {
            return { ...open, conversation: event.conversation };
        }
        if (typeof event.fact === "string") {
            return { ...open, fact: event.fact };
        }
    }
```

In `recall/sync.ts` `applyLines`, record either read, its target the
conversation or the fact's id:

```ts
            if (recall?.tool === "open" && recall.ok) {
                index.db.run(
                    "INSERT OR IGNORE INTO reads (id, reader, target, at) VALUES (?, ?, ?, ?)",
                    [
                        recall.id,
                        row.phrase,
                        "fact" in recall ? recall.fact : recall.conversation,
                        at ?? row.last_at ?? 0,
                    ],
                );
            }
```

In `memory/review.ts`, `PendingRead` gains `fact: boolean;`;
`pendingReads` drops Task 2's `"conversation" in lookup` guard and maps
to:

```ts
                          name:
                              "fact" in lookup
                                  ? lookup.name
                                  : nameOf(lookup.conversation),
                          purpose: lookup.purpose,
                          turns: lookup.turns,
                          fact: "fact" in lookup,
```

and `reviewPrompt`'s read line names its kind:

```ts
                          `<read id="${escapeAttribute(read.id)}" ${read.fact ? "fact" : "conversation"}="${escapeAttribute(read.name)}"${
```

- [ ] **Step 6: Run the tests**

Run: `bun test packages/memory`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add packages/memory
git commit -m "feat(memory): Search and open facts, and appraise a fact's read"
```

---

### Task 4: `remember`

**Files:**

- Modify: `packages/memory/src/facts/store.ts`, `facts/commands.ts`
- Create: `packages/memory/src/recall/remember.ts`
- Test: `packages/memory/src/facts/store.test.ts`,
  `packages/memory/src/recall/remember.test.ts`

**Interfaces:**

- Consumes: `RememberInput`, `RememberResult` (Task 2); `RecallError`
  (Task 3's `query.ts`).
- Produces:
  - `type Guard = (current: Fact | null) => string | null` in
    `store.ts`; `writeFact(store, input, guard?)`,
    `retireFact(store, target, { by, why, guard? })`; `FactResult`
    gains `{ kind: "refused"; reason: string }`.
  - `remember(store: FactStore, input: RememberInput, options: {
    project: string | null; from: string | null }):
    Promise<RememberResult>`, throwing `RecallError` with the reason to
    relay.

- [ ] **Step 1: Write the failing tests**

In `store.test.ts`, beside the `writeFact` tests:

```ts
it("refuses a write its guard refuses, checked under the lock", async () => {
    const store = storeAt(root);
    const seen: (Fact | null)[] = [];
    const result = await writeFact(store, input("tea"), (current) => {
        seen.push(current);
        return "not now";
    });
    expect(result).toEqual({ kind: "refused", reason: "not now" });
    expect(seen).toEqual([null]);
});
```

Use the file's existing helpers for a store and a `FactInput`; if they
are named otherwise, use theirs.

`packages/memory/src/recall/remember.test.ts` (header copied from a
sibling):

```ts
import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { RememberInput } from "@dorothy/core";
import type { Fact } from "../facts/file.js";
import { type FactStore, factPath, PERSONAL, putFact, readFactFile, type Scope } from "../facts/store.js";
import type { Lock } from "../memory/sidecar.js";
import { remember } from "./remember.js";

const AT = "2026-10-15T09:30:00.000Z";
const PROJECT = "github.com/u/here";
const HERE: Scope = { kind: "project", id: PROJECT };
const OPTIONS = { project: PROJECT, from: "able-baker-charlie-delta" };

// Runs work one at a time, as the index's lock does.
function serial(): Lock {
    let chain: Promise<unknown> = Promise.resolve();
    return (work) => {
        const run = chain.then(work);
        chain = run.catch(() => {});
        return run;
    };
}

let root = "";
let commits: string[] = [];
let store: FactStore;
beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "dorothy-remember-"));
    commits = [];
    store = {
        root,
        lock: serial(),
        recorder: async (_paths, message) => {
            commits.push(message);
        },
        now: () => new Date(AT),
    };
});
afterEach(async () => {
    await rm(root, { recursive: true, force: true });
});

const write = (name: string, fields: Partial<RememberInput> = {}): RememberInput => ({
    action: "write",
    name,
    scope: "personal",
    type: "user",
    title: "Tea at four",
    description: "She takes tea at four.",
    body: "Every day at four.",
    ...fields,
});
const read = async (scope: Scope, name: string) => {
    const got = await readFactFile(factPath(root, scope, name), name);
    if (got.kind !== "ok") {
        throw new Error(got.kind);
    }
    return got.fact;
};
const theirs = (origin: "user" | "repo"): Partial<Fact> => ({
    provenance: { origin, by: origin, at: AT, created: AT },
});
const fact = (name: string, fields: Partial<Fact> = {}): Fact => ({
    name,
    title: "Theirs",
    description: "Theirs.",
    type: "user",
    extra: {},
    tags: [],
    importance: null,
    provenance: { origin: "dorothy", by: "dorothy", at: AT, created: AT },
    retired: null,
    body: "Theirs.",
    ...fields,
});

describe("remember", () => {
    it("writes a fact as hers, from this conversation, and commits it", async () => {
        expect(await remember(store, write("tea"), OPTIONS)).toEqual({
            action: "written",
            id: "personal/tea",
        });
        const tea = await read(PERSONAL, "tea");
        expect(tea.provenance).toEqual({
            origin: "dorothy",
            by: "dorothy",
            at: AT,
            created: AT,
            from: "able-baker-charlie-delta",
        });
        expect(tea.body).toBe("Every day at four.");
        expect(commits).toEqual(["fact: personal/tea"]);
    });

    it("corrects a fact of her own, and leaves from out where it is unknown", async () => {
        await remember(store, write("tea"), OPTIONS);
        expect(
            await remember(store, write("tea", { body: "At five now." }), { project: null, from: null }),
        ).toEqual({ action: "corrected", id: "personal/tea" });
        const tea = await read(PERSONAL, "tea");
        expect(tea.body).toBe("At five now.");
        expect(tea.provenance.from).toBeUndefined();
    });

    it("writes to the server's project, and refuses one without", async () => {
        expect(await remember(store, write("gateway", { scope: "project" }), OPTIONS)).toEqual({
            action: "written",
            id: `${PROJECT}/gateway`,
        });
        await expect(
            remember(store, write("gateway", { scope: "project" }), { project: null, from: null }),
        ).rejects.toThrow("There is no project here");
    });

    it("refuses the user's facts and the repository's, saying why", async () => {
        await putFact(root, PERSONAL, fact("tea", theirs("user")));
        await putFact(root, HERE, fact("style", theirs("repo")));
        await expect(remember(store, write("tea"), OPTIONS)).rejects.toThrow(
            "personal/tea is the user's",
        );
        await expect(
            remember(store, { action: "retire", name: "style", scope: "project", why: "Old." }, OPTIONS),
        ).rejects.toThrow(`${PROJECT}/style is the repository's`);
        expect((await read(PERSONAL, "tea")).title).toBe("Theirs");
    });

    it("never raises an origin: an external fact she corrects stays external", async () => {
        await putFact(root, PERSONAL, fact("page", { provenance: { origin: "external", by: "dorothy", at: AT, created: AT } }));
        await remember(store, write("page"), OPTIONS);
        expect((await read(PERSONAL, "page")).provenance.origin).toBe("external");
    });

    it("retires her own fact, and revives none by writing", async () => {
        await remember(store, write("tea"), OPTIONS);
        expect(
            await remember(store, { action: "retire", name: "tea", scope: "personal", why: "She stopped." }, OPTIONS),
        ).toEqual({ action: "retired", id: "personal/tea" });
        expect((await read(PERSONAL, "tea")).retired?.why).toBe("She stopped.");
        await expect(remember(store, write("tea"), OPTIONS)).rejects.toThrow(
            "personal/tea is retired",
        );
    });

    it("refuses what the store would, with the reason", async () => {
        await expect(remember(store, write("Bad Name"), OPTIONS)).rejects.toThrow("not a fact's name");
        await expect(remember(store, write("tea", { type: "mood" }), OPTIONS)).rejects.toThrow(
            "type must be one of user, feedback, project, reference",
        );
        await expect(remember(store, write("tea", { body: " " }), OPTIONS)).rejects.toThrow(
            "Give the fact's title, description and body.",
        );
        await expect(
            remember(store, { action: "retire", name: "tea", scope: "personal" }, OPTIONS),
        ).rejects.toThrow("Say in why");
        await expect(
            remember(store, { action: "retire", name: "none", scope: "personal", why: "x" }, OPTIONS),
        ).rejects.toThrow("There is no fact personal/none.");
    });

    it("checks the origin under the lock, so a user's write in between stands", async () => {
        const gate = Promise.withResolvers<void>();
        const held = store.lock(async () => {
            await putFact(root, PERSONAL, fact("tea", theirs("user")));
            await gate.promise;
        });
        const pending = remember(store, write("tea"), OPTIONS);
        gate.resolve();
        await held;
        await expect(pending).rejects.toThrow("personal/tea is the user's");
    });

    it("takes turns with a concurrent write, each committed", async () => {
        await Promise.all([
            remember(store, write("tea", { body: "One." }), OPTIONS),
            remember(store, write("tea", { body: "Two." }), OPTIONS),
        ]);
        expect((await read(PERSONAL, "tea")).body).toBe("Two.");
        expect(commits).toEqual(["fact: personal/tea", "fact: personal/tea"]);
    });
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `bun test packages/memory/src/facts/store.test.ts packages/memory/src/recall/remember.test.ts`
Expected: FAIL (`remember.js` does not exist; `refused` unknown).

- [ ] **Step 3: Add the guard to the store**

In `store.ts`:

```ts
// A check on the fact as it stands (null: there is none), made under
// the lock with the write it guards; a reason refuses the write.
export type Guard = (current: Fact | null) => string | null;
```

`FactResult` gains `| { kind: "refused"; reason: string }`.
`writeFact(store, input, guard?: Guard)`: after
`if ("kind" in found) { return found; }` add

```ts
        const refusal = guard?.(found.fact) ?? null;
        if (refusal !== null) {
            return { kind: "refused", reason: refusal };
        }
```

`retireFact`'s options become `{ by, why, guard }: { by: Writer; why:
string; guard?: Guard }`, with the same check after the `missing`
return. In `facts/commands.ts` `onTarget`, the failure line already
prints `result.reason` for any kind but `missing`; `refused` needs no
change there beyond what `tsc` asks.

- [ ] **Step 4: Write `remember.ts`**

`packages/memory/src/recall/remember.ts` (header copied from a
sibling):

```ts
// remember: Dorothy's own way to write, correct and retire a fact. She
// writes as dorothy, with dorothy as origin, never higher; a fact the
// user or a repository wrote is refused, as is reviving one by writing,
// and she says why. The checks are made under the store's lock.

import type { RememberInput, RememberResult } from "@dorothy/core";
import { FACT_NAME, FACT_TYPES, type FactType } from "../facts/file.js";
import {
    type FactResult,
    type FactStore,
    type Guard,
    PERSONAL,
    retireFact,
    type Scope,
    scopeLabel,
    writeFact,
} from "../facts/store.js";
import { normalise } from "../memory/sidecar.js";
import { RecallError } from "./query.js";

export type RememberOptions = {
    // The server's project id, for scope "project"; null outside one.
    project: string | null;
    // The conversation she remembers in, where the server knows it.
    from: string | null;
};

const WRITTEN_BY = { user: "the user's", repo: "the repository's" } as const;

function scopeOf(scope: string, project: string | null): Scope {
    if (scope === "personal") {
        return PERSONAL;
    }
    if (scope !== "project") {
        throw new RecallError("scope must be personal or project.");
    }
    if (project === null) {
        throw new RecallError(
            "There is no project here: this session is not in a git repository. Use personal.",
        );
    }
    return { kind: "project", id: project };
}

const refused = (result: FactResult, id: string): never => {
    if (result.kind === "missing") {
        throw new RecallError(`There is no fact ${id}.`);
    }
    throw new RecallError(
        result.kind === "refused" || result.kind === "failed"
            ? result.reason
            : `${id} was not written.`,
    );
};

export async function remember(
    store: FactStore,
    input: RememberInput,
    { project, from }: RememberOptions,
): Promise<RememberResult> {
    const scope = scopeOf(input.scope, project);
    if (!FACT_NAME.test(input.name)) {
        throw new RecallError(
            `${input.name} is not a fact's name: lower case words joined by hyphens, like tea-at-four.`,
        );
    }
    const id = `${scopeLabel(scope)}/${input.name}`;
    const writing = input.action === "write";
    let existed = false;
    const guard: Guard = (current) => {
        existed = current !== null;
        if (current === null) {
            return null;
        }
        const origin = current.provenance.origin;
        if (origin === "user" || origin === "repo") {
            return `${id} is ${WRITTEN_BY[origin]}: you cannot change it. Tell the user what you would change instead.`;
        }
        if (writing && current.retired !== null) {
            return `${id} is retired: writing does not revive it. Ask the user to revive it, or use another name.`;
        }
        return null;
    };
    if (input.action === "retire") {
        const why = normalise(input.why ?? "");
        if (why === "") {
            throw new RecallError("Say in why the fact no longer serves.");
        }
        const result = await retireFact(
            store,
            { scope, name: input.name },
            { by: "dorothy", why, guard },
        );
        if (result.kind === "written") {
            return { action: "retired", id };
        }
        if (result.kind === "unchanged") {
            return { action: "unchanged", id };
        }
        return refused(result, id);
    }
    if (input.action !== "write") {
        throw new RecallError("action must be write or retire.");
    }
    if (!(FACT_TYPES as readonly string[]).includes(input.type ?? "")) {
        throw new RecallError(`type must be one of ${FACT_TYPES.join(", ")}.`);
    }
    const [title, description, body] = [input.title, input.description, input.body].map(
        (text) => (text ?? "").trim(),
    );
    if (title === "" || description === "" || body === "") {
        throw new RecallError("Give the fact's title, description and body.");
    }
    const result = await writeFact(
        store,
        {
            scope,
            name: input.name,
            title: title as string,
            description: description as string,
            type: input.type as FactType,
            body: body as string,
            origin: "dorothy",
            by: "dorothy",
            ...(from === null ? {} : { from }),
        },
        guard,
    );
    if (result.kind === "written") {
        return { action: existed ? "corrected" : "written", id };
    }
    return refused(result, id);
}
```

- [ ] **Step 5: Run the tests**

Run: `bun test packages/memory/src/facts packages/memory/src/recall/remember.test.ts`
Expected: PASS. A failure on a limit's wording (a title over 60
characters) comes from `putFact`'s reason and is relayed as it is.

- [ ] **Step 6: Commit**

```bash
git add packages/memory
git commit -m "feat(memory): Remember, correct and retire her own facts"
```

---

### Task 5: The recall server's facts, `remember` and `--project`

**Files:**

- Modify: `packages/memory/src/recall/server.ts`,
  `packages/memory/src/history/commands.ts`
- Modify: `packages/cli/src/index.ts`
- Test: `packages/memory/src/recall/server.test.ts`,
  `packages/memory/src/history/commands.test.ts`,
  `packages/cli/src/index.test.ts`

**Interfaces:**

- Consumes: `search`, `openFact` (Task 3), `remember` (Task 4).
- Produces:
  - `RecallServerOptions` gains `project?: string | null` (a project
    id) and `openHistory?: OpenHistory | null`; `facts` (the data
    directory) serves facts and `remember`.
  - `runRecallServer({ exclude, recollect, project }: { exclude: string
    | null; recollect: boolean; project: string | null }, env?)`,
    `project` a directory.
  - `commandHistory({ env, err, hook, remindMirror = true })`.
  - The CLI's `Mode` `recall-server` gains `project: string | null`.

- [ ] **Step 1: Write the failing tests**

In `server.test.ts`, import `putFact`, `PERSONAL` from
`../facts/store.js`, `readFactFile`, `factPath` too, and add:

```ts
describe("the recall server's facts", () => {
    const tea = {
        name: "tea",
        title: "Tea at four",
        description: "She takes tea at four.",
        type: "user" as const,
        extra: {},
        tags: [],
        importance: null,
        provenance: {
            origin: "dorothy" as const,
            by: "dorothy" as const,
            at: "2026-10-04T12:00:00.000Z",
            created: "2026-10-04T12:00:00.000Z",
        },
        retired: null,
        body: "Every day at four.",
    };

    it("offers remember beside the lookups", async () => {
        const client = await connect({ facts: dir });
        const { tools } = await client.listTools();
        expect(tools.map((tool) => tool.name).sort()).toEqual([
            "open",
            "remember",
            "search",
            "tags",
        ]);
    });

    it("finds a fact and opens it", async () => {
        await putFact(dir, PERSONAL, tea);
        const client = await connect({ facts: dir });
        const found = JSON.parse(
            textOf(await client.callTool({ name: "search", arguments: { query: "tea" } })),
        ) as SearchResult;
        expect(found.facts.map((hit) => hit.id)).toEqual(["personal/tea"]);
        const opened = JSON.parse(
            textOf(
                await client.callTool({
                    name: "open",
                    arguments: { fact: "personal/tea", purpose: "her tea" },
                }),
            ),
        ) as OpenFactResult;
        expect(opened.body).toBe("Every day at four.");
        const both = await client.callTool({
            name: "open",
            arguments: { fact: "personal/tea", conversation: A, purpose: "p" },
        });
        expect(both.isError).toBe(true);
        expect(textOf(both)).toBe("Give a conversation or a fact to open, not both.");
    });

    it("remembers in its project, from the conversation it serves, committed once opened", async () => {
        const committed: string[] = [];
        let opened = 0;
        const client = await connect({
            facts: dir,
            project: "github.com/u/here",
            openHistory: async () => {
                opened += 1;
                return {
                    recorder: async (_paths, message) => {
                        committed.push(message);
                    },
                    lock: async (work) => work(),
                    sweep: async () => {},
                    heal: async () => false,
                    close: () => {},
                };
            },
        });
        const call = (name: string) =>
            client.callTool({
                name: "remember",
                arguments: {
                    action: "write",
                    name,
                    scope: "project",
                    type: "project",
                    title: "The gateway",
                    description: "How the gateway runs.",
                    body: "On loopback.",
                },
            });
        expect(JSON.parse(textOf(await call("gateway")))).toEqual({
            action: "written",
            id: "github.com/u/here/gateway",
        });
        await call("render");
        expect(opened).toBe(1);
        expect(committed).toEqual([
            "fact: github.com/u/here/gateway",
            "fact: github.com/u/here/render",
        ]);
        const read = await readFactFile(
            factPath(dir, { kind: "project", id: "github.com/u/here" }, "gateway"),
            "gateway",
        );
        expect(read.kind === "ok" && read.fact.provenance.from).toBe(LIVE);
    });

    it("relays a refusal as a tool error", async () => {
        const client = await connect({ facts: dir });
        const result = await client.callTool({
            name: "remember",
            arguments: { action: "write", name: "x", scope: "project", type: "user", title: "t", description: "d", body: "b" },
        });
        expect(result.isError).toBe(true);
        expect(textOf(result)).toStartWith("There is no project here");
    });
});
```

(Import `OpenFactResult` from `@dorothy/core`.)

In `commands.test.ts`'s `commandHistory` block:

```ts
    it("never reminds of the mirror when asked not to", async () => {
        const handle = await commandHistory({ env, err, hook: null, remindMirror: false })(null);
        handle?.close();
        expect(err.text).toBe("");
    });
```

In `index.test.ts`, replace the recall-server expectations: no flags
gives `{ kind: "recall-server", exclude: null, recollect: false,
project: null }`; add

```ts
    it("takes the recall server's flags in any order", () => {
        expect(
            parseArgs(["--recall-server", "--project", "/r", "--exclude", phrase, "--recollect"], false),
        ).toEqual({ kind: "recall-server", exclude: phrase, recollect: true, project: "/r" });
        expect(parseArgs(["--recall-server", "--project", "/r"], false)).toEqual({
            kind: "recall-server",
            exclude: null,
            recollect: false,
            project: "/r",
        });
    });
```

and the refusals (`["--recollect"]`, `["--exclude", phrase, "--other"]`,
`["--exclude", phrase, "--recollect", "x"]`, `["x"]`, `["--exclude"]`,
`["--exclude", "nope"]`, `["--project"]`,
`["--project", "/a", "--project", "/b"]`) expect the message
`"--recall-server takes [--exclude <phrase> [--recollect]] [--project <root>]"`.

- [ ] **Step 2: Run them to see them fail**

Run:

```bash
bun test packages/memory/src/recall/server.test.ts packages/memory/src/history/commands.test.ts packages/cli/src/index.test.ts
```

Expected: FAIL.

- [ ] **Step 3: `commandHistory` without the reminder**

In `history/commands.ts`, `commandHistory` takes
`remindMirror = true` beside `hook`, documented as
`// false for a short-lived process, which leaves the mirror to chat's launch.`,
and guards the `NO_MIRROR` check with `if (remindMirror && ...)`.

- [ ] **Step 4: The server**

In `recall/server.ts`, add to the imports `RecallError`'s neighbours
`openFact`, `NO_FACT`; `remember` from `./remember.js`; `FACT_TYPES`
from `../facts/file.js`; `type FactStore` from `../facts/store.js`;
`type HistoryHandle`, `type OpenHistory` from `../memory/sidecar.js`;
`identify` from `../projects/identify.js`. Replace the descriptions of
search and open, and add remember's:

```ts
export const SEARCH_DESCRIPTION = [
    "Search your memory by the words it contains, by tags, or both: the",
    "facts you and the user have kept, and your past conversations with",
    "this user. Your notes on earlier conversations give their gist; when",
    "they or the user point at detail you lack, search, then open what",
    "matched. Facts come first, live before retired, each with its id,",
    "scope, type, title, description, origin and a snippet; then",
    "conversations, each with its description, its tags as keywords,",
    "dates and up to three snippets. Matched words are marked with « and",
    "». kind limits the search to conversations or facts. tags are labels",
    "from the tags tool; a result carries every one of them, or a",
    "narrower tag. after and before are dates like 2026-10-05, a fact's",
    "by when it was created; limit is 1 to 10 for each, 5 by default.",
].join(" ");

export const OPEN_DESCRIPTION = [
    "Open one past conversation, usually at a turn a search matched, or",
    "one fact by its id. Give conversation or fact, not both. Say",
    "honestly in purpose what you hope to find; later you will judge",
    "whether it served. A conversation returns its notes and the turns",
    "around the one asked for; open again at another turn to read",
    "further. A fact returns whole, with who wrote it and from where.",
].join(" ");

export const REMEMBER_DESCRIPTION = [
    "Keep a fact for later conversations, in Claude Code and in chat:",
    "something lasting about the user, their work or how they want you",
    "to work, not what this conversation already holds. action write",
    "takes name (lower case words joined by hyphens), scope (personal,",
    "or project for this session's repository), type (user, feedback,",
    "project or reference), title (at most 60 characters), description",
    "(one sentence, at most 160) and body. Writing a name that exists",
    "corrects that fact. action retire takes name, scope and why. You",
    "cannot change a fact the user or a repository wrote, nor revive a",
    "retired one: tell the user what you would change instead.",
].join(" ");
```

`RecallServerOptions` gains:

```ts
    // The server's project id: search ranks its facts with personal
    // ones, and remember writes scope "project" there. null outside one.
    project?: string | null;
    // History for remember's commits, opened at its first call, never
    // pushing; null commits nothing.
    openHistory?: OpenHistory | null;
```

In `createRecallServer`, beside `answer`:

```ts
    const project = options.project ?? null;
    const root = options.facts ?? null;
    let versions: HistoryHandle | null | undefined;
    // remember writes under the store's lock, which is the index's: it
    // never runs inside exclusive, and the next query syncs what it wrote.
    const write = async (work: (store: FactStore) => Promise<unknown>) => {
        try {
            if (root === null) {
                throw new RecallError("Facts are unavailable.");
            }
            index ??= options.openIndex();
            // Opened once: null (history off or broken) is kept too.
            if (versions === undefined) {
                versions = (await options.openHistory?.(index)) ?? null;
            }
            const result = await work({
                root,
                lock: index.lock,
                recorder: versions?.recorder ?? null,
                now: () => new Date(now()),
            });
            return {
                content: [{ type: "text" as const, text: JSON.stringify(result) }],
            };
        } catch (error) {
            const text =
                error instanceof RecallError
                    ? error.message
                    : `Memory could not be written: ${describeError(error)}`;
            return { isError: true, content: [{ type: "text" as const, text }] };
        }
    };
```

`search`'s schema gains `kind: z.enum(["conversations", "facts"]).optional()`
and its options `project`. `open`'s schema becomes
`{ conversation: z.string().optional(), fact: z.string().optional(),
purpose: z.string(), turn: z.number().optional() }` and its handler:

```ts
        (input) =>
            answer((index) => {
                const { conversation, fact } = input;
                if ((conversation === undefined) === (fact === undefined)) {
                    throw new RecallError(
                        conversation === undefined
                            ? "Give a conversation or a fact to open."
                            : "Give a conversation or a fact to open, not both.",
                    );
                }
                if (fact !== undefined) {
                    if (root === null) {
                        throw new RecallError(NO_FACT);
                    }
                    return openFact(index, input, root);
                }
                return openConversation(
                    index,
                    { ...input, conversation: conversation as string },
                    { exclude: options.exclude },
                );
            }),
```

Register `remember` only when `root !== null`:

```ts
    if (root !== null) {
        server.registerTool(
            "remember",
            {
                description: REMEMBER_DESCRIPTION,
                inputSchema: {
                    action: z.enum(["write", "retire"]),
                    name: z.string(),
                    scope: z.enum(["personal", "project"]),
                    type: z.enum(FACT_TYPES).optional(),
                    title: z.string().optional(),
                    description: z.string().optional(),
                    body: z.string().optional(),
                    why: z.string().optional(),
                },
            },
            (input) =>
                write((store) =>
                    remember(store, input, { project, from: options.exclude }),
                ),
        );
    }
```

`runRecallServer` becomes:

```ts
// dorothy --recall-server: an MCP server on stdin and stdout until stdin
// closes. It talks to no model, so it needs no credentials. History is
// opened for remember's commits alone, never to push the mirror: chat's
// launch does that.
export async function runRecallServer(
    {
        exclude,
        recollect: serveRecollect,
        project,
    }: { exclude: string | null; recollect: boolean; project: string | null },
    env: Env = process.env,
): Promise<number> {
    const { config } = await readConfig(env);
    const found =
        project === null ? null : await identify(project).catch(() => null);
    const server = createRecallServer({
        openIndex: () => RecallIndex.open(indexPath(env)),
        dir: transcriptDir(env),
        vocabulary: vocabularyPath(env),
        facts: dataRoot(env),
        exclude,
        recollect: serveRecollect,
        halfLifeDays: config.memory.halfLifeDays,
        project: found?.id ?? null,
        openHistory: async (index) => {
            const { commandHistory } = await import("../history/commands.js");
            return commandHistory({ env, remindMirror: false })(index);
        },
    });
    // the rest as before
}
```

- [ ] **Step 5: The CLI's flags**

In `cli/src/index.ts`, the mode becomes
`{ kind: "recall-server"; exclude: string | null; recollect: boolean; project:
string | null }`,
the usage line `"       dorothy --recall-server    memory tools for MCP clients
(stdio)"`,
and the parse:

```ts
    if (first === "--recall-server") {
        const usage = {
            kind: "usage" as const,
            message:
                "--recall-server takes [--exclude <phrase> [--recollect]] [--project <root>]",
        };
        let exclude: string | null = null;
        let project: string | null = null;
        let recollect = false;
        for (let index = 0; index < rest.length; index += 1) {
            const word = rest[index];
            const value = rest[index + 1];
            if (word === "--exclude" && exclude === null && value !== undefined && isPhrase(value)) {
                exclude = value;
                index += 1;
            } else if (word === "--project" && project === null && value !== undefined && value !== "") {
                project = value;
                index += 1;
            } else if (word === "--recollect" && !recollect) {
                recollect = true;
            } else {
                return usage;
            }
        }
        return recollect && exclude === null
            ? usage
            : { kind: "recall-server", exclude, recollect, project };
    }
```

and the dispatch
`process.exitCode = await runRecallServer({ exclude: mode.exclude, recollect:
mode.recollect, project: mode.project });`.

- [ ] **Step 6: Run the tests**

Run: `bun test packages/memory packages/cli`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add packages/memory packages/cli
git commit -m "feat(memory): Serve facts and remember, in a project, without the mirror"
```

---

### Task 6: The gateway's section

**Files:**

- Modify: `packages/gateway/src/anthropic.ts`, `server.ts`
- Test: `packages/gateway/src/anthropic.test.ts`, `server.test.ts`

**Interfaces:**

- Produces: `injectIdentity(body, identity?, section = "")`,
  `rewriteRequest(bytes, encoding, section = "")`,
  `startGateway({ upstream?, section? })`.

- [ ] **Step 1: Write the failing tests**

In `anthropic.test.ts`:

```ts
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
        const bytes = new TextEncoder().encode(JSON.stringify({ system: "plain" }));
        expect(rewriteRequest(bytes, null, "S")).toEqual({ kind: "unmarked" });
    });
});
```

In `server.test.ts`, beside the injection test, one that starts the
gateway with `{ upstream, section: "<memory>m</memory>" }`, sends a
marked request, and expects the upstream's body's identity block to end
with `"\n\n<memory>m</memory>"`; reuse the file's stand-in upstream
helper.

- [ ] **Step 2: Run them to see them fail**

Run: `bun test packages/gateway`
Expected: FAIL.

- [ ] **Step 3: Implement**

`anthropic.ts`: import `withSection` from `@dorothy/core`; the comment
above `injectIdentity` gains "with the section, opaque text such as the
memory block, after her identity"; its signature gains
`section = ""` and `mine` becomes
`{ type: "text", text: withSection(identity, section) }`.
`rewriteRequest(bytes, encoding, section = "")` passes it as
`injectIdentity(body, identityPrompt(), section)` (import
`identityPrompt` is already there).

`server.ts`: `startGateway({ upstream = DEFAULT_UPSTREAM, section = "" }:
{ upstream?: string; section?: string } = {})`, with the comment "The
section is placed as given, the same for every request." `forward`
takes `section` and passes it to `rewriteRequest`.

- [ ] **Step 4: Run the tests**

Run: `bun test packages/gateway`
Expected: PASS.

- [ ] **Step 5: Update the gateway's guide and commit**

In `packages/gateway/AGENTS.md`, the `anthropic.ts` bullet's
`injectIdentity` gains "with a section after it"; `server.ts`'s
`startGateway` gains "and the section it is started with"; add to
Invariants:

```markdown
- The gateway learns nothing of memory: the section, the memory block
  `dorothy --claude` renders, is opaque text it places as given, fixed
  for the launch so the prompt cache holds.
```

```bash
git add packages/gateway
git commit -m "feat(gateway): Place a section after her identity"
```

---

### Task 7: The block and sync for `--claude`

**Files:**

- Create: `packages/memory/src/bodies/launch.ts`, `launch.test.ts`,
  `AGENTS.md`
- Modify: `packages/memory/src/index.ts`

**Interfaces:**

- Consumes: `buildMemory` (`memory/rank.ts`), `indexCatalogue`
  (`memory/catalogue.ts`), `syncProject` (`projects/sync.ts`),
  `commandHistory` (Task 5).
- Produces, from `@dorothy/memory`:
  - `claudeBlock({ env }?): Promise<{ block: string; warnings:
    string[] }>`, `""` when memory is off or there are no notes.
  - `syncDirectory(dir: string, { env, openHistory }?): Promise<string |
    null>`: null when synced or not in a repository, else why it
    failed.

- [ ] **Step 1: Write the failing tests**

`packages/memory/src/bodies/launch.test.ts`:

```ts
import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { newPhrase } from "@dorothy/core";
import { EMPTY_SIDECAR, sidecarPath } from "../memory/sidecar.js";
import { MEMORY_PREAMBLE } from "../memory/block.js";
import { claudeBlock, syncDirectory } from "./launch.js";

let home = "";
let env: Record<string, string>;
beforeEach(async () => {
    home = await mkdtemp(join(tmpdir(), "dorothy-launch-"));
    env = {
        HOME: home,
        XDG_DATA_HOME: join(home, "data"),
        XDG_CACHE_HOME: join(home, "cache"),
        XDG_CONFIG_HOME: join(home, "config"),
        XDG_STATE_HOME: join(home, "state"),
    };
});
afterEach(async () => {
    await rm(home, { recursive: true, force: true });
});

const config = (text: string) =>
    mkdir(join(home, "config", "dorothy"), { recursive: true }).then(() =>
        writeFile(join(home, "config", "dorothy", "config.toml"), text),
    );

describe("claudeBlock", () => {
    it("renders chat's block from the notes", async () => {
        const dir = join(home, "data", "dorothy", "transcripts");
        await mkdir(dir, { recursive: true });
        const phrase = newPhrase();
        await writeFile(
            join(dir, `${phrase}.jsonl`),
            `${JSON.stringify({ v: 1, kind: "user", at: new Date().toISOString(), text: "hello" })}\n`,
        );
        await writeFile(
            sidecarPath(dir, phrase),
            JSON.stringify({ ...EMPTY_SIDECAR, title: "Greetings", description: "A hello." }),
        );
        const { block } = await claudeBlock({ env });
        expect(block).toStartWith(MEMORY_PREAMBLE);
        expect(block).toContain("<title>Greetings</title>");
    });

    it("is empty with no notes, and with memory off", async () => {
        expect((await claudeBlock({ env })).block).toBe("");
        await config("[memory]\nenabled = false\n");
        expect((await claudeBlock({ env })).block).toBe("");
    });
});

describe("syncDirectory", () => {
    it("says nothing outside a repository", async () => {
        await mkdir(join(home, "plain"));
        expect(await syncDirectory(join(home, "plain"), { env, openHistory: async () => null })).toBeNull();
    });

    it("syncs a repository's project, exporting its facts", async () => {
        const repo = join(home, "repo");
        await mkdir(join(repo, ".git"), { recursive: true });
        await writeFile(join(repo, ".git", "config"), "[core]\n");
        const project = await identify(repo);
        await putFact(join(home, "data", "dorothy"), { kind: "project", id: project?.id as string }, {
            name: "gateway",
            title: "The gateway",
            description: "How it runs.",
            type: "project",
            extra: {},
            tags: [],
            importance: null,
            provenance: { origin: "dorothy", by: "dorothy", at: new Date().toISOString(), created: new Date().toISOString() },
            retired: null,
            body: "On loopback.",
        });
        expect(await syncDirectory(repo, { env, openHistory: async () => null })).toBeNull();
        expect(await Bun.file(join(repo, ".agents", "memory", "gateway.md")).exists()).toBe(true);
    });
});
```

(Import `identify` from `../projects/identify.js` and `putFact` from
`../facts/store.js`.) If `identify` needs more of a repository than
`.git/config`, or the store's data directory is not
`$XDG_DATA_HOME/dorothy`, build the fixture as
`projects/identify.test.ts` and `projects/sync.test.ts` do; the
assertion stays: the project's fact reaches its memory directory.

- [ ] **Step 2: Run them to see them fail**

Run: `bun test packages/memory/src/bodies`
Expected: FAIL (`launch.js` does not exist).

- [ ] **Step 3: Implement**

`packages/memory/src/bodies/launch.ts` (header copied from a sibling):

```ts
// What dorothy --claude asks of memory before claude starts: chat's
// memory block, rendered by the same code, and a sync of the project
// claude starts in. Neither talks to a model.

import { type Env, readConfig } from "@dorothy/core";
import { dataRoot } from "../facts/store.js";
import { commandHistory } from "../history/commands.js";
import { indexCatalogue } from "../memory/catalogue.js";
import { buildMemory } from "../memory/rank.js";
import type { OpenHistory } from "../memory/sidecar.js";
import { vocabularyPath } from "../memory/vocabulary.js";
import { syncProject } from "../projects/sync.js";
import { indexPath, RecallIndex } from "../recall/store.js";
import { transcriptDir } from "../transcript.js";

const describeError = (error: unknown) =>
    error instanceof Error ? error.message : String(error);

// Chat's block, its preamble and budget from config.toml, leaving out
// no conversation: no Claude Code session is recorded yet.
export async function claudeBlock({
    env = process.env,
}: { env?: Env } = {}): Promise<{ block: string; warnings: string[] }> {
    const { config, warnings } = await readConfig(env);
    if (!config.memory.enabled) {
        return { block: "", warnings };
    }
    const index = RecallIndex.open(indexPath(env));
    try {
        const loaded = await indexCatalogue(
            index,
            transcriptDir(env),
            vocabularyPath(env),
            dataRoot(env),
        ).load();
        const built = buildMemory(loaded.entries, {
            now: Date.now(),
            config: config.memory,
            exclude: null,
        });
        return {
            block: built.block,
            warnings: [...warnings, ...loaded.warnings, ...built.warnings],
        };
    } finally {
        index.close();
    }
}

// Syncs the project dir is in, under the index's lock, or history's
// own without the index, history committing what changed and never
// pushing. Null when synced or dir is in no repository; else why not.
export async function syncDirectory(
    dir: string,
    {
        env = process.env,
        openHistory = commandHistory({ env, remindMirror: false }),
    }: { env?: Env; openHistory?: OpenHistory } = {},
): Promise<string | null> {
    let index: RecallIndex | null = null;
    try {
        index = RecallIndex.open(indexPath(env));
    } catch {
        // History's own lock stands in.
    }
    const versions = await openHistory(index);
    try {
        const lock = index?.lock ?? versions?.lock;
        if (lock === undefined) {
            return "neither the memory index nor history can lock the store";
        }
        const result = await syncProject(dir, {
            root: dataRoot(env),
            lock,
            recorder: versions?.recorder ?? null,
        });
        return result.kind === "failed" ? result.reason : null;
    } catch (error) {
        return describeError(error);
    } finally {
        versions?.close();
        index?.close();
    }
}
```

In `packages/memory/src/index.ts`, add
`export { claudeBlock, syncDirectory } from "./bodies/launch.js";` and
extend its comment: "dorothy --claude renders the block and syncs its
project with claudeBlock and syncDirectory."

`packages/memory/src/bodies/AGENTS.md`, frontmatter and breadcrumb
copied from `packages/memory/src/projects/AGENTS.md` (title
`packages/memory/src/bodies/AGENTS.md`, description `How memory serves
Dorothy's bodies other than chat: what dorothy --claude asks of it.`):

```markdown
# packages/memory/src/bodies/AGENTS.md

Dorothy's bodies other than chat. Chat opens memory with `openMemory`;
`dorothy --claude` asks it only for what its launch needs, through the
package's `"."` entry point, which the CLI loads lazily.

## Files

- `launch.ts`: `claudeBlock` renders chat's memory block with chat's
  code, preamble and budget, leaving no conversation out, and
  `syncDirectory` syncs the project of the directory `claude` starts
  in, under the index's lock, history committing without the mirror.

## Invariants

- Nothing here talks to a model or writes to the terminal but through
  what it returns: the CLI reports, before `claude` takes the terminal.
- The recording plan adds the reader of Claude Code's transcripts and
  the hook here.
```

- [ ] **Step 4: Run the tests**

Run: `bun test packages/memory/src/bodies && bun run lint:header`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/memory
git commit -m "feat(memory): Render the block and sync a project for --claude"
```

---

### Task 8: `dorothy --claude` delivers her memory

**Files:**

- Modify: `packages/cli/src/claude.ts`, `claude-dump.ts`
- Test: `packages/cli/src/claude.test.ts`, `claude-dump.test.ts`

**Interfaces:**

- Consumes: `startGateway({ upstream, section })` (Task 6),
  `claudeBlock`, `syncDirectory` (Task 7), `CLAUDE_ALLOWED_TOOLS`,
  `CLAUDE_SERVER_NAME` (Task 2), Task 1's decisions.
- Produces:
  - `ClaudeMemory = { block(env): Promise<{ block; warnings }>;
    sync(dir, env): Promise<string | null> }`.
  - `ClaudeDeps` gains `config?`, `memory?`, `cwd?`, `self?`, `read?`;
    `startGateway?` takes `{ upstream, section }`.
  - `launchClaude(args, upstream, deps?, purpose: "run" | "dump" =
    "run"): Promise<Launch | number>`.
  - `dorothyFlags(args, flags, io)`, `mergeJson(a, b)`.

- [ ] **Step 1: Write the failing tests**

In `claude.test.ts`, import `DEFAULT_CONFIG`, `type Config` from
`@dorothy/core`, and `dorothyFlags`, `mergeJson` from `./claude.js`.
The harness takes `memoryOn = false` and gains:

```ts
    const memory = { synced: [] as string[], blocks: 0 };
    const withMemory = (enabled: boolean, recall = true): Config => ({
        ...DEFAULT_CONFIG,
        memory: { ...DEFAULT_CONFIG.memory, enabled, recall },
    });
```

and in `deps`:

```ts
        startGateway: ({ upstream, section }) => {
            calls.upstream = upstream;
            calls.section = section;
            return { url: "http://127.0.0.1:4321", stats, stop: () => { calls.stopped = true; } };
        },
        config: async () => ({ config: withMemory(memoryOn), warnings: [] }),
        memory: {
            block: async () => {
                memory.blocks += 1;
                return { block: "<memory>m</memory>", warnings: [] };
            },
            sync: async (dir) => {
                memory.synced.push(dir);
                return null;
            },
        },
        cwd: "/work",
        self: ["/bin/bun", "/d/index.ts"],
        read: () => {
            throw new Error("no such file");
        },
```

(`calls` gains `section: ""`; the harness returns `memory`.) The
existing tests keep memory off and so pin today's launch. Add:

```ts
describe("dorothy --claude with memory", () => {
    const SETTINGS = `--settings=${JSON.stringify({
        permissions: {
            allow: [
                "mcp__dorothy-memory__search",
                "mcp__dorothy-memory__open",
                "mcp__dorothy-memory__tags",
                "mcp__dorothy-memory__remember",
            ],
        },
    })}`;
    const MCP = `--mcp-config=${JSON.stringify({
        mcpServers: {
            "dorothy-memory": {
                type: "stdio",
                command: "/bin/bun",
                args: ["/d/index.ts", "--recall-server", "--project", "/work"],
            },
        },
    })}`;

    it("syncs, places the block, serves recall and turns auto memory off", async () => {
        const { calls, deps, memory } = harness(0, true);
        expect(await runClaude(["-p", "hi"], deps)).toBe(0);
        expect(memory.synced).toEqual(["/work"]);
        expect(calls.section).toBe("<memory>m</memory>");
        expect(calls.cmd).toEqual([
            "/bin/claude",
            "--append-system-prompt",
            MARKER,
            SETTINGS,
            MCP,
            "-p",
            "hi",
        ]);
        expect(calls.env.CLAUDE_CODE_DISABLE_AUTO_MEMORY).toBe("1");
    });

    it("goes on when sync fails, saying so", async () => {
        const { calls, deps } = harness(0, true);
        deps.memory = { block: async () => ({ block: "", warnings: [] }), sync: async () => "a conflict" };
        expect(await runClaude([], deps)).toBe(0);
        expect(calls.err).toBe("dorothy: sync failed: a conflict\n");
    });

    it("starts without the block when it cannot be built, saying so", async () => {
        const { calls, deps } = harness(0, true);
        deps.memory = {
            block: async () => {
                throw new Error("index locked");
            },
            sync: async () => null,
        };
        expect(await runClaude([], deps)).toBe(0);
        expect(calls.section).toBe("");
        expect(calls.err).toBe(
            "dorothy: the memory block could not be built (index locked); starting without it\n",
        );
    });

    it("serves no recall with recall off, but keeps the block", async () => {
        const { calls, deps } = harness(0, true);
        deps.config = async () => ({
            config: { ...DEFAULT_CONFIG, memory: { ...DEFAULT_CONFIG.memory, recall: false } },
            warnings: [],
        });
        await runClaude([], deps);
        expect(calls.cmd).toEqual(["/bin/claude", "--append-system-prompt", MARKER]);
        expect(calls.section).toBe("<memory>m</memory>");
    });

    it("runs claude as today with memory off", async () => {
        const { calls, deps, memory } = harness(0, false);
        await runClaude(["-p", "hi"], deps);
        expect(memory).toEqual({ synced: [], blocks: 0 });
        expect(calls.cmd).toEqual(["/bin/claude", "--append-system-prompt", MARKER, "-p", "hi"]);
        expect(calls.env.CLAUDE_CODE_DISABLE_AUTO_MEMORY).toBeUndefined();
    });
});

describe("dorothyFlags", () => {
    const io = (files: Record<string, string> = {}) => ({
        cwd: "/work",
        read: (path: string) => {
            const text = files[path];
            if (text === undefined) {
                throw new Error(`ENOENT: ${path}`);
            }
            return text;
        },
    });
    const ours = { settings: { permissions: { allow: ["a"] } }, mcpConfig: null };

    it("merges the user's own settings, a file or inline, into Dorothy's", () => {
        const fromFile = dorothyFlags(
            ["--settings", "mine.json", "-p", "hi"],
            ours,
            io({ "/work/mine.json": '{"permissions":{"allow":["b"]},"model":"x"}' }),
        );
        expect(fromFile).toEqual({
            args: [
                `--settings=${JSON.stringify({ permissions: { allow: ["b", "a"] }, model: "x" })}`,
                "-p",
                "hi",
            ],
            warnings: [],
        });
        expect(
            dorothyFlags([`--settings={"model":"y"}`], ours, io()).args,
        ).toEqual([`--settings=${JSON.stringify({ model: "y", permissions: { allow: ["a"] } })}`]);
    });

    it("passes on settings it cannot read, warning that they may override hers", () => {
        expect(dorothyFlags(["--settings", "gone.json"], ours, io())).toEqual({
            args: [`--settings=${JSON.stringify(ours.settings)}`, "--settings", "gone.json"],
            warnings: [
                "your --settings could not be read (ENOENT: /work/gone.json); it is passed on as given, and may override Dorothy's",
            ],
        });
    });

    it("leaves what follows -- alone, and the user's flags without hers", () => {
        expect(
            dorothyFlags(["--", "--settings", "x"], ours, io()).args,
        ).toEqual([`--settings=${JSON.stringify(ours.settings)}`, "--", "--settings", "x"]);
        expect(
            dorothyFlags(["--settings", "x"], { settings: null, mcpConfig: null }, io()).args,
        ).toEqual(["--settings", "x"]);
    });

    it("merges objects key by key and joins arrays without repeats", () => {
        expect(mergeJson({ a: [1, 2], b: { c: 1 } }, { a: [2, 3], b: { d: 2 }, e: 1 })).toEqual({
            a: [1, 2, 3],
            b: { c: 1, d: 2 },
            e: 1,
        });
    });
});
```

If Task 1 decided `--settings` merges in Claude Code itself, replace the
first three `dorothyFlags` tests with one showing the user's
`--settings` passed through after Dorothy's, untouched. If it decided
`--mcp-config` must be merged, add the same file and inline cases for
it.

In `claude-dump.test.ts`, the harness gains the same `config`,
`memory`, `cwd`, `self` and `read` deps with memory on, and a test:

```ts
    it("dumps with the block alone: no sync, recall or permissions", async () => {
        const { calls, deps, memory } = harness();
        expect(await runClaudeDump([], "hi", deps)).toBe(0);
        expect(memory.synced).toEqual([]);
        expect(calls.section).toBe("<memory>m</memory>");
        expect(calls.cmd.some((arg) => arg.startsWith("--settings") || arg.startsWith("--mcp-config"))).toBe(false);
    });
```

- [ ] **Step 2: Run them to see them fail**

Run: `bun test packages/cli/src/claude.test.ts packages/cli/src/claude-dump.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement `claude.ts`**

Imports:

```ts
import { readFileSync } from "node:fs";
import { isAbsolute, resolve } from "node:path";
import {
    CLAUDE_ALLOWED_TOOLS,
    CLAUDE_SERVER_NAME,
    type Config,
    type Env,
    readConfig,
} from "@dorothy/core";
```

Add, after `FORWARDED`:

```ts
// What --claude asks of memory, loaded only when memory is on.
export type ClaudeMemory = {
    // Chat's memory block, rendered by chat's code; "" for none.
    block(env: Env): Promise<{ block: string; warnings: string[] }>;
    // Syncs the project of a directory, if it is in one: null, or why
    // the sync failed.
    sync(dir: string, env: Env): Promise<string | null>;
};

const MEMORY: ClaudeMemory = {
    block: async (env) => (await import("@dorothy/memory")).claudeBlock({ env }),
    sync: async (dir, env) =>
        (await import("@dorothy/memory")).syncDirectory(dir, { env }),
};
```

`ClaudeDeps` gains:

```ts
    startGateway?: (options: { upstream: string; section: string }) => Gateway;
    config?: (env: Env) => Promise<{ config: Config; warnings: string[] }>;
    memory?: ClaudeMemory;
    // Where dorothy runs; claude starts there unless a package script
    // says otherwise.
    cwd?: string;
    // This program as a command, as claude starts the recall server.
    self?: readonly string[];
    // Reads a file the user's own --settings names.
    read?: (path: string) => string;
```

Add after `claudeArgs`:

```ts
const SETTINGS = "--settings";
const MCP_CONFIG = "--mcp-config";
// The flags of which Claude Code keeps only the last it is given, as the
// delivery probe found: a user's own is merged into Dorothy's. Repeated
// --mcp-config flags accumulate, so the user's are passed as given.
const MERGED: ReadonlySet<string> = new Set([SETTINGS]);

type Json = Record<string, unknown>;
const isJson = (value: unknown): value is Json =>
    typeof value === "object" && value !== null && !Array.isArray(value);
const describeError = (error: unknown) =>
    error instanceof Error ? error.message : String(error);

// b merged into a: objects key by key, arrays joined without repeats,
// anything else b's.
export function mergeJson(a: Json, b: Json): Json {
    const out: Json = { ...a };
    for (const [key, value] of Object.entries(b)) {
        const before = out[key];
        out[key] =
            isJson(before) && isJson(value)
                ? mergeJson(before, value)
                : Array.isArray(before) && Array.isArray(value)
                  ? [...new Set([...before, ...value])]
                  : value;
    }
    return out;
}

// A flag's value as JSON: inline, or the file it names.
function jsonOf(
    value: string,
    cwd: string,
    read: (path: string) => string,
): Json | { problem: string } {
    try {
        const text = value.trimStart().startsWith("{")
            ? value
            : read(isAbsolute(value) ? value : resolve(cwd, value));
        const parsed: unknown = JSON.parse(text);
        return isJson(parsed) ? parsed : { problem: "it is not a JSON object" };
    } catch (error) {
        return { problem: describeError(error) };
    }
}

export type DorothyFlags = { settings: Json | null; mcpConfig: Json | null };

// Dorothy's --settings and --mcp-config, each in its = form so that a
// variadic flag never takes the user's prompt, before the user's
// arguments. A user's own value of a flag in MERGED is merged into it,
// Dorothy's keys winning; one that cannot be read is passed on after
// hers, with a warning. Anything after -- is the user's alone.
export function dorothyFlags(
    args: readonly string[],
    flags: DorothyFlags,
    { cwd, read }: { cwd: string; read: (path: string) => string },
): { args: string[]; warnings: string[] } {
    const values: Record<string, Json | null> = {
        [SETTINGS]: flags.settings,
        [MCP_CONFIG]: flags.mcpConfig,
    };
    const warnings: string[] = [];
    const rest: string[] = [];
    for (let index = 0; index < args.length; index += 1) {
        const arg = args[index] as string;
        if (arg === "--") {
            rest.push(...args.slice(index));
            break;
        }
        const name = [SETTINGS, MCP_CONFIG].find(
            (flag) => arg === flag || arg.startsWith(`${flag}=`),
        );
        const ours = name === undefined ? null : (values[name] ?? null);
        const value = arg === name ? args[index + 1] : arg.slice((name ?? "").length + 1);
        if (name === undefined || ours === null || !MERGED.has(name) || value === undefined) {
            rest.push(arg);
            continue;
        }
        if (arg === name) {
            index += 1;
        }
        const theirs = jsonOf(value, cwd, read);
        if ("problem" in theirs && typeof theirs.problem === "string") {
            rest.push(...(arg === name ? [arg, value] : [arg]));
            warnings.push(
                `your ${name} could not be read (${theirs.problem}); it is passed on as given, and may override Dorothy's`,
            );
            continue;
        }
        values[name] = mergeJson(theirs as Json, ours);
    }
    const front = [SETTINGS, MCP_CONFIG].flatMap((name) => {
        const value = values[name];
        return value === null || value === undefined
            ? []
            : [`${name}=${JSON.stringify(value)}`];
    });
    return { args: [...front, ...rest], warnings };
}
```

Replace `launchClaude` with:

```ts
// --claude runs claude with everything; its dump takes the block alone,
// so it records nothing and starts no server.
export type LaunchPurpose = "run" | "dump";

// What running claude through the gateway needs, for --claude and its
// dump alike: claude from the user's PATH, the marker in its arguments,
// and a gateway in front of the upstream. With [memory] enabled, the
// project claude starts in is synced first, the memory block goes after
// her identity, and auto memory is off; with recall too, the recall
// server is offered as dorothy-memory, its tools allowed. A number is
// the exit code of a failure already reported.
export async function launchClaude(
    args: readonly string[],
    upstream: string,
    {
        env = process.env,
        which = (command, options) => Bun.which(command, options),
        startGateway: start = startGateway,
        write = (text) => {
            process.stderr.write(text);
        },
        config: loadConfig = readConfig,
        memory = MEMORY,
        cwd = process.cwd(),
        self = [process.execPath, resolve(process.argv[1] ?? "")],
        read = (path) => readFileSync(path, "utf8"),
    }: ClaudeDeps = {},
    purpose: LaunchPurpose = "run",
): Promise<Launch | number> {
    const shell = userShell(env);
    const claude = which("claude", { PATH: shell.env.PATH ?? "" });
    if (claude === null) {
        write("dorothy: claude is not on PATH\n");
        return 127;
    }
    const dir = shell.cwd ?? cwd;
    const { config, warnings } = await loadConfig(env);
    for (const warning of warnings) {
        write(`dorothy: ${warning}\n`);
    }
    const on = config.memory.enabled;
    const run = purpose === "run";
    if (on && run) {
        const failed = await memory.sync(dir, env).catch(describeError);
        if (failed !== null) {
            write(`dorothy: sync failed: ${failed}\n`);
        }
    }
    let section = "";
    if (on) {
        try {
            const built = await memory.block(env);
            for (const warning of built.warnings) {
                write(`dorothy: ${warning}\n`);
            }
            section = built.block;
        } catch (error) {
            write(
                `dorothy: the memory block could not be built (${describeError(error)}); starting without it\n`,
            );
        }
    }
    let gateway: Gateway;
    try {
        gateway = start({ upstream, section });
    } catch (error) {
        write(`dorothy: the gateway could not start: ${describeError(error)}\n`);
        return 1;
    }
    const recall = on && run && config.memory.recall;
    const flagged = dorothyFlags(
        args,
        {
            settings: recall
                ? { permissions: { allow: [...CLAUDE_ALLOWED_TOOLS] } }
                : null,
            mcpConfig: recall
                ? {
                      mcpServers: {
                          [CLAUDE_SERVER_NAME]: {
                              type: "stdio",
                              command: self[0],
                              args: [...self.slice(1), "--recall-server", "--project", dir],
                          },
                      },
                  }
                : null,
        },
        { cwd: dir, read },
    );
    for (const warning of flagged.warnings) {
        write(`dorothy: ${warning}\n`);
    }
    const launch: Launch = {
        cmd: [claude, ...claudeArgs(flagged.args)],
        env: {
            ...shell.env,
            ANTHROPIC_BASE_URL: gateway.url,
            // Claude Code turns tool search off for a base URL not
            // Anthropic's; a user's own choice stands.
            ENABLE_TOOL_SEARCH: env.ENABLE_TOOL_SEARCH ?? "1",
            // remember is her one way to write a memory in her sessions.
            ...(on ? { CLAUDE_CODE_DISABLE_AUTO_MEMORY: "1" } : {}),
        },
        gateway,
    };
    return shell.cwd === undefined ? launch : { ...launch, cwd: shell.cwd };
}
```

Follow Task 1's decisions: `MERGED` gains `MCP_CONFIG` if
`--mcp-config` does not accumulate (and its comment says so), loses
`SETTINGS` if `--settings` merges; if the variable lost to a settings
file, the settings object becomes
`{ autoMemoryEnabled: false, ...(recall ? { permissions: ... } : {}) }`
whenever `on && run`. Remove the old `const reason = ...` duplication
in favour of `describeError`.

In `runClaude`:
`const launch = await launchClaude(args, upstreamFrom(env), { ...deps, write });`.

In `claude-dump.ts`:
`const launch = await launchClaude(args, capture.url, { ...deps, write }, "dump");`.

- [ ] **Step 4: Run the tests**

Run: `bun test packages/cli`
Expected: PASS.

- [ ] **Step 5: Update the CLI's guide and commit**

In `packages/cli/AGENTS.md`, the `claude.ts` bullet gains, after "the
marker appended to its prompt (...)": "With `[memory] enabled` it
syncs the project `claude` starts in, gives the gateway chat's memory
block as its section, and sets `CLAUDE_CODE_DISABLE_AUTO_MEMORY=1`; with
`recall` too, `--mcp-config=` offers the recall server as
`dorothy-memory` with `--project`, and `--settings=` allows its tools,
a user's own `--settings` merged in (`dorothyFlags`)." The
`claude-dump.ts` bullet gains "with the block alone: no sync, recall or
permissions". The invariant on `.env` becomes "`--claude` loads no
`.env`: `claude` signs in as the user's own Claude Code does, and memory
is read without credentials."

```bash
git add packages/cli
git commit -m "feat(cli): Give Claude Code her memory block, recall and remember"
```

---

### Task 9: `remember` in chat

**Files:**

- Modify: `packages/agent/src/conversation.ts`, `persona.ts`
- Modify: `packages/memory/src/memory/record.ts`,
  `compaction/session.ts`
- Modify: `packages/tui/src/state.ts`
- Test: `packages/agent/src/conversation.test.ts`, `persona.test.ts`,
  `packages/memory/src/memory/record.test.ts`,
  `packages/tui/src/state.test.ts`

**Interfaces:**

- Consumes: `REMEMBER_TOOL`, `ALLOWED_TOOLS`, the `remember`
  `ConversationEvent` (Task 2); `toolEntry` (`transcript.ts`).
- Produces: `rememberLine(ok, input, output): { text; detail? }` in
  `state.ts`.

- [ ] **Step 1: Write the failing tests**

`conversation.test.ts`: with the file's fake query, an assistant
message holding
`{ type: "tool_use", id: "t1", name: "mcp__memory__remember", input: { action:
"write", name: "tea" } }`
then a user message with
`{ type: "tool_result", tool_use_id: "t1", content:
'{"action":"written","id":"personal/tea"}' }`
emits exactly one event of type `remember`:

```ts
expect(events.filter((event) => event.type === "remember")).toEqual([
    {
        type: "remember",
        id: "t1",
        ok: true,
        offset: 0,
        input: { action: "write", name: "tea" },
        output: '{"action":"written","id":"personal/tea"}',
    },
]);
expect(events.some((event) => event.type === "lookup")).toBe(false);
```

and a result arriving with no answer to `t1` emits it with `ok: false`,
`output: ""`. Copy the shape of the file's lookup tests for driving
the fake query. Also assert `conversationOptions({ recall: { command:
"d", args: [] } }).allowedTools` contains `"mcp__memory__remember"`.

`persona.test.ts`: `CHAT_RECALL` gains a third replace,

```ts
).replace(
    "rather than invent detail.",
    "rather than invent detail. When you learn something lasting about the user or their work, keep it with your remember tool, and correct or retire what you kept when it changes.",
);
```

and the development-mode test expects `"open your earlier conversations
with this user, and keep facts; you"`.

`record.test.ts`: a session emitting the `remember` event above records

```ts
{
    kind: "tool",
    name: "mcp__memory__remember",
    input: '{"action":"write","name":"tea"}',
    output: '{"action":"written","id":"personal/tea"}',
    ok: true,
    cut: { input: 0, output: 0 },
    memory: true,
}
```

`state.test.ts`:

```ts
describe("rememberLine", () => {
    it("names what she kept or retired, and why she could not", () => {
        expect(
            rememberLine(true, { action: "write", name: "tea" }, '{"action":"written","id":"personal/tea"}'),
        ).toEqual({ text: "✎ remembered personal/tea" });
        expect(
            rememberLine(true, { action: "retire", name: "tea" }, '{"action":"retired","id":"personal/tea"}'),
        ).toEqual({ text: "✎ retired personal/tea" });
        expect(
            rememberLine(false, { action: "write", name: "tea" }, "personal/tea is the user's:\nyou cannot"),
        ).toEqual({ text: "✎ couldn't remember tea", detail: "personal/tea is the user's: you cannot" });
    });
});
```

and a reducer test: a `remember` event mid-reply splits the live text
into a `dorothy` line and a `lookup`-role line, as a `lookup` event's
test does. And a search line counts facts beside conversations:

```ts
it("counts the facts a search found", () => {
    const search = { tool: "search" as const, query: "tea" };
    expect(lookupLine(true, { ...search, hits: 2, facts: 1 })).toEqual({
        text: '⌕ searched "tea" · 1 fact, 2 conversations',
    });
    expect(lookupLine(true, { ...search, hits: 0, facts: 0 })).toEqual({
        text: '⌕ searched "tea" · nothing found',
    });
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `bun test packages/agent packages/memory/src/memory/record.test.ts packages/tui/src/state.test.ts`
Expected: FAIL.

- [ ] **Step 3: The agent**

In `conversation.ts`, import `REMEMBER_TOOL`; add
`type PendingRemember = { input: unknown; offset: number };` and a
field `readonly #remembers = new Map<string, PendingRemember>();`. In
the `assistant` branch's loop, after the lookup check:

```ts
                if (
                    block.type === "tool_use" &&
                    block.name === REMEMBER_TOOL &&
                    !this.#remembers.has(block.id)
                ) {
                    this.#remembers.set(block.id, {
                        input: block.input,
                        offset: this.#reply.length,
                    });
                }
```

In the `user` branch, before looking up `#calls`:

```ts
                const kept = this.#remembers.get(block.tool_use_id);
                if (kept !== undefined) {
                    this.#remembers.delete(block.tool_use_id);
                    this.#remembered(
                        block.tool_use_id,
                        kept,
                        block.is_error !== true,
                        textOf(block.content),
                    );
                    continue;
                }
```

Add:

```ts
    #remembered(
        id: string,
        call: PendingRemember,
        ok: boolean,
        output: string,
    ): void {
        this.#afterLookup = true;
        this.#emit({
            type: "remember",
            id,
            ok,
            offset: call.offset,
            input: call.input,
            output,
        });
    }
```

and in `#settleCalls`, before `this.#afterLookup = false;`:

```ts
        for (const [id, call] of this.#remembers) {
            this.#remembered(id, call, false, "");
        }
        this.#remembers.clear();
```

In `persona.ts`, the development capabilities with recall read
`"Your only tools are your memory tools, which search and", "open your earlier
conversations with this user, and keep", "facts; you cannot read files, run
commands or edit code."`,
and the memory component becomes:

```ts
        {
            name: "memory",
            text: sentences(
                "You keep short notes on your earlier conversations with this",
                "user, which follow when there are any, so you remember their",
                "gist but not their details. When the user brings up something",
                "your notes do not cover,",
                recall ? "look it up; if you cannot find it, say" : "say",
                "you do not remember it rather than invent detail.",
                ...(recall
                    ? [
                          "When you learn something lasting about the user or",
                          "their work, keep it with your remember tool, and",
                          "correct or retire what you kept when it changes.",
                      ]
                    : []),
            ),
        },
```

- [ ] **Step 4: The recorder and compaction**

In `record.ts`, import `REMEMBER_TOOL` from `@dorothy/core` and
`toolEntry` from `../transcript.js`; after the `lookup` branch:

```ts
        } else if (event.type === "remember") {
            // What she wrote herself, marked so no review learns it as new.
            record(
                toolEntry({
                    name: REMEMBER_TOOL,
                    input: JSON.stringify(event.input ?? null),
                    output: event.output,
                    ok: event.ok,
                    memory: true,
                }),
            );
```

In `compaction/session.ts`, `streams` gains
`event.type === "remember" ||` beside `lookup`, and its comment "a
lookup" becomes "a lookup or a remember".

- [ ] **Step 5: The TUI**

In `state.ts`'s `lookupLine`, the search branch's `found` becomes:

```ts
        const plural = (count: number, noun: string) =>
            `${count} ${noun}${count === 1 ? "" : "s"}`;
        const counts = [
            ...((lookup.facts ?? 0) > 0 ? [plural(lookup.facts as number, "fact")] : []),
            ...(lookup.hits > 0 ? [plural(lookup.hits, "conversation")] : []),
        ];
        const found = counts.length === 0 ? "nothing found" : counts.join(", ");
```

Add after `lookupLine`:

```ts
// A remember call as a dim line: what she kept or retired, or why she
// could not.
export function rememberLine(
    ok: boolean,
    input: unknown,
    output: string,
): { text: string; detail?: string } {
    const fields =
        typeof input === "object" && input !== null
            ? (input as Record<string, unknown>)
            : {};
    const name = oneRow(typeof fields.name === "string" ? fields.name : "");
    const retiring = fields.action === "retire";
    if (!ok) {
        const why = oneRow(output);
        return {
            text: `✎ couldn't ${retiring ? "retire" : "remember"} ${name}`,
            ...(why === "" ? {} : { detail: why }),
        };
    }
    let id = name;
    try {
        const parsed: unknown = JSON.parse(output);
        const named = (parsed as { id?: unknown } | null)?.id;
        if (typeof named === "string") {
            id = oneRow(named);
        }
    } catch {
        // The name she gave stands.
    }
    return { text: `✎ ${retiring ? "retired" : "remembered"} ${id}` };
}
```

Pull the body of the reducer's `case "lookup":` into
`function memoryLine(state: State, line: { text: string; detail?: string },
offset: number): State`
(the segment flush, the appended `lookup`-role line, `live: ""`,
`split`, `continued`, `replyOffset: offset`), and make the cases:

```ts
        case "lookup":
            return memoryLine(state, lookupLine(event.ok, event.lookup), event.offset);
        case "remember":
            return memoryLine(
                state,
                rememberLine(event.ok, event.input, event.output),
                event.offset,
            );
```

replacing Task 2's placeholder `case "remember":`. Name `State` as the
file names its state type.

- [ ] **Step 6: Run the tests**

Run: `bun run check`
Expected: PASS.

- [ ] **Step 7: Update the agent's guide and commit**

In `packages/agent/AGENTS.md`, the `conversation.ts` bullet: "emitting
`ready`, `delta`, `turn-end`, `sdk`, `lookup`, `remember` and `error`;
recall's lookups become `lookup` events and a call to `remember` a
`remember` event". The `persona.ts` bullet: "capabilities, plumbing and
memory its own, memory telling her to keep lasting facts with
`remember` when she has recall".

```bash
git add packages
git commit -m "feat(agent): Remember in chat, recorded as her own tool event"
```

---

### Task 10: Chat's project

**Files:**

- Modify: `packages/cli/src/recall-launch.ts`, `run-tui.ts`
- Modify: `packages/memory/src/memory/open.ts`, `record.ts`
- Test: `packages/cli/src/recall-launch.test.ts` (create if absent),
  `packages/memory/src/memory/open.test.ts`, `record.test.ts`

**Interfaces:**

- Consumes: `syncProject`, `identify`, Task 5's `--project`.
- Produces:
  - `recallLaunch(phrase: string, project: string | null): RecallLaunch`.
  - `OpenMemoryOptions.cwd?: string | null`: the directory chat started
    in.
  - `sessionRecorder({ ..., project?: string })`.
  - `projectSyncer(sync: () => Promise<SyncResult>, warn: (message:
    string) => void): { run(): void; settled(): Promise<void> }`.

- [ ] **Step 1: Write the failing tests**

`recall-launch.test.ts` (header copied from a sibling):

```ts
import { describe, expect, it } from "bun:test";
import { recallLaunch } from "./recall-launch.js";

describe("recallLaunch", () => {
    it("gives the server the conversation to leave out and the project", () => {
        expect(recallLaunch("a-b-c-d", "/work").args.slice(1)).toEqual([
            "--recall-server",
            "--exclude",
            "a-b-c-d",
            "--project",
            "/work",
        ]);
        expect(recallLaunch("a-b-c-d", null).args.slice(1)).toEqual([
            "--recall-server",
            "--exclude",
            "a-b-c-d",
        ]);
    });
});
```

`record.test.ts`: `sessionRecorder({ ..., project: "github.com/u/here" })`
records the session event with `project: "github.com/u/here"`, and
without `project` records none.

`open.test.ts`:

```ts
describe("projectSyncer", () => {
    it("runs one sync at a time, and once more for any asked meanwhile", async () => {
        const gate = Promise.withResolvers<void>();
        let runs = 0;
        const syncer = projectSyncer(async () => {
            runs += 1;
            if (runs === 1) {
                await gate.promise;
            }
            return { kind: "not-a-repository" };
        }, () => {});
        syncer.run();
        syncer.run();
        syncer.run();
        gate.resolve();
        await syncer.settled();
        expect(runs).toBe(2);
    });

    it("warns of a failure, never throwing", async () => {
        const warned: string[] = [];
        const syncer = projectSyncer(
            async () => ({ kind: "failed", reason: "a conflict" }),
            (message) => warned.push(message),
        );
        syncer.run();
        await syncer.settled();
        expect(warned).toEqual(["sync: a conflict"]);
    });
});
```

`syncer.settled()` must wait for the second run too: it returns the
loop's promise, which loops while `again` is set.

- [ ] **Step 2: Run them to see them fail**

Run:

```bash
bun test packages/cli/src/recall-launch.test.ts packages/memory/src/memory/open.test.ts packages/memory/src/memory/record.test.ts
```

Expected: FAIL.

- [ ] **Step 3: Implement**

`recall-launch.ts`:

```ts
// Dorothy's memory tools: this program again, as an MCP server, leaving
// out the conversation it serves, in the project chat started in. The
// flags are the CLI's, parsed in index.ts.

export function recallLaunch(phrase: string, project: string | null): RecallLaunch {
    return {
        command: process.execPath,
        args: [
            resolve(process.argv[1] ?? ""),
            "--recall-server",
            "--exclude",
            phrase,
            ...(project === null ? [] : ["--project", project]),
        ],
    };
}
```

`record.ts`: `sessionRecorder`'s options gain
`// The project chat started in, if any.\n project?: string;`, and the
session entry adds `...(project === undefined ? {} : { project })`.

`open.ts`: import `identify` from `../projects/identify.js` and
`type SyncResult`, `syncProject` from `../projects/sync.js`. Add after
`turnCommitter`:

```ts
// Syncs chat's project in the background, one run at a time: a run asked
// for while one is under way runs once after it. Never awaited by the
// chat; settled() is for quitting.
export function projectSyncer(
    sync: () => Promise<SyncResult>,
    warn: (message: string) => void,
): { run(): void; settled(): Promise<void> } {
    let running: Promise<void> | null = null;
    let again = false;
    const once = async () => {
        try {
            const result = await sync();
            if (result.kind === "failed") {
                warn(`sync: ${result.reason}`);
            }
        } catch (error) {
            warn(`sync: ${describeError(error)}`);
        }
    };
    const loop = async () => {
        do {
            again = false;
            await once();
        } while (again);
        running = null;
    };
    return {
        run: () => {
            if (running !== null) {
                again = true;
                return;
            }
            running = loop();
        },
        settled: () => running ?? Promise.resolve(),
    };
}
```

`OpenMemoryOptions` gains
`// The directory chat started in; its project, if any, is recorded and
synced.\n cwd?: string | null;`.
In `openMemory`, destructure `cwd = null`; after the history launch:

```ts
    let project: string | null = null;
    if (cwd !== null) {
        try {
            project = (await identify(cwd))?.id ?? null;
        } catch (error) {
            warnings.push(`project: ${cwd} can't be identified (${describeError(error)})`);
        }
    }
```

Move `const channel = noticeChannel();` up to just after `writeLock`,
then:

```ts
    // Chat syncs its project at its start and after each turn; without a
    // lock to sync under, it does not.
    const syncer =
        project === null || cwd === null || writeLock === undefined
            ? null
            : projectSyncer(
                  () =>
                      syncProject(cwd, {
                          root: dataRoot(env),
                          lock: writeLock,
                          recorder: launched?.history.recorder ?? null,
                      }),
                  (message) => channel.warn(message),
              );
    syncer?.run();
```

`sessionRecorder` gets `...(project === null ? {} : { project })`;
`sessionMaker`'s `turnEnded` becomes

```ts
        turnEnded:
            committer === null && syncer === null
                ? null
                : () => {
                      committer?.ended();
                      syncer?.run();
                  },
```

and `close` runs `() => syncer?.settled()` after
`() => committer?.settled()`.

`run-tui.ts`: import `userShell` from `./claude.js`; before
`openMemory`:

```ts
    // The directory the user ran dorothy from, under bun run dev too.
    const cwd = userShell(process.env).cwd ?? process.cwd();
```

and pass `cwd` and `recallLaunch: (phrase) => recallLaunch(phrase, cwd)`.

- [ ] **Step 4: Run the tests**

Run: `bun run check`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages
git commit -m "feat(memory): Record and sync chat's project, and give its server one"
```

---

### Task 11: Guides, spec, report and verification

**Files:**

- Modify: `packages/memory/AGENTS.md`, `packages/core/AGENTS.md`,
  `packages/cli/AGENTS.md`
- Modify: `docs/specs/2026-10-15-memory-bodies-design.md`
- Modify: `docs/reports/2026-10-15-memory-bodies.md`

- [ ] **Step 1: The guides**

`packages/memory/AGENTS.md` is at its 150 lines: make each change
without adding a line net.

- The `"."` entry point line becomes two lines:

```markdown
- `"."` (`src/index.ts`): `openMemory`, `previewStart`, and `--claude`'s
  `claudeBlock` and `syncDirectory`; read [its guide](./src/bodies/AGENTS.md).
```

- The `recall/` bullet, same nine lines:

```markdown
- `recall/`: search over past conversations and facts. `store.ts` is a
  derived SQLite FTS5 index in the XDG cache; `sync.ts` syncs it from the
  transcripts and sidecars before every query, a conversation's source
  and project from its first session, and `facts.ts` the store's facts by
  mtime; `query.ts` has `search` and `open`, of either; `tags.ts` mirrors
  the vocabulary; `remember.ts` writes her own facts; `server.ts` serves
  them over MCP on stdio as `dorothy --recall-server`, history opened
  without the mirror. Reviews appraise each read into the sidecar, and
  `salience()` (`rank.ts`) weighs appraised reads with visits.
```

- "The memory block charges the earlier turns' abstracts to its budget
  first." becomes one line: `- The memory block charges the earlier
  turns' abstracts first.`
- The `recollect` invariant becomes one line: `- \`recollect\` is
  served only with \`--recollect\`, for a chat with clusters.`
- `memory/open.ts`'s bullet gains nothing; `facts/` gains "a write
  guarded under the lock" in place of "written, moved".
- See also's specs gain
  `[bodies](../../docs/specs/2026-10-15-memory-bodies-design.md)` on the
  `[memory store]` line's continuation, within 80 characters.

Run `wc -l packages/memory/AGENTS.md` and `bun run lint:md`; expect at
most 150 and no warnings.

`packages/core/AGENTS.md`: `contracts/recall.ts` becomes "the memory
tools' names and shapes: chat's server and Claude Code's, the lookups,
`remember`, and search and open over facts."

`packages/cli/AGENTS.md`: `recall-launch.ts` gains "with `--project`,
the directory chat started in"; `run-tui.ts` gains "and the directory
the user ran it from (`userShell`), whose project chat records and
syncs".

- [ ] **Step 2: Amend the spec**

In `docs/specs/2026-10-15-memory-bodies-design.md`, bump `mtime` (it
stays 2026-10-15 if today is) and amend Delivery's Into Claude Code
item 2's last sentence to: "Where the arguments resume a session by id
that is already recorded, the block leaves its conversation out, as chat
leaves out the live one, once the recording plan records sessions;
`--continue`, ..." and add the decided merge behaviour to the paragraph
on a user's own `--settings` or `--mcp-config`.

- [ ] **Step 3: Verify end to end, on temporary data**

```sh
P=/tmp/claude-1000/dorothy-delivery-verify
mkdir -p "$P/xdg"
export XDG_DATA_HOME="$P/xdg" XDG_CACHE_HOME="$P/xdg" XDG_CONFIG_HOME="$P/xdg" XDG_STATE_HOME="$P/xdg"
unset CLAUDECODE $(env | grep -o '^CLAUDE_CODE_[A-Z_]*')
bun run check
bun run dev -- --claude --dump-context -- hi | jq -r '.system[] | .text' | grep -c '<memory>' || true
printf '%s\n' \
  '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18","capabilities":{},"clientInfo":{"name":"v","version":"0"}}}' \
  '{"jsonrpc":"2.0","method":"notifications/initialized"}' \
  '{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"remember","arguments":{"action":"write","name":"tea","scope":"personal","type":"user","title":"Tea at four","description":"She takes tea at four.","body":"Every day."}}}' \
  '{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"search","arguments":{"query":"tea"}}}' \
  | bun run dev -- --recall-server --project "$PWD"
bun run dev -- --facts
```

Expected: `bun run check` passes; the dump prints `0` with no notes on
the fresh data (and no error); the server answers id 2 with
`{"action":"written","id":"personal/tea"}` and id 3 with a `facts`
group holding `personal/tea`; `--facts` lists `personal tea`. Record
each command and its output in the report's Verification.

Then, by hand in the user's terminal, ask the user to run
`dorothy --claude` in this repository and: ask her to search her memory
for tea (no permission prompt), to remember something about the
session, and `/memory` to confirm auto memory is off. Record what they
report.

- [ ] **Step 4: The report**

Fill `## Rulings` with Rulings on the spec as carried out and Task 1's
decisions, `## Verification` with Step 3, `## Known limitations` with:
the block is fixed for the launch; a resumed session's conversation is
not left out until Recording; facts reach the block only with Layers;
text injected through a tool can reach a project's facts through
`remember`, which runs without a prompt (the spec's Known risks). Then
`## Summary`.

- [ ] **Step 5: Commit**

```bash
git add packages docs
git commit -m "docs: Report the delivery of Dorothy's memory to her bodies"
```

---

## Verification

The branch is done when `bun run check` passes on the last commit,
Task 11's end-to-end steps behave as expected on temporary data, and
the user has confirmed by hand that in `dorothy --claude` her memory
tools run without a prompt, `remember` writes a fact that chat then
finds, and auto memory is off. Then the `finishing-a-development-branch`
skill, confirming with the user before pushing or opening a pull
request.
