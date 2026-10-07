---
ctime: 2026-10-07
mtime: 2026-10-07
spdx: GPL-3.0-only
title: Compaction probes
description: "Live checks that the CLI's own compaction stays off and that Dorothy's compacts, seeds and recollects"
tags:
  - dorothy
  - sdk
  - report
---

<!--
   -
   - ~chewygumxx/dorothy.git
   - ::: :/docs/reports/2026-10-07-compaction.md
   -
   -->

# Compaction probes

## Summary

Two live probes, both against temporary XDG directories, with the real
credentials loaded through dotenvx:

- The CLI honours `DISABLE_COMPACT`. Without it, a shrunken compaction
  window makes the CLI compact on every turn from the third; with it, the
  CLI never starts a compaction.
- A live chat with tiny thresholds compacted after every idle, recollected
  the first cluster word for word when asked, and resumed from the
  abstracts plus the latest exchange.

Nothing failed. The surprises are under [Notes](#notes).

- Spec: [`docs/specs/2026-10-07-compaction-design.md`](../specs/2026-10-07-compaction-design.md)
- Plan: [`docs/plans/2026-10-07-compaction.md`](../plans/2026-10-07-compaction.md)

## The CLI's switch

`@anthropic-ai/claude-agent-sdk` 0.3.287, which bundles the `claude` CLI
2.1.287 (`claudeCodeVersion` in its `package.json`).

The probe calls `query()` with `baseOptions` and `cliOptions()`, a system
prompt of `"x ".repeat(3000)` (about 3,000 tokens) and these variables on
top of `cliOptions()`'s environment:

```sh
CLAUDE_CODE_AUTO_COMPACT_WINDOW=2000
CLAUDE_AUTOCOMPACT_PCT_OVERRIDE=1
```

It runs once with `DISABLE_COMPACT` deleted and once with it set to `1`,
recording the subtype of every `system` message.

The script as planned sent its three prompts all at once. The CLI folded
the second and third into one turn, so each run had two turns. Without
the switch, the second turn did start a compaction, but it failed:

```text
status "compacting"
status null, compact_result "failed", compact_error "too_few_groups"
```

No `compact_boundary` appeared in either run, and the cause was the turn
count, not the window. A larger prompt would not have helped. So the probe
was paced instead: five prompts, each sent after the previous `result`.

| Turn | Without `DISABLE_COMPACT`                                  | With `DISABLE_COMPACT=1` |
| ---- | ---------------------------------------------------------- | ------------------------ |
| 1    | `init`, `status` requesting                                | the same                 |
| 2    | `init`, `status` requesting, compacting, failed (too few groups) | `init`, `status` requesting |
| 3    | `init`, `status` requesting, compacting, success, `compact_boundary` | `init`, `status` requesting |
| 4    | the same as turn 3                                         | `init`, `status` requesting |
| 5    | the same as turn 3                                         | `init`, `status` requesting |

With the switch set, the CLI never reported `compacting`, and the context
grew steadily, from 3,252 to 3,462 tokens. Without it, the context jumped
to about 4,000 tokens after the first compaction (the CLI's summary) and
stayed there.

## A compacting chat

`config.toml`:

```toml
[memory]
idle-seconds = 10

[compaction]
soft = 2000
hard = 4000
tail = 500
```

Dorothy ran in tmux (`bun run dev`, model `claude-sonnet-5-5`) with
`XDG_CONFIG_HOME`, `XDG_DATA_HOME` and `XDG_CACHE_HOME` all under one
temporary directory. Five messages: four that each asked for several
paragraphs on a new topic (lighthouses, sourdough, glaciers, the waggle
dance), then "What did we say about lighthouse keepers earlier, word for
word?".

What appeared:

- After the first reply, the warning line showed `! compaction: nothing to
  compact; the latest exchange alone fills the tail`. With one exchange
  that is right, and it does not count as a failure.
- After each later reply and its 10-second idle, a dim
  `compacted turns 1-2 into 1 cluster` line appeared, then `turns 3-4`,
  `turns 5-6` and `turns 7-8`. Each compaction took one exchange, since
  every reply alone was larger than the tail. The status line showed a new
  SDK session after each one.
- The keepers question produced `⌕ recollected cluster 1, turns 1-2`, and
  Dorothy quoted the first reply's paragraph on keepers exactly.
- The sidecar held four `clusters` (1-2, 3-4, 5-6, 7-8), each with
  `from`, `through`, `at`, `model` and an abstract of 781 to 993 code
  points.
- The transcript had a `compaction` event (`through` 2, 4, 6, 8, one
  cluster each) after each compacted exchange. Each came before the next
  `session` event, which said `resumed: true`. The recollection was a
  `recall` event with `tool: "recollect"`, `cluster: 1`, `turns: [1, 2]`,
  `ok: true`.

The live chat cost $0.11, plus $0.12 for reviews and compactions.

### The resumed seed

`bun run dev -- --dump-context --resume <phrase>`, with the same
directories, showed a system prompt holding the persona, then the
preamble with recollect and an `<earlier>` block with all four clusters
(`n="1" turns="1-2"` through `n="4" turns="7-8"`), then "The conversation
so far" with only turns 9 and 10, the keepers question and its answer.
That is the latest exchange, which a compaction always keeps. The request
offered `mcp__memory__search`, `mcp__memory__open` and
`mcp__memory__recollect`. There were no notes on other chats, since the
probe had only this one.

## Notes

- dotenvx keeps its device key under `$XDG_CONFIG_HOME/dotenvx`. With a
  temporary `XDG_CONFIG_HOME` the credentials cannot be decrypted and
  Dorothy starts without them. The live probe set
  `DOTENVX_CONFIG=~/.config/dotenvx`, which points dotenvx at its own key
  and nothing else. The switch probe changes only `XDG_CACHE_HOME`, so it
  did not need this.
- mise keeps its installs under `$XDG_DATA_HOME`, so each launch with a
  temporary data directory downloads bun again (about 37 MB) before
  Dorothy starts.
- The `! compaction: nothing to compact` warning from the first idle stayed
  on the warning line through all four later compactions.
- The live chat never made a compaction split into more than one cluster.
  At these thresholds each one covered a single exchange, so the split by
  topic was not exercised live. The unit tests cover it.
- A failed compaction in the CLI reports only a `status` message with
  `compact_result: "failed"`, not a `compact_boundary`. Dorothy watches
  for `compact_boundary` alone. With `DISABLE_COMPACT` set the CLI never
  started one, so this does not matter now.
- The probes ran with `FORCE_COLOR` unset. Otherwise Bun colours the
  logged arrays, which makes the output hard to read.
