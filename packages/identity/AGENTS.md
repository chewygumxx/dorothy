---
ctime: 2026-10-15
mtime: 2026-11-14
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
   - ~xxdorothy/dorothy.git
   - ::: :/packages/identity/AGENTS.md
   -
   -->

# packages/identity/AGENTS.md

`@dorothy/identity` holds Dorothy's core and the layers she opens when
needed, in text that names no host, protocol or provider in the core.
Her chat persona (`agent`) and the gateway behind `dorothy --claude`
(`gateway`) both take the core, so she is the same Dorothy in either.

## Entry points and imports

One entry point, `"."` (`src/index.ts`): `identityPrompt`, `personaLayers`,
`personaVersion`, `versionOf`, `LAYER_NAMES`, `LayerName` and
`PersonaLayers`. It depends on nothing, not even `core`.

Bun's text imports (`with { type: "text" }`) are the package's one read,
done at module load. Calls strip those imported strings; they never read
files at runtime. `src/md.d.ts` declares Markdown's default export as text.

## Files

- `soul.md`: the always-loaded core. Its `## Layers` section names each
  layer in a list item beginning with a backticked name and a colon,
  followed by when to open it. Rules after the list are prose.
- `layers/lore.md`, `layers/voice.md`, `layers/judgement.md`: the three
  layers, in `LAYER_NAMES` order.
- `.markdownlint-cli2.jsonc`: allows the core to open with "You are Dorothy"
  instead of a heading (MD041).
- `src/identity.ts`: the stripped core and its version with every layer.
- `src/layers.ts`: layer names, types and stripped text keyed by name.
- `src/strip.ts`: removes frontmatter, the house breadcrumb and a final
  modeline; keeps the body and rejects an empty one.
- `src/index.ts`: the package's public exports.
- `src/md.d.ts`: Markdown text module declaration.
- `src/identity.test.ts`, `src/layers.test.ts`, `src/strip.test.ts`: the
  core pin, layer agreement and versioning, and header stripping.

## Invariants

- The same text on every call: a request carrying it keeps its prompt
  cache, so nothing in it may vary by time, host or environment.
- What a host lets her do and how it runs her (capabilities, plumbing)
  belong to the host, not here.
- The core's layer list, the directory's basenames, `LAYER_NAMES` and
  `personaLayers()` agree. Only list items beginning with a backticked
  name declare a layer.
- `personaVersion()` hashes the stripped core and each stripped layer in
  `LAYER_NAMES` order, joined with `"\n\0"`, as `xxh3:` plus 16 hex digits.
  Header-only edits leave it unchanged.

## Tests

`identity.test.ts` pins `personaVersion()`: change it only when Dorothy is
meant to change. `agent`'s `persona.test.ts` composes the core with its own
sections and pins the result, with two newlines between components.

## See also

- [Dorothy's identity spec](../../docs/specs/2026-10-15-identity-gateway-design.md)
