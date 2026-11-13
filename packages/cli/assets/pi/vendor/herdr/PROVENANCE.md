---
ctime: 2026-11-04
mtime: 2026-11-11
spdx: GPL-3.0-only
title: herdr's Pi state extension
description: >-
  Where the vendored herdr-agent-state.ts comes from, at which pin, with
  its digest and licence, and how Dorothy loads it.
tags:
  - pi
  - agents
---

<!--
   -
   - ~xxdorothy/dorothy.git
   - ::: :/packages/cli/assets/pi/vendor/herdr/PROVENANCE.md
   -
   -->

# herdr's Pi state extension

`herdr-agent-state.ts` here is herdr's own Pi integration, copied byte
for byte and never edited. `LICENSE` is herdr's, Apache License 2.0,
which covers that file alone; the rest of the repository is GPL-3.0-only.

- Source: <https://github.com/herdrdev/herdr>
- Pin: `2ecf19a92fc3a7fff75b6ce3655ef04f4625ec01`, the herdr commit this
  copy was taken from
- Path: `src/integration/assets/pi/herdr-agent-state.ts`
  (`HERDR_INTEGRATION_VERSION=9`), the file
  `herdr integration install pi` writes
- sha256: `2c5272d732b475bbf91a027203b1f98d25fe43d2c1402530a442b288aeaca1e4`
- `LICENSE`, from the repository root at the same pin, sha256:
  `c71d239df91726fc519c6eb72d318ec65820627232b2f796219e87dcf35d0ab4`

The installed herdr 0.9.5 embeds the same bytes, checked on 2026-11-04.

`dorothy --pi --steward` loads it once, by path, in her managed loadout:
Pi gets `--no-extensions`, so a copy herdr installed under a Pi agent
directory is never discovered beside it. Plain `dorothy --pi` leaves it
out. Outside a herdr pane (`HERDR_ENV`, `HERDR_SOCKET_PATH` and
`HERDR_PANE_ID` unset) it does nothing.

It reports the pane's state to herdr's socket: `working` from
`agent_start`, `idle` from `agent_settled` (never `agent_end`), and
`blocked` while a `herdr:blocked` event is active on Pi's event bus. Pi
1.5.0 emits none of those itself, so Dorothy's stewardship extension
turns Pi's `ui_prompt_start` and `ui_prompt_end` into them.

To update it, fetch the file and licence at the new pin into an empty
directory, compare them, replace both here with the new digests, and
move the `package.json` pin with them; `extension.test.ts` checks the
digest and the pin agree.
