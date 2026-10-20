---
ctime: 2026-10-15
mtime: 2026-10-20
spdx: GPL-3.0-only
title: Dorothy's identity probes
description: >-
  The probes Dorothy's identity rests on: where Claude Code puts text
  appended to its system prompt, and what becomes of the user's own.
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

# Dorothy's identity probes

## Summary

These are the probes of Dorothy's identity; how it was built, its
rulings, its review and its commits are in the
[implementation report](2026-10-15-identity-gateway-implementation.md).

- Claude Code puts the appended marker at the end of its last `system`
  block, after its identity line, under that block's one-hour cache
  breakpoint; never in the messages. The gateway's rules hold as the
  spec wrote them.
- `--append-system-prompt` is last-wins: given twice, Claude Code keeps
  only the last, in either the spaced or the `=` form. A user's own
  would drop the marker, so `dorothy --claude` merges the user's text
  and the marker into one flag.
- `--append-system-prompt-file` stacks with `--append-system-prompt`,
  the file's text first, so a user's file needs no merging.
- Through the built gateway, `dorothy --claude` sends Dorothy's identity
  as its own block after the identity line, the marker gone and every
  breakpoint in place, with the user's own appended text kept.
- End to end, she is Dorothy, answers plainly what runs her, keeps her
  prompt cache across turns, and leaves subagents to Claude Code.

## Method

Claude Code 2.1.296, `claude -p --no-session-persistence
--append-system-prompt '<!-- dorothy:identity -->' hi`, run from an
empty directory with `ENABLE_TOOL_SEARCH=1` against a loopback stand-in
that recorded bodies, never headers, and answered 400, so no run spent a
token. Each run sent two requests, the second a retry of the first;
only the first is summarised. Of each `system` block the summaries keep
its first 60 characters, its length, whether it held the marker (and
ended with it) or the user's text, and its `cache_control`.

## Where the marker lands

[`system-marker.json`](2026-10-15-identity-gateway/system-marker.json):
three blocks, the billing header (no breakpoint), the identity line
("You are Claude Code, Anthropic's official CLI for Claude, running
within the Claude Agent SDK.", 94 characters, a one-hour breakpoint) and
the rest of the prompt (5,679 characters, a one-hour breakpoint), which
ends with the marker after a blank line.
[`messages-marker.json`](2026-10-15-identity-gateway/messages-marker.json):
neither message carries it.

So the gateway finds the marker in the last block, trims it away, and
puts the identity after the identity line, leaving both breakpoints
where they were.

## The user's own appended text

With `<u>` the user's text, the arguments after `-p` and what reached
the last block:

- `--append-system-prompt <marker> --append-system-prompt <u>`: the
  user's text alone
  ([`system-marker-user.json`](2026-10-15-identity-gateway/system-marker-user.json)).
- `--append-system-prompt <marker> --append-system-prompt=<u>`: the
  user's text alone
  ([`system-marker-user-equals.json`](2026-10-15-identity-gateway/system-marker-user-equals.json)).
- `--append-system-prompt <u> --append-system-prompt <marker>`: the
  marker alone
  ([`system-user-marker.json`](2026-10-15-identity-gateway/system-user-marker.json)).
- `--append-system-prompt <marker> --append-system-prompt-file <file>`:
  both
  ([`system-marker-user-file.json`](2026-10-15-identity-gateway/system-marker-user-file.json)).

The flag keeps its last value whichever comes first, so neither order
keeps both. The file's text comes before the flag's, both in the last
block, separated by a blank line.

## Through the gateway

Once built, `dorothy --claude -p --no-session-persistence hi` ran from
the same empty directory with `ANTHROPIC_BASE_URL` at the stand-in,
which the gateway took as its upstream: the real chain, from Claude Code
through the gateway, spending no token.

[`gateway.json`](2026-10-15-identity-gateway/gateway.json): four
blocks, the billing header, the identity line (one-hour breakpoint),
Dorothy's identity (368 characters, no breakpoint) and the rest of the
prompt (one-hour breakpoint), which still opens with its newline and no
longer carries the marker.
[`gateway-user.json`](2026-10-15-identity-gateway/gateway-user.json),
with `--append-system-prompt 'probe-user-text'`: the same four, the last
ending with the user's text. Neither run printed a drift warning.

## End to end

Against the API on the user's login, from an empty directory, with this
session's `CLAUDE_CODE_` variables unset (see the implementation
report's Verification for why), Claude Code 2.1.296 on Claude Opus 5.5,
in the plan mode the user's settings start it in:

1. `dorothy --claude -p --output-format json "Who are you?"`: "I'm
   Dorothy, your assistant here in the terminal. I can explore and
   explain code, plan and make changes, run commands and tests, and help
   with debugging, reviews and other development work." 7,169 tokens
   written to the cache, 7,962 read: the tools and Claude Code's
   opening blocks, which come before her identity and were cached by an
   earlier run.
2. The same session resumed with `--resume <id>`, "And what runs you?":
   "I run on Anthropic's Claude Opus 5.5 model (`claude-opus-5-5`),
   hosted here through Claude Code via the Claude Agent SDK. Dorothy is
   the name and personality I use in this setup." 15,131 tokens read
   from the cache, 298 written.
3. Resumed again, asked to have a general-purpose subagent say who it
   is, the main thread quoted it: "I'm Claude, an AI assistant made by
   Anthropic. Here I'm running as an agent inside Claude Code, ...". It
   added that the persona is set up for the main session only.

No run printed a drift warning.

## Limits

Closed by the roadmap sweep: see
[the sweep report](./2026-10-19-roadmap-sweep.md#probes).

- Forks were not probed: a fork needs a model reply, which the stand-in
  never gives.
- Interactive sessions were not probed; `-p` names the Agent SDK in its
  identity line, which the gateway does not read.
