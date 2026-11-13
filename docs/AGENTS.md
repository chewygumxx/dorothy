---
ctime: 2026-10-12
mtime: 2026-11-03
spdx: GPL-3.0-only
title: docs/AGENTS.md
description: >-
  Agentic instructions regarding the organisational conventions of the docs
  directory with respect documentation storage, filename, and essay structure.
tags:
  - agents
---

<!--
   -
   - ~xxdorothy/dorothy.git
   - ::: :/docs/AGENTS.md
   -
   -->

# docs/AGENTS.md

Documentation pertaining to the development of this repository.

## Filename Convention

Filename format conforms to `YYYY-MM-DD_<abbreviated-title>.md` where
`YYYY-MM-DD` is the creation time (ctime) of the document. The living
reference, `README.md` and `wiki/`, takes stable descriptive names, with
no date; existing dated paths stay as they are.

## Subdirectory Organisation

| Subdirectory | Content                                                                                                                  |
| ------------ | ------------------------------------------------------------------------------------------------------------------------ |
| `specs/`     | Design Proposals                                                                                                         |
| `plans/`     | Implementation Strategy                                                                                                  |
| `reports/`   | Implementation phase probes, rulings and verification with any captured output in a directory beside it of the same name |
| `notes/`     | Research kept for reference                                                                                              |
| `deferred/`  | findings left for later                                                                                                  |
| `wiki/`      | Maintained reference on topics, profiles, decisions, questions, problems and priorities, linking the records as evidence |
| `README.md`  | The front door to the wiki: its routes and pages, and how reference differs from records                                 |
| `roadmap.md` | Projected order of phase implementation                                                                                  |

## Essay Structure

- Each file opens with frontmatter (`ctime`, `mtime`, `spdx`, `title`,
  `description`, `tags`) and the breadcrumb comment; copy both from a
  sibling, and bump `mtime` when you edit. `lint:header` checks the
  breadcrumb against the file's path.
- Lines are at most 80 characters, inline code included: a long command
  goes in a fenced block. Links are Markdown links, never `[[...]]` wiki
  links. `lint:md` runs remark and markdownlint, which enforce both.
- A spec says what and why; a plan says how, task by task, with the code.
- Add each new record to `wiki/records.md` (`docs.test.ts` enforces it);
  a changed decision updates its entry in `wiki/decisions.md`.
- A report records each probe and how it was run, the rulings made on the
  spec, and the verification, with commands and their output.
