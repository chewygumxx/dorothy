---
ctime: 2026-11-01
mtime: 2026-11-01
spdx: GPL-3.0-only
title: Model Providers, Part B
description: >-
  Implementation plan for Model Providers' second part: config.toml routes
  each role over five provider kinds, Anthropic, OpenRouter,
  featherless.ai, Hugging Face's router and local servers, falling back
  from one model to the next.
tags:
  - dorothy
  - plan
---

<!--
   -
   - ~xxdorothy/dorothy.git
   - ::: :/docs/plans/2026-11-01-model-providers-routing.md
   -
   -->

# Model Providers, Part B: Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use
> superpowers:subagent-driven-development (recommended) or
> superpowers:executing-plans to implement this plan task-by-task. Steps
> use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `config.toml` declares providers of five kinds and gives each
role an ordered list of models; a call that fails on one model moves to
the next with a warning saying so, and no provider outside the declared
kinds can receive her requests.

**Architecture:** `@dorothy/core` parses `[providers]` and `[models]`
into a `Routing` (every role's route and every provider's key names) or
a list of faults, and gains `withNotes`, which says a structured call's
fallback notes. `@dorothy/agent` reads every request's stream through
one helper, `readStream`, and gains the OpenRouter and OpenAI-compatible
providers, OpenRouter's cost, a no-usage notice and finer classes for
errors with no status. `@dorothy/memory` says its calls' notes where it
says their failures. `@dorothy/cli` reads the routes from `config.toml`
and acts on a fault as each entry point should. `runRoute` and
`Cooldowns`, built in Part A, already take routes of many entries and
are unchanged.

**Tech Stack:** Bun and TypeScript; `ai` 7.0.159, `@ai-sdk/anthropic`
4.0.94, `@ai-sdk/openai-compatible` 3.0.82, `@openrouter/ai-sdk-provider`
3.1.0, `@ai-sdk/mcp` 2.0.88; `bun:test`.

**Spec:** [`docs/specs/2026-11-01-model-providers-design.md`](../specs/2026-11-01-model-providers-design.md),
Part B, amended in this plan's branch for the `huggingface` kind.

## How this plan carries its code

Every task's tests and code are given whole, as unified diffs against
the tree the earlier tasks leave. They were prototyped and checked on
2026-11-01, and again after the plan's review: applied in order to
`origin/main` at `955abd3`, each task's tests fail before its code and
pass after, and the final tree passes `bun run check` on temporary XDG
roots with 0 failures (3971 tests; how many skip depends on the
machine).

Apply a diff from the repository root, by its number, with this
function; never retype one. The diffs' blank context lines carry no
trailing space, which `git apply` accepts:

```bash
patch_of() {
    awk -v n="$1" '
        /^````diff$/ { c++; if (c == n) { f = 1; next } }
        /^````$/ { if (f) exit }
        f
    ' docs/plans/2026-11-01-model-providers-routing.md
}
patch_of 1 | git apply
```

A diff that does not apply means the tree is not what the earlier tasks
left: stop and report it, never edit the diff to fit.

## Global Constraints

- New subsystems stay independent of any model provider's SDK, speaking
  standard protocols, with SDK types at a thin edge: `core` takes no
  SDK; only `agent` declares `ai`, an `@ai-sdk/` or an `@openrouter/`
  package (`workspace.test.ts` pins it).
- Dependencies, in `packages/agent/package.json` only, added by Task 4
  with `bun add`: `@ai-sdk/openai-compatible` `^3.0.82` and
  `@openrouter/ai-sdk-provider` `^3.1.0`.
- Five kinds: `anthropic`, `openrouter`, `featherless`, `huggingface`,
  `local`. Fixed roots: OpenRouter `https://openrouter.ai/api/v1`,
  featherless `https://api.featherless.ai/v1`, Hugging Face
  `https://router.huggingface.co/v1`; Anthropic
  `https://api.anthropic.com` (Dorothy appends `/v1`) or a loopback
  `base-url`; `local` a required loopback `base-url`, its full API root.
- Loopback is decided on the parsed URL: hostname exactly `localhost`,
  an IPv4 address in `127.0.0.0/8`, or `[::1]`; no user or password;
  `http` or `https`.
- `key` names a `secrets.json` entry, `^[A-Z_][A-Z0-9_]*$`, never a
  value; required except on `local`. A provider's name is
  `^[A-Za-z0-9][A-Za-z0-9_-]*$`, so it never holds the colon that ends
  it in a route entry, which splits at its first colon.
- `price`, `[input, output]` dollars per million tokens, only on
  `featherless`, `huggingface` and `local` entries; `[0, 0]` is free
  and warns of nothing.
- OpenRouter is sent `provider: { data_collection: "deny", zdr: true }`
  and `usage: { include: true }` on every request, and
  `require_parameters: true` on structured ones; its cost is
  `providerMetadata.openrouter.usage.cost`.
- The Chat Completions kinds set `includeUsage` and
  `supportsStructuredOutputs`.
- A fault in `[providers]` or `[models]` is an error, never a default:
  TUI, one-shot reply and `--dump-context` print it and exit 1; the
  service logs it and serves memory with reviews off; the Claude hook
  logs it, its reviews fail, and it exits 0; `--review-backfill` prints
  it and exits 1.
- Every model call sets `maxRetries: 0` and `onError: () => {}`, passes
  its base URL and key explicitly, and fetches through `noRedirect`.
- The recall server's environment is the caller's, less every key any
  provider names, every variable ending `_API_KEY` and every
  `CLAUDE_CODE_OAUTH_TOKEN*`.
- No test reaches a real provider or reads `secrets.json`; every root,
  key and environment is passed in. Wire tests use `fakeMessages` and
  `fakeCompletions` on loopback; behaviour tests use `mockModel`.
- Tests on temporary XDG roots only:

  ```bash
  t=$(mktemp -d)
  XDG_DATA_HOME=$t/d XDG_CACHE_HOME=$t/c XDG_STATE_HOME=$t/s \
      XDG_CONFIG_HOME=$t/cfg bun run check
  ```

- Every new file carries the house header (the diffs include it).
- Run `bun run format` before every check; the diffs are already in
  biome's layout, so it should change nothing.
- `packages/cli/AGENTS.md` ends at its 150-line budget; the root
  `AGENTS.md` is untouched.
- Conventional Commits, scopes the package names; headers at most 50
  characters, body lines at most 72; no em dash; no trailers. Each task
  ends in one commit, its message given.

## Review Focus

- A provider name with a colon, or a `key` holding a secret's value
  rather than its name: a fault naming the table, never a route
  (Task 1's `routing.test.ts`).
- A `base-url` that only looks local, such as
  `http://127.0.0.1.example.com` or `http://127.0.0.1@example.com`:
  refused (Task 1).
- A model named `constructor` or `toString`: no price and one notice,
  never a `NaN` cost (Task 1's `prices.test.ts`).
- A Chat Completions provider answering with a redirect: the key never
  follows it (Task 4's `wire.test.ts`, each kind).
- `HF_TOKEN` or a local server's key, neither ending `_API_KEY`: still
  withheld from the recall server, as every provider's key is, in chat
  and in `--dump-context`, which puts a stand-in in its route's key's
  place (Task 5's `recall-tools.test.ts` and `capture.test.ts`; Task 6's
  `chatDeps` test).

## Rulings

Made while planning, each with its cost if wrong:

1. **Hugging Face.** The user ruled on 2026-11-01, after the spec's
   approval, that Part B adds a fifth kind, `huggingface`, taking any
   provider Hugging Face's router chooses; the spec is amended in this
   branch. Cost: some of its providers keep prompts, so this kind alone
   is not held to no retention; the README says so.
2. **Local servers are tested on loopback fakes only.** The user has no
   local model (2026-11-01); Task 8 verifies OpenRouter, featherless and
   Hugging Face live instead, `HF_TOKEN` being in `secrets.json`. Cost:
   the `local` kind is unproven against a real server.
3. **Thinking on the other kinds is the provider's default.** There is
   no portable lowest setting, and a refused one would fail every
   attempt. Cost: reasoning models on OpenRouter, featherless or Hugging
   Face spend their default thinking.
4. **Reasoning is not carried across Anthropic models**, as Part A's
   report suggested. A thinking block's signature belongs to the model
   that made it, and an attempt always starts from the user's message,
   so carrying one gains nothing a fallback needs. Cost: none seen; a
   model switch loses earlier turns' reasoning, as it does now.
5. **A `config.toml` that does not parse is a routing fault if it
   routes**: when any line opens or sets `[providers]` or `[models]`,
   the routes it meant cannot be known, so chat stops where it used to
   warn, and the service, the hook and the backfill review nothing. A
   broken file with no such line keeps the default routes, and
   `parseConfig`'s warning names the line. Cost: with routing tables in
   the file, a typo in any table stops chat and turns every review off,
   which the service only logs, until it is fixed.
6. **Every fault is reported, not the first**, and a role left out is a
   fault only when every provider was read, so one bad provider is not
   followed by four "missing" lines. Cost: none.
7. **The hook on a fault.** Its agent fails to load, so each review it
   asks for fails with the fault in the log, and the hook exits 0, as
   for any agent that cannot load. Cost: a claim is taken and released
   per review, and the log says the review failed rather than skipped.
8. **Notes are said where calls are handed over**, by core's
   `withNotes`: a TUI warning `memory: <review or compaction>: <note>`,
   the service's log, the hook's log and the backfill's stderr. The TUI
   and backfill paths have tests; the service and hook wraps are one
   line each, left to review. Cost: a regression in those two goes
   unseen by tests.
9. **Unknown costs in structured calls** ride the outcome's `notes`,
   after the route's own, once a process per model. Cost: none.
10. **Errors with no status** are classed by their AI SDK name: an
    answer the SDK could not read (`AI_JSONParseError` and the like) is
    `server`, a request it would not send (`AI_InvalidPromptError` and
    the like) `rejected`; any other stays `network`. Cost: a class only
    changes the message; every class but `cancelled` falls back.
11. **OpenRouter runs in `compatibility: "strict"`**, as its default
    mode leaves out `stream_options` and so a stream's usage. Cost:
    none.
12. **`ModelFactory` takes the call's use**, `chat` or `structured`, as
    OpenRouter's `require_parameters` is a model setting. Cost: none.
13. **`runTui` requires its routing**, as `runDump` does, so no caller
    falls back to the default routes unseen; `chatDeps` builds what each
    chat session takes from it, and is tested. Cost: none.
14. **Structured calls gain a cache breakpoint** on their system prompt
    on Anthropic, a constraint Part A's review left. Cost: a cache write
    costs 1.25 times the input price and lasts five minutes, so a
    service review alone pays it for nothing; repairs and backfill runs
    reuse it, and a prompt under the model's minimum is not cached at
    all. Cheap either way.
15. **Routes are read apart from the other tables.** The spec has
    `parseConfig` return the routing fault beside its warnings; the
    plan gives `core` `routingOf` and `readRouting` instead, so the
    other tables' readers, memory's among them, cannot meet a fault
    they would have to ignore. Cost: the TUI reads `config.toml` twice.
16. **A message of reasoning alone is dropped, not merged**, so another
    model may be sent two user messages in a row. Some local servers'
    chat templates refuse roles that do not alternate; that attempt
    fails as `rejected` and the next entry answers. Cost: rare, and a
    fallback, not a failure.
17. **A step an error ended prices nothing and warns of nothing**: the
    AI SDK reports such a step with no usage, which would otherwise
    raise a false "reported no usage" notice and spend the model's one.
    Cost: none.

## File structure

- `packages/core/src/models/routing.ts` (new): `parseRouting`,
  `isLoopback`, `Provider`, `Routing`, `RoutingResult`.
- `packages/core/src/config.ts`: `routingOf`, `readRouting`;
  `parseConfig` leaves `[providers]` and `[models]` alone.
- `packages/core/src/models/routes.ts`: `FIXED_ROOTS`.
- `packages/core/src/contracts/model.ts`: `KINDS` gains `huggingface`.
- `packages/core/src/models/prices.ts`: own-property price lookups.
- `packages/core/src/contracts/structured.ts`: `withNotes`.
- `packages/memory/src/memory/open.ts`, `service/service.ts`,
  `bodies/hook.ts`, `memory/review-backfill.ts`: calls wrapped in
  `withNotes`.
- `packages/agent/src/stream.ts` (new): `requestBase`, `readStream`.
- `packages/agent/src/providers.ts`: the new kinds, `Use`,
  `OPENROUTER_RETENTION`, `BREAKPOINT`, `instructionsFor`.
- `packages/agent/src/cost.ts`: `stepPrice`, `noUsageNotice`.
- `packages/agent/src/failures.ts`: classes by error name.
- `packages/agent/src/conversation.ts`, `structured.ts`: attempts on
  `readStream`; reasoning-only messages dropped; `keys` and `shown`.
- `packages/agent/src/recall-tools.ts`: `recallEnv`'s `keys`.
- `packages/agent/src/capture.ts`: `dumpRequest` takes the chat route.
- `packages/agent/src/testing.ts`: `fakeCompletions`.
- `packages/agent/src/wire.test.ts` (new): the Chat Completions kinds.
- `packages/cli/src/models.ts`: `COOLDOWNS`, `chatRouting`,
  `loadRouting`; `index.ts`, `run-tui.ts`, `dump.ts`, `claude-hook.ts`
  route from config.
- `README.md`, `packages/agent/AGENTS.md`, `packages/core/AGENTS.md`,
  `packages/cli/AGENTS.md`.
- `docs/reports/2026-11-01-model-providers.md`: Part B's verification
  (Task 8).

---

### Task 1: Routing in config.toml

`core` reads `[providers]` and `[models]` into a `Routing`, or every
fault; `parseConfig` leaves both tables to it. Price lookups take own
properties only.

**Files:**

- Create: `packages/core/src/models/routing.ts`,
  `packages/core/src/models/routing.test.ts`
- Modify: `packages/core/src/config.ts`, `config.test.ts`,
  `contracts/model.ts`, `index.ts`, `models/routes.ts`,
  `models/prices.ts`, `models/prices.test.ts`

**Interfaces:**

- Consumes: Part A's `ROLES`, `KINDS`, `RouteEntry`, `Routes`,
  `DEFAULT_MODELS`, `ANTHROPIC_API_ROOT`, `ANTHROPIC_KEY`.
- Produces:
  - `KINDS`: `["anthropic", "openrouter", "featherless", "huggingface",
    "local"]`.
  - `FIXED_ROOTS: { openrouter; featherless; huggingface }`, the roots
    above.
  - `type Routing = { routes: Routes; keys: string[] }`.
  - `type RoutingResult = { ok: true; routing: Routing } | { ok: false;
    faults: string[] }`.
  - `parseRouting(data: Record<string, unknown>): RoutingResult`.
  - `isLoopback(text: string): boolean`.
  - `routingOf(text: string): RoutingResult`, and
    `readRouting(env?: Env): Promise<RoutingResult>`, no file giving
    the default routes with `keys: ["ANTHROPIC_API_KEY"]`.

- [ ] **Step 1: Add the failing tests**

Run: `patch_of 1 | git apply`

````diff
diff --git a/packages/core/src/config.test.ts b/packages/core/src/config.test.ts
index 0226f06..0a645bc 100644
--- a/packages/core/src/config.test.ts
+++ b/packages/core/src/config.test.ts
@@ -17,7 +17,10 @@ import {
     DEFAULT_CONFIG,
     parseConfig,
     readConfig,
+    readRouting,
+    routingOf,
 } from "./config.js";
+import { defaultRoutes } from "./models/routes.js";

 describe("parseConfig", () => {
     it("gives the defaults for an empty file", () => {
@@ -534,3 +537,96 @@ describe("readConfig", () => {
         }
     });
 });
+
+describe("routing in config.toml", () => {
+    let dir = "";
+    beforeEach(async () => {
+        dir = await mkdtemp(join(tmpdir(), "dorothy-routing-"));
+    });
+    afterEach(async () => {
+        await rm(dir, { recursive: true, force: true });
+    });
+
+    it("leaves [providers] and [models] to routingOf, unwarned", () => {
+        const text = [
+            "[providers.anthropic]",
+            'kind = "nonsense"',
+            "",
+            "[models]",
+            "chat = []",
+        ].join("\n");
+        expect(parseConfig(text)).toEqual({
+            config: DEFAULT_CONFIG,
+            warnings: [],
+        });
+        expect(routingOf(text).ok).toBe(false);
+    });
+
+    it("keeps the default routes for a broken file that routes nothing", () => {
+        expect(routingOf('[memory]\nenabled = true\nbudget = "\n')).toEqual({
+            ok: true,
+            routing: { routes: defaultRoutes(), keys: ["ANTHROPIC_API_KEY"] },
+        });
+    });
+
+    it.each([
+        '[providers.anthropic]\nkind = "anthropic"\nbudget = "\n',
+        '[memory]\nbudget = "\n[models]\nchat = ["anthropic:x"]\n',
+        'models = { chat = ["anthropic:x"] }\nbudget = "\n',
+        'providers.anthropic.kind = "anthropic"\nbudget = "\n',
+        '[ "models" ]\nchat = ["anthropic:x"]\nbudget = "\n',
+    ])("faults a broken file that routes, naming its line: %j", (text) => {
+        expect(routingOf(text)).toEqual({
+            ok: false,
+            faults: [
+                expect.stringMatching(
+                    /^config\.toml line \d+: .+; its routes cannot be read$/,
+                ),
+            ],
+        });
+    });
+
+    it("faults a file that does not parse, naming its line", () => {
+        expect(
+            routingOf('[models]\nchat = ["anthropic:x"]\nbudget = "\n'),
+        ).toEqual({
+            ok: false,
+            faults: [
+                expect.stringMatching(
+                    /^config\.toml line 3: .+; its routes cannot be read$/,
+                ),
+            ],
+        });
+    });
+
+    it("routes every role to its default with no file", async () => {
+        expect(await readRouting({ XDG_CONFIG_HOME: dir })).toEqual({
+            ok: true,
+            routing: { routes: defaultRoutes(), keys: ["ANTHROPIC_API_KEY"] },
+        });
+    });
+
+    it("reads $XDG_CONFIG_HOME/dorothy/config.toml's routes", async () => {
+        await mkdir(join(dir, "dorothy"));
+        await writeFile(
+            join(dir, "dorothy", "config.toml"),
+            '[models]\nchat = ["anthropic:claude-sonnet-5-5"]\n',
+        );
+        const result = await readRouting({ XDG_CONFIG_HOME: dir });
+        expect(result.ok && result.routing.routes.chat[0]?.model).toBe(
+            "claude-sonnet-5-5",
+        );
+    });
+
+    it("faults a file that cannot be read", async () => {
+        await mkdir(join(dir, "dorothy", "config.toml"), { recursive: true });
+        expect(await readRouting({ XDG_CONFIG_HOME: dir })).toEqual({
+            ok: false,
+            faults: [
+                expect.stringMatching(
+                    /^config\.toml: .+; its routes cannot be read$/,
+                ),
+            ],
+        });
+    });
+});
diff --git a/packages/core/src/models/prices.test.ts b/packages/core/src/models/prices.test.ts
index 9042249..7bb72d1 100644
--- a/packages/core/src/models/prices.test.ts
+++ b/packages/core/src/models/prices.test.ts
@@ -60,6 +60,12 @@ describe("stepCost", () => {
         ).toBeNull();
     });

+    it("knows no price for a model named as an object's own property", () => {
+        for (const model of ["constructor", "toString", "__proto__"]) {
+            expect(stepCost(anthropicEntry(model), usage(1000))).toBeNull();
+        }
+    });
+
     it("knows no price for another kind without one", () => {
         const entry = { ...anthropicEntry("m"), kind: "local" as const };
         expect(stepCost(entry, usage(10))).toBeNull();
diff --git a/packages/core/src/models/routing.test.ts b/packages/core/src/models/routing.test.ts
new file mode 100644
index 0000000..ef92bca
--- /dev/null
+++ b/packages/core/src/models/routing.test.ts
@@ -0,0 +1,370 @@
+// vim:set expandtab shiftwidth=4 filetype=typescript:
+// SPDX-License-Identifier: GPL-3.0-only
+
+//
+//
+// ~xxdorothy/dorothy.git
+// ::: :/packages/core/src/models/routing.test.ts
+//
+//
+
+import { describe, expect, it } from "bun:test";
+import { defaultRoutes } from "./routes.js";
+import { isLoopback, parseRouting, type RoutingResult } from "./routing.js";
+
+const parse = (text: string): RoutingResult =>
+    parseRouting(Bun.TOML.parse(text) as Record<string, unknown>);
+
+const faultsOf = (text: string): string[] => {
+    const result = parse(text);
+    if (result.ok) {
+        throw new Error("expected faults");
+    }
+    return result.faults;
+};
+
+const routingOf = (text: string) => {
+    const result = parse(text);
+    if (!result.ok) {
+        throw new Error(result.faults.join("\n"));
+    }
+    return result.routing;
+};
+
+const PROVIDERS = [
+    "[providers.anthropic]",
+    'kind = "anthropic"',
+    'key = "ANTHROPIC_API_KEY"',
+    "",
+    "[providers.openrouter]",
+    'kind = "openrouter"',
+    'key = "OPENROUTER_API_KEY"',
+    "",
+    "[providers.featherless]",
+    'kind = "featherless"',
+    'key = "FEATHERLESS_API_KEY"',
+    "",
+    "[providers.hf]",
+    'kind = "huggingface"',
+    'key = "HF_TOKEN"',
+    "",
+    "[providers.ollama]",
+    'kind = "local"',
+    'base-url = "http://127.0.0.1:11434/v1"',
+    "",
+].join("\n");
+
+describe("parseRouting", () => {
+    it("routes every role to its default on Anthropic with no tables", () => {
+        expect(parse("")).toEqual({
+            ok: true,
+            routing: { routes: defaultRoutes(), keys: ["ANTHROPIC_API_KEY"] },
+        });
+    });
+
+    it("reads each kind, its fixed root, its key and a route of each", () => {
+        const routing = routingOf(
+            [
+                PROVIDERS,
+                "[models]",
+                'chat = ["anthropic:claude-opus-5-5", "openrouter:x/y"]',
+                "review = [",
+                '    "featherless:org/model",',
+                '    { model = "hf:org/model:featherless-ai", price = [0.1, 0.2] },',
+                '    { model = "ollama:llama3", price = [0, 0] },',
+                "]",
+            ].join("\n"),
+        );
+        expect(routing.routes.chat).toEqual([
+            {
+                provider: "anthropic",
+                kind: "anthropic",
+                model: "claude-opus-5-5",
+                baseUrl: "https://api.anthropic.com",
+                key: "ANTHROPIC_API_KEY",
+                price: null,
+            },
+            {
+                provider: "openrouter",
+                kind: "openrouter",
+                model: "x/y",
+                baseUrl: "https://openrouter.ai/api/v1",
+                key: "OPENROUTER_API_KEY",
+                price: null,
+            },
+        ]);
+        expect(routing.routes.review).toEqual([
+            {
+                provider: "featherless",
+                kind: "featherless",
+                model: "org/model",
+                baseUrl: "https://api.featherless.ai/v1",
+                key: "FEATHERLESS_API_KEY",
+                price: null,
+            },
+            {
+                provider: "hf",
+                kind: "huggingface",
+                model: "org/model:featherless-ai",
+                baseUrl: "https://router.huggingface.co/v1",
+                key: "HF_TOKEN",
+                price: [0.1, 0.2],
+            },
+            {
+                provider: "ollama",
+                kind: "local",
+                model: "llama3",
+                baseUrl: "http://127.0.0.1:11434/v1",
+                key: null,
+                price: [0, 0],
+            },
+        ]);
+        expect(routing.routes.compaction).toEqual(defaultRoutes().compaction);
+        expect(routing.keys).toEqual([
+            "ANTHROPIC_API_KEY",
+            "OPENROUTER_API_KEY",
+            "FEATHERLESS_API_KEY",
+            "HF_TOKEN",
+        ]);
+    });
+
+    it("splits an entry at its first colon", () => {
+        const routing = routingOf(
+            [PROVIDERS, "[models]", 'chat = ["openrouter:x/y:free"]'].join(
+                "\n",
+            ),
+        );
+        expect(routing.routes.chat[0]?.model).toBe("x/y:free");
+    });
+
+    it("takes an anthropic base-url on loopback, and a local key", () => {
+        const routing = routingOf(
+            [
+                "[providers.anthropic]",
+                'kind = "anthropic"',
+                'key = "ANTHROPIC_API_KEY"',
+                'base-url = "http://localhost:8080"',
+                "",
+                "[providers.vllm]",
+                'kind = "local"',
+                'base-url = "https://[::1]:8000/v1"',
+                'key = "VLLM_KEY"',
+                "",
+                "[models]",
+                'maintenance = ["vllm:qwen"]',
+            ].join("\n"),
+        );
+        expect(routing.routes.chat[0]?.baseUrl).toBe("http://localhost:8080");
+        expect(routing.routes.maintenance[0]).toMatchObject({
+            baseUrl: "https://[::1]:8000/v1",
+            key: "VLLM_KEY",
+        });
+    });
+
+    it("faults a route on an anthropic provider not named anthropic, left out", () => {
+        expect(
+            faultsOf(
+                [
+                    "[providers.claude]",
+                    'kind = "anthropic"',
+                    'key = "ANTHROPIC_API_KEY"',
+                    "",
+                    "[models]",
+                    'chat = ["claude:claude-opus-5-5"]',
+                    'review = ["claude:claude-sonnet-5-5"]',
+                    'compaction = ["claude:claude-sonnet-5-5"]',
+                ].join("\n"),
+            ),
+        ).toEqual([
+            "config.toml: models.maintenance is missing, and no anthropic provider named anthropic gives its default",
+        ]);
+    });
+
+    it.each([
+        [
+            "a role outside the four",
+            '[models]\nsummary = ["anthropic:claude-haiku-5-5"]',
+            "config.toml: models.summary: the roles are chat, review, compaction, maintenance",
+        ],
+        [
+            "an empty route",
+            "[models]\nchat = []",
+            "config.toml: models.chat must be a list of one model or more",
+        ],
+        [
+            "a route that is not a list",
+            '[models]\nchat = "anthropic:claude-opus-5-5"',
+            "config.toml: models.chat must be a list of one model or more",
+        ],
+        [
+            "an entry with no colon",
+            '[models]\nchat = ["claude-opus-5-5"]',
+            'config.toml: models.chat: "claude-opus-5-5" is not "provider:model"',
+        ],
+        [
+            "an entry with no model",
+            '[models]\nchat = ["anthropic:"]',
+            'config.toml: models.chat: "anthropic:" is not "provider:model"',
+        ],
+        [
+            "an undeclared provider",
+            '[models]\nchat = ["openrouter:x/y"]',
+            "config.toml: models.chat: no provider is named openrouter",
+        ],
+        [
+            "a price on an anthropic entry",
+            '[models]\nchat = [{ model = "anthropic:claude-opus-5-5", price = [1, 2] }]',
+            "config.toml: models.chat: anthropic:claude-opus-5-5 cannot carry a price; only featherless, huggingface, local entries do",
+        ],
+        [
+            "a price that is not two amounts",
+            '[models]\nchat = [{ model = "anthropic:claude-opus-5-5", price = [1] }]',
+            "config.toml: models.chat: a price is two dollar amounts per million tokens, input and output, such as [0.1, 0.1]",
+        ],
+        [
+            "a negative price",
+            '[models]\nchat = [{ model = "anthropic:claude-opus-5-5", price = [-1, 1] }]',
+            "config.toml: models.chat: a price is two dollar amounts per million tokens, input and output, such as [0.1, 0.1]",
+        ],
+        [
+            "an entry table with a setting it does not take",
+            '[models]\nchat = [{ model = "anthropic:claude-opus-5-5", effort = "low" }]',
+            "config.toml: models.chat: an entry takes no effort",
+        ],
+        [
+            "an entry that is neither text nor a table",
+            "[models]\nchat = [3]",
+            'config.toml: models.chat: an entry is "provider:model" or { model = "provider:model", price = [in, out] }',
+        ],
+        [
+            "models that is not a table",
+            'models = "anthropic:claude-opus-5-5"',
+            "config.toml: models is not a table",
+        ],
+    ])("faults %s", (_name, text, fault) => {
+        expect(faultsOf(text)).toEqual([fault]);
+    });
+
+    it.each([
+        [
+            "a kind outside the five",
+            '[providers.anthropic]\nkind = "openai"\nkey = "OPENAI_API_KEY"',
+            "config.toml: providers.anthropic.kind must be one of anthropic, openrouter, featherless, huggingface, local",
+        ],
+        [
+            "a setting its kind does not take",
+            '[providers.anthropic]\nkind = "openrouter"\nkey = "OPENROUTER_API_KEY"\nbase-url = "http://127.0.0.1:1"',
+            "config.toml: providers.anthropic: an openrouter provider takes no base-url",
+        ],
+        [
+            "a setting no kind takes",
+            '[providers.anthropic]\nkind = "anthropic"\nkey = "ANTHROPIC_API_KEY"\nmodel = "x"',
+            "config.toml: providers.anthropic: an anthropic provider takes no model",
+        ],
+        [
+            "a missing key",
+            '[providers.anthropic]\nkind = "anthropic"',
+            "config.toml: providers.anthropic.key is required",
+        ],
+        [
+            "a key that holds a value",
+            '[providers.anthropic]\nkind = "anthropic"\nkey = "sk-ant-api03-abc"',
+            'config.toml: providers.anthropic.key must name a secret, such as "ANTHROPIC_API_KEY", never hold one',
+        ],
+        [
+            "a local provider with no base-url",
+            '[providers.anthropic]\nkind = "local"',
+            "config.toml: providers.anthropic.base-url is required",
+        ],
+        [
+            "a name with a colon",
+            '[providers."a:b"]\nkind = "local"\nbase-url = "http://127.0.0.1:1/v1"',
+            "config.toml: providers.a:b: a provider's name is letters, digits, - and _, starting with a letter or digit",
+        ],
+        [
+            "a provider that is not a table",
+            'providers.anthropic = "anthropic"',
+            "config.toml: providers.anthropic is not a table",
+        ],
+        [
+            "providers that is not a table",
+            'providers = "anthropic"',
+            "config.toml: providers is not a table",
+        ],
+    ])("faults %s", (_name, text, fault) => {
+        // Each provider here is named anthropic, so that a fault in it is
+        // the only one: the defaults' routes need no provider of their own.
+        expect(faultsOf(text)).toEqual([fault]);
+    });
+
+    it("reports every fault, not the first", () => {
+        expect(
+            faultsOf(
+                [
+                    "[providers.anthropic]",
+                    'kind = "anthropic"',
+                    "",
+                    "[models]",
+                    "chat = []",
+                ].join("\n"),
+            ),
+        ).toEqual([
+            "config.toml: providers.anthropic.key is required",
+            "config.toml: models.chat must be a list of one model or more",
+        ]);
+    });
+
+    it.each([
+        "http://127.0.0.1.example.com/v1",
+        "http://localhost.example.com/v1",
+        "http://127.0.0.1@example.com/v1",
+        "http://user:pass@127.0.0.1/v1",
+        "http://10.0.0.1/v1",
+        "ftp://127.0.0.1/v1",
+        "127.0.0.1:11434",
+        "https://api.anthropic.com",
+    ])("refuses %s as a local base-url", (url) => {
+        expect(
+            faultsOf(
+                `[providers.anthropic]\nkind = "local"\nbase-url = "${url}"`,
+            ),
+        ).toEqual([
+            'config.toml: providers.anthropic.base-url must be a loopback http or https URL, such as "http://127.0.0.1:11434/v1"',
+        ]);
+    });
+
+    it("refuses a remote anthropic base-url", () => {
+        expect(
+            faultsOf(
+                '[providers.anthropic]\nkind = "anthropic"\nkey = "ANTHROPIC_API_KEY"\nbase-url = "https://proxy.example.com"',
+            ),
+        ).toEqual([
+            'config.toml: providers.anthropic.base-url must be a loopback http or https URL, such as "http://127.0.0.1:8080"',
+        ]);
+    });
+});
+
+describe("isLoopback", () => {
+    it.each([
+        "http://localhost:11434/v1",
+        "https://localhost/v1",
+        "http://127.0.0.1:8080",
+        "http://127.255.255.254/v1",
+        "http://[::1]:8000/v1",
+        // The parser writes these as 127.0.0.1 and [::1].
+        "http://127.1/v1",
+        "http://[0:0:0:0:0:0:0:1]/v1",
+        "http://LOCALHOST/v1",
+    ])("takes %s", (url) => {
+        expect(isLoopback(url)).toBe(true);
+    });
+
+    it.each([
+        "http://localhost./v1",
+        "http://[::ffff:127.0.0.1]/v1",
+        "http://0.0.0.0/v1",
+        "not a url",
+    ])("refuses %s", (url) => {
+        expect(isLoopback(url)).toBe(false);
+    });
+});
````

- [ ] **Step 2: Run them to see them fail**

```bash
bun test packages/core/src/models/routing.test.ts \
    packages/core/src/config.test.ts packages/core/src/models/prices.test.ts
```

Expected: FAIL: `routing.js` cannot be found, `readRouting` and
`routingOf` are not exported, and the own-property price test receives
`NaN`.

- [ ] **Step 3: Add the code**

Run: `patch_of 2 | git apply`

````diff
diff --git a/packages/core/src/config.ts b/packages/core/src/config.ts
index a12bf2f..2679ab9 100644
--- a/packages/core/src/config.ts
+++ b/packages/core/src/config.ts
@@ -11,6 +11,7 @@
 import { readFile } from "node:fs/promises";
 import { isIP } from "node:net";
 import { isAbsolute, join } from "node:path";
+import { parseRouting, type RoutingResult } from "./models/routing.js";
 import { type Env, xdgDir } from "./xdg.js";

 export const MODULE_NAMES = [
@@ -418,7 +419,7 @@ function errorLine(text: string): number {
 }

 // A broken file never stops Dorothy: each problem is a warning, and whatever
-// it spoils falls back to the default.
+// it spoils falls back to the default. Its routes are routingOf's.
 export function parseConfig(text: string): {
     config: Config;
     warnings: string[];
@@ -456,6 +457,8 @@ export function parseConfig(text: string): {
             config.service = parseService(value, warnings);
         } else if (key === "recording") {
             config.recording = parseRecording(value, warnings);
+        } else if (key === "providers" || key === "models") {
+            // Read by parseRouting, whose faults are errors.
         } else {
             warnings.push(`config.toml: unknown key ${key}`);
         }
@@ -463,6 +466,34 @@ export function parseConfig(text: string): {
     return { config, warnings };
 }

+// A line that opens or sets [providers] or [models], in any of TOML's
+// forms: a table header, a dotted key or an inline table.
+const ROUTING_LINE =
+    /^\s*(\[\s*"?(providers|models)"?\s*[\].]|"?(providers|models)"?\s*[.=])/m;
+
+// The routes config.toml gives, or its faults. A file that does not
+// parse is a fault here only if it routes: the routes it meant cannot be
+// known. One that names no routes keeps the default routes, and
+// parseConfig's warning names its line.
+export function routingOf(text: string): RoutingResult {
+    let data: unknown;
+    try {
+        data = Bun.TOML.parse(text);
+    } catch (error) {
+        if (!ROUTING_LINE.test(text)) {
+            return parseRouting({});
+        }
+        const reason = describeError(error).replace(/^TOML Parse error: /, "");
+        return {
+            ok: false,
+            faults: [
+                `config.toml line ${errorLine(text)}: ${reason}; its routes cannot be read`,
+            ],
+        };
+    }
+    return parseRouting(data as Record<string, unknown>);
+}
+
 export function configPath(env: Env = process.env): string {
     return join(
         xdgDir(env, "XDG_CONFIG_HOME", ".config"),
@@ -489,3 +520,25 @@ export async function readConfig(
     }
     return parseConfig(text);
 }
+
+// No file routes every role to its default on Anthropic; a file that
+// cannot be read is a fault.
+export async function readRouting(
+    env: Env = process.env,
+): Promise<RoutingResult> {
+    let text: string;
+    try {
+        text = await readFile(configPath(env), "utf8");
+    } catch (error) {
+        if ((error as { code?: unknown }).code === "ENOENT") {
+            return parseRouting({});
+        }
+        return {
+            ok: false,
+            faults: [
+                `config.toml: ${describeError(error)}; its routes cannot be read`,
+            ],
+        };
+    }
+    return routingOf(text);
+}
diff --git a/packages/core/src/contracts/model.ts b/packages/core/src/contracts/model.ts
index f059402..c93fd1a 100644
--- a/packages/core/src/contracts/model.ts
+++ b/packages/core/src/contracts/model.ts
@@ -20,13 +20,14 @@ export const KINDS = [
     "anthropic",
     "openrouter",
     "featherless",
+    "huggingface",
     "local",
 ] as const;
 export type Kind = (typeof KINDS)[number];

 // One model a role may use, with what reaching it needs.
 export type RouteEntry = {
-    // The provider it came from, [providers.<name>] in Part B's config.
+    // The provider it came from: [providers.<name>] in config.toml.
     provider: string;
     kind: Kind;
     model: string;
diff --git a/packages/core/src/index.ts b/packages/core/src/index.ts
index df1e7a8..0879968 100644
--- a/packages/core/src/index.ts
+++ b/packages/core/src/index.ts
@@ -24,6 +24,7 @@ export * from "./models/cooldowns.js";
 export * from "./models/fallback.js";
 export * from "./models/prices.js";
 export * from "./models/routes.js";
+export * from "./models/routing.js";
 export * from "./secrets.js";
 export * from "./session-id.js";
 export * from "./timers.js";
diff --git a/packages/core/src/models/prices.ts b/packages/core/src/models/prices.ts
index dd7fb46..58e95ee 100644
--- a/packages/core/src/models/prices.ts
+++ b/packages/core/src/models/prices.ts
@@ -75,10 +75,11 @@ function priceOf(entry: RouteEntry, usage: StepUsage): Price | null {
     if (entry.kind !== "anthropic") {
         return null;
     }
-    const priced = ANTHROPIC_PRICES[entry.model];
-    if (priced === undefined) {
+    // Own keys only: a model named "constructor" has no price.
+    if (!Object.hasOwn(ANTHROPIC_PRICES, entry.model)) {
         return null;
     }
+    const priced = ANTHROPIC_PRICES[entry.model] as Priced;
     const prompt = usage.noCache + usage.cacheRead + usage.cacheWrite;
     return priced.over !== undefined && prompt > priced.over.tokens
         ? priced.over.price
diff --git a/packages/core/src/models/routes.ts b/packages/core/src/models/routes.ts
index 6b73741..4cb4ccb 100644
--- a/packages/core/src/models/routes.ts
+++ b/packages/core/src/models/routes.ts
@@ -8,8 +8,9 @@
 //
 //

-// Part A's routes: each role's default model on Anthropic's Messages
-// API, one entry each, until config.toml routes them.
+// Each role's default model on Anthropic's Messages API, one entry
+// each: the routes when config.toml names none, and the API roots of
+// the kinds whose root is fixed.

 import {
     ROLES,
@@ -29,6 +30,14 @@ export const DEFAULT_MODELS: Readonly<Record<Role, string>> = {
 export const ANTHROPIC_API_ROOT = "https://api.anthropic.com";
 export const ANTHROPIC_KEY = "ANTHROPIC_API_KEY";

+// The kinds whose root no config may change: their API roots, as each
+// provider documents them.
+export const FIXED_ROOTS = {
+    openrouter: "https://openrouter.ai/api/v1",
+    featherless: "https://api.featherless.ai/v1",
+    huggingface: "https://router.huggingface.co/v1",
+} as const;
+
 export function anthropicEntry(model: string): RouteEntry {
     return {
         provider: "anthropic",
diff --git a/packages/core/src/models/routing.ts b/packages/core/src/models/routing.ts
new file mode 100644
index 0000000..4de4640
--- /dev/null
+++ b/packages/core/src/models/routing.ts
@@ -0,0 +1,374 @@
+// vim:set expandtab shiftwidth=4 filetype=typescript:
+// SPDX-License-Identifier: GPL-3.0-only
+
+//
+//
+// ~xxdorothy/dorothy.git
+// ::: :/packages/core/src/models/routing.ts
+//
+//
+
+// config.toml's [providers] and [models]: which providers Dorothy's
+// requests may reach, and each role's ordered list of models on them.
+// Unlike the other tables, a fault here is no warning: a default could
+// send her requests where the user did not mean, so the caller refuses
+// to route at all.
+
+import {
+    KINDS,
+    type Kind,
+    ROLES,
+    type Role,
+    type Route,
+    type RouteEntry,
+    type Routes,
+} from "../contracts/model.js";
+import {
+    ANTHROPIC_API_ROOT,
+    ANTHROPIC_KEY,
+    DEFAULT_MODELS,
+    FIXED_ROOTS,
+} from "./routes.js";
+
+// A [providers.<name>] table, read.
+export type Provider = {
+    name: string;
+    kind: Kind;
+    key: string | null;
+    baseUrl: string;
+};
+
+// Every role's route, and the secrets.json names every provider gives,
+// which the recall server must never see.
+export type Routing = { routes: Routes; keys: string[] };
+
+export type RoutingResult =
+    | { ok: true; routing: Routing }
+    | { ok: false; faults: string[] };
+
+// A name a route entry can carry: no colon, which ends it, and no dot,
+// which TOML would read as a nested table.
+const PROVIDER_NAME = /^[A-Za-z0-9][A-Za-z0-9_-]*$/;
+// A secrets.json name, never a value.
+const KEY_NAME = /^[A-Z_][A-Z0-9_]*$/;
+
+// The kinds that may carry a price, having no price table of their own
+// and no cost in their responses.
+const PRICED: readonly Kind[] = ["featherless", "huggingface", "local"];
+
+type Rule = {
+    key: "required" | "optional";
+    baseUrl: "none" | "optional" | "required";
+};
+
+// Each kind as a fault names it, and the base-url it would take.
+const ARTICLE: Readonly<Record<Kind, string>> = {
+    anthropic: "an",
+    openrouter: "an",
+    featherless: "a",
+    huggingface: "a",
+    local: "a",
+};
+const BASE_URL_EXAMPLE: Readonly<Record<Kind, string>> = {
+    anthropic: "http://127.0.0.1:8080",
+    openrouter: "",
+    featherless: "",
+    huggingface: "",
+    local: "http://127.0.0.1:11434/v1",
+};
+
+const RULES: Readonly<Record<Kind, Rule>> = {
+    anthropic: { key: "required", baseUrl: "optional" },
+    openrouter: { key: "required", baseUrl: "none" },
+    featherless: { key: "required", baseUrl: "none" },
+    huggingface: { key: "required", baseUrl: "none" },
+    local: { key: "optional", baseUrl: "required" },
+};
+
+const isRecord = (value: unknown): value is Record<string, unknown> =>
+    typeof value === "object" && value !== null && !Array.isArray(value);
+const isKind = (value: unknown): value is Kind =>
+    (KINDS as readonly unknown[]).includes(value);
+const isRole = (name: string): name is Role =>
+    (ROLES as readonly string[]).includes(name);
+
+// Loopback by the parsed URL alone: localhost, 127.0.0.0/8 or [::1],
+// over http or https, with no user or password. The parser has already
+// written any other form of a loopback address in one of these.
+export function isLoopback(text: string): boolean {
+    let url: URL;
+    try {
+        url = new URL(text);
+    } catch {
+        return false;
+    }
+    if (url.protocol !== "http:" && url.protocol !== "https:") {
+        return false;
+    }
+    if (url.username !== "" || url.password !== "") {
+        return false;
+    }
+    const host = url.hostname;
+    return (
+        host === "localhost" ||
+        host === "[::1]" ||
+        /^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(host)
+    );
+}
+
+// The provider config.toml implies when it declares none.
+const IMPLIED: Provider = {
+    name: "anthropic",
+    kind: "anthropic",
+    key: ANTHROPIC_KEY,
+    baseUrl: ANTHROPIC_API_ROOT,
+};
+
+function readProvider(
+    name: string,
+    value: unknown,
+    faults: string[],
+): Provider | null {
+    const at = `config.toml: providers.${name}`;
+    if (!PROVIDER_NAME.test(name)) {
+        faults.push(
+            `${at}: a provider's name is letters, digits, - and _, starting with a letter or digit`,
+        );
+        return null;
+    }
+    if (!isRecord(value)) {
+        faults.push(`${at} is not a table`);
+        return null;
+    }
+    const kind = value.kind;
+    if (!isKind(kind)) {
+        faults.push(`${at}.kind must be one of ${KINDS.join(", ")}`);
+        return null;
+    }
+    const rule = RULES[kind];
+    const before = faults.length;
+    for (const setting of Object.keys(value)) {
+        if (
+            setting !== "kind" &&
+            setting !== "key" &&
+            !(setting === "base-url" && rule.baseUrl !== "none")
+        ) {
+            faults.push(
+                `${at}: ${ARTICLE[kind]} ${kind} provider takes no ${setting}`,
+            );
+        }
+    }
+    const key = value.key;
+    if (key === undefined) {
+        if (rule.key === "required") {
+            faults.push(`${at}.key is required`);
+        }
+    } else if (typeof key !== "string" || !KEY_NAME.test(key)) {
+        faults.push(
+            `${at}.key must name a secret, such as "ANTHROPIC_API_KEY", never hold one`,
+        );
+    }
+    const baseUrl = value["base-url"];
+    if (baseUrl === undefined) {
+        if (rule.baseUrl === "required") {
+            faults.push(`${at}.base-url is required`);
+        }
+    } else if (
+        rule.baseUrl !== "none" &&
+        (typeof baseUrl !== "string" || !isLoopback(baseUrl))
+    ) {
+        faults.push(
+            `${at}.base-url must be a loopback http or https URL, such as "${BASE_URL_EXAMPLE[kind]}"`,
+        );
+    }
+    if (faults.length > before) {
+        return null;
+    }
+    return {
+        name,
+        kind,
+        key: typeof key === "string" ? key : null,
+        baseUrl:
+            typeof baseUrl === "string"
+                ? baseUrl
+                : kind === "anthropic"
+                  ? ANTHROPIC_API_ROOT
+                  : FIXED_ROOTS[kind as keyof typeof FIXED_ROOTS],
+    };
+}
+
+function readProviders(
+    value: unknown,
+    faults: string[],
+): Map<string, Provider> {
+    if (value === undefined) {
+        return new Map([[IMPLIED.name, IMPLIED]]);
+    }
+    const providers = new Map<string, Provider>();
+    if (!isRecord(value)) {
+        faults.push("config.toml: providers is not a table");
+        return providers;
+    }
+    for (const [name, table] of Object.entries(value)) {
+        const provider = readProvider(name, table, faults);
+        if (provider !== null) {
+            providers.set(name, provider);
+        }
+    }
+    return providers;
+}
+
+const entryOf = (
+    provider: Provider,
+    model: string,
+    price: [number, number] | null,
+): RouteEntry => ({
+    provider: provider.name,
+    kind: provider.kind,
+    model,
+    baseUrl: provider.baseUrl,
+    key: provider.key,
+    price,
+});
+
+const isPrice = (value: unknown): value is [number, number] =>
+    Array.isArray(value) &&
+    value.length === 2 &&
+    value.every(
+        (each) =>
+            typeof each === "number" && Number.isFinite(each) && each >= 0,
+    );
+
+// One item of a route: "provider:model", or { model, price }.
+function readEntry(
+    at: string,
+    item: unknown,
+    providers: Map<string, Provider>,
+    declared: ReadonlySet<string>,
+    faults: string[],
+): RouteEntry | null {
+    let text: unknown = item;
+    let price: [number, number] | null = null;
+    if (isRecord(item)) {
+        for (const setting of Object.keys(item)) {
+            if (setting !== "model" && setting !== "price") {
+                faults.push(`${at}: an entry takes no ${setting}`);
+                return null;
+            }
+        }
+        text = item.model;
+        if (item.price !== undefined) {
+            if (!isPrice(item.price)) {
+                faults.push(
+                    `${at}: a price is two dollar amounts per million tokens, input and output, such as [0.1, 0.1]`,
+                );
+                return null;
+            }
+            price = item.price;
+        }
+    }
+    if (typeof text !== "string") {
+        faults.push(
+            `${at}: an entry is "provider:model" or { model = "provider:model", price = [in, out] }`,
+        );
+        return null;
+    }
+    // At the first colon: a model's own name may hold more.
+    const colon = text.indexOf(":");
+    const name = colon === -1 ? "" : text.slice(0, colon);
+    const model = colon === -1 ? "" : text.slice(colon + 1);
+    if (name === "" || model === "") {
+        faults.push(`${at}: "${text}" is not "provider:model"`);
+        return null;
+    }
+    const provider = providers.get(name);
+    if (provider === undefined) {
+        // A provider declared with a fault has said so already.
+        if (!declared.has(name)) {
+            faults.push(`${at}: no provider is named ${name}`);
+        }
+        return null;
+    }
+    if (price !== null && !PRICED.includes(provider.kind)) {
+        faults.push(
+            `${at}: ${text} cannot carry a price; only ${PRICED.join(", ")} entries do`,
+        );
+        return null;
+    }
+    return entryOf(provider, model, price);
+}
+
+function readRoutes(
+    value: unknown,
+    providers: Map<string, Provider>,
+    declared: ReadonlySet<string>,
+    faults: string[],
+): Partial<Routes> {
+    const routes: Partial<Routes> = {};
+    if (value === undefined) {
+        return routes;
+    }
+    if (!isRecord(value)) {
+        faults.push("config.toml: models is not a table");
+        return routes;
+    }
+    for (const [role, list] of Object.entries(value)) {
+        const at = `config.toml: models.${role}`;
+        if (!isRole(role)) {
+            faults.push(`${at}: the roles are ${ROLES.join(", ")}`);
+            continue;
+        }
+        if (!Array.isArray(list) || list.length === 0) {
+            faults.push(`${at} must be a list of one model or more`);
+            continue;
+        }
+        const route: Route = [];
+        for (const item of list) {
+            const entry = readEntry(at, item, providers, declared, faults);
+            if (entry !== null) {
+                route.push(entry);
+            }
+        }
+        routes[role] = route;
+    }
+    return routes;
+}
+
+// Reads the two tables from config.toml's parsed data; every other table
+// is parseConfig's.
+export function parseRouting(data: Record<string, unknown>): RoutingResult {
+    const faults: string[] = [];
+    const providers = readProviders(data.providers, faults);
+    // A role left out is a fault of its own only where every provider
+    // was read: one that was not has said so already.
+    const providersRead = faults.length === 0;
+    const declared = new Set(
+        isRecord(data.providers) ? Object.keys(data.providers) : [],
+    );
+    const given = readRoutes(data.models, providers, declared, faults);
+    const anthropic = providers.get("anthropic");
+    const routes = {} as Routes;
+    for (const role of ROLES) {
+        const route = given[role];
+        if (route !== undefined) {
+            routes[role] = route;
+        } else if (anthropic?.kind === "anthropic") {
+            routes[role] = [entryOf(anthropic, DEFAULT_MODELS[role], null)];
+        } else if (providersRead) {
+            faults.push(
+                `config.toml: models.${role} is missing, and no anthropic provider named anthropic gives its default`,
+            );
+        }
+    }
+    if (faults.length > 0) {
+        return { ok: false, faults };
+    }
+    const keys = [
+        ...new Set(
+            [...providers.values()].flatMap((provider) =>
+                provider.key === null ? [] : [provider.key],
+            ),
+        ),
+    ];
+    return { ok: true, routing: { routes, keys } };
+}
````

- [ ] **Step 4: Run them to see them pass**

Run: `bun test packages/core`
Expected: PASS, 214 tests, 0 fail.

- [ ] **Step 5: Check**

Run `bun run format`, then the check on temporary roots (Global
Constraints). Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add -A packages/core
git commit -m "feat(core): Read routes from config.toml" \
    -m "[providers] and [models] give each role an ordered list of models
on five provider kinds; a fault in either is an error, never a
default. Price lookups take own properties only."
```

### Task 2: Fallback notes through memory

`withNotes` says each note a structured call's outcome carries; memory
wraps every call it is handed in it.

**Files:**

- Create: `packages/core/src/contracts/structured.test.ts`
- Modify: `packages/core/src/contracts/structured.ts`,
  `packages/memory/src/memory/open.ts`,
  `packages/memory/src/service/service.ts`,
  `packages/memory/src/bodies/hook.ts`,
  `packages/memory/src/memory/review-backfill.ts`,
  `packages/memory/src/memory/open-compaction.test.ts`,
  `packages/memory/src/memory/review-backfill.test.ts`

**Interfaces:**

- Consumes: `StructuredCall`, `StructuredOutcome.notes`.
- Produces: `withNotes(call: StructuredCall, say: (message: string) =>
  void): StructuredCall`, saying `<request.what>: <note>` per note and
  passing the outcome on. Memory's TUI warnings read `memory:
  <what>: <note>`.

- [ ] **Step 1: Add the failing tests**

Run: `patch_of 3 | git apply`

````diff
diff --git a/packages/core/src/contracts/structured.test.ts b/packages/core/src/contracts/structured.test.ts
new file mode 100644
index 0000000..b0d2a02
--- /dev/null
+++ b/packages/core/src/contracts/structured.test.ts
@@ -0,0 +1,64 @@
+// vim:set expandtab shiftwidth=4 filetype=typescript:
+// SPDX-License-Identifier: GPL-3.0-only
+
+//
+//
+// ~xxdorothy/dorothy.git
+// ::: :/packages/core/src/contracts/structured.test.ts
+//
+//
+
+import { describe, expect, it } from "bun:test";
+import {
+    type StructuredOutcome,
+    type StructuredRequest,
+    withNotes,
+} from "./structured.js";
+
+const REQUEST: StructuredRequest = {
+    what: "review",
+    system: "s",
+    prompt: "p",
+    schema: {},
+    timeoutMs: 1000,
+};
+
+describe("withNotes", () => {
+    it.each([
+        {
+            ok: true,
+            output: {},
+            model: "b:m",
+            costUsd: 0.1,
+            notes: ["a:m refused (usage: spent); answering with b:m"],
+        },
+        {
+            ok: false,
+            reason: "a:m: usage: spent; b:m: server: down",
+            costUsd: 0,
+            notes: ["a:m refused (usage: spent); answering with b:m"],
+        },
+    ] satisfies StructuredOutcome[])(
+        "says each note with what the call was for, passing the outcome on",
+        async (outcome) => {
+            const said: string[] = [];
+            const call = withNotes(
+                async () => outcome,
+                (message) => said.push(message),
+            );
+            expect(await call(REQUEST)).toBe(outcome);
+            expect(said).toEqual([
+                "review: a:m refused (usage: spent); answering with b:m",
+            ]);
+        },
+    );
+
+    it("says nothing of an outcome with no notes", async () => {
+        const said: string[] = [];
+        await withNotes(
+            async () => ({ ok: true, output: {}, model: "a:m", costUsd: 0 }),
+            (message) => said.push(message),
+        )(REQUEST);
+        expect(said).toEqual([]);
+    });
+});
diff --git a/packages/memory/src/memory/open-compaction.test.ts b/packages/memory/src/memory/open-compaction.test.ts
index fc2f8c4..3416d84 100644
--- a/packages/memory/src/memory/open-compaction.test.ts
+++ b/packages/memory/src/memory/open-compaction.test.ts
@@ -109,6 +109,8 @@ describe("a chat compacted end to end", () => {
                 },
                 model: "claude-test",
                 costUsd: 0.1,
+                // A fallback on the way, which the chat is told of.
+                notes: ["a:m refused (usage: spent); answering with b:m"],
             };
         };
         const starts: SessionStart[] = [];
@@ -130,6 +132,12 @@ describe("a chat compacted end to end", () => {
             throw new Error(opened.message);
         }
         const { memory } = opened;
+        const warned: string[] = [];
+        memory.notices?.subscribe((notice) => {
+            if (notice.type === "warning") {
+                warned.push(notice.message);
+            }
+        });
         const words = ["walnut", "kiln", "ember", "loom", "quill", "tarn"];
         const reply = (inner: FakeSession, replied: string, context: number) =>
             inner.emit({
@@ -186,6 +194,9 @@ describe("a chat compacted end to end", () => {
         // The call was sent the transcript's own turns, under their
         // transcript numbers.
         expect(compactions).toHaveLength(1);
+        expect(warned).toContain(
+            "memory: compaction: a:m refused (usage: spent); answering with b:m",
+        );
         for (const [at, turn] of turns.slice(0, 4).entries()) {
             const who = turn.role === "user" ? "User" : "Dorothy";
             expect(compactions[0]?.prompt).toContain(
diff --git a/packages/memory/src/memory/review-backfill.test.ts b/packages/memory/src/memory/review-backfill.test.ts
index 8ca9502..bb2c20e 100644
--- a/packages/memory/src/memory/review-backfill.test.ts
+++ b/packages/memory/src/memory/review-backfill.test.ts
@@ -191,6 +191,23 @@ describe("runReviewBackfill", () => {
         });
     });

+    it("warns of a call's fallback notes, reviewing all the same", async () => {
+        await conversation(1, NOW.getTime());
+        const warnings: string[] = [];
+        const result = await runReviewBackfill({
+            ...options(async (request) => ({
+                ...(await good(request)),
+                notes: ["a:m refused (usage: spent); answering with b:m"],
+            })),
+            count: 1,
+            warn: (message) => warnings.push(message),
+        });
+        expect(result).toEqual({ ...emptyCounts, reviewed: 1 });
+        expect(warnings).toEqual([
+            "memory: review: a:m refused (usage: spent); answering with b:m",
+        ]);
+    });
+
     it("defaults to the newest 25 and leaves the rest marked", async () => {
         const ids: string[] = [];
         for (let n = 1; n <= 26; n++)
````

- [ ] **Step 2: Run them to see them fail**

```bash
bun test packages/core/src/contracts/structured.test.ts \
    packages/memory/src/memory/open-compaction.test.ts \
    packages/memory/src/memory/review-backfill.test.ts
```

Expected: FAIL: `withNotes` is not exported; the compaction and
backfill tests find no note among the warnings.

- [ ] **Step 3: Add the code**

Run: `patch_of 4 | git apply`

````diff
diff --git a/packages/core/src/contracts/structured.ts b/packages/core/src/contracts/structured.ts
index 5edbae6..586e5b3 100644
--- a/packages/core/src/contracts/structured.ts
+++ b/packages/core/src/contracts/structured.ts
@@ -38,3 +38,16 @@ export type StructuredOutcome =
 export type StructuredCall = (
     request: StructuredRequest,
 ) => Promise<StructuredOutcome>;
+
+// call, saying each outcome's notes as they come, with what the call was
+// for: "review: anthropic:claude-sonnet-5-5 refused (...); answering
+// with ...". Memory says them where it says that call's failures.
+export const withNotes =
+    (call: StructuredCall, say: (message: string) => void): StructuredCall =>
+    async (request) => {
+        const outcome = await call(request);
+        for (const note of outcome.notes ?? []) {
+            say(`${request.what}: ${note}`);
+        }
+        return outcome;
+    };
diff --git a/packages/memory/src/bodies/hook.ts b/packages/memory/src/bodies/hook.ts
index ab6e69d..11e7ce1 100644
--- a/packages/memory/src/bodies/hook.ts
+++ b/packages/memory/src/bodies/hook.ts
@@ -29,6 +29,7 @@ import {
     type StructuredCall,
     sleep,
     type Timers,
+    withNotes,
 } from "@dorothy/core";
 import { dataRoot } from "../facts/store.js";
 import { commandHistory } from "../history/commands.js";
@@ -402,7 +403,7 @@ async function stepsFor(
                     index,
                     vocabulary: vocabularyPath(env),
                     versions,
-                    call: agent.call,
+                    call: withNotes(agent.call, (message) => log.warn(message)),
                     persona: agent.persona,
                     now,
                     entries: () => loaded.entries,
diff --git a/packages/memory/src/memory/open.ts b/packages/memory/src/memory/open.ts
index ab38776..d95c1c8 100644
--- a/packages/memory/src/memory/open.ts
+++ b/packages/memory/src/memory/open.ts
@@ -21,6 +21,7 @@ import {
     type SessionStart,
     type StructuredCall,
     type Turn,
+    withNotes,
 } from "@dorothy/core";
 import { startNotices } from "../bodies/unread.js";
 import { COMPACTION_TIMEOUT_MS } from "../compaction/compact.js";
@@ -551,6 +552,11 @@ export async function openMemory({
     // told at chat's start as at dorothy --claude's.
     warnings.push(...(await startNotices(env).catch(() => [])));

+    // What memory tells the chat as it runs, its calls' fallback notes
+    // among it.
+    const channel = noticeChannel();
+    const say = (message: string) => channel.warn(`memory: ${message}`);
+
     // The index and history open before anything is read, so that
     // history restores a broken file first. The index serves compaction
     // whenever the config lets it, since this chat's notes are not read
@@ -587,7 +593,7 @@ export async function openMemory({
                   history,
                   config,
                   versions: launched?.history.handle() ?? null,
-                  call: calls.review,
+                  call: withNotes(calls.review, say),
                   persona: prompts.review,
                   transcript,
                   warnings,
@@ -614,7 +620,6 @@ export async function openMemory({
     // Canonical writers prefer history's combined lock, falling back
     // to the index when history is unavailable.
     const writeLock = launched?.history.lock ?? claims?.lock;
-    const channel = noticeChannel();
     // Chat syncs its project at its start and after each turn; with
     // memory off, or without a lock to sync under, it does not.
     const syncer =
@@ -629,7 +634,7 @@ export async function openMemory({
               clusters,
               prompts,
               recollect: recall !== null,
-              call: calls.compaction,
+              call: withNotes(calls.compaction, say),
               dir,
               phrase,
               path,
diff --git a/packages/memory/src/memory/review-backfill.ts b/packages/memory/src/memory/review-backfill.ts
index 07a684b..759d037 100644
--- a/packages/memory/src/memory/review-backfill.ts
+++ b/packages/memory/src/memory/review-backfill.ts
@@ -15,6 +15,7 @@ import {
     isPhrase,
     readConfig,
     type StructuredCall,
+    withNotes,
 } from "@dorothy/core";
 import { dataRoot } from "../facts/store.js";
 import { indexPath, RecallIndex } from "../recall/store.js";
@@ -168,7 +169,7 @@ export async function runReviewBackfill({
             index,
             vocabulary,
             versions,
-            call,
+            call: withNotes(call, (message) => warn(`memory: ${message}`)),
             persona,
             now,
             entries: () => entries.values(),
diff --git a/packages/memory/src/service/service.ts b/packages/memory/src/service/service.ts
index 90c6122..b2450c1 100644
--- a/packages/memory/src/service/service.ts
+++ b/packages/memory/src/service/service.ts
@@ -23,6 +23,7 @@ import {
     type RecordResponse,
     SERVICE_PATHS,
     type StructuredCall,
+    withNotes,
 } from "@dorothy/core";
 import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
 import { hookLog } from "../bodies/log.js";
@@ -181,7 +182,9 @@ export async function startService(
                       index,
                       vocabulary,
                       versions: launched?.history.handle() ?? null,
-                      call: options.review.call,
+                      call: withNotes(options.review.call, (message) =>
+                          warn(`memory: ${message}`),
+                      ),
                       persona: options.review.persona,
                       now,
                       entries: () => entries,
````

- [ ] **Step 4: Run them to see them pass**

Run: `bun test packages/core packages/memory`
Expected: PASS.

- [ ] **Step 5: Check**

Run `bun run format`, then the check on temporary roots. Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add -A packages/core packages/memory
git commit -m "feat(memory): Say structured calls' fallback notes" \
    -m "core's withNotes says each note an outcome carries; memory wraps
the calls it is handed, so a fallback shows as a TUI warning, a
service or hook log line, or on the backfill's stderr."
```

### Task 3: One stream reader for every attempt

Chat's attempts and structured calls read a request's stream through one
helper, as Part A's review asked before more kinds arrive. On the way:
a step's cost is OpenRouter's own figure where it gives one, a response
with no usage warns once, errors with no status are classed by name,
and structured calls cache their system prompt on Anthropic. No
behaviour of chat changes.

**Files:**

- Create: `packages/agent/src/stream.ts`
- Modify: `packages/agent/src/conversation.ts`, `structured.ts`,
  `providers.ts`, `cost.ts`, `failures.ts`, and their tests
  `cost.test.ts`, `failures.test.ts`, `structured.test.ts`,
  `providers.test.ts`

**Interfaces:**

- Consumes: Part A's `Watchdog`, `failureOf`, `stepUsage`, `stepCost`,
  `providerOptions`.
- Produces:
  - `type Use = "chat" | "structured"`; `type ModelFactory = (entry:
    RouteEntry, key: string, use: Use) => LanguageModel`.
  - `BREAKPOINT`, and `instructionsFor(entry, system)`: a system message
    with a breakpoint on Anthropic, else the text.
  - `requestBase(entry, key, use, model, watchdog)`: `{ model,
    maxRetries: 0, abortSignal, providerOptions, onError }`.
  - `readStream<R>(entry, watchdog, start: () => R, { onPart?, notice
    }): Promise<{ ok: true; result: R; costUsd } | { ok: false;
    failure: Failure; costUsd }>`.
  - `stepPrice(entry, usage, metadata): { costUsd: number; notice:
    string | null }`; `noUsageNotice(entry)`.

- [ ] **Step 1: Add the failing tests**

Run: `patch_of 5 | git apply`

````diff
diff --git a/packages/agent/src/cost.test.ts b/packages/agent/src/cost.test.ts
index 6ca2996..141a6d9 100644
--- a/packages/agent/src/cost.test.ts
+++ b/packages/agent/src/cost.test.ts
@@ -10,7 +10,7 @@

 import { describe, expect, it } from "bun:test";
 import { anthropicEntry } from "@dorothy/core";
-import { stepUsage, unpricedNotice } from "./cost.js";
+import { stepPrice, stepUsage, unpricedNotice } from "./cost.js";

 describe("stepUsage", () => {
     it("takes the uncached input, cache reads and writes, and output", () => {
@@ -58,3 +58,70 @@ describe("unpricedNotice", () => {
         expect(unpricedNotice(entry)).toBeNull();
     });
 });
+
+describe("stepPrice", () => {
+    const usage = (input: number, output: number) =>
+        ({
+            inputTokens: input,
+            inputTokenDetails: { noCacheTokens: input },
+            outputTokens: output,
+        }) as never;
+    const openrouter = {
+        ...anthropicEntry("x/y"),
+        provider: "openrouter",
+        kind: "openrouter" as const,
+    };
+
+    it("prices an Anthropic step by core's table", () => {
+        expect(
+            stepPrice(
+                anthropicEntry("claude-sonnet-5-5"),
+                usage(1_000_000, 1_000_000),
+                undefined,
+            ),
+        ).toEqual({ costUsd: 12, notice: null });
+    });
+
+    it("takes OpenRouter's own figure for its steps", () => {
+        expect(
+            stepPrice(openrouter, usage(10, 5), {
+                openrouter: { usage: { cost: 0.0042 } },
+            }),
+        ).toEqual({ costUsd: 0.0042, notice: null });
+    });
+
+    it("warns once of an OpenRouter step that gave no figure", () => {
+        const entry = { ...openrouter, model: "x/no-figure" };
+        expect(stepPrice(entry, usage(10, 5), undefined)).toEqual({
+            costUsd: 0,
+            notice: "no price is known for openrouter:x/no-figure; its cost shows as $0",
+        });
+        expect(stepPrice(entry, usage(10, 5), undefined).notice).toBeNull();
+    });
+
+    it("warns once of a step with no usage", () => {
+        const entry = anthropicEntry("claude-no-usage-test");
+        const none = {} as never;
+        expect(stepPrice(entry, none, undefined)).toEqual({
+            costUsd: 0,
+            notice: "anthropic:claude-no-usage-test reported no usage; its cost shows as $0",
+        });
+        expect(stepPrice(entry, none, undefined).notice).toBeNull();
+    });
+
+    it("warns of nothing on a free entry, usage or none", () => {
+        const entry = {
+            ...anthropicEntry("free-test"),
+            kind: "local" as const,
+            price: [0, 0] as [number, number],
+        };
+        expect(stepPrice(entry, {} as never, undefined)).toEqual({
+            costUsd: 0,
+            notice: null,
+        });
+        expect(stepPrice(entry, usage(10, 5), undefined)).toEqual({
+            costUsd: 0,
+            notice: null,
+        });
+    });
+});
diff --git a/packages/agent/src/failures.test.ts b/packages/agent/src/failures.test.ts
index e1a6248..8616459 100644
--- a/packages/agent/src/failures.test.ts
+++ b/packages/agent/src/failures.test.ts
@@ -9,7 +9,14 @@
 //

 import { describe, expect, it } from "bun:test";
-import { APICallError } from "ai";
+import {
+    APICallError,
+    InvalidPromptError,
+    InvalidResponseDataError,
+    JSONParseError,
+    NoSuchModelError,
+    UnsupportedFunctionalityError,
+} from "ai";
 import { classOf, failureOf, retryAfterMs } from "./failures.js";

 const apiError = (
@@ -114,6 +121,47 @@ describe("failureOf", () => {
             retryAfterMs: null,
         });
     });
+    it("takes a connection the SDK could not make for the network", () => {
+        const error = new APICallError({
+            message: "Cannot connect to API: Unable to connect",
+            url: "http://127.0.0.1:1/v1/chat/completions",
+            requestBodyValues: {},
+            isRetryable: true,
+        });
+        expect(failureOf(error).class).toBe("network");
+    });
+    it.each([
+        [
+            "AI_JSONParseError",
+            new JSONParseError({ text: "{not json", cause: null }),
+            "server",
+        ],
+        [
+            "AI_InvalidResponseDataError",
+            new InvalidResponseDataError({ data: {}, message: "no choices" }),
+            "server",
+        ],
+        [
+            "AI_InvalidPromptError",
+            new InvalidPromptError({ prompt: "", message: "bad" }),
+            "rejected",
+        ],
+        [
+            "AI_UnsupportedFunctionalityError",
+            new UnsupportedFunctionalityError({ functionality: "audio" }),
+            "rejected",
+        ],
+        [
+            "AI_NoSuchModelError",
+            new NoSuchModelError({ modelId: "x", modelType: "languageModel" }),
+            "rejected",
+        ],
+    ] as const)(
+        "classes %s, which has no status, by its name",
+        (_name, error, kind) => {
+            expect(failureOf(error).class).toBe(kind);
+        },
+    );
     it("takes a thrown non-Error value for the network, by its text", () => {
         expect(failureOf("connection reset")).toEqual({
             class: "network",
diff --git a/packages/agent/src/providers.test.ts b/packages/agent/src/providers.test.ts
index c7e4dc1..8c463cb 100644
--- a/packages/agent/src/providers.test.ts
+++ b/packages/agent/src/providers.test.ts
@@ -34,7 +34,7 @@ const entryAt = (url: string) => ({
 // The first error part of a one-message stream, or null.
 async function firstError(url: string): Promise<unknown> {
     const result = streamText({
-        model: languageModel(entryAt(url), "test-key"),
+        model: languageModel(entryAt(url), "test-key", "chat"),
         prompt: "hi",
         maxRetries: 0,
         onError: () => {},
@@ -212,7 +212,7 @@ describe("providerOptions", () => {
             baseUrl: server.url,
         };
         const result = streamText({
-            model: languageModel(entry, "test-key"),
+            model: languageModel(entry, "test-key", "chat"),
             prompt: "hi",
             maxRetries: 0,
             onError: () => {},
diff --git a/packages/agent/src/structured.test.ts b/packages/agent/src/structured.test.ts
index f7a48a5..8aeec18 100644
--- a/packages/agent/src/structured.test.ts
+++ b/packages/agent/src/structured.test.ts
@@ -76,7 +76,13 @@ describe("structuredCall", () => {
             costUsd: 12,
         });
         const sent = model.doStreamCalls[0];
-        expect(sent?.prompt[0]).toEqual({ role: "system", content: "persona" });
+        expect(sent?.prompt[0]).toEqual({
+            role: "system",
+            content: "persona",
+            providerOptions: {
+                anthropic: { cacheControl: { type: "ephemeral" } },
+            },
+        });
         expect(sent?.responseFormat).toMatchObject({
             type: "json",
             schema: SCHEMA,
@@ -94,6 +100,44 @@ describe("structuredCall", () => {
         });
     });

+    it("says nothing of usage on a step an error ended", async () => {
+        const entry = { ...SONNET, model: "claude-error-step-test" };
+        const model = mockModel(
+            [
+                {
+                    chunks: [
+                        { type: "stream-start", warnings: [] },
+                        { type: "error", error: new Error("boom") },
+                        {
+                            type: "finish",
+                            usage: {
+                                inputTokens: {
+                                    total: undefined,
+                                    noCache: undefined,
+                                    cacheRead: undefined,
+                                    cacheWrite: undefined,
+                                },
+                                outputTokens: {
+                                    total: undefined,
+                                    text: undefined,
+                                    reasoning: undefined,
+                                },
+                            },
+                            finishReason: { unified: "error", raw: undefined },
+                        },
+                    ],
+                },
+            ],
+            entry.model,
+        );
+        const outcome = await structuredCall({
+            route: [entry],
+            env,
+            model: () => model,
+        })(REQUEST);
+        expect(outcome).toEqual({ ok: false, reason: "boom", costUsd: 0 });
+    });
+
     it("fails JSON of another shape than the schema's", async () => {
         const { call } = callWith([{ chunks: textChunks("[1,2]") }]);
         expect(await call(REQUEST)).toMatchObject({
````

- [ ] **Step 2: Run them to see them fail**

```bash
bun test packages/agent/src/cost.test.ts \
    packages/agent/src/failures.test.ts packages/agent/src/structured.test.ts
```

Expected: FAIL: `stepPrice` is not exported; the named errors come out
`network`; the structured call's system message has no breakpoint; a
step an error ended raises a no-usage notice.

- [ ] **Step 3: Add the code**

Run: `patch_of 6 | git apply`

````diff
diff --git a/packages/agent/src/conversation.ts b/packages/agent/src/conversation.ts
index 1574e20..b322ea5 100644
--- a/packages/agent/src/conversation.ts
+++ b/packages/agent/src/conversation.ts
@@ -20,7 +20,6 @@ import {
     Cooldowns,
     defaultRoutes,
     type Env,
-    type Failure,
     label,
     type RawMessage,
     REAL_TIMERS,
@@ -29,13 +28,12 @@ import {
     type RouteEntry,
     runRoute,
     type SessionStart,
-    stepCost,
     type Timers,
     withSection,
 } from "@dorothy/core";
 import { type ModelMessage, stepCountIs, streamText } from "ai";
 import { STALL_MS, secretFailure, Watchdog } from "./attempt.js";
-import { stepUsage, unpricedNotice } from "./cost.js";
+import { stepUsage } from "./cost.js";
 import { failureOf } from "./failures.js";
 import {
     type PersonaMode,
@@ -44,10 +42,11 @@ import {
     withHistory,
 } from "./persona.js";
 import {
+    BREAKPOINT,
+    instructionsFor,
     keyOf,
     languageModel,
     type ModelFactory,
-    providerOptions,
 } from "./providers.js";
 import {
     type ConnectRecall,
@@ -55,16 +54,12 @@ import {
     type RecallTools,
     recallEnv,
 } from "./recall-tools.js";
+import { readStream, requestBase } from "./stream.js";
 import { TurnState } from "./turn.js";

 export const MAX_STEPS = 10;
 export const STEP_LIMIT_WARNING = "the reply stopped after ten tool steps";

-// Anthropic's prompt cache: the system prompt, and the latest message.
-const BREAKPOINT = {
-    anthropic: { cacheControl: { type: "ephemeral" as const } },
-};
-
 // A session's start and the persona it speaks with. Every field may be
 // left out, for tests and the dump.
 export type SessionSetup = Partial<SessionStart> & { persona?: PersonaMode };
@@ -117,8 +112,8 @@ export type ConversationDeps = {
     now?: () => number;
 };

-// A message, and the model that made it, null for the user's and for
-// text kept from an interrupted turn.
+// A message, and the label of the model that made it, null for the
+// user's and for text kept from an interrupted turn.
 type Stored = { message: ModelMessage; by: string | null };
 type Answer = { messages: ModelMessage[]; limited: boolean };

@@ -463,82 +458,71 @@ export class Conversation implements ChatSession {
             };
         }
         const watchdog = new Watchdog(signal, this.#stallMs, this.#timers);
-        let costUsd = 0;
-        let failure: Failure | null = null;
-        let aborted = false;
         let limited = false;
+        let costUsd = 0;
         try {
-            const result = streamText({
-                model: this.#model(entry, key),
-                instructions:
-                    entry.kind === "anthropic"
-                        ? {
-                              role: "system",
-                              content: this.#setup.system,
-                              providerOptions: BREAKPOINT,
-                          }
-                        : this.#setup.system,
-                messages: this.#outgoing(entry, text),
-                ...(this.#recall === null ? {} : { tools: this.#recall.tools }),
-                stopWhen: stepCountIs(MAX_STEPS),
-                maxRetries: 0,
-                abortSignal: watchdog.signal,
-                providerOptions: providerOptions(entry),
-                onError: () => {},
-            });
-            for await (const part of result.fullStream) {
-                watchdog.touch();
-                this.#emit({ type: "sdk", message: rawOf(part) });
-                switch (part.type) {
-                    case "text-delta":
-                        turn.text(part.text, this.#now());
-                        break;
-                    case "tool-call":
-                        turn.call(part.toolCallId, part.toolName, part.input);
-                        break;
-                    case "tool-result":
-                        turn.result(part.toolCallId, part.output);
-                        break;
-                    case "tool-error":
-                        turn.error(part.toolCallId);
-                        break;
-                    case "finish-step": {
-                        const usage = stepUsage(part.usage);
-                        turn.step(usage);
-                        const cost = stepCost(entry, usage);
-                        if (cost === null) {
-                            const notice = unpricedNotice(entry);
-                            if (notice !== null) {
-                                this.#emit({
-                                    type: "warning",
-                                    message: notice,
-                                });
-                            }
+            const read = await readStream(
+                entry,
+                watchdog,
+                () =>
+                    streamText({
+                        ...requestBase(
+                            entry,
+                            key,
+                            "chat",
+                            this.#model,
+                            watchdog,
+                        ),
+                        instructions: instructionsFor(
+                            entry,
+                            this.#setup.system,
+                        ),
+                        messages: this.#outgoing(entry, text),
+                        ...(this.#recall === null
+                            ? {}
+                            : { tools: this.#recall.tools }),
+                        stopWhen: stepCountIs(MAX_STEPS),
+                    }),
+                {
+                    onPart: (part) => {
+                        this.#emit({ type: "sdk", message: rawOf(part) });
+                        switch (part.type) {
+                            case "text-delta":
+                                turn.text(part.text, this.#now());
+                                break;
+                            case "tool-call":
+                                turn.call(
+                                    part.toolCallId,
+                                    part.toolName,
+                                    part.input,
+                                );
+                                break;
+                            case "tool-result":
+                                turn.result(part.toolCallId, part.output);
+                                break;
+                            case "tool-error":
+                                turn.error(part.toolCallId);
+                                break;
+                            case "finish-step":
+                                turn.step(stepUsage(part.usage));
+                                limited = part.finishReason === "tool-calls";
+                                break;
                         }
-                        costUsd += cost ?? 0;
-                        limited = part.finishReason === "tool-calls";
-                        break;
-                    }
-                    case "error":
-                        failure ??= failureOf(part.error);
-                        break;
-                    case "abort":
-                        aborted = true;
-                        break;
-                }
-            }
-            if (aborted) {
+                    },
+                    notice: (message) =>
+                        this.#emit({ type: "warning", message }),
+                },
+            );
+            costUsd = read.costUsd;
+            if (!read.ok) {
                 return {
                     ok: false,
-                    failure: watchdog.failure(),
+                    failure: read.failure,
                     started: turn.started,
                     costUsd,
                 };
             }
-            if (failure !== null) {
-                return { ok: false, failure, started: turn.started, costUsd };
-            }
-            const steps = await result.steps;
+            const steps = await read.result.steps;
             return {
                 ok: true,
                 value: {
diff --git a/packages/agent/src/cost.ts b/packages/agent/src/cost.ts
index 4505eb9..115d6eb 100644
--- a/packages/agent/src/cost.ts
+++ b/packages/agent/src/cost.ts
@@ -8,11 +8,15 @@
 //
 //

-// A step's usage as core prices it, and the notice for a model with no
-// price.
+// A step's usage and cost, and the notices for a cost unknown.

-import { label, type RouteEntry, type StepUsage } from "@dorothy/core";
-import type { LanguageModelUsage } from "ai";
+import {
+    label,
+    type RouteEntry,
+    type StepUsage,
+    stepCost,
+} from "@dorothy/core";
+import type { LanguageModelUsage, ProviderMetadata } from "ai";

 export function stepUsage(usage: LanguageModelUsage): StepUsage {
     const details = usage.inputTokenDetails;
@@ -31,15 +35,60 @@ export function stepUsage(usage: LanguageModelUsage): StepUsage {
     };
 }

-// Models already warned of, for the process.
-const unpriced = new Set<string>();
+// Notices already given, for the process: one of each kind per model.
+const warned = new Set<string>();
+
+function once(kind: string, entry: RouteEntry, message: string): string | null {
+    const key = `${kind} ${label(entry)}`;
+    if (warned.has(key)) {
+        return null;
+    }
+    warned.add(key);
+    return message;
+}

 // Once a process per model: its cost shows as $0.
 export function unpricedNotice(entry: RouteEntry): string | null {
-    const name = label(entry);
-    if (unpriced.has(name)) {
-        return null;
+    return once(
+        "price",
+        entry,
+        `no price is known for ${label(entry)}; its cost shows as $0`,
+    );
+}
+
+export function noUsageNotice(entry: RouteEntry): string | null {
+    return once(
+        "usage",
+        entry,
+        `${label(entry)} reported no usage; its cost shows as $0`,
+    );
+}
+
+// OpenRouter's own figure for a step, which usage.include asks for.
+function openRouterCost(metadata: ProviderMetadata | undefined): number | null {
+    const usage = metadata?.openrouter?.usage as { cost?: unknown } | undefined;
+    return typeof usage?.cost === "number" ? usage.cost : null;
+}
+
+// A step's cost, and the notice, once a process per model, of a cost
+// unknown: no price, or no usage to price. A free entry, priced [0, 0],
+// is never warned of.
+export function stepPrice(
+    entry: RouteEntry,
+    usage: LanguageModelUsage,
+    metadata: ProviderMetadata | undefined,
+): { costUsd: number; notice: string | null } {
+    if (entry.price?.[0] === 0 && entry.price[1] === 0) {
+        return { costUsd: 0, notice: null };
+    }
+    if (usage.inputTokens === undefined && usage.outputTokens === undefined) {
+        return { costUsd: 0, notice: noUsageNotice(entry) };
     }
-    unpriced.add(name);
-    return `no price is known for ${name}; its cost shows as $0`;
+    const cost =
+        entry.kind === "openrouter"
+            ? openRouterCost(metadata)
+            : stepCost(entry, stepUsage(usage));
+    return cost === null
+        ? { costUsd: 0, notice: unpricedNotice(entry) }
+        : { costUsd: cost, notice: null };
 }
diff --git a/packages/agent/src/failures.ts b/packages/agent/src/failures.ts
index 4b71381..80ca104 100644
--- a/packages/agent/src/failures.ts
+++ b/packages/agent/src/failures.ts
@@ -66,7 +66,24 @@ export function classOf(status: number, message: string): FailureClass {
     return "rejected";
 }

+// An error with no status, by the AI SDK's name for it: a call that
+// never reached a provider is network; an answer the SDK could not read
+// is the provider's, as a 5xx is; a request it would not send is
+// rejected. An error it does not name stays network.
+const CLASS_OF_NAME: ReadonlyMap<string, FailureClass> = new Map([
+    ["AI_JSONParseError", "server"],
+    ["AI_InvalidResponseDataError", "server"],
+    ["AI_TypeValidationError", "server"],
+    ["AI_EmptyResponseBodyError", "server"],
+    ["AI_NoContentGeneratedError", "server"],
+    ["AI_InvalidPromptError", "rejected"],
+    ["AI_InvalidArgumentError", "rejected"],
+    ["AI_UnsupportedFunctionalityError", "rejected"],
+    ["AI_NoSuchModelError", "rejected"],
+]);
+
 type Wire = {
+    name?: unknown;
     statusCode?: unknown;
     responseHeaders?: Record<string, string>;
     data?: unknown;
@@ -106,7 +123,11 @@ export function failureOf(error: unknown, now = Date.now()): Failure {
               : String(error);
     const status = statusOf(wire);
     if (status === null) {
-        return { class: "network", message, retryAfterMs: null };
+        const named =
+            typeof wire.name === "string"
+                ? CLASS_OF_NAME.get(wire.name)
+                : undefined;
+        return { class: named ?? "network", message, retryAfterMs: null };
     }
     const kind = classOf(status, message);
     return {
diff --git a/packages/agent/src/providers.ts b/packages/agent/src/providers.ts
index b7ee8bc..40b6b04 100644
--- a/packages/agent/src/providers.ts
+++ b/packages/agent/src/providers.ts
@@ -27,21 +27,49 @@ export const noRedirect: typeof fetch = Object.assign(
     { preconnect: fetch.preconnect },
 );

-export type ModelFactory = (entry: RouteEntry, key: string) => LanguageModel;
+// What a model is asked for: a chat's reply, or structured output, for
+// which OpenRouter chooses only endpoints that honour the schema.
+export type Use = "chat" | "structured";
+
+export type ModelFactory = (
+    entry: RouteEntry,
+    key: string,
+    use: Use,
+) => LanguageModel;

 export const languageModel: ModelFactory = (entry, key) => {
+    const root = entry.baseUrl.replace(/\/+$/, "");
     switch (entry.kind) {
         case "anthropic":
             return createAnthropic({
-                baseURL: `${entry.baseUrl.replace(/\/+$/, "")}/v1`,
+                baseURL: `${root}/v1`,
                 apiKey: key,
                 fetch: noRedirect,
             })(entry.model);
         default:
-            throw new Error(`no provider for ${entry.kind} entries yet`);
+            throw new Error(
+                `no provider for ${(entry as { kind: string }).kind} entries`,
+            );
     }
 };

+// Anthropic's prompt cache: a breakpoint closes the prefix it caches.
+export const BREAKPOINT = {
+    anthropic: { cacheControl: { type: "ephemeral" as const } },
+};
+
+// A request's system prompt: on Anthropic, a system message carrying a
+// breakpoint, so that the prompt is cached; elsewhere its text.
+export function instructionsFor(entry: RouteEntry, system: string) {
+    return entry.kind === "anthropic"
+        ? {
+              role: "system" as const,
+              content: system,
+              providerOptions: BREAKPOINT,
+          }
+        : system;
+}
+
 // The key an entry names, from env: "" for a keyless entry, null when
 // the key it names is not set.
 export function keyOf(entry: RouteEntry, env: Env): string | null {
diff --git a/packages/agent/src/stream.ts b/packages/agent/src/stream.ts
new file mode 100644
index 0000000..1cab9fe
--- /dev/null
+++ b/packages/agent/src/stream.ts
@@ -0,0 +1,110 @@
+// vim:set expandtab shiftwidth=4 filetype=typescript:
+// SPDX-License-Identifier: GPL-3.0-only
+
+//
+//
+// ~xxdorothy/dorothy.git
+// ::: :/packages/agent/src/stream.ts
+//
+//
+
+// One request's stream, read as chat's attempts and structured calls'
+// both read it: every part feeds the watchdog; an error or abort part,
+// or a throw, becomes the attempt's Failure; each step's usage becomes
+// its cost, with a notice where that cost is unknown.
+
+import type { Failure, RouteEntry } from "@dorothy/core";
+import type { TextStreamPart, ToolSet } from "ai";
+import type { Watchdog } from "./attempt.js";
+import { stepPrice } from "./cost.js";
+import { failureOf } from "./failures.js";
+import { type ModelFactory, providerOptions, type Use } from "./providers.js";
+
+// What every request sets, beside its own prompt: the entry's model, no
+// retries, the attempt's own abort, the model's thinking, and nothing
+// written to the console.
+export function requestBase(
+    entry: RouteEntry,
+    key: string,
+    use: Use,
+    model: ModelFactory,
+    watchdog: Watchdog,
+) {
+    return {
+        model: model(entry, key, use),
+        maxRetries: 0,
+        abortSignal: watchdog.signal,
+        providerOptions: providerOptions(entry),
+        onError: () => {},
+    };
+}
+
+export type Streamed<R> =
+    | { ok: true; result: R; costUsd: number }
+    | { ok: false; failure: Failure; costUsd: number };
+
+export type ReadOptions = {
+    // Each part, after the watchdog has seen it. It may throw: the
+    // attempt then fails, as a throw from the stream would.
+    onPart?: (part: TextStreamPart<ToolSet>) => void;
+    // A cost unknown, once a process per model.
+    notice: (message: string) => void;
+};
+
+export async function readStream<
+    R extends { fullStream: AsyncIterable<TextStreamPart<ToolSet>> },
+>(
+    entry: RouteEntry,
+    watchdog: Watchdog,
+    start: () => R,
+    { onPart, notice }: ReadOptions,
+): Promise<Streamed<R>> {
+    let costUsd = 0;
+    let failure: Failure | null = null;
+    let aborted = false;
+    try {
+        const result = start();
+        for await (const part of result.fullStream) {
+            watchdog.touch();
+            onPart?.(part);
+            if (part.type === "error") {
+                failure ??= failureOf(part.error);
+            } else if (part.type === "abort") {
+                aborted = true;
+            } else if (part.type === "finish-step") {
+                // A step an error ended has no usage of its own: it costs
+                // nothing, and is no sign of a provider that reports none.
+                if (
+                    part.finishReason === "error" &&
+                    part.usage.inputTokens === undefined &&
+                    part.usage.outputTokens === undefined
+                ) {
+                    continue;
+                }
+                const step = stepPrice(
+                    entry,
+                    part.usage,
+                    part.providerMetadata,
+                );
+                costUsd += step.costUsd;
+                if (step.notice !== null) {
+                    notice(step.notice);
+                }
+            }
+        }
+        if (aborted) {
+            return { ok: false, failure: watchdog.failure(), costUsd };
+        }
+        return failure === null
+            ? { ok: true, result, costUsd }
+            : { ok: false, failure, costUsd };
+    } catch (error) {
+        return {
+            ok: false,
+            failure: watchdog.signal.aborted
+                ? watchdog.failure()
+                : failureOf(error),
+            costUsd,
+        };
+    }
+}
diff --git a/packages/agent/src/structured.ts b/packages/agent/src/structured.ts
index 11b3ded..84b00de 100644
--- a/packages/agent/src/structured.ts
+++ b/packages/agent/src/structured.ts
@@ -28,20 +28,19 @@ import {
     runRoute,
     type StructuredCall,
     type StructuredRequest,
-    stepCost,
     type Timers,
 } from "@dorothy/core";
 import { jsonSchema, type ModelMessage, Output, streamText } from "ai";
 import { z } from "zod";
 import { STALL_MS, secretFailure, Watchdog } from "./attempt.js";
-import { stepUsage } from "./cost.js";
 import { failureOf } from "./failures.js";
 import {
+    instructionsFor,
     keyOf,
     languageModel,
     type ModelFactory,
-    providerOptions,
 } from "./providers.js";
+import { readStream, requestBase } from "./stream.js";

 // Times a model is asked again after an answer that breaks its schema.
 export const STRUCTURED_REPAIRS = 2;
@@ -60,7 +59,7 @@ export type StructuredDeps = {

 type AttemptDeps = Required<
     Pick<StructuredDeps, "env" | "model" | "timers" | "stallMs">
->;
+> & { notice: (message: string) => void };

 // JSON of the schema's top-level type; the caller judges the rest.
 function fits(value: unknown, schema: Record<string, unknown>): boolean {
@@ -112,11 +111,19 @@ export function structuredCall({
     timers = REAL_TIMERS,
     stallMs = STALL_MS,
 }: StructuredDeps = {}): StructuredCall {
-    const deps: AttemptDeps = { env, model, timers, stallMs };
     return async (request) => {
         if (request.signal?.aborted) {
             return { ok: false, reason: "cancelled", costUsd: 0 };
         }
+        // A cost unknown is said beside the route's own notes.
+        const notices: string[] = [];
+        const deps: AttemptDeps = {
+            env,
+            model,
+            timers,
+            stallMs,
+            notice: (message) => notices.push(message),
+        };
         const outcome = await runRoute(
             route,
             (entry, signal) => attempt(entry, signal, request, deps),
@@ -129,8 +136,8 @@ export function structuredCall({
                     : { signal: request.signal }),
             },
         );
-        const notes =
-            outcome.notes.length === 0 ? {} : { notes: outcome.notes };
+        const said = [...outcome.notes, ...notices];
+        const notes = said.length === 0 ? {} : { notes: said };
         return outcome.ok
             ? {
                   ok: true,
@@ -164,51 +171,30 @@ async function ask(
     messages: ModelMessage[],
     deps: AttemptDeps,
 ): Promise<Round> {
-    let costUsd = 0;
-    let streamed: Failure | null = null;
-    let aborted = false;
-    try {
-        const result = streamText({
-            model: deps.model(entry, key),
-            instructions: system,
-            messages,
-            output: Output.object({ schema: jsonSchema(schema) }),
-            maxRetries: 0,
-            abortSignal: watchdog.signal,
-            providerOptions: providerOptions(entry),
-            onError: () => {},
-        });
-        for await (const part of result.fullStream) {
-            watchdog.touch();
-            if (part.type === "error") {
-                streamed ??= failureOf(part.error);
-            } else if (part.type === "abort") {
-                aborted = true;
-            } else if (part.type === "finish-step") {
-                costUsd += stepCost(entry, stepUsage(part.usage)) ?? 0;
-            }
-        }
-        if (aborted || streamed !== null) {
-            return {
-                output: undefined,
-                failure: aborted ? watchdog.failure() : streamed,
-                costUsd,
-            };
-        }
-        const output = await result.output.then(
-            (value) => value as unknown,
-            () => undefined,
-        );
-        return { output, failure: null, costUsd };
-    } catch (error) {
+    const read = await readStream(
+        entry,
+        watchdog,
+        () =>
+            streamText({
+                ...requestBase(entry, key, "structured", deps.model, watchdog),
+                instructions: instructionsFor(entry, system),
+                messages,
+                output: Output.object({ schema: jsonSchema(schema) }),
+            }),
+        { notice: deps.notice },
+    );
+    if (!read.ok) {
         return {
             output: undefined,
-            failure: watchdog.signal.aborted
-                ? watchdog.failure()
-                : failureOf(error),
-            costUsd,
+            failure: read.failure,
+            costUsd: read.costUsd,
         };
     }
+    const output = await read.result.output.then(
+        (value) => value as unknown,
+        () => undefined,
+    );
+    return { output, failure: null, costUsd: read.costUsd };
 }

 const unparsed = (message: string): Failure => ({
````

- [ ] **Step 4: Run them to see them pass**

Run: `bun test packages/agent`
Expected: PASS, 164 tests, 0 fail.

- [ ] **Step 5: Check**

Run `bun run format`, then the check on temporary roots. Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add -A packages/agent
git commit -m "feat(agent): Read every stream through one helper" \
    -m "readStream feeds the watchdog, turns error and abort parts into
Failures and costs each step, for chat and structured calls alike.
OpenRouter's own cost is taken where given, a response with no usage
warns once, errors with no status are classed by name, and structured
calls cache their system prompt on Anthropic."
```

### Task 4: OpenRouter, featherless, Hugging Face and local servers

The four kinds beside Anthropic's: OpenRouter's provider, always told to
deny data collection and keep to zero-retention endpoints, and the
OpenAI-compatible provider for the rest.

**Files:**

- Create: `packages/agent/src/wire.test.ts`
- Modify: `packages/agent/package.json`, `bun.lock`,
  `packages/agent/src/providers.ts`, `testing.ts`, `capture.test.ts`

**Interfaces:**

- Consumes: Task 3's `ModelFactory`, `Use`, `readStream`; Task 1's
  kinds.
- Produces: `languageModel` for every kind; `OPENROUTER_RETENTION`;
  `fakeCompletions(replies: CompletionReply[])`, a loopback Chat
  Completions fake keeping each request's `paths`, `bodies` and `auth`.

- [ ] **Step 1: Add the failing tests**

Run: `patch_of 7 | git apply`

````diff
diff --git a/packages/agent/src/capture.test.ts b/packages/agent/src/capture.test.ts
index 1eb8376..efdc395 100644
--- a/packages/agent/src/capture.test.ts
+++ b/packages/agent/src/capture.test.ts
@@ -152,13 +152,13 @@ describe("dumpRequest", () => {
         const body = await dumpRequest({
             setup: {},
             message: "hi",
-            entry: { ...OPUS, kind: "local" },
+            entry: { ...OPUS, kind: "unknown" as never },
             env: {},
             report: (kind, message) => reports.push([kind, message]),
         });
         expect(body).toBeNull();
         expect(reports).toEqual([
-            ["error", expect.stringContaining("no provider for local")],
+            ["error", expect.stringContaining("no provider for unknown")],
         ]);
     });
 });
diff --git a/packages/agent/src/testing.ts b/packages/agent/src/testing.ts
index cd90694..d4b16d0 100644
--- a/packages/agent/src/testing.ts
+++ b/packages/agent/src/testing.ts
@@ -8,9 +8,10 @@
 //
 //

-// Stand-ins for tests: the Messages API on a loopback port, answering
-// each request with the next scripted reply and keeping its body; mock
-// models scripted by stream parts; and timers fired by hand.
+// Stand-ins for tests: the Messages API and Chat Completions on
+// loopback ports, answering each request with the next scripted reply
+// and keeping its body; mock models scripted by stream parts; and
+// timers fired by hand.

 import type { Timers } from "@dorothy/core";
 import { simulateReadableStream } from "ai";
@@ -166,6 +167,125 @@ export function fakeMessages(replies: Reply[]): {
     };
 }

+export type CompletionUsage = {
+    prompt_tokens: number;
+    completion_tokens: number;
+    cached_tokens?: number;
+    // OpenRouter's own figure, in dollars.
+    cost?: number;
+};
+
+export type CompletionReply =
+    // usage null: a stream that reports none.
+    | { text: string; usage?: CompletionUsage | null }
+    | { status: number; message: string; headers?: Record<string, string> }
+    | { midstream: { message: string; code?: number | string } }
+    | { redirect: string };
+
+const COMPLETION_USAGE: CompletionUsage = {
+    prompt_tokens: 10,
+    completion_tokens: 5,
+};
+
+const chunk = (data: unknown) => `data: ${JSON.stringify(data)}\n\n`;
+
+function completion(reply: CompletionReply): Response {
+    if ("status" in reply) {
+        return Response.json(
+            { error: { message: reply.message, code: reply.status } },
+            { status: reply.status, headers: reply.headers ?? {} },
+        );
+    }
+    if ("redirect" in reply) {
+        return new Response(null, {
+            status: 307,
+            headers: { location: reply.redirect },
+        });
+    }
+    const base = { id: "c", object: "chat.completion.chunk", created: 1 };
+    if ("midstream" in reply) {
+        return new Response(
+            chunk({
+                ...base,
+                choices: [{ index: 0, delta: { content: "" } }],
+            }) + chunk({ error: reply.midstream }),
+            { headers: STREAM },
+        );
+    }
+    const usage = reply.usage === undefined ? COMPLETION_USAGE : reply.usage;
+    let body =
+        chunk({
+            ...base,
+            choices: [
+                {
+                    index: 0,
+                    delta: { role: "assistant", content: reply.text },
+                    finish_reason: null,
+                },
+            ],
+        }) +
+        chunk({
+            ...base,
+            choices: [{ index: 0, delta: {}, finish_reason: "stop" }],
+        });
+    if (usage !== null) {
+        const { cached_tokens, ...rest } = usage;
+        body += chunk({
+            ...base,
+            choices: [],
+            usage: {
+                ...rest,
+                total_tokens: usage.prompt_tokens + usage.completion_tokens,
+                ...(cached_tokens === undefined
+                    ? {}
+                    : { prompt_tokens_details: { cached_tokens } }),
+            },
+        });
+    }
+    return new Response(`${body}data: [DONE]\n\n`, { headers: STREAM });
+}
+
+// Chat Completions on a loopback port, as OpenRouter, featherless,
+// Hugging Face's router and local servers speak it: each request takes
+// the next reply, the last repeating, and its path, body and
+// Authorization header are kept.
+export function fakeCompletions(replies: CompletionReply[]): {
+    url: string;
+    paths: string[];
+    bodies: Record<string, unknown>[];
+    auth: (string | null)[];
+    stop: () => void;
+} {
+    const paths: string[] = [];
+    const bodies: Record<string, unknown>[] = [];
+    const auth: (string | null)[] = [];
+    let next = 0;
+    const server = Bun.serve({
+        hostname: "127.0.0.1",
+        port: 0,
+        idleTimeout: 0,
+        async fetch(request) {
+            paths.push(new URL(request.url).pathname);
+            bodies.push((await request.json()) as Record<string, unknown>);
+            auth.push(request.headers.get("authorization"));
+            const reply = replies[Math.min(next, replies.length - 1)];
+            next += 1;
+            return reply === undefined
+                ? new Response("no reply scripted", { status: 500 })
+                : completion(reply);
+        },
+    });
+    return {
+        url: `http://127.0.0.1:${server.port}`,
+        paths,
+        bodies,
+        auth,
+        stop: () => {
+            server.stop(true);
+        },
+    };
+}
+
 export const mockUsage = (
     noCache = 10,
     output = 5,
diff --git a/packages/agent/src/wire.test.ts b/packages/agent/src/wire.test.ts
new file mode 100644
index 0000000..e23aa30
--- /dev/null
+++ b/packages/agent/src/wire.test.ts
@@ -0,0 +1,361 @@
+// vim:set expandtab shiftwidth=4 filetype=typescript:
+// SPDX-License-Identifier: GPL-3.0-only
+
+//
+//
+// ~xxdorothy/dorothy.git
+// ::: :/packages/agent/src/wire.test.ts
+//
+//
+
+// The kinds that speak Chat Completions, on the wire: what each sends,
+// how its usage is priced, and fallback from one kind to another.
+
+import { afterEach, describe, expect, it } from "bun:test";
+import {
+    type ConversationEvent,
+    Cooldowns,
+    type Kind,
+    type RouteEntry,
+} from "@dorothy/core";
+import { Conversation } from "./conversation.js";
+import { structuredCall } from "./structured.js";
+import { type CompletionReply, fakeCompletions } from "./testing.js";
+
+const stops: (() => void)[] = [];
+afterEach(() => {
+    for (const stop of stops.splice(0)) {
+        stop();
+    }
+});
+const serve = (replies: CompletionReply[]) => {
+    const server = fakeCompletions(replies);
+    stops.push(server.stop);
+    return server;
+};
+
+const KEYS = {
+    OPENROUTER_API_KEY: "or-key",
+    FEATHERLESS_API_KEY: "fl-key",
+    HF_TOKEN: "hf-key",
+};
+
+const entry = (
+    kind: Kind,
+    baseUrl: string,
+    overrides: Partial<RouteEntry> = {},
+): RouteEntry => ({
+    provider: kind,
+    kind,
+    model: "org/model",
+    baseUrl,
+    key:
+        kind === "openrouter"
+            ? "OPENROUTER_API_KEY"
+            : kind === "featherless"
+              ? "FEATHERLESS_API_KEY"
+              : kind === "huggingface"
+                ? "HF_TOKEN"
+                : null,
+    price: null,
+    ...overrides,
+});
+
+const SCHEMA = {
+    type: "object",
+    properties: { ok: { type: "boolean" } },
+    required: ["ok"],
+    additionalProperties: false,
+};
+
+const REQUEST = {
+    what: "review",
+    system: "persona",
+    prompt: "review this",
+    schema: SCHEMA,
+    timeoutMs: 5000,
+};
+
+const structured = (route: RouteEntry[], cooldowns = new Cooldowns()) =>
+    structuredCall({ route, cooldowns, env: KEYS })(REQUEST);
+
+// One chat turn on route: its events, once the turn has ended.
+async function chat(route: RouteEntry[]): Promise<ConversationEvent[]> {
+    const conversation = new Conversation({ route, env: KEYS });
+    const events: ConversationEvent[] = [];
+    const done = new Promise<void>((resolve) => {
+        conversation.subscribe((event) => {
+            events.push(event);
+            if (event.type === "turn-end" || event.type === "error") {
+                resolve();
+            }
+        });
+    });
+    conversation.start();
+    conversation.send("hi");
+    await done;
+    await conversation.close();
+    return events;
+}
+
+describe("OpenRouter", () => {
+    it("denies data collection and asks for ZDR and usage on a chat", async () => {
+        const server = serve([{ text: "hello" }]);
+        await chat([entry("openrouter", server.url)]);
+        expect(server.paths).toEqual(["/chat/completions"]);
+        expect(server.auth).toEqual(["Bearer or-key"]);
+        expect(server.bodies[0]).toMatchObject({
+            model: "org/model",
+            provider: { data_collection: "deny", zdr: true },
+            usage: { include: true },
+            stream_options: { include_usage: true },
+        });
+        expect(server.bodies[0]?.provider).toEqual({
+            data_collection: "deny",
+            zdr: true,
+        });
+    });
+
+    it("requires the schema's parameters of a structured call", async () => {
+        const server = serve([{ text: '{"ok":true}' }]);
+        await structured([entry("openrouter", server.url)]);
+        expect(server.bodies[0]).toMatchObject({
+            provider: {
+                data_collection: "deny",
+                zdr: true,
+                require_parameters: true,
+            },
+            response_format: {
+                type: "json_schema",
+                json_schema: { schema: SCHEMA },
+            },
+        });
+    });
+
+    it("costs what OpenRouter says a step cost", async () => {
+        const server = serve([
+            {
+                text: '{"ok":true}',
+                usage: { prompt_tokens: 10, completion_tokens: 5, cost: 0.25 },
+            },
+        ]);
+        expect(await structured([entry("openrouter", server.url)])).toEqual({
+            ok: true,
+            output: { ok: true },
+            model: "openrouter:org/model",
+            costUsd: 0.25,
+        });
+    });
+
+    it("warns once of a step whose cost it did not say", async () => {
+        const server = serve([{ text: '{"ok":true}' }]);
+        const route = [
+            entry("openrouter", server.url, { model: "org/costless" }),
+        ];
+        expect(await structured(route)).toMatchObject({
+            ok: true,
+            costUsd: 0,
+            notes: [
+                "no price is known for openrouter:org/costless; its cost shows as $0",
+            ],
+        });
+        expect((await structured(route)).notes).toBeUndefined();
+    });
+});
+
+describe.each([
+    ["featherless", "Bearer fl-key"],
+    ["huggingface", "Bearer hf-key"],
+] as const)("%s", (kind, auth) => {
+    it("posts to its root with its key, asking for usage", async () => {
+        const server = serve([{ text: "hello" }]);
+        await chat([entry(kind, server.url)]);
+        expect(server.paths).toEqual(["/chat/completions"]);
+        expect(server.auth).toEqual([auth]);
+        expect(server.bodies[0]).toMatchObject({
+            model: "org/model",
+            stream_options: { include_usage: true },
+        });
+        expect(server.bodies[0]?.provider).toBeUndefined();
+    });
+
+    it("asks for the schema of a structured call", async () => {
+        const server = serve([{ text: '{"ok":true}' }]);
+        await structured([entry(kind, server.url)]);
+        expect(server.bodies[0]?.response_format).toMatchObject({
+            type: "json_schema",
+            json_schema: { schema: SCHEMA },
+        });
+    });
+
+    it("costs a step at the entry's price, cache reads at its input rate", async () => {
+        const server = serve([
+            {
+                text: '{"ok":true}',
+                usage: {
+                    prompt_tokens: 1_000_000,
+                    completion_tokens: 1_000_000,
+                    cached_tokens: 400_000,
+                },
+            },
+        ]);
+        const outcome = await structured([
+            entry(kind, server.url, { price: [0.5, 2] }),
+        ]);
+        expect(outcome.costUsd).toBeCloseTo(0.5 + 2, 10);
+    });
+});
+
+describe("local", () => {
+    it("sends a keyless server no Authorization header", async () => {
+        const server = serve([{ text: "hello" }]);
+        await chat([entry("local", server.url)]);
+        expect(server.auth).toEqual([null]);
+    });
+
+    it("sends a keyed server its key", async () => {
+        const server = serve([{ text: "hello" }]);
+        await structuredCall({
+            route: [entry("local", server.url, { key: "LOCAL_KEY" })],
+            env: { LOCAL_KEY: "local-key" },
+        })(REQUEST);
+        expect(server.auth).toEqual(["Bearer local-key"]);
+    });
+
+    it("warns of nothing at a free price", async () => {
+        const server = serve([{ text: '{"ok":true}', usage: null }]);
+        const outcome = await structured([
+            entry("local", server.url, { model: "free", price: [0, 0] }),
+        ]);
+        expect(outcome).toMatchObject({ ok: true, costUsd: 0 });
+        expect(outcome.notes).toBeUndefined();
+    });
+
+    it("warns once of a stream that reports no usage", async () => {
+        const server = serve([{ text: '{"ok":true}', usage: null }]);
+        const route = [
+            entry("local", server.url, { model: "quiet", price: [1, 1] }),
+        ];
+        expect((await structured(route)).notes).toEqual([
+            "local:quiet reported no usage; its cost shows as $0",
+        ]);
+        expect((await structured(route)).notes).toBeUndefined();
+    });
+});
+
+describe("failures on Chat Completions", () => {
+    it.each(["openrouter", "featherless", "huggingface", "local"] as const)(
+        "%s refuses a redirect, so its key never follows it",
+        async (kind) => {
+            const elsewhere = serve([{ text: "followed" }]);
+            const server = serve([{ redirect: `${elsewhere.url}/chat` }]);
+            const outcome = await structured([entry(kind, server.url)]);
+            expect(outcome).toMatchObject({ ok: false });
+            expect(elsewhere.bodies).toHaveLength(0);
+        },
+    );
+
+    it("classes a 429 after a 200 as a rate limit, cooling the model", async () => {
+        const server = serve([
+            { midstream: { message: "Rate limit exceeded", code: 429 } },
+        ]);
+        const cooldowns = new Cooldowns();
+        const route = [entry("openrouter", server.url)];
+        const outcome = await structured(route, cooldowns);
+        expect(outcome).toMatchObject({
+            ok: false,
+            reason: "Rate limit exceeded",
+        });
+        expect(cooldowns.until(route[0] as RouteEntry)).not.toBeNull();
+    });
+
+    it.each(
+        (
+            ["openrouter", "featherless", "huggingface", "local"] as const
+        ).flatMap((kind) =>
+            (
+                [
+                    [429, "rate-limit"],
+                    ["429", "rate-limit"],
+                    [402, "usage"],
+                    [500, "server"],
+                ] as const
+            ).map(([code, failure]) => [kind, code, failure] as const),
+        ),
+    )(
+        "%s classes an error with code %p after a 200 as %s, saying nothing of usage",
+        async (kind, code, failure) => {
+            const failing = serve([{ midstream: { message: "boom", code } }]);
+            const answering = serve([{ text: '{"ok":true}' }]);
+            const outcome = await structured([
+                entry(kind, failing.url, {
+                    provider: "first",
+                    model: `m-${code}`,
+                }),
+                entry("local", answering.url, {
+                    provider: "next",
+                    price: [0, 0],
+                }),
+            ]);
+            expect(outcome).toMatchObject({ ok: true });
+            expect(outcome.notes).toEqual([
+                `first:m-${code} refused (${failure}: boom); answering with next:org/model`,
+            ]);
+        },
+    );
+});
+
+describe("fallback across kinds", () => {
+    it("answers a structured call from the next kind when one answers 429", async () => {
+        const limited = serve([
+            {
+                status: 429,
+                message: "slow down",
+                headers: { "retry-after": "30" },
+            },
+        ]);
+        const answering = serve([
+            {
+                text: '{"ok":true}',
+                usage: { prompt_tokens: 1, completion_tokens: 1, cost: 0.01 },
+            },
+        ]);
+        const cooldowns = new Cooldowns();
+        const first = entry("local", limited.url, { provider: "proxy" });
+        const outcome = await structured(
+            [first, entry("openrouter", answering.url)],
+            cooldowns,
+        );
+        expect(outcome).toEqual({
+            ok: true,
+            output: { ok: true },
+            model: "openrouter:org/model",
+            costUsd: 0.01,
+            notes: [
+                "proxy:org/model refused (rate-limit: slow down, retry in 30s); answering with openrouter:org/model",
+            ],
+        });
+        expect(cooldowns.until(first)).not.toBeNull();
+    });
+
+    it("answers a chat turn from the next kind, warning of the move", async () => {
+        const limited = serve([{ status: 429, message: "slow down" }]);
+        const answering = serve([{ text: "hello" }]);
+        const events = await chat([
+            entry("local", limited.url, { provider: "proxy" }),
+            entry("featherless", answering.url, { price: [0, 0] }),
+        ]);
+        expect(events.filter((event) => event.type === "warning")).toEqual([
+            {
+                type: "warning",
+                message:
+                    "proxy:org/model refused (rate-limit: slow down); answering with featherless:org/model",
+            },
+        ]);
+        expect(events.at(-1)).toMatchObject({
+            type: "turn-end",
+            reply: "hello",
+            model: "featherless:org/model",
+        });
+    });
+});
````

- [ ] **Step 2: Run them to see them fail**

```bash
bun test packages/agent/src/wire.test.ts packages/agent/src/capture.test.ts
```

Expected: FAIL: every non-Anthropic kind throws "no provider for
openrouter entries" and the like, so no request reaches the fakes.

- [ ] **Step 3: Add the packages and the code**

```bash
(cd packages/agent && bun add @ai-sdk/openai-compatible@^3.0.82 \
    @openrouter/ai-sdk-provider@^3.1.0)
patch_of 8 | git apply
```

````diff
diff --git a/packages/agent/src/providers.ts b/packages/agent/src/providers.ts
index 40b6b04..ec86fac 100644
--- a/packages/agent/src/providers.ts
+++ b/packages/agent/src/providers.ts
@@ -14,7 +14,9 @@
 // own, and a key goes only where its route says.

 import { createAnthropic } from "@ai-sdk/anthropic";
+import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
 import type { Env, RouteEntry } from "@dorothy/core";
+import { createOpenRouter } from "@openrouter/ai-sdk-provider";
 import type { LanguageModel } from "ai";

 // The AI SDK writes its warnings to the console, which would land on the
@@ -37,7 +39,14 @@ export type ModelFactory = (
     use: Use,
 ) => LanguageModel;

-export const languageModel: ModelFactory = (entry, key) => {
+// Sent to OpenRouter on every request: no endpoint that collects data or
+// keeps prompts.
+export const OPENROUTER_RETENTION = {
+    data_collection: "deny",
+    zdr: true,
+} as const;
+
+export const languageModel: ModelFactory = (entry, key, use) => {
     const root = entry.baseUrl.replace(/\/+$/, "");
     switch (entry.kind) {
         case "anthropic":
@@ -46,6 +55,35 @@ export const languageModel: ModelFactory = (entry, key) => {
                 apiKey: key,
                 fetch: noRedirect,
             })(entry.model);
+        case "openrouter":
+            // strict: the compatible mode would leave out stream_options,
+            // and with it the usage of a stream.
+            return createOpenRouter({
+                baseURL: root,
+                apiKey: key,
+                fetch: noRedirect,
+                compatibility: "strict",
+            }).chat(entry.model, {
+                provider: {
+                    ...OPENROUTER_RETENTION,
+                    ...(use === "structured"
+                        ? { require_parameters: true }
+                        : {}),
+                },
+                usage: { include: true },
+            });
+        case "featherless":
+        case "huggingface":
+        case "local":
+            return createOpenAICompatible({
+                name: entry.kind,
+                baseURL: root,
+                // A keyless local server is sent no Authorization header.
+                ...(key === "" ? {} : { apiKey: key }),
+                fetch: noRedirect,
+                includeUsage: true,
+                supportsStructuredOutputs: true,
+            })(entry.model);
         default:
             throw new Error(
                 `no provider for ${(entry as { kind: string }).kind} entries`,
````

- [ ] **Step 4: Run them to see them pass**

Run: `bun test packages/agent`
Expected: PASS, 201 tests, 0 fail.

- [ ] **Step 5: Check**

Run `bun run format`, then the check on temporary roots. Expected:
PASS, `workspace.test.ts` among it.

- [ ] **Step 6: Commit**

```bash
git add -A bun.lock packages/agent
git commit -m "feat(agent): Reach OpenRouter and Chat Completions" \
    -m "OpenRouter is told to deny data collection and keep to zero-
retention endpoints on every request; featherless, Hugging Face's
router and local servers speak Chat Completions with usage on."
```

### Task 5: Chat across kinds

What a session sends another model: no message that held only
reasoning; the recall server withheld every provider's key; and the
dump's development prompt naming the whole chat route.

**Files:**

- Modify: `packages/agent/src/conversation.ts`, `recall-tools.ts`,
  `capture.ts`, their tests `conversation.test.ts`,
  `recall-tools.test.ts`, `capture.test.ts`; `packages/cli/src/dump.ts`
  and `dump.test.ts`, for `dumpRequest`'s new argument

**Interfaces:**

- Consumes: Task 3's `Conversation` on `readStream`.
- Produces:
  - `ConversationDeps.keys?: readonly string[]`, every provider's key
    names, withheld from the recall server; `ConversationDeps.shown?:
    Route`, the route development mode's prompt names.
  - `recallEnv(env, route, keys?: readonly string[])`.
  - `dumpRequest({ setup, message, route, keys?, env?, connect?,
    report? })`, its `route` the chat's, of which it dumps the first
    entry; its `keys`, every provider's, are withheld from the recall
    server with the route's own.

- [ ] **Step 1: Add the failing tests**

Run: `patch_of 9 | git apply`

````diff
diff --git a/packages/agent/src/capture.test.ts b/packages/agent/src/capture.test.ts
index efdc395..bb77e17 100644
--- a/packages/agent/src/capture.test.ts
+++ b/packages/agent/src/capture.test.ts
@@ -80,7 +80,7 @@ describe("dumpRequest", () => {
         const body = (await dumpRequest({
             setup: {},
             message: "hi",
-            entry: OPUS,
+            route: [OPUS],
             env: {},
         })) as Record<string, unknown>;
         expect(body.model).toBe("claude-opus-5-5");
@@ -114,7 +114,7 @@ describe("dumpRequest", () => {
                     recall: { command: process.execPath, args: [FAKE_MCP] },
                 },
                 message: "hi",
-                entry: OPUS,
+                route: [OPUS],
                 env: { PATH: process.env.PATH ?? "", XDG_CACHE_HOME: cache },
             })) as { tools: { name: string }[] };
             expect(body.tools.map((tool) => tool.name).sort()).toEqual([
@@ -133,7 +133,7 @@ describe("dumpRequest", () => {
         const body = (await dumpRequest({
             setup: { recall: { command: "recall", args: [] } },
             message: "hi",
-            entry: OPUS,
+            route: [OPUS],
             env: {},
             connect: async () => {
                 throw new Error("spawn failed");
@@ -147,12 +147,92 @@ describe("dumpRequest", () => {
         ]);
     });

+    it("names every entry of the chat route in development mode", async () => {
+        const body = (await dumpRequest({
+            setup: { persona: "development" },
+            message: "hi",
+            route: [
+                OPUS,
+                {
+                    ...OPUS,
+                    provider: "openrouter",
+                    kind: "openrouter",
+                    model: "x/y",
+                },
+            ],
+            env: {},
+        })) as { model: string; system: { text: string }[] };
+        expect(body.model).toBe("claude-opus-5-5");
+        expect(body.system[0]?.text).toEndWith(
+            "Your chat runs on the first of these models to answer: anthropic:claude-opus-5-5, openrouter:x/y.",
+        );
+    });
+
+    it("withholds the route's key and every provider's from the recall server", async () => {
+        let seen: Record<string, string> = {};
+        await dumpRequest({
+            setup: { recall: { command: "recall", args: [] } },
+            message: "hi",
+            route: [
+                {
+                    ...OPUS,
+                    provider: "hf",
+                    kind: "huggingface",
+                    model: "org/model",
+                    key: "HF_TOKEN",
+                },
+            ],
+            keys: ["VLLM_KEY"],
+            env: { PATH: "/bin", HF_TOKEN: "hf-secret", VLLM_KEY: "v" },
+            connect: async (_launch, _recollect, env) => {
+                seen = env;
+                throw new Error("spawn failed");
+            },
+        });
+        expect(seen).toEqual({ PATH: "/bin" });
+    });
+
+    it("dumps a Chat Completions entry, OpenRouter's retention in its body", async () => {
+        const body = (await dumpRequest({
+            setup: {},
+            message: "hi",
+            route: [
+                {
+                    ...OPUS,
+                    provider: "openrouter",
+                    kind: "openrouter",
+                    model: "x/y",
+                    key: "OPENROUTER_API_KEY",
+                },
+            ],
+            env: {},
+        })) as Record<string, unknown>;
+        expect(body).toMatchObject({
+            model: "x/y",
+            provider: { data_collection: "deny", zdr: true },
+            messages: [{ role: "system" }, { role: "user", content: "hi" }],
+        });
+    });
+
+    it("reports a route with no entry, sending nothing", async () => {
+        const reports: [string, string][] = [];
+        const body = await dumpRequest({
+            setup: {},
+            message: "hi",
+            route: [],
+            env: {},
+            report: (kind, message) => reports.push([kind, message]),
+        });
+        expect(body).toBeNull();
+        expect(reports).toEqual([["error", "the chat route has no entry"]]);
+    });
+
     it("reports why no request was sent, when none was", async () => {
         const reports: [string, string][] = [];
         const body = await dumpRequest({
             setup: {},
             message: "hi",
-            entry: { ...OPUS, kind: "unknown" as never },
+            route: [{ ...OPUS, kind: "unknown" as never }],
             env: {},
             report: (kind, message) => reports.push([kind, message]),
         });
diff --git a/packages/agent/src/conversation.test.ts b/packages/agent/src/conversation.test.ts
index 4433c97..82a6788 100644
--- a/packages/agent/src/conversation.test.ts
+++ b/packages/agent/src/conversation.test.ts
@@ -1027,6 +1027,50 @@ describe("Conversation on a route of two", () => {
         expect(sent).toContain("A says hi");
         expect(sent).not.toContain("thinking hard");
     });
+
+    it("sends another model no message that held reasoning alone", async () => {
+        const cooldowns = new Cooldowns({ now: () => 0 });
+        const first = mockModel([
+            {
+                chunks: [
+                    START,
+                    { type: "reasoning-start", id: "r" },
+                    { type: "reasoning-delta", id: "r", delta: "only this" },
+                    { type: "reasoning-end", id: "r" },
+                    {
+                        type: "finish",
+                        finishReason: { unified: "stop", raw: "end_turn" },
+                        usage: mockUsage(),
+                    },
+                ],
+            },
+        ]);
+        const second = mockModel(
+            [{ chunks: textChunks("B says hi") }],
+            B.model,
+        );
+        const conversation = new Conversation({
+            env,
+            route: [OPUS, B],
+            cooldowns,
+            model: (entry) => (entry.model === OPUS.model ? first : second),
+        });
+        const events: ConversationEvent[] = [];
+        conversation.subscribe((event) => events.push(event));
+        conversation.start();
+        conversation.send("one");
+        await until(() => ended(events));
+        cooldowns.note(OPUS, {
+            class: "usage",
+            message: "spent",
+            retryAfterMs: 60_000,
+        });
+        conversation.send("two");
+        await until(() => ended(events, 2));
+        expect(
+            second.doStreamCalls[0]?.prompt.map((message) => message.role),
+        ).toEqual(["system", "user", "user"]);
+    });
 });

 describe("conversationSetup", () => {
diff --git a/packages/agent/src/recall-tools.test.ts b/packages/agent/src/recall-tools.test.ts
index 0c79bac..adca9e6 100644
--- a/packages/agent/src/recall-tools.test.ts
+++ b/packages/agent/src/recall-tools.test.ts
@@ -73,6 +73,18 @@ describe("recallEnv", () => {
     });
 });

+describe("recallEnv, given every provider's keys", () => {
+    it("withholds keys other roles' providers give, whatever their names", () => {
+        expect(
+            recallEnv(
+                { PATH: "/bin", HF_TOKEN: "a", LOCAL_SECRET: "b" },
+                [anthropicEntry("m")],
+                ["HF_TOKEN", "LOCAL_SECRET"],
+            ),
+        ).toEqual({ PATH: "/bin" });
+    });
+});
+
 describe("connectRecall", () => {
     it("offers her tools by the names the model calls, and no others", async () => {
         const recall = await connectRecall(launch, false, ENV);
diff --git a/packages/cli/src/dump.test.ts b/packages/cli/src/dump.test.ts
index f476a29..d1895eb 100644
--- a/packages/cli/src/dump.test.ts
+++ b/packages/cli/src/dump.test.ts
@@ -15,7 +15,7 @@ import { join } from "node:path";
 import type { dumpRequest } from "@dorothy/agent";
 import { newPhrase } from "@dorothy/core";
 import { runDump } from "./dump.js";
-import { chatEntry } from "./models.js";
+import { ROUTES } from "./models.js";

 const recording = (
     body: unknown = { model: "claude-opus-5-5" },
@@ -73,7 +73,7 @@ describe("runDump", () => {
         expect(fake.seen).toHaveLength(1);
         expect(fake.seen[0]).toMatchObject({
             message: "hi",
-            entry: chatEntry(),
+            route: ROUTES.chat,
             setup: { persona: "chat", history: [] },
         });
         expect(fake.seen[0]?.setup.recall).toHaveProperty("command");
````

- [ ] **Step 2: Run them to see them fail**

```bash
bun test packages/agent/src/conversation.test.ts \
    packages/agent/src/recall-tools.test.ts packages/agent/src/capture.test.ts
```

Expected: FAIL: the second model is sent an empty assistant message;
`HF_TOKEN` reaches the recall server's environment, in chat and in the
dump; `dumpRequest` takes no `route`.

- [ ] **Step 3: Add the code**

Run: `patch_of 10 | git apply`

````diff
diff --git a/packages/agent/src/capture.ts b/packages/agent/src/capture.ts
index d5b2ec5..7d19783 100644
--- a/packages/agent/src/capture.ts
+++ b/packages/agent/src/capture.ts
@@ -8,7 +8,7 @@
 //
 //

-import type { Env, RouteEntry } from "@dorothy/core";
+import type { Env, Route } from "@dorothy/core";
 import { Conversation, type SessionSetup } from "./conversation.js";
 import type { ConnectRecall } from "./recall-tools.js";

@@ -72,22 +72,36 @@ export function captureServer(): {
 export async function dumpRequest({
     setup,
     message,
-    entry,
+    route,
+    keys = [],
     env = process.env,
     connect,
     report = () => {},
 }: {
     setup: SessionSetup;
     message: string;
-    entry: RouteEntry;
+    // The chat's route: its first entry is dumped, and development mode's
+    // prompt names every entry, as a chat's does.
+    route: Route;
+    // Every provider's key names, which the recall server must not see.
+    keys?: readonly string[];
     env?: Env;
     connect?: ConnectRecall;
     report?: (kind: "warning" | "error", message: string) => void;
 }): Promise<unknown | null> {
+    const entry = route[0];
+    if (entry === undefined) {
+        report("error", "the chat route has no entry");
+        return null;
+    }
     const server = captureServer();
     const conversation = new Conversation({
         ...setup,
         route: [{ ...entry, baseUrl: server.url, key: DUMP_KEY }],
+        shown: route,
+        // The stand-in takes the entry's key's place, which the recall
+        // server is withheld all the same.
+        keys: [...keys, ...(entry.key === null ? [] : [entry.key])],
         env: { ...env, [DUMP_KEY]: "dorothy --dump-context" },
         ...(connect === undefined ? {} : { connect }),
     });
diff --git a/packages/agent/src/conversation.ts b/packages/agent/src/conversation.ts
index b322ea5..72e6c67 100644
--- a/packages/agent/src/conversation.ts
+++ b/packages/agent/src/conversation.ts
@@ -103,6 +103,12 @@ export function conversationSetup(

 export type ConversationDeps = {
     route?: Route;
+    // The route development mode's prompt names, when it is not the one
+    // tried: the dump's, which tries its first entry alone.
+    shown?: Route;
+    // Every secrets.json name a provider gives, every role's, which the
+    // recall server must not see; the route's own are never seen either.
+    keys?: readonly string[];
     cooldowns?: Cooldowns;
     env?: Env;
     model?: ModelFactory;
@@ -139,15 +145,14 @@ function rawOf(part: { type: string; text?: unknown }): RawMessage {
         : { type: part.type };
 }

-// Reasoning belongs to the model that made it; another is sent none.
-function withoutReasoning(message: ModelMessage): ModelMessage {
+// Reasoning belongs to the model that made it; another is sent none,
+// and an assistant message that held nothing else is not sent at all.
+function withoutReasoning(message: ModelMessage): ModelMessage | null {
     if (message.role !== "assistant" || typeof message.content === "string") {
         return message;
     }
-    return {
-        ...message,
-        content: message.content.filter((part) => part.type !== "reasoning"),
-    };
+    const content = message.content.filter((part) => part.type !== "reasoning");
+    return content.length === 0 ? null : { ...message, content };
 }

 // The user's message as sent: on Anthropic it carries the second cache
@@ -169,6 +174,7 @@ export class Conversation implements ChatSession {
     readonly #listeners = new Set<(event: ConversationEvent) => void>();
     readonly #setup: ConversationSetup;
     readonly #route: Route;
+    readonly #keys: readonly string[];
     readonly #cooldowns: Cooldowns;
     readonly #env: Env;
     readonly #model: ModelFactory;
@@ -190,6 +196,8 @@ export class Conversation implements ChatSession {

     constructor({
         route = defaultRoutes().chat,
+        shown = route,
+        keys = [],
         cooldowns = new Cooldowns(),
         env = process.env,
         model = languageModel,
@@ -200,6 +208,7 @@ export class Conversation implements ChatSession {
         ...setup
     }: SessionSetup & ConversationDeps = {}) {
         this.#route = route;
+        this.#keys = keys;
         this.#cooldowns = cooldowns;
         this.#env = env;
         this.#model = model;
@@ -207,7 +216,7 @@ export class Conversation implements ChatSession {
         this.#timers = timers;
         this.#stallMs = stallMs;
         this.#now = now;
-        this.#setup = conversationSetup(setup, route);
+        this.#setup = conversationSetup(setup, shown);
     }

     start(): void {
@@ -293,7 +302,7 @@ export class Conversation implements ChatSession {
                 this.#recall = await this.#connect(
                     recall,
                     recollect,
-                    recallEnv(this.#env, this.#route),
+                    recallEnv(this.#env, this.#route, this.#keys),
                 );
             } catch (error) {
                 this.#notify({
@@ -432,14 +441,18 @@ export class Conversation implements ChatSession {

     #outgoing(entry: RouteEntry, text: string): ModelMessage[] {
         const by = label(entry);
-        return [
-            ...this.#messages.map(({ message, by: from }) =>
+        const sent: ModelMessage[] = [];
+        for (const { message, by: from } of this.#messages) {
+            const kept =
                 from === null || from === by
                     ? message
-                    : withoutReasoning(message),
-            ),
-            outgoingUser(text, entry),
-        ];
+                    : withoutReasoning(message);
+            if (kept !== null) {
+                sent.push(kept);
+            }
+        }
+        sent.push(outgoingUser(text, entry));
+        return sent;
     }

     async #attempt(
diff --git a/packages/agent/src/recall-tools.ts b/packages/agent/src/recall-tools.ts
index bf5111c..245a930 100644
--- a/packages/agent/src/recall-tools.ts
+++ b/packages/agent/src/recall-tools.ts
@@ -37,12 +37,17 @@ export type ConnectRecall = (
 ) => Promise<RecallTools>;

 // What the recall server may see: the caller's environment, its XDG
-// roots among it, less every credential: the keys a route names, any
-// *_API_KEY and Claude's OAuth tokens.
-export function recallEnv(env: Env, route: Route): Record<string, string> {
-    const named = new Set(
-        route.flatMap((entry) => (entry.key === null ? [] : [entry.key])),
-    );
+// roots among it, less every credential: the keys a route names, those
+// every provider gives, any *_API_KEY and Claude's OAuth tokens.
+export function recallEnv(
+    env: Env,
+    route: Route,
+    keys: readonly string[] = [],
+): Record<string, string> {
+    const named = new Set([
+        ...keys,
+        ...route.flatMap((entry) => (entry.key === null ? [] : [entry.key])),
+    ]);
     const kept: Record<string, string> = {};
     for (const [name, value] of Object.entries(env)) {
         if (
diff --git a/packages/cli/src/dump.ts b/packages/cli/src/dump.ts
index 8d426e3..56d522c 100644
--- a/packages/cli/src/dump.ts
+++ b/packages/cli/src/dump.ts
@@ -11,7 +11,7 @@
 import { dumpRequest, type PersonaMode } from "@dorothy/agent";
 import type { Env } from "@dorothy/core";
 import { previewStart } from "@dorothy/memory";
-import { chatEntry } from "./models.js";
+import { ROUTES } from "./models.js";
 import { recallLaunch } from "./recall-launch.js";

 export type DumpRequest = {
@@ -56,7 +56,7 @@ export async function runDump(
     const body = await dump({
         setup: { ...preview.start, persona: request.persona },
         message: request.message,
-        entry: chatEntry(),
+        route: ROUTES.chat,
         env,
         report: (kind, message) => {
             if (kind === "error") {
````

- [ ] **Step 4: Run them to see them pass**

Run: `bun test packages/agent packages/cli`
Expected: PASS.

- [ ] **Step 5: Check**

Run `bun run format`, then the check on temporary roots. Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add -A packages/agent packages/cli
git commit -m "fix(agent): Send other models what they can take" \
    -m "A message that held only reasoning is not sent to another model;
the recall server is withheld every provider's key, not only the
route's; the dump's development prompt names the whole chat route."
```

### Task 6: Each entry point routed by config

The CLI reads the routes once per entry point and acts on a fault as
the spec's table says.

**Files:**

- Create: `packages/cli/src/models.test.ts`
- Modify: `packages/cli/src/models.ts`, `index.ts`, `run-tui.ts`,
  `dump.ts`, `claude-hook.ts`, and tests `index.test.ts`,
  `claude-hook.test.ts`, `dump.test.ts`, `recall-tools.test.ts`

**Interfaces:**

- Consumes: Task 1's `readRouting`, `Routing`, `RoutingResult`; Task
  5's `keys` and `dumpRequest({ route })`.
- Produces:
  - `COOLDOWNS`, as before; `ROUTES` and `chatEntry` are gone.
  - `type RoutingDeps = { env?: Env; readRouting?: (env: Env) =>
    Promise<RoutingResult> }`.
  - `loadRouting(deps?): Promise<Routing>`, throwing every fault in one
    message.
  - `chatRouting(write, deps?): Promise<Routing | null>`, saying each
    fault as `dorothy: <fault>`.
  - `chatDeps(routing: Routing): { route; keys; cooldowns }`, what each
    chat session takes.
  - `runTui(resume, persona, routing)`, all three required;
    `runDump(request, { routing, env?, dump?, write? })`, passing
    `routing.keys` to `dumpRequest`; `CredentialDeps` and `HookCliDeps`
    take `RoutingDeps`.

- [ ] **Step 1: Add the failing tests**

Run: `patch_of 11 | git apply`

````diff
diff --git a/packages/cli/src/claude-hook.test.ts b/packages/cli/src/claude-hook.test.ts
index 67a521b..c10048c 100644
--- a/packages/cli/src/claude-hook.test.ts
+++ b/packages/cli/src/claude-hook.test.ts
@@ -158,6 +158,30 @@ describe("runHook", () => {
         expect(seen.agents).toBe(0);
     });

+    it("still runs the hook on a routing fault, its reviews failing with it", async () => {
+        const { seen, deps } = harness();
+        delete deps.agent;
+        deps.readRouting = async () => ({
+            ok: false,
+            faults: [
+                "config.toml: models.review must be a list of one model or more",
+            ],
+        });
+        expect(await runHook({ kind: "hook" }, deps)).toBe(0);
+        const outcome = await (await seen.deps?.agent())?.call({
+            what: "a review",
+            system: "",
+            prompt: "",
+            schema: {},
+            timeoutMs: 1,
+        });
+        expect(outcome).toEqual({
+            ok: false,
+            reason: "the agent could not load (config.toml: models.review must be a list of one model or more)",
+            costUsd: 0,
+        });
+    });
+
     it("still runs the hook when the agent cannot load, its reviews failing", async () => {
         const { seen, deps } = harness();
         deps.agent = async () => {
diff --git a/packages/cli/src/dump.test.ts b/packages/cli/src/dump.test.ts
index d1895eb..834a8e4 100644
--- a/packages/cli/src/dump.test.ts
+++ b/packages/cli/src/dump.test.ts
@@ -13,9 +13,10 @@ import { mkdtemp, rm } from "node:fs/promises";
 import { tmpdir } from "node:os";
 import { join } from "node:path";
 import type { dumpRequest } from "@dorothy/agent";
-import { newPhrase } from "@dorothy/core";
+import { defaultRoutes, newPhrase } from "@dorothy/core";
 import { runDump } from "./dump.js";
-import { ROUTES } from "./models.js";
+
+const ROUTING = { routes: defaultRoutes(), keys: ["ANTHROPIC_API_KEY"] };

 const recording = (
     body: unknown = { model: "claude-opus-5-5" },
@@ -66,14 +67,15 @@ describe("runDump", () => {
         const fake = recording();
         const code = await runDump(
             { resume: null, message: "hi", persona: "chat" },
-            { env, dump: fake.dump, write },
+            { routing: ROUTING, env, dump: fake.dump, write },
         );
         expect(code).toBe(0);
         expect(JSON.parse(out)).toEqual({ model: "claude-opus-5-5" });
         expect(fake.seen).toHaveLength(1);
         expect(fake.seen[0]).toMatchObject({
             message: "hi",
-            route: ROUTES.chat,
+            route: ROUTING.routes.chat,
+            keys: ROUTING.keys,
             setup: { persona: "chat", history: [] },
         });
         expect(fake.seen[0]?.setup.recall).toHaveProperty("command");
@@ -83,7 +85,7 @@ describe("runDump", () => {
         const fake = recording();
         await runDump(
             { resume: null, message: "hi", persona: "development" },
-            { env, dump: fake.dump, write },
+            { routing: ROUTING, env, dump: fake.dump, write },
         );
         expect(fake.seen[0]?.setup.persona).toBe("development");
     });
@@ -93,7 +95,7 @@ describe("runDump", () => {
         const phrase = newPhrase();
         const code = await runDump(
             { resume: phrase, message: "hi", persona: "chat" },
-            { env, dump: fake.dump, write },
+            { routing: ROUTING, env, dump: fake.dump, write },
         );
         expect(code).toBe(1);
         expect(out).toBe("");
@@ -104,7 +106,7 @@ describe("runDump", () => {
     it("fails when the chat sent no request", async () => {
         const code = await runDump(
             { resume: null, message: "hi", persona: "chat" },
-            { env, dump: recording(null).dump, write },
+            { routing: ROUTING, env, dump: recording(null).dump, write },
         );
         expect(code).toBe(1);
         expect(err).toBe("dorothy: the chat sent no request to dump\n");
@@ -116,7 +118,7 @@ describe("runDump", () => {
         ]);
         const code = await runDump(
             { resume: null, message: "hi", persona: "chat" },
-            { env, dump: fake.dump, write },
+            { routing: ROUTING, env, dump: fake.dump, write },
         );
         expect(code).toBe(0);
         expect(JSON.parse(out)).toEqual({ model: "m" });
@@ -131,7 +133,7 @@ describe("runDump", () => {
         ]);
         const code = await runDump(
             { resume: null, message: "hi", persona: "chat" },
-            { env, dump: fake.dump, write },
+            { routing: ROUTING, env, dump: fake.dump, write },
         );
         expect(code).toBe(1);
         expect(err).toBe(
diff --git a/packages/cli/src/index.test.ts b/packages/cli/src/index.test.ts
index 0f2f3e3..bff444d 100644
--- a/packages/cli/src/index.test.ts
+++ b/packages/cli/src/index.test.ts
@@ -81,6 +81,34 @@ describe("CLI secrets", () => {
         expect(err).toEqual(["dorothy: secrets not loaded (SOPS_FAILED)\n"]);
     });

+    it("disables service reviews on a routing fault, loading no secrets", async () => {
+        const err: string[] = [];
+        let loaded = false;
+        const result = await reviewAgent({
+            root,
+            env: { HOME: root },
+            readRouting: async () => ({
+                ok: false,
+                faults: ["config.toml: models.review: no provider is named x"],
+            }),
+            load: async () => {
+                loaded = true;
+                return null;
+            },
+            write: (text) => {
+                err.push(text);
+            },
+        });
+        expect(result).toEqual({
+            review: null,
+            noReviews: "config.toml: models.review: no provider is named x",
+        });
+        expect(err).toEqual([
+            "dorothy: reviews are off: config.toml: models.review: no provider is named x\n",
+        ]);
+        expect(loaded).toBe(false);
+    });
+
     it("disables service reviews with a coded failure", async () => {
         const err: string[] = [];
         const env: Env = {
diff --git a/packages/cli/src/models.test.ts b/packages/cli/src/models.test.ts
new file mode 100644
index 0000000..42bee62
--- /dev/null
+++ b/packages/cli/src/models.test.ts
@@ -0,0 +1,82 @@
+// vim:set expandtab shiftwidth=4 filetype=typescript:
+// SPDX-License-Identifier: GPL-3.0-only
+
+//
+//
+// ~xxdorothy/dorothy.git
+// ::: :/packages/cli/src/models.test.ts
+//
+//
+
+import { describe, expect, it } from "bun:test";
+import { defaultRoutes, type RoutingResult } from "@dorothy/core";
+import { chatRouting, loadRouting } from "./models.js";
+
+const ROUTING = { routes: defaultRoutes(), keys: ["ANTHROPIC_API_KEY"] };
+const routed = async (): Promise<RoutingResult> => ({
+    ok: true,
+    routing: ROUTING,
+});
+const faulted = async (): Promise<RoutingResult> => ({
+    ok: false,
+    faults: [
+        "config.toml: models.chat must be a list of one model or more",
+        "config.toml: models.review: no provider is named openrouter",
+    ],
+});
+
+describe("chatRouting", () => {
+    it("gives config.toml's routes, saying nothing", async () => {
+        const written: string[] = [];
+        expect(
+            await chatRouting((text) => written.push(text), {
+                env: {},
+                readRouting: routed,
+            }),
+        ).toBe(ROUTING);
+        expect(written).toEqual([]);
+    });
+
+    it("says each fault on a line of its own, and gives null", async () => {
+        const written: string[] = [];
+        expect(
+            await chatRouting((text) => written.push(text), {
+                env: {},
+                readRouting: faulted,
+            }),
+        ).toBeNull();
+        expect(written).toEqual([
+            "dorothy: config.toml: models.chat must be a list of one model or more\n",
+            "dorothy: config.toml: models.review: no provider is named openrouter\n",
+        ]);
+    });
+
+    it("reads the environment's config.toml", async () => {
+        const seen: unknown[] = [];
+        const env = { XDG_CONFIG_HOME: "/nowhere" };
+        await chatRouting(() => {}, {
+            env,
+            readRouting: async (given) => {
+                seen.push(given);
+                return routed();
+            },
+        });
+        expect(seen).toEqual([env]);
+    });
+});
+
+describe("loadRouting", () => {
+    it("gives config.toml's routes", async () => {
+        expect(await loadRouting({ env: {}, readRouting: routed })).toBe(
+            ROUTING,
+        );
+    });
+
+    it("throws every fault in one message", async () => {
+        await expect(
+            loadRouting({ env: {}, readRouting: faulted }),
+        ).rejects.toThrow(
+            "config.toml: models.chat must be a list of one model or more; config.toml: models.review: no provider is named openrouter",
+        );
+    });
+});
diff --git a/packages/cli/src/recall-tools.test.ts b/packages/cli/src/recall-tools.test.ts
index 0e9f92a..789cb42 100644
--- a/packages/cli/src/recall-tools.test.ts
+++ b/packages/cli/src/recall-tools.test.ts
@@ -13,7 +13,7 @@ import { existsSync, mkdtempSync, rmSync } from "node:fs";
 import { tmpdir } from "node:os";
 import { join } from "node:path";
 import { connectRecall, recallEnv } from "@dorothy/agent";
-import { ROUTES } from "./models.js";
+import { defaultRoutes } from "@dorothy/core";
 import { recallLaunch } from "./recall-launch.js";

 type Execute = (
@@ -53,7 +53,7 @@ describe("her recall server, through the agent's client", () => {
         const recall = await connectRecall(
             launch,
             false,
-            recallEnv(env, ROUTES.chat),
+            recallEnv(env, defaultRoutes().chat),
         );
         try {
             expect(Object.keys(recall.tools).sort()).toEqual([
@@ -89,7 +89,9 @@ describe("her recall server, through the agent's client", () => {

     it("hands the server no key, and Bun no project .env", () => {
         const env = { ANTHROPIC_API_KEY: "k", PATH: "/bin" };
-        expect(recallEnv(env, ROUTES.chat).ANTHROPIC_API_KEY).toBeUndefined();
+        expect(
+            recallEnv(env, defaultRoutes().chat).ANTHROPIC_API_KEY,
+        ).toBeUndefined();
         expect(recallLaunch("phrase", null).args[0]).toBe("--no-env-file");
     });
 });
diff --git a/packages/cli/src/run-tui.test.ts b/packages/cli/src/run-tui.test.ts
index 138c8b5..663fbac 100644
--- a/packages/cli/src/run-tui.test.ts
+++ b/packages/cli/src/run-tui.test.ts
@@ -12,10 +12,26 @@ import { afterEach, beforeEach, describe, expect, it, spyOn } from "bun:test";
 import { mkdtemp, rm } from "node:fs/promises";
 import { tmpdir } from "node:os";
 import { join } from "node:path";
-import { DEFAULT_CONFIG, newPhrase } from "@dorothy/core";
+import { DEFAULT_CONFIG, defaultRoutes, newPhrase } from "@dorothy/core";
 import * as memoryModule from "@dorothy/memory";
 import * as tui from "@dorothy/tui";
-import { runTui } from "./run-tui.js";
+import { COOLDOWNS } from "./models.js";
+import { chatDeps, runTui } from "./run-tui.js";
+
+const ROUTING = {
+    routes: defaultRoutes(),
+    keys: ["ANTHROPIC_API_KEY", "HF_TOKEN"],
+};
+
+describe("chatDeps", () => {
+    it("gives a session the chat route, every provider's keys and the cooldowns", () => {
+        expect(chatDeps(ROUTING)).toEqual({
+            route: ROUTING.routes.chat,
+            keys: ["ANTHROPIC_API_KEY", "HF_TOKEN"],
+            cooldowns: COOLDOWNS,
+        });
+    });
+});

 // runTui opens memory from these, so every one points into the test's
 // directory.
@@ -82,7 +98,7 @@ describe("runTui", () => {
                 if (fails) throw new Error("fixture render failure");
             });
             let settled = false;
-            const result = runTui(null).then(
+            const result = runTui(null, "chat", ROUTING).then(
                 (code) => {
                     settled = true;
                     return { code };
@@ -120,7 +136,7 @@ describe("runTui", () => {
             },
         );
         try {
-            expect(await runTui(phrase)).toBe(1);
+            expect(await runTui(phrase, "chat", ROUTING)).toBe(1);
         } finally {
             write.mockRestore();
         }
````

- [ ] **Step 2: Run them to see them fail**

Run: `bun test packages/cli`
Expected: FAIL: `models.ts` exports neither `chatRouting` nor
`loadRouting`, and `run-tui.ts` no `chatDeps`; a routing fault leaves
reviews on.

- [ ] **Step 3: Add the code**

Run: `patch_of 12 | git apply`

````diff
diff --git a/packages/cli/src/claude-hook.ts b/packages/cli/src/claude-hook.ts
index 48dbe6b..e635f84 100644
--- a/packages/cli/src/claude-hook.ts
+++ b/packages/cli/src/claude-hook.ts
@@ -28,7 +28,7 @@ import {
     xdgDir,
 } from "@dorothy/core";
 import type { HookDeps, HookLog, HookMode } from "@dorothy/memory/claude-hook";
-import { COOLDOWNS, ROUTES } from "./models.js";
+import { COOLDOWNS, loadRouting, type RoutingDeps } from "./models.js";

 // The checkout this program runs from: three up from packages/cli/src.
 export const checkoutRoot = resolve(import.meta.dir, "..", "..", "..");
@@ -55,26 +55,30 @@ export async function loadCheckoutSecrets(

 type Agent = { call: StructuredCall; persona: string };

-export type HookCliDeps = CheckoutSecretsDeps & {
-    // process.env: claude's environment, into which her secrets load, and
-    // which reviews read their keys from.
-    env?: Env;
-    // This program as a command, for the detached catch-up.
-    self?: readonly string[];
-    agent?: () => Promise<Agent>;
-    run?: (mode: HookMode, deps: HookDeps) => Promise<number>;
-    // Memory's hook entry point, imported once it is needed.
-    memory?: () => Promise<typeof import("@dorothy/memory/claude-hook")>;
-};
+export type HookCliDeps = CheckoutSecretsDeps &
+    RoutingDeps & {
+        // process.env: claude's environment, into which her secrets load, and
+        // which reviews read their keys from.
+        env?: Env;
+        // This program as a command, for the detached catch-up.
+        self?: readonly string[];
+        agent?: () => Promise<Agent>;
+        run?: (mode: HookMode, deps: HookDeps) => Promise<number>;
+        // Memory's hook entry point, imported once it is needed.
+        memory?: () => Promise<typeof import("@dorothy/memory/claude-hook")>;
+    };

 const describeError = (error: unknown) =>
     error instanceof Error ? error.message : String(error);

-async function loadAgent(env: Env): Promise<Agent> {
+// config.toml's review route, then the agent; a routing fault fails it,
+// so each review fails, saying the fault in the log, and the hook goes on.
+async function loadAgent(env: Env, deps: HookCliDeps): Promise<Agent> {
+    const routing = await loadRouting({ ...deps, env });
     const { structuredCall, systemPrompt } = await import("@dorothy/agent");
     return {
         call: structuredCall({
-            route: ROUTES.review,
+            route: routing.routes.review,
             cooldowns: COOLDOWNS,
             env,
         }),
@@ -202,7 +206,7 @@ function reviewingAgent(
     }
     let loading: Promise<Agent> | undefined;
     return () => {
-        loading ??= (deps.agent ?? (() => loadAgent(env)))().catch(
+        loading ??= (deps.agent ?? (() => loadAgent(env, deps)))().catch(
             (error: unknown) => ({
                 call: refusing(
                     `the agent could not load (${describeError(error)})`,
diff --git a/packages/cli/src/dump.ts b/packages/cli/src/dump.ts
index 56d522c..620095f 100644
--- a/packages/cli/src/dump.ts
+++ b/packages/cli/src/dump.ts
@@ -9,9 +9,8 @@
 //

 import { dumpRequest, type PersonaMode } from "@dorothy/agent";
-import type { Env } from "@dorothy/core";
+import type { Env, Routing } from "@dorothy/core";
 import { previewStart } from "@dorothy/memory";
-import { ROUTES } from "./models.js";
 import { recallLaunch } from "./recall-launch.js";

 export type DumpRequest = {
@@ -26,6 +25,7 @@ export type DumpRequest = {
 export async function runDump(
     request: DumpRequest,
     {
+        routing,
         env = process.env,
         dump = dumpRequest,
         write = {
@@ -37,10 +37,12 @@ export async function runDump(
             },
         },
     }: {
+        // config.toml's, whose chat route the dump shows.
+        routing: Routing;
         env?: Env;
         dump?: typeof dumpRequest;
         write?: { out: (text: string) => void; err: (text: string) => void };
-    } = {},
+    },
 ): Promise<number> {
     const preview = await previewStart({
         resume: request.resume,
@@ -56,7 +58,8 @@ export async function runDump(
     const body = await dump({
         setup: { ...preview.start, persona: request.persona },
         message: request.message,
-        route: ROUTES.chat,
+        route: routing.routes.chat,
+        keys: routing.keys,
         env,
         report: (kind, message) => {
             if (kind === "error") {
diff --git a/packages/cli/src/index.ts b/packages/cli/src/index.ts
index 05989a6..c70a060 100644
--- a/packages/cli/src/index.ts
+++ b/packages/cli/src/index.ts
@@ -19,7 +19,12 @@ import {
     checkoutRoot,
     loadCheckoutSecrets,
 } from "./claude-hook.js";
-import { COOLDOWNS, ROUTES } from "./models.js";
+import {
+    COOLDOWNS,
+    chatRouting,
+    loadRouting,
+    type RoutingDeps,
+} from "./models.js";
 import { selfServe } from "./self.js";

 // What runs each mode, and the code it exits with; nothing where it set
@@ -44,11 +49,11 @@ const writeError = (text: string): void => {
     process.stderr.write(text);
 };

-// Reviews for the service: Dorothy's secrets by path from this
-// checkout, then the agent, whose calls name their own base URL and
-// key, so nothing Claude Code exported reaches them. Off, and said, when
-// either fails; the service keeps the reason in its log, as its stderr
-// may be ignored.
+// Reviews for the service: config.toml's review route, Dorothy's
+// secrets by path from this checkout, then the agent, whose calls name
+// their own base URL and key, so nothing Claude Code exported reaches
+// them. Off, and said, when any fails; the service keeps the reason in
+// its log, as its stderr may be ignored.
 export async function reviewAgent(
     deps: CredentialDeps = {},
 ): Promise<
@@ -58,6 +63,7 @@ export async function reviewAgent(
     const write = deps.write ?? writeError;
     try {
         const env = deps.env ?? process.env;
+        const routing = await loadRouting({ ...deps, env });
         const failure = await loadCheckoutSecrets(env, deps);
         if (failure !== null) {
             throw new Error(`secrets.json did not load (${failure})`);
@@ -66,7 +72,7 @@ export async function reviewAgent(
         return {
             review: {
                 call: structuredCall({
-                    route: ROUTES.review,
+                    route: routing.routes.review,
                     cooldowns: COOLDOWNS,
                     env,
                 }),
@@ -81,10 +87,11 @@ export async function reviewAgent(
     }
 }

-export type CredentialDeps = CheckoutSecretsDeps & {
-    env?: Env;
-    write?: (text: string) => void;
-};
+export type CredentialDeps = CheckoutSecretsDeps &
+    RoutingDeps & {
+        env?: Env;
+        write?: (text: string) => void;
+    };

 // Decrypt only for modes that need credentials. A failed load warns by
 // code and leaves the mode to report its missing credential as before.
@@ -110,28 +117,41 @@ const RUNNERS: Runners = {
         return 2;
     },
     oneshot: async (mode) => {
-        // The modes that talk to the model load their credentials first.
+        // The modes that talk to the model stop on a routing fault, then
+        // load their credentials.
+        const routing = await chatRouting(writeError);
+        if (routing === null) {
+            return 1;
+        }
         await loadCredentials();
         const { runOneShot } = await import("@dorothy/agent");
         // It sets the exit code itself, should the reply fail.
         await runOneShot(mode.prompt, mode.persona, {
-            route: ROUTES.chat,
+            route: routing.routes.chat,
             cooldowns: COOLDOWNS,
         });
         return undefined;
     },
     tui: async (mode) => {
+        const routing = await chatRouting(writeError);
+        if (routing === null) {
+            return 1;
+        }
         await loadCredentials();
         // Loaded only for chat, so one-shot replies never pay for React.
         const { runTui } = await import("./run-tui.js");
         // runTui has closed everything by now. A push or a repack still
         // running must not hold the terminal after the chat is gone.
-        process.exit(await runTui(mode.resume, mode.persona));
+        process.exit(await runTui(mode.resume, mode.persona, routing));
     },
     dump: async (mode) => {
+        const routing = await chatRouting(writeError);
+        if (routing === null) {
+            return 1;
+        }
         await loadCredentials();
         const { runDump } = await import("./dump.js");
-        return runDump(mode);
+        return runDump(mode, { routing });
     },
     list: async () => {
         const { commandHistory, runList } = await commands();
diff --git a/packages/cli/src/models.ts b/packages/cli/src/models.ts
index 509c05a..72ff5be 100644
--- a/packages/cli/src/models.ts
+++ b/packages/cli/src/models.ts
@@ -8,27 +8,50 @@
 //
 //

-// The routes Dorothy's calls take, each role's default model on
-// Anthropic until config.toml routes them, and the refusals this process
-// has met: one record, shared by every call, so that a refusal one call
-// meets is skipped by the next.
+// The routes Dorothy's calls take, from config.toml, and the refusals
+// this process has met: one record, shared by every call, so that a
+// refusal one call meets is skipped by the next.

 import {
     Cooldowns,
-    defaultRoutes,
-    type RouteEntry,
-    type Routes,
+    type Env,
+    type Routing,
+    type RoutingResult,
+    readRouting,
 } from "@dorothy/core";

-export const ROUTES: Routes = defaultRoutes();
-
 export const COOLDOWNS = new Cooldowns();

-// The entry a chat starts on, which --dump-context shows.
-export function chatEntry(): RouteEntry {
-    const entry = ROUTES.chat[0];
-    if (entry === undefined) {
-        throw new Error("the chat route has no entry");
+export type RoutingDeps = {
+    env?: Env;
+    readRouting?: (env: Env) => Promise<RoutingResult>;
+};
+
+// The routes, or an error naming every fault, for the entry points that
+// go on without reviews: the service, the backfill and the hook.
+export async function loadRouting({
+    env = process.env,
+    readRouting: read = readRouting,
+}: RoutingDeps = {}): Promise<Routing> {
+    const result = await read(env);
+    if (!result.ok) {
+        throw new Error(result.faults.join("; "));
+    }
+    return result.routing;
+}
+
+// The routes, or null once each fault is said: chat, the one-shot reply
+// and the dump stop there.
+export async function chatRouting(
+    write: (text: string) => void,
+    { env = process.env, readRouting: read = readRouting }: RoutingDeps = {},
+): Promise<Routing | null> {
+    const result = await read(env);
+    if (result.ok) {
+        return result.routing;
+    }
+    for (const fault of result.faults) {
+        write(`dorothy: ${fault}\n`);
     }
-    return entry;
+    return null;
 }
diff --git a/packages/cli/src/run-tui.ts b/packages/cli/src/run-tui.ts
index ed2ed7d..a00d28c 100644
--- a/packages/cli/src/run-tui.ts
+++ b/packages/cli/src/run-tui.ts
@@ -21,16 +21,26 @@ import {
     structuredCall,
     systemPrompt,
 } from "@dorothy/agent";
+import type { Routing } from "@dorothy/core";
 import { openMemory } from "@dorothy/memory";
 import { runApp } from "@dorothy/tui";
 import { userShell } from "./claude.js";
-import { COOLDOWNS, ROUTES } from "./models.js";
+import { COOLDOWNS } from "./models.js";
 import { recallLaunch } from "./recall-launch.js";

+// What each chat session takes from the routes: the chat route, every
+// provider's key names, which its recall server is withheld, and the
+// process's cooldowns.
+export function chatDeps({ routes, keys }: Routing) {
+    return { route: routes.chat, keys, cooldowns: COOLDOWNS };
+}
+
 export async function runTui(
     resume: string | null,
-    persona: PersonaMode = "chat",
+    persona: PersonaMode,
+    routing: Routing,
 ): Promise<number> {
+    const { routes } = routing;
     // The directory the user ran dorothy from, under bun run dev too.
     const cwd = userShell(process.env).cwd ?? process.cwd();
     const compactionPrompt = personaPrompt({ recall: false, mode: persona });
@@ -38,11 +48,11 @@ export async function runTui(
         resume,
         calls: {
             review: structuredCall({
-                route: ROUTES.review,
+                route: routes.review,
                 cooldowns: COOLDOWNS,
             }),
             compaction: structuredCall({
-                route: ROUTES.compaction,
+                route: routes.compaction,
                 cooldowns: COOLDOWNS,
             }),
         },
@@ -52,18 +62,17 @@ export async function runTui(
             compaction:
                 persona === "chat"
                     ? compactionPrompt
-                    : `${compactionPrompt}\n\n${routeLine(ROUTES.chat)}`,
+                    : `${compactionPrompt}\n\n${routeLine(routes.chat)}`,
             hash: (recall) =>
                 promptHash(personaPrompt({ recall, mode: persona })),
             session: (start) =>
-                conversationSetup({ ...start, persona }, ROUTES.chat).system,
+                conversationSetup({ ...start, persona }, routes.chat).system,
         },
         connect: (start) => {
             const conversation = new Conversation({
                 ...start,
                 persona,
-                route: ROUTES.chat,
-                cooldowns: COOLDOWNS,
+                ...chatDeps(routing),
             });
             conversation.start();
             return conversation;
````

- [ ] **Step 4: Run them to see them pass**

Run: `bun test packages/cli`
Expected: PASS.

- [ ] **Step 5: Check**

Run `bun run format`, then the check on temporary roots. Expected: PASS,
3971 tests, 0 fail.

- [ ] **Step 6: Commit**

```bash
git add -A packages/cli
git commit -m "feat(cli): Route every role from config.toml" \
    -m "Chat, the one-shot reply and the dump print a routing fault and
exit 1; the service, the backfill and the Claude hook turn reviews
off with it. Chat sessions withhold every provider's key from the
recall server."
```

### Task 7: The README and package guides

**Files:**

- Modify: `README.md`, `packages/agent/AGENTS.md`,
  `packages/core/AGENTS.md`, `packages/cli/AGENTS.md`

- [ ] **Step 1: Apply the text**

Run: `patch_of 13 | git apply`

````diff
diff --git a/README.md b/README.md
index e9d3bbb..aa02182 100644
--- a/README.md
+++ b/README.md
@@ -23,7 +23,8 @@ Conversational LLM interface

 Dorothy is a conversational assistant in the spirit of <https://claude.ai>,
 running on her own runtime, the Vercel AI SDK, which reaches Anthropic's
-Messages API with her own system prompt.
+Messages API with her own system prompt, and the other providers
+`config.toml` names.

 ## Prerequisites

@@ -56,6 +57,9 @@ Use sops's editor to set a credential as a JSON string:
 - `ANTHROPIC_API_KEY`: the key Dorothy's own calls spend, her chat, her
   reviews and her compactions, through Anthropic's Messages API. A Max
   plan's monthly API credits cover it.
+- `OPENROUTER_API_KEY`, `FEATHERLESS_API_KEY` and `HF_TOKEN`: keys for
+  the other providers her calls may be routed to (Models and providers,
+  below). A provider in `config.toml` names the one it uses.
 - `CLAUDE_CODE_OAUTH_TOKEN`: a Claude Pro/Max subscription token, minted
   by running `claude setup-token`, for the eval's `via = "claude"`
   clients, which run Claude Code itself. `dorothy --claude` needs none: it
@@ -148,7 +152,80 @@ Modules show left to right as far as the width allows, then on up to
 `max-lines` lines (at most 5); those that still do not fit are left out from
 the right. An empty `modules` hides the line; for the statusline it also
 frees its rows, so the window then needs only 19 lines. A mistake in the
-file shows as a warning, naming its line, and the defaults apply.
+file shows as a warning, naming its line, and the defaults apply, but for
+the routing tables below: a mistake there, or a file holding them that
+does not parse, is an error.
+
+### Models and providers
+
+Each of her calls has a role: `chat`, `review`, `compaction`, and
+`maintenance`, for work to come. By default each runs on one Anthropic
+model: chat on `claude-opus-5-5`, reviews and compaction on
+`claude-sonnet-5-5`, maintenance on `claude-haiku-5-5`. `config.toml`
+can declare other providers and give each role an ordered list:
+
+```toml
+[providers.anthropic]
+kind = "anthropic"
+key = "ANTHROPIC_API_KEY"
+
+[providers.openrouter]
+kind = "openrouter"
+key = "OPENROUTER_API_KEY"
+
+[providers.featherless]
+kind = "featherless"
+key = "FEATHERLESS_API_KEY"
+
+[providers.hf]
+kind = "huggingface"
+key = "HF_TOKEN"
+
+[providers.ollama]
+kind = "local"
+base-url = "http://127.0.0.1:11434/v1"
+
+[models]
+chat = ["anthropic:claude-opus-5-5", "openrouter:<model>"]
+review = [
+  "anthropic:claude-sonnet-5-5",
+  { model = "featherless:<model>", price = [0.1, 0.1] },
+]
+```
+
+A call that fails on one model moves to the next and says so, unless it
+was cancelled or her reply had begun: once text has streamed or she has
+kept a fact, a failure ends the turn. A provider out of credit is skipped
+until its `retry-after`, or for five minutes, and a rate-limited model
+likewise, for as long as the process runs.
+
+| Kind | Reaches | What keeps her prompts |
+| --- | --- | --- |
+| `anthropic` | The Messages API, or a loopback `base-url` written as `ANTHROPIC_BASE_URL` is | Anthropic's commercial terms |
+| `openrouter` | `https://openrouter.ai/api/v1` | Only endpoints with zero data retention and data collection denied, asked on every request |
+| `featherless` | `https://api.featherless.ai/v1`, on its paid API plan | Featherless stores no prompts |
+| `huggingface` | `https://router.huggingface.co/v1` | Whichever provider Hugging Face routes to, some of which keep prompts; a suffix such as `org/model:featherless-ai` chooses one |
+| `local` | A loopback `base-url`, the server's full API root | This machine |
+
+- `key` names a `secrets.json` entry, never a value; only `local` may
+  leave it out. A key unset when a call runs fails that entry alone.
+- An entry is `provider:model`, split at the first colon, so
+  `openrouter:x/y:free` names the model `x/y:free`.
+- `price`, dollars per million tokens in and out, is for `featherless`,
+  `huggingface` and `local` entries; `[0, 0]` is free. OpenRouter reports
+  each call's cost, and Anthropic's models are priced from a table; any
+  other model costs $0, with a warning.
+- With no `[providers]`, `anthropic` is implied. A role left out of
+  `[models]` takes its default model on the provider named `anthropic`.
+- A model later in a list needs a context window no smaller than
+  `compaction.hard` (128,000 tokens by default), or a long chat fails on
+  it.
+
+A mistake in these tables is an error, as a default could send her
+requests where you did not mean: chat, a one-shot reply and
+`--dump-context` print it and exit 1; the memory service and Claude
+Code's hooks log it and review nothing; `--review-backfill` prints it and
+exits 1.

 ### Memory

diff --git a/packages/agent/AGENTS.md b/packages/agent/AGENTS.md
index 38913a8..fe016f8 100644
--- a/packages/agent/AGENTS.md
+++ b/packages/agent/AGENTS.md
@@ -20,10 +20,11 @@ tags:
 # packages/agent/AGENTS.md

 `@dorothy/agent` is Dorothy's model side, and the only package declaring a
-model provider's SDK: `ai`, `@ai-sdk/anthropic` and `@ai-sdk/mcp`, at a
-thin edge, as core's contracts carry no SDK type. It runs her on the
-Vercel AI SDK, reaching Anthropic's Messages API with her own system
-prompt, one route per role.
+model provider's SDK: `ai`, `@ai-sdk/anthropic`, `@ai-sdk/openai-compatible`,
+`@openrouter/ai-sdk-provider` and `@ai-sdk/mcp`, at a thin edge, as core's
+contracts carry no SDK type. It runs her on the Vercel AI SDK, reaching
+Anthropic's Messages API, OpenRouter and Chat Completions servers with her
+own system prompt, one route per role.

 ## Entry points and imports

@@ -37,16 +38,25 @@ unused.

 ## Files

-- `providers.ts`: `languageModel`, the AI SDK's model for a route entry.
-  Every provider gets its base URL (Dorothy appends `/v1`) and key
-  explicitly and `noRedirect` as its fetch, so none reads
-  `ANTHROPIC_BASE_URL`, `ANTHROPIC_API_KEY` or any variable of its own;
-  `keyOf` reads an entry's key from the environment passed in. It turns
-  the AI SDK's console warnings off and sets `providerOptions`.
+- `providers.ts`: `languageModel`, the AI SDK's model for a route entry
+  and its use, `chat` or `structured`: Anthropic's (Dorothy appends
+  `/v1`); OpenRouter's, sent `OPENROUTER_RETENTION` and usage accounting
+  on every request and `require_parameters` on structured ones; and the
+  OpenAI-compatible provider for featherless, Hugging Face and local
+  servers. Every provider gets its base URL and key explicitly and
+  `noRedirect` as its fetch, so none reads a variable of its own; `keyOf`
+  reads an entry's key from the environment passed in. It turns the AI
+  SDK's console warnings off, sets `providerOptions`, and puts the system
+  prompt behind a cache breakpoint on Anthropic (`instructionsFor`).
 - `failures.ts`: `failureOf`, a provider's error, thrown or streamed, as
-  core's `Failure`; only this package knows the wire.
-- `cost.ts`: `stepUsage`, a step's usage as core's `stepCost` prices
-  it, and `unpricedNotice`, once a process per model with no price.
+  core's `Failure`, one with no status by its AI SDK name; only this
+  package knows the wire.
+- `cost.ts`: `stepUsage`, and `stepPrice`, a step's cost (OpenRouter's
+  own figure, else core's `stepCost`) with the notice, once a process per
+  model, of a cost unknown: no price, or no usage.
+- `stream.ts`: `requestBase`, what every request sets, and `readStream`,
+  a request's stream as chat and structured calls both read it: the
+  watchdog fed, error and abort parts made a `Failure`, each step costed.
 - `attempt.ts`: `STALL_MS`; `Watchdog`, an attempt's abort (its route's
   signal, or a stall: no stream part for `STALL_MS`), as the AI SDK's own
   chunk timeouts miss a server that never answers; `secretFailure`.
@@ -60,7 +70,8 @@ unused.
 - `recall-tools.ts`: `connectRecall`, an MCP stdio client of the recall
   server (this program again, from `RecallLaunch`), its tools named
   `mcp__memory__<name>` and only those a session may use. `recallEnv`
-  is the caller's environment less every key a route names, every
+  is the caller's environment less every key a route or provider names
+  (the session's `keys`), every
   `*_API_KEY` and every `CLAUDE_CODE_OAUTH_TOKEN*`; `recallCwd` is a
   directory of Dorothy's, never the user's project.
 - `turn.ts`: `TurnState`, one turn's progress across its attempts: the
@@ -72,7 +83,8 @@ unused.
   label), `delta`, `turn-end`, `sdk` (a stream part), `lookup`,
   `remember`, `warning` and `error`. Cache breakpoints sit on the system
   prompt and the latest user message, the second never stored. Reasoning
-  is kept to the model that made it. `conversationSetup()` builds what a
+  is kept to the model that made it; an assistant message left empty
+  without it is not sent. `conversationSetup()` builds what a
   session starts with from `SessionStart` and the persona, joining the
   memory block and the earlier section with `withSection` and the turns
   with `withHistory`; development mode ends with `routeLine`.
@@ -88,10 +100,12 @@ unused.
   reads back.
 - `capture.ts`: `captureServer`, a loopback stand-in for the API that
   records request bodies and answers with an error; `dumpRequest` sends a
-  chat's first request to it and returns the body, for `--dump-context`.
+  chat's first request, on its route's first entry, to it and returns the
+  body, for `--dump-context`; development mode names the whole route.
   The CLI's `--claude --dump-context` puts it behind the gateway.
-- `testing.ts` and `fake-mcp.ts`: for tests only, `fakeMessages`, mock
-  models, hand-fired timers and a stand-in MCP server.
+- `testing.ts` and `fake-mcp.ts`: for tests only, `fakeMessages` and
+  `fakeCompletions`, mock models, hand-fired timers and a stand-in MCP
+  server.

 ## Invariants

@@ -106,9 +120,10 @@ unused.
 - `persona.test.ts` pins the chat prompt byte for byte, and that every
   persona is well formed: change the pin only when the persona is meant
   to change.
-- Wire tests run on `fakeMessages` on loopback, behaviour tests on
-  `mockModel` (`ai/test`); no test reaches a provider or reads
-  `secrets.json`.
+- Wire tests run on `fakeMessages` and `fakeCompletions` on loopback
+  (`wire.test.ts`: each Chat Completions kind, and fallback across
+  kinds), behaviour tests on `mockModel` (`ai/test`); no test reaches a
+  provider or reads `secrets.json`.

 ## See also

diff --git a/packages/cli/AGENTS.md b/packages/cli/AGENTS.md
index 4841774..8bcd1a3 100644
--- a/packages/cli/AGENTS.md
+++ b/packages/cli/AGENTS.md
@@ -49,8 +49,9 @@ SDK. Keep every new mode's import lazy.
   starts a `Conversation`, and the screen runs over its `createSession`. Once
   `runTui` resolves, everything is closed and the CLI ends the process, so a
   push or repack still running never holds the terminal.
-- `models.ts`: `ROUTES` (core's `defaultRoutes`) and the process's one
-  `COOLDOWNS`, passed to the agent by every model mode; `chatEntry`, dump's.
+- `models.ts`: the process's one `COOLDOWNS`; `chatRouting`, config's routes
+  or each fault said, on which chat, one-shot and dump exit 1, and
+  `loadRouting`, which throws them, so the service's and hook's reviews fail.
 - `dump.ts`: `runDump` composes `previewStart` with `dumpRequest` for
   `--dump-context`.
 - `claude.ts`: `launchClaude`, for `--claude` and its dump, starts the gateway
@@ -126,9 +127,9 @@ SDK. Keep every new mode's import lazy.
   core's async `loadSecrets` through sops. The model modes, mirror and
   recover await `loadCredentials`. A failed load warns by code; mirror
   refuses to create a key after a failed load.
-- Routes (`models.ts`) name their own base URL and key, and nothing reads
-  the provider variables. The agent runs the recall server with `recallEnv`,
-  without any key or OAuth token, in `recallCwd`, never the user's project.
+- Routes (`models.ts`) name their own base URL and key; no provider reads
+  its variables. The recall server runs with `recallEnv`, withheld every
+  provider's key and OAuth token, in `recallCwd`, never the user's project.
 - `--claude` loads no secrets: `claude` signs in as the user's own Claude
   Code does, and memory is read without credentials. `--claude-hook`
   loads the checkout's `secrets.json` by path for reviews, never the
diff --git a/packages/core/AGENTS.md b/packages/core/AGENTS.md
index 81a1e6c..8db21d3 100644
--- a/packages/core/AGENTS.md
+++ b/packages/core/AGENTS.md
@@ -37,8 +37,8 @@ below. It declares `niceware` alone, and never imports another
   and `withSection`, which joins a section (the memory block, the earlier
   turns' abstracts) to a system prompt.
 - `contracts/structured.ts`: `StructuredCall`, the one-shot call reviews
-  and compaction take.
-- `contracts/model.ts`: the routing contracts: `ROLES`, `KINDS`, a
+  and compaction take, and `withNotes`, which says an outcome's notes.
+- `contracts/model.ts`: the routing contracts: `ROLES`, the five `KINDS`, a
   `RouteEntry` (base URL always explicit, key a `secrets.json` name),
   `Routes`, `Failure` and `AttemptResult`, and `label`
   (`<provider>:<model>`).
@@ -51,7 +51,11 @@ below. It declares `niceware` alone, and never imports another
 - `models/prices.ts`: `ANTHROPIC_PRICES`, dated with their source, and
   `stepCost`, what a step's tokens cost, or null for no known price.
 - `models/routes.ts`: `DEFAULT_MODELS` and `defaultRoutes`, each role's
-  Anthropic route until config routes it.
+  Anthropic route when config names none, and `FIXED_ROOTS`.
+- `models/routing.ts`: `parseRouting`, `config.toml`'s `[providers]` and
+  `[models]` as a `Routing` (every role's route, every provider's key
+  names) or every fault, and `isLoopback`. `config.ts`'s `routingOf` and
+  `readRouting` read them; `parseConfig` leaves both tables alone.
 - `contracts/notices.ts`: `Notice` and `NoticeSource`, what memory and
   history show on screen.
 - `contracts/editor.ts`: `Editor`, the external editor's contract.
````

- [ ] **Step 2: Check**

Run: `git add -A && bun run lint:md && wc -l packages/cli/AGENTS.md`
Expected: PASS; 150 lines.

- [ ] **Step 3: Commit**

```bash
git commit -m "docs: Describe providers and routes" \
    -m "The README's new section on [providers] and [models], with the
context-window caution and what each kind keeps; the guides of core,
agent and cli follow the code."
```

### Task 8: Live verification and report (the coordinating agent)

Run by the coordinating agent, not an implementer: the one sanctioned
read of the real `secrets.json`, on temporary XDG roots, recorded in the
report with output and cost.

- [ ] **Step 1: Choose the models**

From OpenRouter's model list that day, a model with a zero-retention
endpoint and structured-output support; from featherless's catalogue a
model on the Developer plan, with its per-token price from its pricing
page. Name both, and where each fact came from, in the report.

- [ ] **Step 2: A loopback server answering 429**

A Bun script on `127.0.0.1` answering every POST with 429 and
`retry-after: 30`, declared as `[providers.proxy]`, `kind = "local"`.
`config.toml` on the temporary `XDG_CONFIG_HOME`:

```toml
[providers.proxy]
kind = "local"
base-url = "http://127.0.0.1:<port>/v1"

[providers.openrouter]
kind = "openrouter"
key = "OPENROUTER_API_KEY"

[providers.featherless]
kind = "featherless"
key = "FEATHERLESS_API_KEY"

[providers.anthropic]
kind = "anthropic"
key = "ANTHROPIC_API_KEY"

[models]
chat = ["proxy:none", "openrouter:<model>"]
review = ["proxy:none", "openrouter:<model>"]
```

- [ ] **Step 3: One call forced onto OpenRouter**

`bun run dev -- "Say hello in five words."`: stderr carries the note
"proxy:none refused (rate-limit: …); answering with openrouter:…", the
reply streams, exit 0. Record the note, the reply and OpenRouter's
reported cost.

- [ ] **Step 4: A chat, a review and a compaction on it**

Add to `config.toml`:

```toml
compaction = ["proxy:none", "openrouter:<model>"]

[compaction]
soft = 2000
hard = 4000
tail = 500
```

In a herdr tab with the temporary roots exported, chat on the TUI until
compaction runs: the fallback warning shows, the header names
`openrouter:<model>`, the reply stats carry OpenRouter's cost, and the
compaction's note shows as `memory: compaction: …`. After the idle
wait, the review runs and its note shows as `memory: review: …`. The
structured output must pass memory's own judges: record that the
sidecar holds the review's notes (`validateReview` passed) and the
clusters (`validateClusters` passed), or the warning that says why
not. A model that ignores the schemas' limits fails here; investigate
before the merge, as Part A did.

- [ ] **Step 5: featherless and Hugging Face**

With every role on `[{ model = "featherless:<model>", price = [<in>,
<out>] }]`, a one-shot reply, then a TUI chat that reaches a
compaction and a review, judged as in Step 4, each with its cost by the
entry's price. A Chat plan, which excludes API use, fails here as
`rejected` or `usage`; say so, never work around it. Then one one-shot
reply with `chat = ["hf:<org/model>:<provider>"]` on
`[providers.hf]`, `kind = "huggingface"`, `key = "HF_TOKEN"`.

- [ ] **Step 6: Report**

A "Part B" section in `docs/reports/2026-11-01-model-providers.md`:
the models and why, each run's output and cost, and the build's
rulings. Then the PR, its merge once CI passes, and the roadmap's
revision as its Revising section says.
