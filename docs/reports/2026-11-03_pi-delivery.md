---
ctime: 2026-11-04
mtime: 2026-11-04
spdx: GPL-3.0-only
title: Dorothy in Pi, delivery
description: >-
  Verification of `dorothy --pi`: the native interface in a
  pseudo-terminal with her real hook, MCP bridge and memory service,
  recovery after a killed launcher, the offline probe and one bounded
  live Featherless run, with the open questions each answered.
tags:
  - dorothy
  - pi
  - report
---

<!--
   -
   - ~chewygumxx/dorothy.git
   - ::: :/docs/reports/2026-11-03_pi-delivery.md
   -
   -->

# Dorothy in Pi, delivery

## Summary

[The spec](../specs/2026-11-03_pi-delivery.md) and
[the plan](../plans/2026-11-03_pi-delivery.md), increment A. Tasks 1 to
6 built `dorothy --pi`; this report is Task 7's verification. Delivery
is built and verified: offline fixtures pass, and one bounded live run
against Featherless passed every wire check, for about US$0.0014.

- The published Pi 1.5.0 ran in its own terminal interface, in a
  pseudo-terminal, through the launcher, with her real `--pi-hook`,
  `--mcp --host pi` and memory service on private roots: tool calls,
  one interrupted, `/reload`, `--resume`, `/compact`, `/fork`, then
  the launcher killed mid-turn and two sweeps. Each event was recorded
  once, in the segment that owns it.
- No integration fix was needed: the fixtures failed when the wiring
  was removed or a crash injected, and passed on the code as built.
- Featherless took system messages, no `store`, `max_completion_tokens`
  and `chat_template_kwargs.thinking`, and Pi replayed the streamed
  reasoning after a tool call. Its catalogue matches the manifest.

Captured output is in the directory beside this report:
[`offline.json`](./2026-11-03_pi-delivery/offline.json) and
[`live.json`](./2026-11-03_pi-delivery/live.json), the probe's
machine-readable results.

## Versions

| Component | Version |
| --- | --- |
| `@earendil-works/pi-coding-agent` | 1.5.0, the CLI's pinned dependency |
| Node | v24.22.1 (Pi needs >=22.19.0) |
| Bun | 1.4.2 |
| Model | `deepseek-ai/DeepSeek-V4.1-Flash-1017` on Featherless |
| Branch base | `16fdfe3` on `feat/pi-integration` |

## What was added

- `packages/cli/src/hosts/pi/native-launch.ts`: `runPi` as a process,
  for a pseudo-terminal. A plan file gives the roots' environment, the
  cwd, `self` and the base URL; the routing and a synthetic key are
  injected, so `secrets.json` is never read. `index.ts --pi` is never
  driven by a test, as it would decrypt the checkout's secrets.
- `packages/cli/src/hosts/pi/delivery-testing.ts`: her real memory
  service on the roots, started from `@dorothy/memory/service` with
  reviews off (never `--serve`, which loads secrets);
  `launchNative`, Bun's `terminal` spawn with typing, waiting for text
  and killing the launcher's process group; `sweepOnce`, this
  checkout's `--sweep`; and `archive`, the transcripts it leaves.
- `testing.ts`: `startFakeProvider` also takes a function choosing each
  reply from the request, which may hold a reply back.
- `wire.test.ts`: "Pi in its own terminal" (below), and "sends nothing
  for a run aborted before it starts".
- Memory: `COMPACTED_LINES` and `compactedForkLines` in
  `pi-fixtures.ts`, the shapes Pi 1.5.0 wrote in the native run, and a
  sweep test of them.
- `scripts/probe-pi-delivery.ts`, with `probe-pi-delivery.test.ts` for
  its argument and proxy rules. It is a script, not a test file, so
  `bun run test` and `bun run check` never run it.

## The native fixture

`wire.test.ts`, "records a native session once each, through a killed
launcher", against a scripted provider:

1. A new session. "look up moss" calls `mcp__dorothy_memory__search`
   through the real bridge; `/reload` rebuilds her extension; "after
   reload" is answered; "run slow" calls `bash` with `sleep 30`, which
   escape interrupts. `/quit`. The real hook has by then recorded the
   session through the service.
2. A preference of the user's, `compaction.keepRecentTokens: 1`, is
   written to her profile's `settings.json`.
3. `--resume`, the session chosen in Pi's picker. "second prompt",
   `/compact` (two summary requests: a split turn), "third prompt",
   `/fork` from the latest message, past the compaction, " (forked)"
   typed onto it, then "run quick", whose `bash` result is saved
   before its next request is held unanswered and the launcher's
   process group is killed.

Then, with the service stopped:

- Every turn's request carried a system message holding
  `<dorothy-identity>` and `<dorothy-capabilities>`, exactly the eight
  declared tools (`bash`, `edit`, `read`, `write` and her four memory
  tools), one `<memory>` layer from the service and the synthetic key,
  after the reload too.
- Before the sweep, "run quick" is in no archive conversation.
- `dorothy --sweep` adds what the hooks had not, and says so. With
  `sweep.json` and Pi's sidecars deleted, a second sweep reads both
  files again, records `pi: 0 events in 0 sessions` and leaves the
  archive identical, its sidecars rebuilt.
- Two conversations. The original holds "look up moss", "after
  reload", "run slow", "second prompt" and "third prompt", with the
  search (`ok`, `[]`) and the interrupted `bash` (failed, "Command
  aborted") once each. The fork holds "third prompt (forked)" and "run
  quick", with `bash` (`QUICK`), and names the original as its parent:
  nothing of the copied path was recorded again.
- No `sourceUuid` repeats; no summary, system prompt or memory layer
  was taken for speech; no `dorothy.tool-final` was written; no file
  under the roots holds the key.

The run takes about 5 s. In its final form it passed 14 runs in a row,
`bun run check` among them. An earlier form, which waited for the
fork's settled record before the kill, failed once for a reason not
captured, then passed 21 in a row (see Limits).

### Failures it exposes

Each injection was made by hand, run, and reverted:

```text
$ # deliverMemory(...) not called in assets/pi/index.ts
$ bun test packages/cli/src/hosts/pi/wire.test.ts -t "own terminal"
error: the hook never recorded
(fail) Pi in its own terminal > records a native session once each,
       through a killed launcher [12559.48ms]
 1 fail

$ # the "pi-hook" runner in packages/cli/src/index.ts throws first
error: the hook never recorded
(fail) Pi in its own terminal > ... [12830.82ms]
 1 fail

$ # launch.ts writes extensions: [] into the manifest
error: fixture: Pi exited (1) before "v1.5.0":
Error: Model "fixture-featherless/deepseek-ai/DeepSeek-V4.1-Flash-1017"
not found. Use --list-models to see available models.
(fail) Pi in its own terminal > ... [687.24ms]
 1 fail
```

The kill itself is the injected crash the sweep recovers from. With the
hook crashing, the conversation still ran to its fork: delivery fails
open. The abort test was checked the same way: with the extension's
`ctx.abort()` replaced by nothing, the provider received one request
and the test failed.

## Commands and output

```text
$ bun run check
 4192 pass
 5 skip
 0 fail
Ran 4197 tests across 204 files. [65.20s]
```

```text
$ bun scripts/probe-pi-delivery.ts --offline --out <tmp>
probe offline: pass, 3 request(s), US$0.000020; <tmp>
```

```text
$ bun scripts/probe-pi-delivery.ts --live --out <tmp> --max-usd 5 \
    --max-turns 6 --timeout-ms 120000
probe live: pass, 3 request(s), US$0.001400; <tmp>
```

The live run started at 2026-11-04T00:19:26Z and took 8 s. It ran once.

## The probe

Pi's native interface in a pseudo-terminal on private roots, with her
real hook, bridge and service, and two human turns: thinking high, a
request to call `bash` once with `echo dorothy-probe` and reply DONE;
then `/thinking off` and "Reply with the single word OK." Then `/quit`
and a sweep.

Its model requests go through a forwarding proxy on loopback, owned by
the probe and given to Pi as the route entry's base URL:

- It forwards only `POST /v1/chat/completions` for the one model, to
  the fixed endpoint (Featherless live, a scripted one offline), and
  counts every request, compaction's and retries alike. Others get 404
  or 400, recorded, never forwarded.
- Pi sends a synthetic key; the proxy holds the upstream one. Live, the
  key comes from `secrets.json` through the checkout's loader
  (`loadCheckoutSecrets`, core's `loadSecrets`), into an object of the
  probe's own: never `process.env`, argv, a file or a log.
- Before forwarding a call it reserves its worst cost, a full context
  window in and its `max_completion_tokens` out at the manifest's
  prices: US$0.0884736 each. Streamed usage settles it; a reply without
  usage keeps its reservation and stops the proxy. Calls past
  `--max-turns`, the budget or `--max-turns` times `--timeout-ms` are
  refused; each upstream call is bounded by `--timeout-ms`.
- `--live` without `--max-usd` is refused. The result holds shapes,
  counts, digests of reasoning and costs, never a key or prompt text.

### The live run

| Check | Result |
| --- | --- |
| system-role | pass: every request opens with system, none developer |
| no-store | pass: no request has `store` |
| max-completion-tokens | pass: 32768 on every request, no `max_tokens` |
| thinking | pass: `true`, `true`, then `false` after `/thinking off` |
| tool-call | pass: one call; the next request answered its id |
| reasoning-replay | pass: digest `45e99bd66ccd6908` replayed |
| synthetic-key | pass: Pi sent only the synthetic key |
| loadout | pass: the eight declared tools |
| recorded | pass: 1 conversation, 5 events; the sweep added 0 |
| within-limits | pass: 3 requests, US$0.001400 |
| no-key-at-rest | pass: no file under the roots holds a key |

| # | Status | Roles | Thinking | Reply | Usage in/out | US$ |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | 200 | system user user | true | tool call, reasoning | 2784/83 | 0.000701 |
| 2 | 200 | system user user assistant tool | true | stop | 2883/4 (2839 cached) | 0.000031 |
| 3 | 200 | system user assistant tool assistant user user | false | stop | 2963/2 | 0.000668 |

Each request's body held `chat_template_kwargs`,
`max_completion_tokens`, `messages`, `model`, `stream`, `stream_options`
and `tools`, and nothing else. The second user message of each request
is her memory layer. The screen's end, as the probe saved it:

```text
This is an automated connectivity probe. Call the bash tool exactly
once, with the command: echo dorothy-probe. After it returns, reply
with the single word DONE.
The user wants me to call bash exactly once with echo dorothy-probe,
then reply with a single word DONE.
This is an automated connectivity probe. Simple and harmless. Let me
do it.
$ echo dorothy-probe
dorothy-probe
Took 0.0s
DONE
Thinking level: off
Reply with the single word OK.
OK
~/project-a
↑5.8k ↓89 R2.8k CH0.0% $0.001 1.1%/262k (auto)
deepseek-ai/DeepSeek-V4.1-Flash-1017 • thinking off
```

### Cost

US$0.001400 for three requests, against the US$5 limit. The source is
the probe's own ledger: each reply's streamed usage times the
manifest's prices per million tokens (input 0.225, output 0.9, cached
input 0.006). Featherless's own billing was not queried, and its plan
may bill differently; Pi's footer showed about US$0.001 from its own
reckoning.

### Model metadata

Refreshed during the live run from
`https://api.featherless.ai/v1/models`, unauthenticated, at
2026-11-04T00:19:28Z: the model is listed, context 262144, maximum
completion 32768, prices 0.225 and 0.9. No drift from
`packages/cli/assets/pi/models.json`; the catalogue gives no cached
price, so the manifest's 0.006 (from the model's page) was not
rechecked. Nothing was changed.

## Open questions, answered

- **Featherless with `supportsDeveloperRole: false`, no `store`,
  `max_completion_tokens` and `chat_template_kwargs.thinking`.**
  Verified live: all three requests were accepted with status 200, and
  thinking on gave streamed reasoning while thinking off gave none.
- **`reasoning_content` replay after tool calls.** Verified live: the
  tool-calling reply's reasoning came back on the next two requests,
  unchanged by digest. The live result does not name the field it
  streamed in; the probe now records it (`reasoningField`), and the
  offline run shows `reasoning_content`. Pi replays it in whichever
  field it arrived in (pi-ai 1.5.0 `openai-completions.js`).
- **Does `ctx.abort()` in `before_agent_start` stop inference?** Yes.
  With the published Pi and an extension aborting there, no request
  reached the endpoint, the prompt was saved with no reply, and Pi
  exited 0. Pi's `agent-session.js` aborts a run at `agent_start` when
  an abort was asked while it started.
- **Does Pi 1.5.0 end a call without saving its result?** Not seen. An
  interrupted `bash` got a saved `toolResult` ("Command aborted",
  `isError`), then an empty reply with stop reason `error`; no
  `dorothy.tool-final` was written, and memory recorded the call once,
  failed. In pi-agent-core's `agent-loop.js` every call that reaches
  `tool_execution_end` gets its result message, and calls an abort
  skips get neither. The window left is a parallel batch, whose results
  are saved only once all finish: a crash inside it loses the extension
  too. `dorothy.tool-final` stays a fallback no real run has needed.
- **The real `--pi-hook` runner end to end.** Exercised by the native
  fixture and both probe runs: `[bun, --no-env-file, index.ts,
  --pi-hook]` and `--mcp --host pi` against her service on private
  roots, opening blocks, recall and records all arriving.
- **The native interface under an isolated pseudo-terminal, with
  `--resume`.** Exercised by the native fixture (picker included) and
  by both probe runs, never print mode alone.

## Findings

- A killed launcher leaves its launch directory,
  `$XDG_RUNTIME_DIR/dorothy/pi-<id>`, holding the manifest and persona
  but no key. Nothing removes stale ones, unlike Claude Code's
  launches; the runtime directory is cleared at logout.
- An argument to a slash command (`/thinking off`) needs a second Enter
  in Pi's editor: the first takes its completion.
- With the memory service down, the hook starts `dorothy --serve`, as
  every host's hook does. The fixtures keep the service up, so no test
  starts one that would read the checkout's `secrets.json`.
- Pi 1.5.0 saves its system prompt as a `system` message entry with its
  sections, and a fork copies the path verbatim, compaction and ids
  alike. Memory's reader takes neither for speech.

## Pending gates and limits

- None for delivery's live gate, which passed. CI on the branch and its
  merge remain, under the repository's standing rules.
- Live coverage is two turns: compaction, resume, fork, reload and
  recovery were verified against the scripted provider alone. Their
  requests use the same wire.
- `dorothy.tool-final` has no real-Pi case; it is unit-tested only.
- The native fixture depends on Pi's screen text (`v1.5.0`, "Resume
  Session", "Fork from Message", "Compacted from"), which a Pi upgrade
  may change; the pin keeps it.
- One unexplained failure of the native fixture in about 25 runs, when
  it still waited for the fork's settled record, whose hook has a 5 s
  budget. It now checks what the sweep adds instead; 14 runs since
  passed.
- Stewardship, increment B, has not started.
