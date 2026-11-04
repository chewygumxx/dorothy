---
ctime: 2026-11-03
mtime: 2026-11-03
spdx: GPL-3.0-only
title: Pi delivery implementation plan
description: >-
  Native Pi delivery in seven tested increments: the pinned executable,
  model and profile configuration, branch-aware recording, memory hooks,
  the extension, the launcher and bounded verification.
tags:
  - dorothy
  - pi
  - plan
---

<!--
   -
   - ~chewygumxx/dorothy.git
   - ::: :/docs/plans/2026-11-03_pi-delivery.md
   -
   -->

# Pi Delivery Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use
> superpowers:subagent-driven-development, as AGENTS.md requires.
> Implement task by task; checkboxes track execution, not design approval.

**Goal:** `dorothy --pi` opens Pi's interface with Featherless inference,
Dorothy's identity, scoped memory and recoverable session recording.

**Architecture:** The CLI launches the published Pi executable and an
extension. The extension calls Dorothy's Bun helpers over JSON stdin;
memory decodes ordinary JSONL through its existing service contract.
Pi SDK types stay in the CLI package.

**Tech Stack:** Bun, TypeScript, Node >=22.19.0, Pi 1.5.0, native MCP,
OpenAI-compatible Chat Completions, the existing memory service.

**Spec:** [Dorothy in Pi](../specs/2026-11-03_pi-delivery.md), approved
2026-11-03. This plan implements increment A. The
[stewardship plan](./2026-11-03_pi-stewardship.md) follows it.

## Global constraints

- Pin `@earendil-works/pi-coding-agent` to `1.5.0`; Node `>=22.19.0`.
- The CLI owns the dependency. No Pi SDK type enters core or memory.
- Agent directory: `$XDG_CONFIG_HOME/dorothy/pi`; session root:
  `$XDG_DATA_HOME/dorothy/pi/sessions`, with existing XDG defaults.
- Keep identity additive, preferences persistent and launch files private.
- Every test injects roots and environment; no real store or secret load.
- No automatic model fallback, copied login or key in argv/files/logs.
- Direct memory MCP tools; no incidental codemode or tool-search tools.
- Read each affected package guide; update it with the task's changes.
- Every file gets the house header; Markdown lines stay within 80 columns.
- Commit messages below meet the repository's 50-character header limit.
- Live inference is outside CI and requires a recorded spending budget.

## Review focus

1. A resumed session enters another project: rebind memory and helpers;
   never reuse the former project's context. Tasks 4 and 5 test it.
2. Two paths share Pi's sanitized directory name: retain distinct
   session roots and resume results. Tasks 2 and 6 test it.
3. A child fork is swept before its parent, or a cache is lost: resolve
   ancestry without new copies of old speech. Tasks 3 and 4 test it.
4. A trusted project's MCP configuration shadows Dorothy's server:
   refuse the collision before connection. Tasks 2 and 5 test it.
5. An aborted call has no normal tool-result callback: record one final
   result, including after replay. Tasks 3, 5 and 7 test it.

## File responsibilities and shared contracts

- `packages/cli/src/hosts/pi/`: runtime resolution, profile preparation,
  model selection and launch composition. No conversation loop here.
- `packages/cli/assets/pi/`: Pi's extension, its provider/context
  adapters and declared model metadata. Node-compatible code only.
- `packages/memory/src/recording/pi*.ts`: pure graph decoding, ancestry
  metadata and confined source discovery, using no Pi import.
- `packages/memory/src/hooks/pi.ts`: JSON helper, using existing block,
  recall and recording clients. Export through `./host-hook`.
- `packages/cli/src/hosts/pi/testing.ts`: fake provider and private
  roots shared by integration tests. No global setup or credentials.

New internal helper: `dorothy --pi-hook`, JSON on stdin and stdout.
The request/reply types are exported from `@dorothy/memory/host-hook`:

```ts
type PiHookRequest = {
    event: "start" | "prompt" | "settled" | "end";
    sessionId: string;
    sessionFile: string | null;
    leafId: string | null;
    cwd: string;
    private: boolean;
    reason?: BlockReason;
    prompt?: string;
};
type PiHookReply = {
    session: string | null;
    context: string;
    recording: "off" | "pending" | "delivered";
    warning: string | null; // Stable code, never raw content.
};
```

`BlockReason` and `Env` are existing core types. Helpers use JSON rather
than importing Bun modules into Pi. Requests are capped at 128 KiB;
replies at 64 KiB. An invalid helper reply produces a warning, never
prompt text. These are implementation limits, not provider token limits.

## Task 1: verify the published Pi runtime boundary

**Files:** Create `packages/cli/src/hosts/pi/runtime.ts` and
`runtime.test.ts`; modify `packages/cli/package.json`, `bun.lock`,
`workspace.test.ts`, `packages/cli/AGENTS.md` and
`packages/cli/src/hosts/AGENTS.md`.

**Interfaces:**

```ts
type PiRuntime = { command: string[]; version: "1.5.0" };
resolvePiRuntime(cliDir: string, env: Env): Promise<PiRuntime>;
```

`cliDir` is the CLI package directory. Resolve its installed public
`node_modules/.bin/pi` link and execute it with the selected Node.
Read package metadata as files to verify the pin; import no internal
package entry point. Diagnostics are codes and paths, not environment.

- [ ] Write tests for the exact dependency pin, Node 22.18 refusal,
  Node 22.19 acceptance, absent binary and a hostile global `pi` first
  on PATH. Pin the workspace rule that only CLI declares Pi packages.

  ```ts
  expect(await resolvePiRuntime(cliDir, env)).toMatchObject({
      version: "1.5.0",
  });
  expect(spawnedExecutable).not.toBe(globalDecoy);
  ```

- [ ] Run `bun test packages/cli/src/hosts/pi/runtime.test.ts` and
  `bun test workspace.test.ts`; observe the missing runtime/pin failures.
- [ ] Declare the exact Pi dependency and install through `bun install`.
  Implement resolution and runtime checks. Test the published executable
  with `--offline --version` under a temporary HOME and agent directory;
  set `PI_OFFLINE=1`, with no inherited provider credentials.
- [ ] Repeat the two tests; require exit 0 and version `1.5.0` from the
  actual packaged CLI. A Node/native-module incompatibility stops this
  task and is reported before more integration code is written.
- [ ] Commit: `feat(cli): Pin and resolve Pi runtime`.

## Task 2: define model selection and owned profile files

**Files:** Create `packages/cli/src/hosts/pi/models.ts`, `profile.ts`,
`models.test.ts`, `profile.test.ts` and
`packages/cli/assets/pi/models.json`; update the CLI guides.

**Interfaces:** `RouteEntry`, `Routing` and `Env` come from core.

```ts
type PiModelSpec = {
    id: string;
    contextWindow: number;
    maxTokens: number;
    reasoning: boolean;
    input: ("text" | "image")[];
    price: { input: number; output: number; cacheRead: number | null };
    checkedAt: string;
    sources: string[];
};
type PiSelection = { entry: RouteEntry; models: PiModelSpec[] };
sessionDirFor(canonicalCwd: string): string;
selectPiModel(
    route: readonly RouteEntry[], requested: string | null,
    catalog: readonly PiModelSpec[],
): PiSelection;
type PiProfile = {
    agentDir: string; sessionDir: string; launchDir: string;
    manifestPath: string; personaPath: string;
    cleanup(): Promise<void>;
};
preparePiProfile(input: {
    env: Env; cwd: string; launchId: string;
    persona: string; manifest: PiLaunchManifest;
}): Promise<PiProfile>;
```

Define `PiLaunchManifest` in `models.ts`: version `1`, launch ID,
canonical cwd, `self: string[]`, selected `RouteEntry`, model metadata,
required extension/skill paths, and `helperEnv: Env`. No credential
value belongs in any manifest field. The provider key field is its
variable name. The stewardship plan adds an optional registry path.
The helper environment contains only root, executable and local-service
coordinates. Reconstruct runtime proxy/terminal environment in the
launcher; do not serialize credentials embedded in proxy URLs.

First model: `deepseek-ai/DeepSeek-V4.1-Flash-1017`. The public
[catalogue][catalogue], read without authentication on 2026-11-03,
returned context `262144`, maximum completion `32768`, input price
`0.225` and output price `0.9` per million tokens. Its
[model page][model] additionally lists cached input at `0.006`.
Use text input in this first compatibility entry; vision is untested.
Mark reasoning supported, with the wire behaviour verified in Task 5.
Revalidate this metadata before a paid run rather than silently updating
the committed defaults. An unlisted configured model fails clearly.
An explicit route price overrides input/output accounting metadata and
is labelled as configuration-derived; context and completion limits
still come from the checked manifest.

- [ ] Test default selection of the first Featherless chat-route entry,
  exact `provider:model` selection, unknown model refusal and no
  cross-provider model picker entries. Test ownership collision,
  parallel launches, key-free files and preserved preferences.

  ```ts
  expect(selection.models.map((m) => m.id)).toEqual([modelId]);
  expect(profileA.launchDir).not.toBe(profileB.launchDir);
  expect(await readFile(profileA.manifestPath, "utf8"))
      .not.toContain(syntheticKey);
  expect(sessionDirFor("/a/b")).not.toBe(sessionDirFor("/a-b"));
  ```

- [ ] Run `bun test packages/cli/src/hosts/pi`; expect missing
  model/profile functions to fail while Task 1 stays green.
- [ ] Implement selection and profile writes. Use an exclusive owner
  marker at the dedicated agent root; an unmarked nonempty directory
  is refused. Never overwrite settings, keybindings or trust state.
  Use mode 0700 directories and 0600 files, atomic publication and a
  distinct launch directory below Dorothy's runtime directory. Compose
  the session directory as `sessions/<sha256(canonical-cwd)>/--safe--`,
  where `safe` is Pi's path sanitization. The digest prevents collisions.
  Inspect static profile/project MCP configuration without executing it;
  reject a `dorothy-memory` name collision and report other servers
  before native project trust is resolved. Disable discovered extensions
  and skills by flags; explicitly retain built-in MCP.
- [ ] Run the directory's tests; prove cleanup removes only its launch
  directory, including on setup failure, and preserves session files.
- [ ] Commit: `feat(cli): Prepare Dorothy Pi profiles`.

## Task 3: decode Pi history with stable branch ownership

**Files:** Create `packages/memory/src/recording/pi.ts`, `pi-tree.ts`,
`pi-fixtures.ts` and `pi.test.ts`; update the recording guide.

**Interfaces:** Pure decoding; callers resolve parent paths and pass
their parsed ancestry, never allow this function to open files.

```ts
type PiSegment = {
    session: string; parent: string | null;
    anchor: string | null; events: RecordEvent[]; pending: boolean;
};
type PiAncestry = {
    nativeSession: string;
    entries: Record<string, {
        owner: string; origin: string; parentId: string | null;
        payloadDigest: string;
    }>;
};
type PiRead = {
    nativeSession: string | null; cwd: string | null;
    segments: PiSegment[]; ancestry: PiAncestry | null;
    pending: boolean;
    halt: { line: number; code: string } | null;
    unknown: { line: number; type: string }[];
};
readPi(lines: readonly string[], options: {
    parent: PiAncestry | null; ended: boolean;
}): PiRead;
```

Deterministic mapping, fixed before tests:

1. Validate the v3 session header, unique entry IDs and parent graph in
   append order. A parent must already exist locally or in the supplied
   ancestry. Duplicate IDs with conflicting data or cycles halt.
2. The initial segment is `pi-<sha256(native-session + NUL + root)>`.
   The first child to extend a node retains its segment. Each additional
   child opens `pi-<sha256(native-session + NUL + child-id)>`, linked to
   the segment owning that parent. Count tree entries, including ignored
   context entries, but not non-tree usage entries, so later speech
   does not change a branch identity.
3. A file fork inherits matching entry IDs from the resolved parent;
   inherited entries retain their original owner and emit no new speech.
   The first new descendant opens a segment under the new native session.
   Missing parent ancestry holds the child, not unrelated sessions.
4. Join origin session, entry ID, event kind and occurrence with NUL;
   use `e-` followed by that tuple's SHA-256 digest as the event ID.
   Neither content nor a timestamp chooses identity. Payload digests
   detect conflicting reuse only; they never identify matching speech.
   This keeps contract IDs below 256 characters.
5. Tool pairing follows the branch's ancestry and call occurrence.
   Emit tool evidence at its finalized result, once. Preserve original
   speech after context edits; edits change model context, not history.
   Summaries, reasoning, system and extension context emit no speech.

- [ ] Build synthetic fixtures for linear history, a second child,
  switching back, external forks, repeated tool-call IDs, missing parent,
  malformed known entries, unknown types, torn tails and compaction.

  ```ts
  expect(readTwice.segments).toEqual(firstRead.segments);
  expect(child.events.some((e) => e.sourceId === inheritedId)).toBe(false);
  expect(branchA.session).not.toBe(branchB.session);
  expect(allEvents.filter((e) => e.kind === "user")).toHaveLength(3);
  ```

- [ ] Run `bun test packages/memory/src/recording/pi.test.ts`; confirm
  the absent decoder fails the tests.
- [ ] Implement the graph mapping and message decoder. Unknown
  bookkeeping is diagnosed without speech; an unknown message/content
  type that could carry speech holds that session. Trailing partial
  JSON waits. Images become `[image]`; no attachment is opened.
  A still-pending call holds later events in that segment; other
  branches progress. Only ended/finalized calls become failed results.
- [ ] Run the test file; add a property-style fixture that appends one
  branch at a time and asserts every prior event owner is unchanged.
- [ ] Commit: `feat(memory): Decode Pi session branches`.

## Task 4: connect Pi recording and hook requests to memory

**Files:** Create `packages/memory/src/hosts/pi-root.ts`,
`packages/memory/src/recording/pi-source.ts`, `pi-source.test.ts`,
`packages/memory/src/hooks/pi.ts` and `pi.test.ts`. Modify
`packages/core/src/config.ts` and its tests; recording `sources.ts`,
`sweep.ts`, `state.ts`, `report.ts`, `watermark.ts` and their tests;
`packages/memory/src/host-hook.ts`; add `hosts/pi.json`. Update the
core, memory, recording, hooks and service guides where affected.

**Interfaces:** Export `PiHookRequest`, `PiHookReply` and:

```ts
type PiHookDeps = HostHookDeps & {
    env: Env;
    record: (request: RecordRequest) => Promise<RecordResponse | null>;
};
runPiHostHook(input: unknown, deps: PiHookDeps): Promise<PiHookReply>;
piSource(env: Env): Source;
piSessionRoot(env: Env): string;
```

`record` uses the existing client queue in the CLI helper; the service
sweep binds its existing `acceptRecord` route. No second writer.

- [ ] Test project changes, service outage/catch-up, parent-after-child
  listing, concurrent hook/sweep, lost hints, escaped parent paths,
  symlinks, private sessions and scoped reread/dismiss diagnostics.

  ```ts
  expect(await replay()).toMatchObject({ accepted: 0 });
  expect(recordCalls.every((r) => r.host === "pi")).toBe(true);
  expect(outsideRootReads).toBe(0);
  expect(secondProjectRequest.project).toBe(projectB);
  ```

- [ ] Run `bun test packages/memory/src/recording` and
  `bun test packages/memory/src/hooks`; observe Pi-specific failures.
- [ ] Add `pi` to recording configuration and profile defaults:
  `checked: ["1.5.0"]`, block/recall budgets `4000`, instructions
  `2048`, delivery `["plugin", "mcp"]`. Discover only the dedicated
  root. Reuse file fingerprints and open-without-following-symlinks;
  resolve ancestry in topological order with a cycle guard and 64 MiB
  per-file cap. Persist a versioned ancestry sidecar under
  `$XDG_STATE_HOME/dorothy/pi/recording`, keyed by canonical file path;
  it records segment anchors and original entry owners, never speech.
  Recompute from source if lost; refuse conflicting ownership on rewrite.
  Add `{ kind: "pi"; read: PiRead }` to `SourceRead`, retaining its
  fingerprint/stability fields. Use core's `RecordingHost` for `Host`.
  Extend the sweep's non-Claude path to record multiple segment views;
  save a file fingerprint only after every view and diagnostic settles.
  Retain backfill, privacy and one-hour ended-call semantics.
- [ ] Implement hook dispatch. Start/prompt resolve the active leaf's
  logical archive session, then reuse `runHostHook` and its project
  resolver. Settled/end decode and send records through the same source.
  Private or no-file sessions return recording `off`. Missing ancestry
  returns `pending` and a warning, with no guessed exclusion ID.
  Use existing block/recall/record client deadlines `1000/500/2000` ms.
  Run both test directories plus `bun test packages/core/src/config.test.ts`;
  require all existing host tests and Pi fixtures to pass.
- [ ] Commit: `feat(memory): Record Pi through the service`.

## Task 5: implement the native extension and wire compatibility

**Files:** Create `packages/cli/assets/pi/index.ts`, `provider.ts`,
`context.ts`, `helper.ts`, `capabilities.md` and `AGENTS.md`;
`packages/cli/src/hosts/pi/extension.test.ts`, `wire.test.ts` and
`testing.ts`. Declare direct runtime imports such as `typebox` in CLI's
manifest at the pinned Pi-compatible version; update its lock and guides.

**Interfaces:** The default export is Pi's `ExtensionAPI` factory.
`invokeHook(request: PiHookRequest, signal: AbortSignal)` in `helper.ts`
returns `Promise<PiHookReply>` by spawning the manifest's `self` with
`--pi-hook`. Its environment is the manifest's filtered helper env.
`testing.ts` exports `startFakeProvider(script)` returning `baseUrl`,
captured `requests` and async `close`; `script` is an array of SSE
chunks or `{status, body}` failures, consumed per request.

- [ ] Test lifecycle handlers with a fake Pi API and spawn adapter;
  test the actual published CLI against a loopback scripted provider.

  ```ts
  expect(secondRequest.messages).toContainEqual(expect.objectContaining({
      role: "tool", tool_call_id: "call-1",
  }));
  expect(replayedAssistant.reasoning_content).toBe("synthetic thought");
  expect(activeMemoryLayers).toHaveLength(1);
  expect(recordedHumanPrompts).toEqual(["the actual user prompt"]);
  ```

- [ ] Run `bun test packages/cli/src/hosts/pi/extension.test.ts` and
  `bun test packages/cli/src/hosts/pi/wire.test.ts`; require failures
  against the absent extension, with no external requests.
- [ ] Register the selected provider and its models during extension
  initialization. Use `api: "openai-completions"` and an explicit
  `$<configured-key-name>` reference. Set metadata from Task 2. For the
  initial DeepSeek entry, send `chat_template_kwargs.thinking: true`
  when thinking is enabled, false for `off`, following
  [Featherless's template contract][thinking]. Do not silently map
  `high` to a token budget the endpoint does not document. Verify
  `reasoning_content` after tool calls; add a narrow payload adapter
  only if a fixture demonstrates the need. Model changes outside the
  manifest are refused before inference and restore the prior model.
  Register `dorothy-memory` with direct exposure, filtered environment
  and the current cwd. Rebind on session replacement; check effective
  servers/tools and report explicitly admitted loadout deviations.
- [ ] Add start/prompt/compaction context handlers and bounded helper
  calls: 2500 ms for start/prompt, 5000 ms for recording, kill the helper
  on timeout, retain JSONL for later catch-up. Supersede the previous
  memory layer rather than appending it again. Do not turn injected
  messages into human prompts. At `agent_settled` request catch-up;
  use session shutdown for final notification. Capture missing finalized
  tool results in a `dorothy.tool-final` custom entry containing the
  originating call-entry ID and result; the reader emits it only when
  there is no ordinary result for that occurrence. Wait for a persisted
  call identity before writing; never invent one from text.
  Test blocked/invalid/aborted calls, reload, compaction, project switch,
  broken streams and 429s, then run the directory's full tests.
- [ ] Commit: `feat(cli): Deliver memory in Pi extension`.

## Task 6: compose the launcher and expose its CLI

**Files:** Create `packages/cli/src/hosts/pi/launch.ts`, `launch.test.ts`
and `env.ts`; modify `packages/cli/src/args.ts`, `args.test.ts`,
`index.ts`, `index.test.ts` and the CLI guides. Reuse
`models.ts`, `self.ts`, `userShell` and the checkout secret loader.

**Interfaces:**

```ts
type PiOptions = {
    args: string[]; model: string | null; dump: boolean;
};
runPi(options: PiOptions, deps: {
    env: Env; cwd: string; self: string[];
    loadRouting: () => Promise<Routing>;
    loadSecrets: (target: Env) => Promise<void>;
    spawn: (cmd: string[], env: Env, cwd?: string) => Spawned;
    write: (text: string) => void;
}): Promise<number>;
```

Production binds the existing loaders; tests inject every dependency.
`resolvePiRuntime` and `preparePiProfile` remain separately fixture-tested.

- [ ] Test `--pi`, `--pi --dump`, `--pi --model provider:id -- ...`,
  `--pi-hook`, no-secret help/dump, native `--resume` and `--fork`,
  argument-value ambiguity, hostile environment and spawn failure.

  ```ts
  expect(loadSecretCallsForDump).toBe(0);
  expect(childEnv.OTHER_PROVIDER_KEY).toBeUndefined();
  expect(helperEnv.SELECTED_PROVIDER_KEY).toBeUndefined();
  expect(childArgs).not.toContain(syntheticKey);
  expect(await exitedLaunch).toBe(17);
  ```

- [ ] Run `bun test packages/cli/src/args.test.ts` and
  `bun test packages/cli/src/hosts/pi/launch.test.ts`; observe failures.
- [ ] Parse Dorothy options only before the separator; native Pi
  arguments follow it. Validate the selected route before secret loading.
  Copy only the selected key from an isolated loader environment into
  Pi's environment. Construct an explicit environment allowlist for
  terminal, PATH, XDG, locale, proxies and required herdr context; omit
  unrelated keys, OAuth tokens, `NODE_OPTIONS`, `BUN_OPTIONS`, preload
  variables and any foreign `PI_*` settings. Helpers receive no model
  key. Redacted dumps show variable names only. Supply `--offline`, the
  fixed profile/session paths, additive identity, `--no-extensions`,
  explicit Dorothy and built-in MCP extensions, and `--no-skills` with
  the declared skill paths. Disable incidental prompt/theme discovery
  only where it would introduce undeclared executable resources.
  Parse native option arity so a prompt containing `--api-key` is not
  mistaken for an option; reject actual credential, profile, extension
  removal and session-root overrides, including `--flag=value` forms.
- [ ] Bind `--pi-hook` lazily to Task 4, using bounded stdin and JSON
  replies. Run via `runForwarding`, retaining cleanup in `finally`.
  Explicit `--session <path>` must resolve inside the dedicated root;
  no-session launches disable recording. Exercise native resume and
  profile preferences after a new launch, then run all CLI tests.
- [ ] Commit: `feat(cli): Launch Dorothy in Pi`.

## Task 7: verify delivery and publish its evidence

**Files:** Create `scripts/probe-pi-delivery.ts` and
`docs/reports/2026-11-03_pi-delivery.md`; extend `wire.test.ts` and
memory Pi fixtures; update `README.md`, package guides and the roadmap.

**Interface:**

```text
bun scripts/probe-pi-delivery.ts --offline --out <temporary-directory>
bun scripts/probe-pi-delivery.ts --live --out <temporary-directory>
  --max-usd <number> --max-turns 6 --timeout-ms 120000
```

`--live` alone never supplies a spending limit. No probe uses production
memory, host profiles or session directories. Output includes a machine
readable result and a sanitized Markdown report.

- [ ] Add end-to-end fixtures for an actual Pi conversation, tool call,
  compaction, resume and fork. Kill the launcher before catch-up, sweep
  twice, then assert exact archive event ownership and no duplicates.
  Test a native terminal launch under an isolated PTY, not print mode
  alone. Fixtures use a fake provider and synthetic memory service.
- [ ] Run the new offline probe and tests; confirm failures expose
  injected crashes or omitted extension wiring before fixing them.
- [ ] Implement the probe and complete only the integration fixes the
  fixtures identify. For live mode, refresh public model metadata and
  obtain the selected credential through the existing loader. Use a
  runner-owned loopback forwarding proxy, injected through the route
  dependency as in wire tests, to count every request, including
  compaction and retries. It forwards only Chat Completions for the
  selected model to the fixed Featherless endpoint. Pi receives a
  synthetic key; the proxy holds the real one. Reserve a conservative
  context-window plus maximum-output cost before forwarding each call;
  settle from measured usage, or retain the reservation and stop if
  usage is unavailable. Record the approved budget and enforce turn/time
  limits. This probe helper is not a general product gateway.
  No worker runs in this smoke test. Require existing authorization
  for the spend, or leave the live gate visibly pending.
- [ ] Run `bun run check`, the offline probe and, when authorized, the
  bounded live probe. Record commands, versions, actual output, cost
  source and pending gates. Passing offline tests alone means delivery
  is built with live compatibility pending, not fully verified.
- [ ] Commit: `test(cli): Verify Dorothy Pi delivery`. After CI and
  the required live gate pass, integrate under the repository's standing
  branch/PR rules; revise the roadmap before the stewardship increment.

## Self-review and handoff

Coverage: launch/profile and dependency boundary are Tasks 1, 2 and 6;
Featherless is Tasks 2 and 5; memory is Tasks 3 through 5; native UI,
recovery and live evidence are Task 7. Each Review Focus item has an
owning task and assertion. The graph mapping and helper types above
are shared contracts; later tasks must not rename them independently.

Execution uses the repository's required subagent-driven method. On
2026-11-03 the user approved the design, then said to let it run,
authorising execution without another plan approval round. A missing
live-run budget or login does not stop independent offline work.

[catalogue]: https://api.featherless.ai/v1/models
[model]:
  https://featherless.ai/models/deepseek-ai/DeepSeek-V4.1-Flash-1017
[thinking]: https://featherless.ai/docs/chat-template-kwargs
