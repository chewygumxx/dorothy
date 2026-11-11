---
ctime: 2026-11-11
mtime: 2026-11-11
spdx: GPL-3.0-only
title: Data by function deferred findings
description: >-
  A skill for keeping data by function awaits its drafting; Dorothy's
  trial of the doctrine is reported, and its settled rules are in the root
  AGENTS.md.
tags:
  - dorothy
  - agents
  - deferred
---

<!--
   -
   - ~chewygumxx/dorothy.git
   - ::: :/docs/deferred/2026-11-11_data-by-function-deferred.md
   -
   -->

# Data by function deferred findings

The doctrine: documentation, source, tests, build and CI each in their own
files, stored beside what they concern, and linked by a standard
convention ([decision](../wiki/decisions.md)). Its settled rules are in
the root `AGENTS.md`, under "Data by function". A skill waits, to be
written in the user's agent library, where its first trial, on mise's
task file, took place.

## Why it waits

It has been tried once. A skill spreads its mistakes to every repository
that adopts it, and this one would touch every file. Dorothy is its trial:
the [build configuration](../specs/2026-11-10_build-configuration.md)
spec audits her configuration comments and moves their narrative to the
wiki. The trial is
[reported](../reports/2026-11-11_build-configuration.md#comment-audit),
and the skill awaits its drafting. The questions the trial had to answer:

- Documentation in a `.d.ts` beside its `.ts`: TypeScript resolves imports
  to the `.ts` and ignores the `.d.ts`, so nothing checks they agree, and
  editor hovers show neither. The alternatives are a generated API report
  kept in the repository, after Microsoft's API Extractor, or a `.md`
  beside the source with a test that every export has an entry.
- Which level documents a thing: a file beside it, a directory of them,
  or one file for the directory, with nothing documented at two levels.
- What a check that a pair agrees looks like for each kind of file.

## What the skill would cover

Not the rules every edit needs, which are in `AGENTS.md`, but the
occasional jobs a skill's description can match:

- auditing a repository, classifying every comment as a directive, a
  label, a one-line why, a contract or narrative, and counting each;
- moving documentation out of code;
- choosing the level a piece of documentation belongs at;
- writing the check that keeps a split pair in agreement.

It takes in `documenting-configuration`, which the build configuration
spec first planned on its own, and may take in the wiki skill among the
roadmap's candidates, as one account of where text goes.

## When to take it up

Once the build configuration restructuring has merged and its report
records what held and what did not. Write the skill from that record.
