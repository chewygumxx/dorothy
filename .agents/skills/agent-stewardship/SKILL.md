---
name: agent-stewardship
description: >-
  Use when messaging another agent in herdr, scheduling a wake-up for
  yourself, or compacting your own conversation, so work survives a plan's
  usage limit.
ctime: 2026-10-31
mtime: 2026-10-31
spdx: GPL-3.0-only
tags:
  - agents
---

<!--
   -
   - ~chewygumxx/dorothy.git
   - ::: :/.agents/skills/agent-stewardship/SKILL.md
   -
   -->

# Agent stewardship

Scripts in [`scripts/`](./scripts) keep agents in herdr working across a
plan's usage limit. This page is a stub; the full guide follows.

- [`send-prompt.sh`](./scripts/send-prompt.sh) sends a message to an
  agent now, or at a dated time, or after a span, from a timer.
- [`compact-self.sh`](./scripts/compact-self.sh) compacts the calling
  agent's own conversation once its turn ends.
- [`pane-lock.sh`](./scripts/pane-lock.sh) is their shared lock on a
  pane, sourced by both.
