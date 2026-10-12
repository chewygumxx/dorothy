---
ctime: 2026-10-12
mtime: 2026-10-12
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
- Lines are at most 80 characters, and links are Markdown links, never
  `[[...]]` wiki links; remark (`lint:md`) enforces both.
- A spec says what and why; a plan says how, task by task, with the code.
- A report records each probe and how it was run, the rulings made on the
  spec, and the verification, with commands and their output.
