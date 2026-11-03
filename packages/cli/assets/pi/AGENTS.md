---
ctime: 2026-11-04
mtime: 2026-11-04
spdx: GPL-3.0-only
title: packages/cli/assets/pi/AGENTS.md
description: >-
  Dorothy's Pi extension: the launch's Featherless provider, her memory
  layer and recording notices through `dorothy --pi-hook`, and her memory
  server, run by the published Pi under Node.
tags:
  - agents
---

<!--
   -
   - ~chewygumxx/dorothy.git
   - ::: :/packages/cli/assets/pi/AGENTS.md
   -
   -->

# packages/cli/assets/pi/AGENTS.md

The extension `dorothy --pi` passes Pi 1.5.0 by path (`-e`). Pi loads it
with jiti under Node, so it imports Node's built-ins, its siblings and
Pi's types alone: never Bun, never a Dorothy package. Contracts it shares
with Bun code are re-declared, and `extension.test.ts` checks they agree.

## Files

- `index.ts`: the factory. It reads the manifest `DOROTHY_PI_MANIFEST`
  names (`readManifest`, refused as `dorothy_pi_manifest: <path>`), takes
  the provider's key out of Pi's environment (`takeKey`, refused as
  `dorothy_pi_key: <name>`; kept per manifest for a replaced runtime's
  next load), then wires the rest. At each session start it registers
  the MCP server `dorothy-memory` (`memoryServer`): the manifest's `self` with
  `--mcp --host pi`, direct exposure, the live cwd, and the manifest's
  helper environment with every other variable of Pi's blanked, since Pi
  starts a server with its own environment beneath the configured one;
  values are escaped from Pi's `$` and `!` interpolation, and the key's
  name is blanked whatever the helper environment holds. A project
  `.pi/mcp.json` naming her server has its trust declined
  (`project_trust`); a trusted or profile one keeps hers unregistered and
  its tools blocked (`pi_mcp_collision`). Other servers, tools from other
  extensions, and an active `codemode` or `tool_search` are shown once as
  outside her tested loadout. `capabilities.md` (after its header) is the
  `dorothy-capabilities` section of Pi's system prompt.
- `provider.ts`: the manifest's provider with `api:
  "openai-completions"`, the key as an escaped literal, which Pi keeps
  in memory alone, and each model's checked limits and prices (unknown
  cached input priced as input).
  `FEATHERLESS_COMPAT` sends thinking as `chat_template_kwargs.thinking`,
  true for any level but `off`, with system messages and no `store`;
  minimal, low and medium are unsupported, so Pi clamps them to high. A
  model outside the manifest is refused on selection or restore, the
  prior or selected model put back, and a run on one is aborted.
- `context.ts`: `deliverMemory`. A start (reason `startup`, `resume`,
  `clear`; `compact` after compaction, `resume` after a tree move) asks
  for the block, a human prompt for recall; the two make one
  `dorothy.memory` message before the latest human prompt on each
  request (`layered`), never saved, any older copy dropped. After each
  settled run it asks memory to record (`settled`); at shutdown, once
  pending records finish, `end`. A call Pi finalized without saving its
  result gets a `dorothy.tool-final` entry (`{ entryId, toolCallId,
  content, isError }`) once its assistant entry is saved; memory's reader
  uses it only where no ordinary result exists.
- `helper.ts`: `hookInvoker(manifest, launchDir)` gives `invokeHook`,
  which runs `self --pi-hook` in the launch directory with the helper
  environment alone, the request on stdin (128 KiB at most) and the reply
  on stdout (64 KiB at most). The signal is the deadline: 2500 ms for
  start and prompt, 5000 ms for records, the helper SIGKILLed past it.
- `capabilities.md`: what the model is told of her memory tools and
  layer; her identity is the launcher's persona, apart from it.
- `models.json`: the checked model manifest
  ([hosts guide](../../src/hosts/AGENTS.md)).

## Invariants

- Every helper request carries the live cwd and session, so a session
  resumed in another project asks there; Pi builds a new instance per
  runtime, so nothing of a former session's layer or server survives.
- A helper fault never blocks or fails a prompt: no layer, a warning
  shown once by stable code (`pi_hook_timeout`, `pi_hook_failed`,
  `pi_reply_invalid`, `pi_reply_too_large`, `pi_request_too_large`, or
  memory's own), and the saved JSONL left for the sweep.
- The key is in Pi's environment only until the extension loads, which
  is before any session spawns a child (Pi connects MCP servers from
  `session_start`, and bash reads the environment as it runs). After
  that only Pi's provider holds it, in memory, sending it to the
  endpoint alone: bash, the helper, her server and any other MCP server
  never inherit it, and no file, argv or log carries it. Code running in
  Pi's process (another extension, say) can still reach it, as the spec
  allows for ordinary local execution.

## Tests

`src/hosts/pi/extension.test.ts` drives the factory through a fake
ExtensionAPI and a stand-in `dorothy` (`testing.ts`);
`src/hosts/pi/wire.test.ts` runs the published CLI against a scripted
loopback endpoint (`startFakeProvider`). Both inject every root.
