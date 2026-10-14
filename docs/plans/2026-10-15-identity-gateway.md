---
ctime: 2026-10-15
mtime: 2026-10-15
spdx: GPL-3.0-only
title: Dorothy's identity plan
description: >-
  Implementation plan for the identity package, the gateway that applies
  it to an agentic client's main thread, and the dorothy --claude
  launcher, with the probe that fixes the gateway's rules.
tags:
  - dorothy
  - gateway
  - plan
---

<!--
   -
   - ~chewygumxx/dorothy.git
   - ::: :/docs/plans/2026-10-15-identity-gateway.md
   -
   -->

# Dorothy's Identity Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use
> superpowers:subagent-driven-development (recommended) or
> superpowers:executing-plans to implement this plan task-by-task. Steps
> use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `dorothy --claude` runs the user's own Claude Code with Dorothy
as its main agent, through a local gateway that adds her identity, and
her chat persona takes the same identity from one package.

**Architecture:** `@dorothy/identity` holds Dorothy's identity, voice and
provenance as plain text. `@dorothy/gateway` serves on loopback, forwards
to Anthropic, and in a request whose `system` carries a marker replaces
the marker with that text. `@dorothy/cli` gains `--claude`, which starts
the gateway and runs `claude` with `ANTHROPIC_BASE_URL` pointed at it and
the marker appended to its system prompt. `@dorothy/agent`'s persona
takes its first components from `identity`.

**Tech Stack:** Bun 1.4.2 (`Bun.serve`, `fetch`, `Bun.spawn`,
`Bun.gunzipSync`, `bun test`, isolated linker), TypeScript 7, Biome 2.5,
remark, Claude Code 2.1.296.

**Spec:** `docs/specs/2026-10-15-identity-gateway-design.md`.

## Global Constraints

- Every new file carries the house header, copied from a sibling;
  `bun run lint:header` checks the breadcrumb against the path.
- No em dash (U+2014) anywhere; Markdown lines at most 80 characters.
- Commits in Conventional Commits, scopes the package names, `config`,
  `claude` and `api`; no agent trailers. `identity` and `gateway` become
  scopes in Task 2 and Task 3.
- No test reaches the API or runs a real `claude`; probes never touch
  `$XDG_DATA_HOME/dorothy` or `$XDG_CACHE_HOME/dorothy`.
- Never record or log request headers; they carry the credentials.
- The marker is exactly `<!-- dorothy:identity -->`.
- The default upstream is exactly `https://api.anthropic.com`.
- The launcher sets exactly `ANTHROPIC_BASE_URL=<gateway url>` and
  `ENABLE_TOOL_SEARCH=1`, and does not load Dorothy's `.env`.
- `identity` declares no dependencies; `gateway` declares `@dorothy/core`
  and `@dorothy/identity`; neither declares the Agent SDK.
- The root `AGENTS.md` stays within 100 lines (it is at 100 now), each
  package's within 150.
- Every commit passes `bun run check`, except as Task 2 notes for the
  uncommitted persona draft it absorbs.

## Review Focus

- **A long pause in a streamed reply.** Extended thinking can leave a
  stream silent for more than `Bun.serve`'s default 10-second idle
  timeout; the reply must not be cut. Pinned in Task 4.
- **The user's own `--append-system-prompt`.** `dorothy --claude
  --append-system-prompt "..." ` must keep the user's text and still
  inject. Probed in Task 1, pinned in Task 3.
- **Ctrl-C inside Claude Code.** The terminal delivers `SIGINT` to the
  whole foreground group; `dorothy` must neither die (taking the gateway
  with it) nor send `claude` a second `SIGINT`, which Claude Code reads
  as a request to quit. Pinned in Task 5.
- **A compressed reply.** Whatever encoding the upstream answers with,
  the client must receive a body it can decode. Pinned in Task 4.
- **A pre-existing `ANTHROPIC_BASE_URL` with a path.** The gateway must
  forward to that proxy, path prefix kept. Pinned in Task 4 and Task 5.

## Rulings on the spec

Made while planning; Task 6 records them in the report and amends the
spec.

- `startGateway` takes `{ upstream }` only. The spec's `log` is dropped:
  the gateway is silent while `claude` runs, and `stats` carries what a
  log would.
- `SIGINT` is not forwarded but ignored while `claude` runs, as the
  terminal already delivers it to `claude`. `SIGTERM` and `SIGHUP` are
  forwarded.
- A candidate whose body carries the marker outside `system`, or whose
  `content-encoding` is neither absent, `identity` nor `gzip`, is
  forwarded unchanged and counted as drift, so a client that moves its
  appended text is noticed.
- The gateway strips the client's `accept-encoding`, leaving Bun's
  `fetch` to negotiate and decode the reply, and strips
  `content-encoding` and `content-length` from replies, which no longer
  describe the decoded body.
- `Bun.serve` runs with `idleTimeout: 0`.

## File Structure

- `packages/identity/`: new. `src/identity.ts` (the components and the
  prompt), `src/index.ts`, `src/identity.test.ts`, `package.json`,
  `AGENTS.md`.
- `packages/gateway/`: new. `src/anthropic.ts` (the marker and the pure
  rewrite), `src/server.ts` (`startGateway`, forwarding),
  `src/index.ts`, `src/anthropic.test.ts`, `src/server.test.ts`,
  `package.json`, `AGENTS.md`.
- `packages/agent/src/persona.ts`, `persona.test.ts`,
  `packages/agent/package.json`, `packages/agent/AGENTS.md`: modified.
- `packages/cli/src/claude.ts`, `claude.test.ts`: new;
  `packages/cli/src/index.ts`, `index.test.ts`, `package.json`,
  `AGENTS.md`: modified.
- `workspace.test.ts`, `.commitlintrc.mts`, `AGENTS.md`,
  `docs/roadmap.md`, `bun.lock`: modified.
- `docs/reports/2026-10-15-identity-gateway.md` and its directory: new.

---

### Task 1: The probe

Fixes where Claude Code puts appended text before any code depends on
it. Spends no tokens: the stand-in answers every request with 400.

**Files:**

- Create: `docs/reports/2026-10-15-identity-gateway.md`
- Create: `docs/reports/2026-10-15-identity-gateway/system-marker.json`,
  `system-marker-user.json`, `messages-marker.json`

**Interfaces:**

- Produces: the report's sections (`## Summary`, `## The probe`,
  `## Rulings`, `## Verification`, `## Commits`, `## Known
  limitations`), which Task 6 fills; the decision below.

- [ ] **Step 1: Write the stand-in, outside the repository**

`/tmp/dorothy-probe/capture.ts`:

```ts
// Records each POST .../messages body, never a header, and answers 400.
const out = process.argv[2] ?? "/tmp/dorothy-probe/out";
let count = 0;
const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    async fetch(request) {
        const { pathname } = new URL(request.url);
        if (request.method === "POST" && pathname.endsWith("/messages")) {
            count += 1;
            const body = await request.json().catch(() => null);
            await Bun.write(`${out}/request-${count}.json`, JSON.stringify(body));
        }
        return Response.json(
            {
                type: "error",
                error: { type: "invalid_request_error", message: "probe" },
            },
            { status: 400 },
        );
    },
});
console.log(server.port);
```

- [ ] **Step 2: Capture a marked request, and one with the user's own
      appended text**

```sh
P=/tmp/dorothy-probe
mkdir -p "$P/out" "$P/out-user" "$P/cwd"
probe() {
    bun "$P/capture.ts" "$1" >"$P/port" &
    pid=$!
    sleep 1
    (cd "$P/cwd" &&
        ANTHROPIC_BASE_URL="http://127.0.0.1:$(cat "$P/port")" \
            ENABLE_TOOL_SEARCH=1 \
            claude -p --no-session-persistence \
            --append-system-prompt '<!-- dorothy:identity -->' \
            "${@:2}" hi) || true
    kill "$pid"
}
probe "$P/out"
probe "$P/out-user" --append-system-prompt 'probe-user-text'
ls "$P/out" "$P/out-user"
```

Expected: at least `request-1.json` in each directory. `claude` exits
non-zero on the 400; that is expected.

- [ ] **Step 3: Summarise where the marker landed, without messages**

```sh
P=/tmp/dorothy-probe
R=docs/reports/2026-10-15-identity-gateway
mkdir -p "$R"
summary='[.system | if type == "string" then [{type: "text", text: .}]
    else . end | .[] | {type, head: (.text // "")[:60],
    chars: ((.text // "") | length),
    marker: ((.text // "") | contains("dorothy:identity")),
    marker_at_end: ((.text // "") | endswith("dorothy:identity -->")),
    user_text: ((.text // "") | contains("probe-user-text")),
    cache_control}]'
jq "$summary" "$P/out/request-1.json" >"$R/system-marker.json"
jq "$summary" "$P/out-user/request-1.json" >"$R/system-marker-user.json"
jq '[.messages[] | tostring | contains("dorothy:identity")]' \
    "$P/out/request-1.json" >"$R/messages-marker.json"
cat "$R"/*.json
grep -c 'cgumxx\|@' "$R"/*.json || true
```

Expected: one entry per `system` block. The last command must print `0`
for each file: nothing personal is committed, only the first 60
characters of each block.

- [ ] **Step 4: Decide**

- If exactly one `system` text block has `marker: true` and
  `messages-marker.json` is all `false`: the spec's rules hold. Note the
  block's index, whether `marker_at_end` is true, and its
  `cache_control`.
- If, with the user's text, both `marker` and `user_text` are true in
  `system-marker-user.json` (in one block or two): the user's appended
  text survives beside the marker. If `user_text` is false anywhere,
  record that Claude Code keeps only one `--append-system-prompt` and add
  it to Known limitations.
- If the marker is only in `messages`, or nowhere: stop and report back
  to the user; the spec needs revising before Task 3.

- [ ] **Step 5: Begin the report**

`docs/reports/2026-10-15-identity-gateway.md`:

```markdown
---
ctime: 2026-10-15
mtime: 2026-10-15
spdx: GPL-3.0-only
title: Dorothy's identity report
description: >-
  How the identity package, the gateway and dorothy --claude were built:
  the probe, the rulings, the verification and what is left.
tags:
  - dorothy
  - gateway
  - report
---

<!--
   -
   - ~chewygumxx/dorothy.git
   - ::: :/docs/reports/2026-10-15-identity-gateway.md
   -
   -->

# Dorothy's identity report

## Summary

Written last.

## The probe

Claude Code 2.1.296, `claude -p --no-session-persistence
--append-system-prompt '<!-- dorothy:identity -->' hi`, run from an
empty directory against a loopback stand-in that recorded bodies, never
headers, and answered 400. A second run added
`--append-system-prompt 'probe-user-text'`. Only a summary of each
`system` block was kept: its first 60 characters, its length, whether it
held the marker or the user's text, and its `cache_control`.

- [`system-marker.json`](2026-10-15-identity-gateway/system-marker.json)
- [`system-marker-user.json`](2026-10-15-identity-gateway/system-marker-user.json)
- [`messages-marker.json`](2026-10-15-identity-gateway/messages-marker.json)

<What Step 4 found, in two or three sentences: the block, its position,
its cache_control, and the user's text.>

## Rulings

## Verification

## Commits

## Known limitations

- Forks were not probed: a fork needs a model reply, which the stand-in
  never gives. The end-to-end check covers the main thread only.
```

Replace the angle-bracketed paragraph with the finding before
committing.

- [ ] **Step 6: Lint and commit**

```sh
bunx --bun --no-install remark --frail --quiet --no-stdout \
    docs/reports/2026-10-15-identity-gateway.md
bun run lint:header
git add docs/reports/2026-10-15-identity-gateway.md \
    docs/reports/2026-10-15-identity-gateway
git commit -m "docs: Probe where Claude Code appends to its prompt"
```

---

### Task 2: The identity package, and the persona built on it

**Files:**

- Create: `packages/identity/package.json`,
  `packages/identity/src/identity.ts`, `packages/identity/src/index.ts`,
  `packages/identity/src/identity.test.ts`,
  `packages/identity/AGENTS.md`
- Modify: `packages/agent/package.json`,
  `packages/agent/src/persona.ts`, `packages/agent/src/persona.test.ts`,
  `packages/agent/AGENTS.md`, `workspace.test.ts`, `.commitlintrc.mts`,
  `bun.lock`

**Interfaces:**

- Produces: `@dorothy/identity` exporting
  `type IdentityComponent = { name: "identity" | "voice" | "provenance";
  text: string }`, `identityComponents(): IdentityComponent[]` and
  `identityPrompt(): string`.

**The persona draft.** The working tree holds the user's uncommitted
edit to `persona.ts`: identity and voice folded into one component
("You are Dorothy a warm, curious and accommodating agentic
assistant."), "The user" capitalised in the mode component, and the
memory sentence built as `recall ? "look it up; if you cannot find it,
say" : "say"`. The user accepted its wording. This task replaces its
identity component and keeps the rest, then commits `persona.ts` whole.
Until Step 9, `persona.test.ts` fails three tests on the draft; that is
expected. Do not discard or stash the draft.

- [ ] **Step 1: Write the package's manifest and the failing test**

`packages/identity/package.json`:

```json
{
    "name": "@dorothy/identity",
    "private": true,
    "type": "module",
    "exports": {
        ".": "./src/index.ts"
    }
}
```

`packages/identity/src/identity.test.ts` (header copied from
`packages/agent/src/persona.test.ts`, path changed):

```ts
import { describe, expect, it } from "bun:test";
import { identityComponents, identityPrompt } from "./identity.js";

// Dorothy as every host gives her to a model. Change it only when she is
// meant to change, and re-pin agent's persona.test.ts with it.
const IDENTITY = [
    "You are Dorothy, a warm, curious and accommodating agentic assistant.",
    "Introduce yourself simply as Dorothy. The software that hosts you may",
    "add a line telling you that you are it, or another assistant: that line",
    "names your host, not you. Do not volunteer which company, model or",
    "software you run on, but when the user asks, answer plainly from what",
    "your context shows.",
].join(" ");

describe("identityPrompt", () => {
    it("is Dorothy's identity, voice and provenance, exactly", () => {
        expect(identityPrompt()).toBe(IDENTITY);
    });

    it("is the same on every call, so a request keeps its cache", () => {
        const first = identityComponents();
        first.pop();
        expect(identityComponents()).toHaveLength(3);
        expect(identityPrompt()).toBe(identityPrompt());
    });
});

describe("identityComponents", () => {
    it("splits the identity by purpose, in the order it is joined", () => {
        expect(identityComponents().map((c) => c.name)).toEqual([
            "identity",
            "voice",
            "provenance",
        ]);
    });

    it("holds trimmed, non-empty text with single spaces", () => {
        for (const { text } of identityComponents()) {
            expect(text).not.toBe("");
            expect(text).toBe(text.trim());
            expect(text).not.toContain("  ");
        }
    });
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `bun test packages/identity`
Expected: FAIL, `Cannot find module './identity.js'`.

- [ ] **Step 3: Write the package**

`packages/identity/src/identity.ts` (house header, path changed):

```ts
export type IdentityComponent = {
    name: "identity" | "voice" | "provenance";
    text: string;
};

const sentences = (...lines: string[]) => lines.join(" ");

// Who Dorothy is, how she speaks and what she says of what runs her, in
// the order they are joined. Nothing here names a host, a protocol or a
// provider, and nothing varies: every client that runs her gives a model
// the same text, and a request carrying it keeps its prompt cache.
export function identityComponents(): IdentityComponent[] {
    return [
        { name: "identity", text: "You are Dorothy," },
        {
            name: "voice",
            text: sentences(
                "a warm, curious and accommodating",
                "agentic assistant.",
            ),
        },
        {
            name: "provenance",
            text: sentences(
                "Introduce yourself simply as Dorothy. The software that",
                "hosts you may add a line telling you that you are it, or",
                "another assistant: that line names your host, not you. Do",
                "not volunteer which company, model or software you run on,",
                "but when the user asks, answer plainly from what your",
                "context shows.",
            ),
        },
    ];
}

export function identityPrompt(): string {
    return identityComponents()
        .map((component) => component.text)
        .join(" ");
}
```

`packages/identity/src/index.ts` (house header):

```ts
// @dorothy/identity: who Dorothy is, in text any host can give a model.

export {
    type IdentityComponent,
    identityComponents,
    identityPrompt,
} from "./identity.js";
```

- [ ] **Step 4: Run it to see it pass**

Run: `bun test packages/identity`
Expected: 4 pass.

- [ ] **Step 5: Pin the graph, then declare the dependency**

In `workspace.test.ts`, set:

```ts
const GRAPH: Record<string, string[]> = {
    agent: ["core", "identity"],
    cli: ["agent", "core", "memory", "tui"],
    core: [],
    identity: [],
    memory: ["core"],
    tui: ["core"],
};

const ENTRIES: Record<string, string[]> = {
    agent: ["."],
    cli: [],
    core: ["."],
    identity: ["."],
    memory: [".", "./commands", "./recall-server"],
    tui: ["."],
};
```

and in "resolves only what a package declares, and only its doors" add:

```ts
        expect(() =>
            Bun.resolveSync("@dorothy/identity", from("agent")),
        ).not.toThrow();
        expect(() => Bun.resolveSync(SDK, from("identity"))).toThrow();
        expect(() =>
            Bun.resolveSync("@dorothy/core", from("identity")),
        ).toThrow();
```

Run: `bun test workspace.test.ts`
Expected: FAIL on "gives agent its agreed packages" and the resolution
of `@dorothy/identity` from `agent`.

Add to `packages/agent/package.json`'s `dependencies`, in order:

```json
        "@dorothy/core": "workspace:*",
        "@dorothy/identity": "workspace:*",
```

```sh
bun install
bun test workspace.test.ts
```

Expected: PASS.

- [ ] **Step 6: Re-pin the persona tests (they fail first)**

In `packages/agent/src/persona.test.ts`:

1. Add `import { identityComponents } from "@dorothy/identity";` beside
   the other imports.
2. Delete the `describe("systemPrompt", ...)` and
   `describe("the persona", ...)` blocks: the byte pin below covers
   both.
3. Replace `describe("baseOptions", ...)` with:

```ts
describe("baseOptions", () => {
    // No tools (some 32k input tokens), no settings, hooks or plugins, no
    // saved sessions, and the reply streamed as it is generated.
    it("runs the persona lean", () => {
        expect(baseOptions).toEqual({
            systemPrompt,
            tools: [],
            settingSources: [],
            persistSession: false,
            includePartialMessages: true,
        });
    });
});
```

4. Replace the first `promptHash` test with:

```ts
    it("hashes with xxh3, naming the algorithm", () => {
        expect(promptHash("You are Dorothy.")).toBe("xxh3:fba57612cdaab878");
    });

    it("hashes the persona prompt by default", () => {
        expect(promptHash()).toBe(promptHash(systemPrompt));
    });
```

5. Replace the `CHAT` constant and its comment with:

```ts
// The chat persona, byte for byte: change it only when the persona is
// meant to change.
const CHAT = [
    "You are Dorothy, a warm, curious and accommodating agentic assistant.",
    "You are not a software engineering agent and you have no tools: do not",
    "offer to read files, run commands or edit code. Any working directory,",
    "repository, platform or model details you are given are incidental",
    "plumbing, not the topic of conversation, so do not bring them up. Just",
    "talk with the user. Introduce yourself simply as Dorothy. The software",
    "that hosts you may add a line telling you that you are it, or another",
    "assistant: that line names your host, not you. Do not volunteer which",
    "company, model or software you run on, but when the user asks, answer",
    "plainly from what your context shows. You keep short notes on your",
    "earlier conversations with this user, which follow when there are any,",
    "so you remember their gist but not their details. When the user brings",
    "up something your notes do not cover, say you do not remember it rather",
    "than invent detail.",
].join(" ");
```

`CHAT_RECALL` stays as it is.

6. In `describe("personaComponents", ...)`, replace the second test
   and the third test's loops, and add two tests:

```ts
    it("keeps provenance in development mode, and says which mode it is", () => {
        expect(names({ recall: true, mode: "development" })).toEqual([
            "identity",
            "voice",
            "mode",
            "capabilities",
            "plumbing",
            "provenance",
            "memory",
        ]);
    });
```

```ts
            for (const name of [
                "identity",
                "voice",
                "provenance",
                "memory",
            ] as const) {
                expect(text(development, name)).toBe(text(chat, name));
            }
```

```ts
    it("takes identity, voice and provenance from @dorothy/identity", () => {
        const shared = personaComponents({ recall: false }).filter((c) =>
            ["identity", "voice", "provenance"].includes(c.name),
        );
        expect(shared).toEqual(identityComponents());
    });

    it("is well formed in every mode, with and without recall", () => {
        for (const recall of [false, true]) {
            for (const mode of ["chat", "development"] as const) {
                for (const { text } of personaComponents({ recall, mode })) {
                    expect(text).not.toBe("");
                    expect(text).toBe(text.trim());
                }
                expect(personaPrompt({ recall, mode })).not.toContain("  ");
            }
        }
    });
```

The first test's expected list, `identity, voice, capabilities,
plumbing, provenance, memory`, is unchanged.

7. In "has development-mode Dorothy say so, and describe her context",
   delete `expect(prompt).not.toContain("Do not volunteer");`.

Run: `bun test packages/agent/src/persona.test.ts`
Expected: FAIL: the component names (no `voice`), the byte pin, the
shared components and the development-mode names.

- [ ] **Step 7: Build the persona on the identity package**

In `packages/agent/src/persona.ts`, add the import:

```ts
import { type IdentityComponent, identityComponents } from "@dorothy/identity";
```

Above `personaComponents`, add:

```ts
// Who she is, how she speaks and what she says of what runs her are the
// same in every host, so they come from @dorothy/identity.
function shared(name: IdentityComponent["name"]): PersonaComponent {
    const component = identityComponents().find((c) => c.name === name);
    if (component === undefined) {
        throw new Error(`@dorothy/identity has no ${name} component`);
    }
    return component;
}
```

In `personaComponents`, replace the draft's `identity` component (the
first element) with:

```ts
        shared("identity"),
        shared("voice"),
```

and replace the chat-only provenance block:

```ts
        ...(chat
            ? [
                  {
                      name: "provenance" as const,
                      text: sentences(
                          "Introduce yourself simply as Dorothy. Do not volunteer",
                          ...
                      ),
                  },
              ]
            : []),
```

with:

```ts
        shared("provenance"),
```

Leave the mode, capabilities, plumbing and memory components as the
draft has them.

- [ ] **Step 8: Run the persona tests and the agent's**

Run: `bun test packages/agent`
Expected: PASS. `conversation.test.ts` builds on `systemPrompt`, so it
follows the new text without change.

- [ ] **Step 9: Guidance and scope**

In `packages/agent/AGENTS.md`:

- "Of the `@dorothy` packages it depends on `core` alone." becomes "Of
  the `@dorothy` packages it depends on `core` and `identity`."
- The `persona.ts` bullet's parenthesis becomes "(identity, voice and
  provenance from `@dorothy/identity`; capabilities, plumbing and memory
  its own) in chat mode or development mode (`--dev`: a mode component,
  and Dorothy describes her context)".
- The first Tests bullet becomes "`persona.test.ts` pins the chat prompt
  byte for byte, and that every persona is well formed: change the pin
  only when the persona is meant to change."

Write `packages/identity/AGENTS.md`:

```markdown
---
ctime: 2026-10-15
mtime: 2026-10-15
spdx: GPL-3.0-only
title: packages/identity/AGENTS.md
description: >-
  The identity package's guide: who Dorothy is, in text any host can
  give a model.
tags:
  - agents
---

<!--
   -
   - ~chewygumxx/dorothy.git
   - ::: :/packages/identity/AGENTS.md
   -
   -->

# packages/identity/AGENTS.md

`@dorothy/identity` says who Dorothy is, how she speaks and what she says
of what runs her, in text that names no host, protocol or provider. Her
chat persona (`agent`) and the gateway behind `dorothy --claude`
(`gateway`) both take it, so she is the same Dorothy in either.

## Entry points and imports

One entry point, `"."` (`src/index.ts`): `identityComponents`,
`identityPrompt` and `IdentityComponent`. It depends on nothing, not even
`core`, and does no I/O.

## Files

- `identity.ts`: the `identity`, `voice` and `provenance` components, in
  the order `identityPrompt` joins them.

## Invariants

- The same text on every call: a request carrying it keeps its prompt
  cache, so nothing in it may vary by time, host or environment.
- What a host lets her do and how it runs her (capabilities, plumbing)
  belong to the host, not here.

## Tests

`identity.test.ts` pins the prompt byte for byte: change it only when
Dorothy is meant to change, and re-pin `agent`'s `persona.test.ts` with
it.

## See also

- [Dorothy's identity spec](../../docs/specs/2026-10-15-identity-gateway-design.md)
```

In `.commitlintrc.mts`, after the `core` scope, add:

```ts
        {
            name: "identity",
            fullName: "Identity",
            description: "Who Dorothy is, ie. packages/identity/",
        },
```

- [ ] **Step 10: Check and commit**

```sh
bun run check
git add packages/identity packages/agent workspace.test.ts \
    .commitlintrc.mts bun.lock
git commit -m "feat(identity): Give Dorothy an identity any host can use" \
    -m "The persona takes its identity, voice and provenance from the new
package. Provenance is one stance everywhere: the host's identity line
names her host, and she answers plainly when asked what runs her. The
persona tests pin the new text, check every persona is well formed, and
lose the checks the byte pin already made."
```

Expected: `bun run check` passes in full.

---

### Task 3: The gateway's rewrite

The pure part: given a request body, put the identity where the marker
was. No server yet.

**Files:**

- Create: `packages/gateway/package.json`,
  `packages/gateway/src/anthropic.ts`,
  `packages/gateway/src/anthropic.test.ts`,
  `packages/gateway/src/index.ts`, `packages/gateway/AGENTS.md`
- Modify: `workspace.test.ts`, `.commitlintrc.mts`, `bun.lock`

**Interfaces:**

- Consumes: `identityPrompt()` from `@dorothy/identity`.
- Produces: `MARKER: string`;
  `injectIdentity(body: unknown, identity?: string):
  Record<string, unknown> | null` (null when `system` carries no
  marker); `type Rewritten = { kind: "unmarked" } | { kind: "injected";
  bytes: Uint8Array } | { kind: "drift" }`;
  `rewriteRequest(bytes: Uint8Array, encoding: string | null):
  Rewritten`.

- [ ] **Step 1: Manifest and graph**

`packages/gateway/package.json`:

```json
{
    "name": "@dorothy/gateway",
    "private": true,
    "type": "module",
    "exports": {
        ".": "./src/index.ts"
    },
    "dependencies": {
        "@dorothy/core": "workspace:*",
        "@dorothy/identity": "workspace:*"
    }
}
```

In `workspace.test.ts`, add `gateway: ["core", "identity"],` to `GRAPH`
and `gateway: ["."],` to `ENTRIES`, in alphabetical place, and to the
resolution test:

```ts
        expect(() => Bun.resolveSync(SDK, from("gateway"))).toThrow();
        expect(() =>
            Bun.resolveSync("@dorothy/agent", from("gateway")),
        ).toThrow();
```

`packages/gateway/src/index.ts` (house header), for now:

```ts
// @dorothy/gateway: a local stand-in for the API that adds Dorothy's
// identity to an agentic client's main thread and forwards the rest.

export {
    injectIdentity,
    MARKER,
    type Rewritten,
    rewriteRequest,
} from "./anthropic.js";
```

```sh
bun install
```

- [ ] **Step 2: Write the failing tests**

`packages/gateway/src/anthropic.test.ts` (house header):

```ts
import { describe, expect, it } from "bun:test";
import { identityPrompt } from "@dorothy/identity";
import { injectIdentity, MARKER, rewriteRequest } from "./anthropic.js";

const BILLING = { type: "text", text: "x-anthropic-billing-header: cc=1;" };
const HOST = { type: "text", text: "You are Claude Code." };
const ME = "You are Dorothy.";
const mine = { type: "text", text: ME };
const ttl = { type: "ephemeral", ttl: "1h" };

describe("injectIdentity", () => {
    it("puts the identity after the host's line, the marker gone", () => {
        const body = {
            model: "m",
            system: [
                BILLING,
                { ...HOST, cache_control: ttl },
                { type: "text", text: `Rules.\n\n${MARKER}`, cache_control: ttl },
            ],
            messages: [{ role: "user", content: "hi" }],
        };
        expect(injectIdentity(body, ME)).toEqual({
            model: "m",
            system: [
                BILLING,
                { ...HOST, cache_control: ttl },
                mine,
                { type: "text", text: "Rules.", cache_control: ttl },
            ],
            messages: [{ role: "user", content: "hi" }],
        });
    });

    it("keeps the user's own appended text beside the marker", () => {
        const body = {
            system: [BILLING, HOST, {
                type: "text",
                text: `Rules.\n\n${MARKER}\n\nUser text.`,
            }],
        };
        expect(injectIdentity(body, ME)?.system).toEqual([
            BILLING,
            HOST,
            mine,
            { type: "text", text: "Rules.\n\nUser text." },
        ]);
    });

    it("drops a block that held only the marker, keeping its breakpoint", () => {
        const body = {
            system: [
                BILLING,
                HOST,
                { type: "text", text: "Rules." },
                { type: "text", text: MARKER, cache_control: ttl },
            ],
        };
        expect(injectIdentity(body, ME)?.system).toEqual([
            BILLING,
            HOST,
            mine,
            { type: "text", text: "Rules.", cache_control: ttl },
        ]);
    });

    it("turns a string system into blocks", () => {
        expect(injectIdentity({ system: `Rules. ${MARKER}` }, ME)).toEqual({
            system: [{ type: "text", text: "Rules." }, mine],
        });
        expect(injectIdentity({ system: MARKER }, ME)).toEqual({
            system: [mine],
        });
    });

    it("leaves a request without the marker in system alone", () => {
        expect(injectIdentity({ system: [BILLING, HOST] }, ME)).toBeNull();
        expect(injectIdentity({ system: "Rules." }, ME)).toBeNull();
        expect(
            injectIdentity(
                { system: [HOST], messages: [{ role: "user", content: MARKER }] },
                ME,
            ),
        ).toBeNull();
        expect(injectIdentity("nonsense", ME)).toBeNull();
    });

    it("gives Dorothy's identity by default", () => {
        expect(injectIdentity({ system: MARKER })).toEqual({
            system: [{ type: "text", text: identityPrompt() }],
        });
    });
});

describe("rewriteRequest", () => {
    const encode = (value: unknown) =>
        new TextEncoder().encode(JSON.stringify(value));
    const decode = (bytes: Uint8Array) =>
        JSON.parse(new TextDecoder().decode(bytes));

    it("passes a request without the marker as it is", () => {
        expect(rewriteRequest(encode({ system: "Rules." }), null)).toEqual({
            kind: "unmarked",
        });
        expect(rewriteRequest(new Uint8Array([0xff, 0x00]), null)).toEqual({
            kind: "unmarked",
        });
    });

    it("rewrites a marked request, plain or gzipped", () => {
        const body = encode({ system: MARKER });
        for (const [bytes, encoding] of [
            [body, null],
            [body, "identity"],
            [Bun.gzipSync(body), "gzip"],
        ] as const) {
            const result = rewriteRequest(bytes, encoding);
            expect(result.kind).toBe("injected");
            if (result.kind === "injected") {
                expect(decode(result.bytes)).toEqual({
                    system: [{ type: "text", text: identityPrompt() }],
                });
            }
        }
    });

    it("counts as drift what it cannot read or place", () => {
        const truncated = new TextEncoder().encode(`{"system":"${MARKER}`);
        expect(rewriteRequest(truncated, null)).toEqual({ kind: "drift" });
        expect(rewriteRequest(new Uint8Array([1, 2, 3]), "gzip")).toEqual({
            kind: "drift",
        });
        expect(rewriteRequest(encode({ system: MARKER }), "br")).toEqual({
            kind: "drift",
        });
        const inMessages = encode({
            system: "Rules.",
            messages: [{ role: "user", content: MARKER }],
        });
        expect(rewriteRequest(inMessages, null)).toEqual({ kind: "drift" });
    });
});
```

- [ ] **Step 3: Run them to see them fail**

Run: `bun test packages/gateway`
Expected: FAIL, `Cannot find module './anthropic.js'`.

- [ ] **Step 4: Write the rewrite**

`packages/gateway/src/anthropic.ts` (house header):

```ts
import { identityPrompt } from "@dorothy/identity";

// What `dorothy --claude` appends to Claude Code's system prompt, and the
// gateway replaces with Dorothy's identity. Only the main thread and its
// forks carry it; subagents build prompts of their own.
export const MARKER = "<!-- dorothy:identity -->";

const BILLING = "x-anthropic-billing-header:";

type Fields = Record<string, unknown>;

export type Rewritten =
    | { kind: "unmarked" }
    | { kind: "injected"; bytes: Uint8Array }
    | { kind: "drift" };

const isRecord = (value: unknown): value is Fields =>
    typeof value === "object" && value !== null && !Array.isArray(value);

const isText = (value: unknown): value is Fields & { text: string } =>
    isRecord(value) && value.type === "text" && typeof value.text === "string";

// The text with every marker gone and its paragraphs rejoined.
function unmark(text: string): string {
    return text
        .split(MARKER)
        .map((part) => part.trim())
        .filter((part) => part !== "")
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
// the marker. What cannot be read, or carries the marker elsewhere, is
// drift: forwarded as it is, and counted, so a client that changes how
// it sends its prompt is noticed.
export function rewriteRequest(
    bytes: Uint8Array,
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
    return injected === null
        ? { kind: "drift" }
        : {
              kind: "injected",
              bytes: new TextEncoder().encode(JSON.stringify(injected)),
          };
}
```

- [ ] **Step 5: Run them to see them pass**

Run: `bun test packages/gateway workspace.test.ts`
Expected: PASS.

- [ ] **Step 6: Apply the probe's finding**

If Task 1 found the marker in a block of its own, or at the end of
Claude Code's last block, the fixtures above already cover it. If it
found anything else inside `system` (for example the marker inside a
`<system-reminder>`), add a fixture copying that shape, from the summary
in `docs/reports/2026-10-15-identity-gateway/system-marker.json`, to
`describe("injectIdentity")`, and make it pass.

- [ ] **Step 7: Guidance, scope, check and commit**

`packages/gateway/AGENTS.md`:

```markdown
---
ctime: 2026-10-15
mtime: 2026-10-15
spdx: GPL-3.0-only
title: packages/gateway/AGENTS.md
description: >-
  The gateway package's guide: a loopback stand-in for the API that adds
  Dorothy's identity to an agentic client's main thread.
tags:
  - agents
---

<!--
   -
   - ~chewygumxx/dorothy.git
   - ::: :/packages/gateway/AGENTS.md
   -
   -->

# packages/gateway/AGENTS.md

`@dorothy/gateway` stands between an agentic client and the API. It
forwards every request, and in one whose system prompt carries the
marker, which `dorothy --claude` appends, it puts Dorothy's identity in
the marker's place. Dorothy's Gateway is to grow it with memory, budgets
and model routing.

## Entry points and imports

One entry point, `"."` (`src/index.ts`): `MARKER`, `injectIdentity`,
`rewriteRequest` and `Rewritten`. It depends on `core` and `identity`,
never on a model provider's SDK.

## Files

- `anthropic.ts`: the Anthropic protocol. `MARKER`, `injectIdentity` (the
  identity after the first block that is not the billing header, the
  marker gone, an emptied block's `cache_control` moved to the block
  before) and `rewriteRequest` (gzip, parsing, drift). An OpenAI adapter
  would sit beside it.

## Invariants

- Additive: only the marker is removed. The billing header, the client's
  identity line, messages and headers stay as sent.
- Never record or log a header or a body; write nothing to the terminal,
  which the client owns.
- A request without the marker passes byte for byte, so a client that
  changes fails safe, and drift tells of it.

## Tests

`anthropic.test.ts` covers the rewrite on fixtures. No test reaches
the API.

## See also

- [Dorothy's identity spec](../../docs/specs/2026-10-15-identity-gateway-design.md)
- [The probe](../../docs/reports/2026-10-15-identity-gateway.md)
```

In `.commitlintrc.mts`, after `identity`, add:

```ts
        {
            name: "gateway",
            fullName: "Gateway",
            description: "The local stand-in for the API, ie. packages/gateway/",
        },
```

```sh
bun run check
git add packages/gateway workspace.test.ts .commitlintrc.mts bun.lock
git commit -m "feat(gateway): Put Dorothy's identity where the marker was"
```

---

### Task 4: The gateway's server

**Files:**

- Create: `packages/gateway/src/server.ts`,
  `packages/gateway/src/server.test.ts`
- Modify: `packages/gateway/src/index.ts`, `packages/gateway/AGENTS.md`

**Interfaces:**

- Consumes: `rewriteRequest` from Task 3.
- Produces: `DEFAULT_UPSTREAM = "https://api.anthropic.com"`;
  `upstreamFrom(env: Env): string`; `type GatewayStats = { injected:
  number; drift: number }`; `type Gateway = { url: string; stats:
  GatewayStats; stop: () => void }`; `startGateway(options?: {
  upstream?: string }): Gateway`, which throws if it cannot bind.

- [ ] **Step 1: Write the failing tests**

`packages/gateway/src/server.test.ts` (house header):

```ts
import { afterEach, describe, expect, it } from "bun:test";
import { identityPrompt } from "@dorothy/identity";
import { MARKER } from "./anthropic.js";
import {
    DEFAULT_UPSTREAM,
    type Gateway,
    startGateway,
    upstreamFrom,
} from "./server.js";

type Seen = {
    method: string;
    path: string;
    headers: Headers;
    body: string;
};

// The API's stand-in: records what reaches it and answers as told.
function standIn(
    reply: (seen: Seen) => Response | Promise<Response> = () =>
        Response.json({ ok: true }),
) {
    const seen: Seen[] = [];
    const server = Bun.serve({
        hostname: "127.0.0.1",
        port: 0,
        idleTimeout: 0,
        async fetch(request) {
            const url = new URL(request.url);
            const entry = {
                method: request.method,
                path: url.pathname + url.search,
                headers: request.headers,
                body: await request.text(),
            };
            seen.push(entry);
            return reply(entry);
        },
    });
    return {
        url: `http://127.0.0.1:${server.port}`,
        seen,
        stop: () => server.stop(true),
    };
}

const marked = JSON.stringify({
    system: [{ type: "text", text: "You are Claude Code." }, {
        type: "text",
        text: `Rules.\n\n${MARKER}`,
    }],
    messages: [{ role: "user", content: "hi" }],
});

let upstream: ReturnType<typeof standIn> | undefined;
let gateway: Gateway | undefined;

afterEach(() => {
    gateway?.stop();
    upstream?.stop();
});

describe("upstreamFrom", () => {
    it("takes the user's base URL, or Anthropic's", () => {
        expect(upstreamFrom({})).toBe(DEFAULT_UPSTREAM);
        expect(upstreamFrom({ ANTHROPIC_BASE_URL: "" })).toBe(
            "https://api.anthropic.com",
        );
        expect(upstreamFrom({ ANTHROPIC_BASE_URL: "http://proxy/x" })).toBe(
            "http://proxy/x",
        );
    });
});

describe("startGateway", () => {
    it("listens on loopback", () => {
        upstream = standIn();
        gateway = startGateway({ upstream: upstream.url });
        expect(gateway.url).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/);
    });

    it("injects the identity, headers untouched but for the hop", async () => {
        upstream = standIn();
        gateway = startGateway({ upstream: upstream.url });
        const reply = await fetch(`${gateway.url}/v1/messages?beta=true`, {
            method: "POST",
            headers: {
                authorization: "Bearer test-token",
                "anthropic-beta": "oauth-2025-04-20",
                "content-type": "application/json",
                "accept-encoding": "gzip",
            },
            body: marked,
        });
        expect(await reply.json()).toEqual({ ok: true });
        const [request] = upstream.seen;
        expect(request?.path).toBe("/v1/messages?beta=true");
        expect(request?.headers.get("authorization")).toBe(
            "Bearer test-token",
        );
        expect(request?.headers.get("anthropic-beta")).toBe(
            "oauth-2025-04-20",
        );
        expect(JSON.parse(request?.body ?? "").system).toEqual([
            { type: "text", text: "You are Claude Code." },
            { type: "text", text: identityPrompt() },
            { type: "text", text: "Rules." },
        ]);
        expect(gateway.stats).toEqual({ injected: 1, drift: 0 });
    });

    it("forwards an unmarked request byte for byte", async () => {
        upstream = standIn();
        gateway = startGateway({ upstream: upstream.url });
        const body = '{ "system": "Rules.",  "messages": [] }';
        await fetch(`${gateway.url}/v1/messages`, { method: "POST", body });
        expect(upstream.seen[0]?.body).toBe(body);
        expect(gateway.stats).toEqual({ injected: 0, drift: 0 });
    });

    it("rewrites a gzipped request and sends it plain", async () => {
        upstream = standIn();
        gateway = startGateway({ upstream: upstream.url });
        await fetch(`${gateway.url}/v1/messages`, {
            method: "POST",
            headers: { "content-encoding": "gzip" },
            body: Bun.gzipSync(new TextEncoder().encode(marked)),
        });
        const [request] = upstream.seen;
        expect(request?.headers.get("content-encoding")).toBeNull();
        expect(JSON.parse(request?.body ?? "").system[1].text).toBe(
            identityPrompt(),
        );
    });

    it("rewrites count_tokens, and passes other paths through", async () => {
        upstream = standIn();
        gateway = startGateway({ upstream: upstream.url });
        await fetch(`${gateway.url}/v1/messages/count_tokens`, {
            method: "POST",
            body: marked,
        });
        await fetch(`${gateway.url}/v1/models?limit=1`);
        await fetch(`${gateway.url}/v1/other`, { method: "POST", body: marked });
        expect(upstream.seen.map((s) => [s.method, s.path])).toEqual([
            ["POST", "/v1/messages/count_tokens"],
            ["GET", "/v1/models?limit=1"],
            ["POST", "/v1/other"],
        ]);
        expect(upstream.seen[0]?.body).toContain(identityPrompt());
        expect(upstream.seen[2]?.body).toBe(marked);
    });

    it("keeps the upstream's path prefix", async () => {
        upstream = standIn();
        gateway = startGateway({ upstream: `${upstream.url}/proxy/` });
        await fetch(`${gateway.url}/v1/messages`, { method: "POST", body: "{}" });
        expect(upstream.seen[0]?.path).toBe("/proxy/v1/messages");
    });

    it("streams a reply as it comes, through a long pause", async () => {
        let release = () => {};
        const held = new Promise<void>((resolve) => {
            release = resolve;
        });
        upstream = standIn(
            () =>
                new Response(
                    new ReadableStream({
                        async start(controller) {
                            controller.enqueue(
                                new TextEncoder().encode("event: a\n\n"),
                            );
                            await held;
                            await Bun.sleep(11_000);
                            controller.enqueue(
                                new TextEncoder().encode("event: b\n\n"),
                            );
                            controller.close();
                        },
                    }),
                    { headers: { "content-type": "text/event-stream" } },
                ),
        );
        gateway = startGateway({ upstream: upstream.url });
        const reply = await fetch(`${gateway.url}/v1/messages`, {
            method: "POST",
            body: "{}",
        });
        const reader = reply.body?.getReader();
        const decode = (chunk?: Uint8Array) =>
            new TextDecoder().decode(chunk);
        expect(decode((await reader?.read())?.value)).toBe("event: a\n\n");
        release();
        expect(decode((await reader?.read())?.value)).toBe("event: b\n\n");
    }, 20_000);

    it("hands the client a compressed reply it can read", async () => {
        upstream = standIn(
            () =>
                new Response(
                    Bun.gzipSync(new TextEncoder().encode('{"ok":true}')),
                    {
                        headers: {
                            "content-encoding": "gzip",
                            "content-type": "application/json",
                        },
                    },
                ),
        );
        gateway = startGateway({ upstream: upstream.url });
        const reply = await fetch(`${gateway.url}/v1/messages`, {
            method: "POST",
            body: "{}",
        });
        expect(await reply.json()).toEqual({ ok: true });
    });

    it("passes the upstream's errors through as they are", async () => {
        upstream = standIn(() =>
            Response.json({ type: "error" }, { status: 429 }),
        );
        gateway = startGateway({ upstream: upstream.url });
        const reply = await fetch(`${gateway.url}/v1/messages`, {
            method: "POST",
            body: "{}",
        });
        expect(reply.status).toBe(429);
    });

    it("answers 502 in the API's shape when the upstream is gone", async () => {
        upstream = standIn();
        const gone = upstream.url;
        upstream.stop();
        gateway = startGateway({ upstream: gone });
        const reply = await fetch(`${gateway.url}/v1/messages`, {
            method: "POST",
            body: marked,
        });
        expect(reply.status).toBe(502);
        expect(await reply.json()).toMatchObject({
            type: "error",
            error: { type: "api_error" },
        });
    });

    it("counts what it could not rewrite", async () => {
        upstream = standIn();
        gateway = startGateway({ upstream: upstream.url });
        await fetch(`${gateway.url}/v1/messages`, {
            method: "POST",
            body: `{"system":"${MARKER}`,
        });
        expect(gateway.stats).toEqual({ injected: 0, drift: 1 });
        expect(upstream.seen[0]?.body).toBe(`{"system":"${MARKER}`);
    });
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `bun test packages/gateway/src/server.test.ts`
Expected: FAIL, `Cannot find module './server.js'`.

- [ ] **Step 3: Write the server**

`packages/gateway/src/server.ts` (house header):

```ts
import type { Env } from "@dorothy/core";
import { rewriteRequest } from "./anthropic.js";

export const DEFAULT_UPSTREAM = "https://api.anthropic.com";

export type GatewayStats = { injected: number; drift: number };

export type Gateway = {
    url: string;
    stats: GatewayStats;
    stop: () => void;
};

// Headers that describe one hop rather than the request. The client's
// accept-encoding goes too: Bun's fetch negotiates and decodes its own.
const HOP = [
    "host",
    "connection",
    "keep-alive",
    "transfer-encoding",
    "content-length",
    "accept-encoding",
];

const CANDIDATE = /\/v1\/messages(?:\/count_tokens)?$/;

// The user's own base URL, so the gateway chains onto a proxy they
// already use, or Anthropic's.
export function upstreamFrom(env: Env): string {
    const url = env.ANTHROPIC_BASE_URL;
    return url === undefined || url === "" ? DEFAULT_UPSTREAM : url;
}

// A loopback stand-in for the API. It never records a header or a body,
// and writes nothing: the client owns the terminal.
export function startGateway({
    upstream = DEFAULT_UPSTREAM,
}: { upstream?: string } = {}): Gateway {
    const base = upstream.replace(/\/+$/, "");
    const stats: GatewayStats = { injected: 0, drift: 0 };
    const server = Bun.serve({
        hostname: "127.0.0.1",
        port: 0,
        // A streamed reply can fall silent for longer than the default
        // ten seconds while the model thinks.
        idleTimeout: 0,
        fetch: (request) => forward(request, base, stats),
    });
    return {
        url: `http://127.0.0.1:${server.port}`,
        stats,
        stop: () => {
            server.stop(true);
        },
    };
}

async function forward(
    request: Request,
    base: string,
    stats: GatewayStats,
): Promise<Response> {
    const url = new URL(request.url);
    const headers = new Headers(request.headers);
    for (const name of HOP) {
        headers.delete(name);
    }
    let body: Uint8Array | undefined;
    if (request.method !== "GET" && request.method !== "HEAD") {
        body = new Uint8Array(await request.arrayBuffer());
        if (request.method === "POST" && CANDIDATE.test(url.pathname)) {
            const result = rewriteRequest(
                body,
                request.headers.get("content-encoding"),
            );
            if (result.kind === "injected") {
                stats.injected += 1;
                body = result.bytes;
                headers.delete("content-encoding");
            } else if (result.kind === "drift") {
                stats.drift += 1;
            }
        }
    }
    let reply: Response;
    try {
        reply = await fetch(`${base}${url.pathname}${url.search}`, {
            method: request.method,
            headers,
            body,
            redirect: "manual",
        });
    } catch (error) {
        const reason = error instanceof Error ? error.message : String(error);
        return Response.json(
            {
                type: "error",
                error: {
                    type: "api_error",
                    message: `dorothy's gateway cannot reach ${base}: ${reason}`,
                },
            },
            { status: 502 },
        );
    }
    // Bun's fetch has decoded the body, so the encoding and length the
    // upstream gave no longer describe it.
    const out = new Headers(reply.headers);
    for (const name of [...HOP, "content-encoding"]) {
        out.delete(name);
    }
    return new Response(reply.body, {
        status: reply.status,
        statusText: reply.statusText,
        headers: out,
    });
}
```

Add to `packages/gateway/src/index.ts`:

```ts
export {
    DEFAULT_UPSTREAM,
    type Gateway,
    type GatewayStats,
    startGateway,
    upstreamFrom,
} from "./server.js";
```

- [ ] **Step 4: Run them to see them pass**

Run: `bun test packages/gateway`
Expected: PASS, the long-pause test taking about 11 seconds. If the
long-pause test fails with the connection closed, `idleTimeout: 0` is
missing; if it fails on Bun's own `fetch` timing out, record the limit
Bun imposes in the report's Known limitations and lower the pause to
just above 10 seconds.

- [ ] **Step 5: Guidance**

In `packages/gateway/AGENTS.md`, make the Entry points sentence:

```markdown
One entry point, `"."` (`src/index.ts`): `startGateway`, `upstreamFrom`,
`DEFAULT_UPSTREAM`, `MARKER`, `injectIdentity`, `rewriteRequest` and
their types.
```

add this bullet under Files, after `anthropic.ts`'s:

```markdown
- `server.ts`: `startGateway` on `127.0.0.1`, port `0`, `idleTimeout: 0`;
  `POST .../v1/messages` and `.../count_tokens` go to `rewriteRequest`,
  everything else through byte for byte; 502 in the API's shape when the
  upstream cannot be reached.
```

make the second Invariants bullet:

```markdown
- Never record or log a header or a body; write nothing to the terminal,
  which the client owns. `stats` counts injections and drift instead.
```

and make Tests:

```markdown
## Tests

`anthropic.test.ts` covers the rewrite on fixtures; `server.test.ts`
runs the gateway against a stand-in upstream on loopback, including an
11-second pause in a stream. No test reaches the API.
```

- [ ] **Step 6: Check and commit**

```sh
bun run check
git add packages/gateway
git commit -m "feat(gateway): Forward to the API, adding Dorothy's identity"
```

---

### Task 5: `dorothy --claude`

**Files:**

- Create: `packages/cli/src/claude.ts`, `packages/cli/src/claude.test.ts`
- Modify: `packages/cli/src/index.ts`, `packages/cli/src/index.test.ts`,
  `packages/cli/package.json`, `packages/cli/AGENTS.md`, `AGENTS.md`,
  `workspace.test.ts`, `bun.lock`

**Interfaces:**

- Consumes: `startGateway`, `upstreamFrom`, `MARKER`, `Gateway` from
  `@dorothy/gateway`.
- Produces: `Mode` gains `{ kind: "claude"; args: string[] }`;
  `runClaude(args: readonly string[], deps?: ClaudeDeps):
  Promise<number>`.

- [ ] **Step 1: Graph and dependency**

In `workspace.test.ts`, `cli: ["agent", "core", "gateway", "memory",
"tui"],`. Add `"@dorothy/gateway": "workspace:*",` to
`packages/cli/package.json` after `@dorothy/core`, then:

```sh
bun install
bun test workspace.test.ts
```

Expected: PASS.

- [ ] **Step 2: The failing launcher tests**

`packages/cli/src/claude.test.ts` (house header):

```ts
import { describe, expect, it } from "bun:test";
import { EventEmitter } from "node:events";
import { MARKER } from "@dorothy/gateway";
import { type ClaudeDeps, runClaude } from "./claude.js";

function harness(exit: number | Promise<number> = 0) {
    const calls = {
        cmd: [] as string[],
        env: {} as Record<string, string | undefined>,
        upstream: "",
        stopped: false,
        killed: [] as string[],
        err: "",
    };
    const signals = new EventEmitter();
    const stats = { injected: 0, drift: 0 };
    const deps: ClaudeDeps = {
        env: { PATH: "/bin", HOME: "/home/u" },
        which: (command, { PATH }) =>
            command === "claude" && PATH === "/bin" ? "/bin/claude" : null,
        startGateway: ({ upstream }) => {
            calls.upstream = upstream;
            return {
                url: "http://127.0.0.1:4321",
                stats,
                stop: () => {
                    calls.stopped = true;
                },
            };
        },
        spawn: (cmd, env) => {
            calls.cmd = cmd;
            calls.env = env;
            return {
                exited: Promise.resolve(exit),
                kill: (signal) => {
                    calls.killed.push(String(signal));
                },
            };
        },
        write: (text) => {
            calls.err += text;
        },
        signals,
    };
    return { calls, deps, signals, stats };
}

describe("runClaude", () => {
    it("runs claude through the gateway, the marker first", async () => {
        const { calls, deps } = harness();
        expect(await runClaude(["-p", "hi"], deps)).toBe(0);
        expect(calls.cmd).toEqual([
            "/bin/claude",
            "--append-system-prompt",
            MARKER,
            "-p",
            "hi",
        ]);
        expect(calls.env).toEqual({
            PATH: "/bin",
            HOME: "/home/u",
            ANTHROPIC_BASE_URL: "http://127.0.0.1:4321",
            ENABLE_TOOL_SEARCH: "1",
        });
        expect(calls.upstream).toBe("https://api.anthropic.com");
        expect(calls.stopped).toBe(true);
        expect(calls.err).toBe("");
    });

    it("chains onto the user's own base URL", async () => {
        const { calls, deps } = harness();
        deps.env = { ...deps.env, ANTHROPIC_BASE_URL: "http://proxy/x" };
        await runClaude([], deps);
        expect(calls.upstream).toBe("http://proxy/x");
        expect(calls.env.ANTHROPIC_BASE_URL).toBe("http://127.0.0.1:4321");
    });

    it("exits as claude did, a signal's code included", async () => {
        expect(await runClaude([], harness(3).deps)).toBe(3);
        expect(await runClaude([], harness(143).deps)).toBe(143);
    });

    it("says so, and exits 127, when claude is not on PATH", async () => {
        const { calls, deps } = harness();
        deps.env = { PATH: "/nowhere" };
        expect(await runClaude([], deps)).toBe(127);
        expect(calls.err).toBe("dorothy: claude is not on PATH\n");
        expect(calls.cmd).toEqual([]);
    });

    it("exits 1 without claude when the gateway cannot start", async () => {
        const { calls, deps } = harness();
        deps.startGateway = () => {
            throw new Error("EADDRINUSE");
        };
        expect(await runClaude([], deps)).toBe(1);
        expect(calls.err).toBe(
            "dorothy: the gateway could not start: EADDRINUSE\n",
        );
        expect(calls.cmd).toEqual([]);
    });

    it("forwards TERM and HUP, and leaves INT to the terminal", async () => {
        let finish = (_: number) => {};
        const { calls, deps, signals } = harness(
            new Promise<number>((resolve) => {
                finish = resolve;
            }),
        );
        const running = runClaude([], deps);
        await Bun.sleep(0);
        signals.emit("SIGINT");
        signals.emit("SIGTERM");
        signals.emit("SIGHUP");
        expect(calls.killed).toEqual(["SIGTERM", "SIGHUP"]);
        expect(signals.listenerCount("SIGINT")).toBe(1);
        finish(0);
        await running;
        for (const name of ["SIGINT", "SIGTERM", "SIGHUP"]) {
            expect(signals.listenerCount(name)).toBe(0);
        }
    });

    it("warns after claude exits if any marked request slipped through", async () => {
        const { calls, deps, stats } = harness();
        // The fake gateway's stats, read once claude has exited.
        stats.drift = 2;
        await runClaude([], deps);
        expect(calls.err).toBe(
            "dorothy: 2 requests carried the identity marker but could not be rewritten; Claude Code may have changed how it sends its prompt\n",
        );
    });
});
```

Run: `bun test packages/cli/src/claude.test.ts`
Expected: FAIL, `Cannot find module './claude.js'`.

- [ ] **Step 3: Write the launcher**

`packages/cli/src/claude.ts` (house header):

```ts
import type { Env } from "@dorothy/core";
import {
    type Gateway,
    MARKER,
    startGateway,
    upstreamFrom,
} from "@dorothy/gateway";

export type Spawned = {
    exited: Promise<number>;
    kill: (signal?: NodeJS.Signals) => void;
};

export type ClaudeDeps = {
    env?: Env;
    which?: (command: string, options: { PATH: string }) => string | null;
    startGateway?: (options: { upstream: string }) => Gateway;
    spawn?: (cmd: string[], env: Env) => Spawned;
    write?: (text: string) => void;
    signals?: Pick<NodeJS.EventEmitter, "on" | "off">;
};

// The terminal sends SIGINT to the whole foreground group, claude
// included: forwarding it would send claude a second, which it reads as
// a request to quit. These reach dorothy alone, so claude is told.
const FORWARDED = ["SIGTERM", "SIGHUP"] as const;

const spawnInherited = (cmd: string[], env: Env): Spawned =>
    Bun.spawn(cmd, {
        env,
        stdin: "inherit",
        stdout: "inherit",
        stderr: "inherit",
    });

// The user's own Claude Code, with Dorothy as its main agent: the gateway
// replaces the marker appended to its system prompt with her identity.
// Dorothy's .env is not loaded; claude signs in as it always does.
export async function runClaude(
    args: readonly string[],
    {
        env = process.env,
        which = (command, options) => Bun.which(command, options),
        startGateway: start = startGateway,
        spawn = spawnInherited,
        write = (text) => {
            process.stderr.write(text);
        },
        signals = process,
    }: ClaudeDeps = {},
): Promise<number> {
    const claude = which("claude", { PATH: env.PATH ?? "" });
    if (claude === null) {
        write("dorothy: claude is not on PATH\n");
        return 127;
    }
    let gateway: Gateway;
    try {
        gateway = start({ upstream: upstreamFrom(env) });
    } catch (error) {
        const reason = error instanceof Error ? error.message : String(error);
        write(`dorothy: the gateway could not start: ${reason}\n`);
        return 1;
    }
    const child = spawn(
        [claude, "--append-system-prompt", MARKER, ...args],
        {
            ...env,
            ANTHROPIC_BASE_URL: gateway.url,
            ENABLE_TOOL_SEARCH: "1",
        },
    );
    const ignore = () => {};
    const handlers = FORWARDED.map(
        (signal) => [signal, () => child.kill(signal)] as const,
    );
    signals.on("SIGINT", ignore);
    for (const [signal, handler] of handlers) {
        signals.on(signal, handler);
    }
    try {
        return await child.exited;
    } finally {
        signals.off("SIGINT", ignore);
        for (const [signal, handler] of handlers) {
            signals.off(signal, handler);
        }
        gateway.stop();
        const { drift } = gateway.stats;
        if (drift > 0) {
            write(
                `dorothy: ${drift} ${drift === 1 ? "request" : "requests"} carried the identity marker but could not be rewritten; Claude Code may have changed how it sends its prompt\n`,
            );
        }
    }
}
```

Run: `bun test packages/cli/src/claude.test.ts`
Expected: PASS. If `tsc` rejects `Bun.spawn`'s return as `Spawned`
(its `kill` takes `number | NodeJS.Signals`), widen `Spawned["kill"]`
to `(signal?: number | NodeJS.Signals) => void`.

- [ ] **Step 4: Parse `--claude` (tests first)**

In `packages/cli/src/index.test.ts`, add:

```ts
    it("hands everything after --claude to claude, terminal or not", () => {
        expect(parseArgs(["--claude"], true)).toEqual({
            kind: "claude",
            args: [],
        });
        expect(
            parseArgs(["--claude", "-p", "--resume", "x", "hi"], false),
        ).toEqual({
            kind: "claude",
            args: ["-p", "--resume", "x", "hi"],
        });
    });

    it("refuses --dev before --claude", () => {
        expect(parseArgs(["--dev", "--claude"], true)).toEqual({
            kind: "usage",
            message: "--dev applies only to chat, a prompt or --dump-context",
        });
    });

    it("lists --claude in the usage", () => {
        expect(USAGE).toContain("dorothy --claude [args...]");
    });
```

and import `USAGE` beside `parseArgs`.

Run: `bun test packages/cli/src/index.test.ts`
Expected: FAIL on the three new tests.

In `packages/cli/src/index.ts`:

- Add `| { kind: "claude"; args: string[] }` to `Mode`, after the
  `recall-server` member.
- In `USAGE`, after the `--dump-context` lines and before `--dev`, add:

```ts
    "       dorothy --claude [args...]  Claude Code, with Dorothy as its",
    "                                  agent; args go to claude",
```

- In `parseArgs`, after the `--dump-context` branch:

```ts
    if (first === "--claude") {
        return { kind: "claude", args: rest };
    }
```

- In the entry guard, before the final `else`, add (no `config()` call:
  the launcher loads no `.env`):

```ts
    } else if (mode.kind === "claude") {
        const { runClaude } = await import("./claude.js");
        process.exitCode = await runClaude(mode.args);
```

Run: `bun test packages/cli`
Expected: PASS.

- [ ] **Step 5: Guidance**

In `packages/cli/AGENTS.md`:

- The opening's "depends on all four other packages, wiring memory, the
  agent and the TUI together" becomes "depends on every other package
  but `identity`, wiring memory, the agent, the TUI and the gateway
  together".
- Under Files, add: "- `claude.ts`: `runClaude` for `--claude`: starts
  the gateway, runs `claude` from `PATH` with `ANTHROPIC_BASE_URL` at it,
  `ENABLE_TOOL_SEARCH=1` and the marker appended to its prompt, forwards
  `SIGTERM` and `SIGHUP`, ignores `SIGINT` (the terminal sends it to
  `claude` too), and exits with `claude`'s code."
- Under Invariants, after the auth bullet: "- `--claude` loads no
  `.env`: `claude` signs in as the user's own Claude Code does."

In the root `AGENTS.md`, replace the Packages paragraph (lines 28 to 35,
eight lines) with these eight:

```markdown
Seven Bun workspace packages under `packages/`, each `@dorothy/<name>`.
`core` holds the contracts the others meet on, `identity` who Dorothy is;
`memory` and `tui` depend on `core` alone, `agent` and `gateway` on it
and `identity`, never on each other; `cli` depends on all but `identity`
and wires them. A package exports only the entry points its
`package.json` names and imports only what it declares, as Bun's isolated
linker fails an undeclared or internal import under Bun and `tsc`.
`workspace.test.ts` pins the graph, the entry points and the SDK's holder.
```

Run: `wc -l AGENTS.md`
Expected: `100 AGENTS.md`.

- [ ] **Step 6: Check and commit**

```sh
bun run check
git add packages/cli AGENTS.md workspace.test.ts bun.lock
git commit -m "feat(cli): Run Claude Code as Dorothy with --claude"
```

---

### Task 6: Roadmap, report and verification

**Files:**

- Modify: `docs/roadmap.md`,
  `docs/specs/2026-10-15-identity-gateway-design.md`,
  `docs/reports/2026-10-15-identity-gateway.md`

- [ ] **Step 1: The roadmap**

In `docs/roadmap.md`, under `## Ahead`, before `### Model Providers`:

```markdown
### Dorothy's Identity

An identity package any host can give a model, a gateway that applies it
to an agentic client's main thread, and `dorothy --claude`, which runs
the user's own Claude Code with Dorothy as its agent. Spec:
[Dorothy's identity](./specs/2026-10-15-identity-gateway-design.md).

- **Status**: Specified, Planned
- **Required**: Requisites Fulfilled
- **Rationale**: Dorothy is the agent in Claude Code now, and nothing in
  it waits on a provider contract; Dorothy's Gateway grows from its
  gateway.
```

In `### Dorothy's Gateway`, after its first paragraph's last sentence,
add: "It grows from the `gateway` package Dorothy's Identity builds."
Add to Revisions:

```markdown
- 2026-10-15: Dorothy's Identity goes ahead of Model Providers: an
  identity package and a gateway let Dorothy be the agent in Claude Code
  without waiting on a provider contract, and Dorothy's Gateway grows
  from that gateway.
```

- [ ] **Step 2: Amend the spec with the rulings**

In `docs/specs/2026-10-15-identity-gateway-design.md`, bump `mtime` and:

- In `### @dorothy/gateway`, `startGateway({ upstream?, log? })` becomes
  `startGateway({ upstream? })`.
- In `### @dorothy/cli`, step 3 becomes "Inherit stdin, stdout and
  stderr; forward `SIGTERM` and `SIGHUP` to the child, and ignore
  `SIGINT`, which the terminal already sends it."
- In `## Request handling`, under Rewrite step 1, add: "A body whose
  marker is outside `system`, or whose `content-encoding` is neither
  absent, `identity` nor `gzip`, is forwarded unchanged and counted as
  drift." Under Responses, add: "The gateway strips `accept-encoding`
  from requests and `content-encoding` and `content-length` from
  replies, which Bun's `fetch` has decoded. It serves with
  `idleTimeout: 0`."

- [ ] **Step 3: End to end, with the user's go-ahead**

Ask the user before running these: they spend tokens on their login.
From an empty directory, so no project settings load:

```sh
D=$(mktemp -d)
CLI=/home/chewygumxx/dev/dorothy/packages/cli/src/index.ts
cd "$D"
bun "$CLI" --claude -p --output-format json "Who are you?" |
    tee first.json | jq -r .result
bun "$CLI" --claude -c -p --output-format json "And what runs you?" |
    tee second.json | jq '{result, usage}'
bun "$CLI" --claude -c -p \
    "Use the Agent tool to ask a general-purpose subagent its name, and quote its answer." |
    tee third.txt
claude purge "$D" --yes
```

Expected: the first answer introduces Dorothy; the second answers
plainly and its `usage.cache_read_input_tokens` is above zero; the
third quotes a subagent that does not call itself Dorothy; no `dorothy:`
warning on stderr. `claude purge` removes the transcripts these runs
left in Claude Code's own data.

- [ ] **Step 4: Fill the report**

In `docs/reports/2026-10-15-identity-gateway.md`:

- `## Rulings`: the five from this plan's Rulings on the spec, and any
  made during execution.
- `## Verification`: `bun run check`'s last lines (test and file
  counts), and Step 3's commands with the three results (the first
  answer's opening sentence, the `cache_read_input_tokens` value, the
  subagent's quoted name), or "not run" with the reason.
- `## Commits`: `git log --oneline main..HEAD`.
- `## Known limitations`: resumed sessions (the spec's Known risks),
  forks not verified, and anything Task 1 or Task 4 recorded.
- `## Summary`: three to five sentences.

- [ ] **Step 5: Check and commit**

```sh
bun run check
git add docs/roadmap.md docs/specs/2026-10-15-identity-gateway-design.md \
    docs/reports/2026-10-15-identity-gateway.md
git commit -m "docs: Report Dorothy's identity, and put it on the roadmap"
```
