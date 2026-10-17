---
ctime: 2026-10-12
mtime: 2026-10-18
spdx: GPL-3.0-only
title: docs/AGENTS.md
description: >-
  Where Dorothy's documents go, how they are named and how they are
  written.
tags:
  - agents
---

<!--
   -
   - ~chewygumxx/dorothy.git
   - ::: :/docs/AGENTS.md
   -
   -->

# docs/AGENTS.md

## Where things go

- `specs/`: designs, `YYYY-MM-DD-<topic>-design.md`.
- `plans/`: implementation plans, `YYYY-MM-DD-<topic>.md`.
- `reports/`: a phase's probes, rulings and verification,
  `YYYY-MM-DD-<topic>.md`, with any captured output in a directory beside
  it of the same name.
- `notes/`: research kept for reference, `YYYY-MM-DD_<topic>.md`.
- `deferred/`: findings left for later, `YYYY-MM-DD_<topic>.md`.
- `roadmap.md`: the phases in order, revised as its Revising section says.

## How they are written

- Each file opens with frontmatter (`ctime`, `mtime`, `spdx`, `title`,
  `description`, `tags`) and the breadcrumb comment; copy both from a
  sibling, and bump `mtime` when you edit. `lint:header` checks the
  breadcrumb against the file's path.
- Lines are at most 80 characters, inline code included: a long command
  goes in a fenced block. Links are Markdown links, never `[[...]]` wiki
  links. `lint:md` runs remark and markdownlint, which enforce both.
- A spec says what and why; a plan says how, task by task, with the code.
- A report records each probe and how it was run, the rulings made on the
  spec, and the verification, with commands and their output.

## The AGENTS.md files

`agents.test.ts` pins them: the root at most 100 lines, this file 60 and
each package's 150, header included; every relative link resolves; and no
`CLAUDE.md`, `.claude/CLAUDE.md` or `CLAUDE.local.md` exists anywhere, as
one switches Claude Code's `AGENTS.md` off. A package's file that
outgrows its budget gains a nested `src/<subdir>/AGENTS.md`, read on
demand; the root moves detail into the file where it is needed. No
budget grows.
