---
ctime: 2026-10-08
mtime: 2026-10-20
spdx: GPL-3.0-only
title: Tags deferred findings
description: >-
  Catalogue snapshot visibility retained by the roadmap sweep.
tags:
  - dorothy
  - memory
  - deferred
---

<!--
   -
   - ~chewygumxx/dorothy.git
   - ::: :/docs/deferred/2026-10-08_tags-deferred.md
   -
   -->

# Tags deferred findings

The roadmap sweep closed the code findings, editor behaviours and test
gaps from `feat/tags`. See the
[sweep report](../reports/2026-10-19-roadmap-sweep.md#task-7-tags).

## Catalogue snapshot visibility

**Hiding a chat mid-run is not seen by that run's reviews.** Reviews
receive the catalogue snapshot loaded at launch, including its hidden
flags; they do not read the index. A concept carried only by a chat hidden
by another process since launch can still be reused until the next
launch. The sweep left this behaviour as moot under its conditional
ruling: fix it only if reviews can see the catalogue's new flag without
reading the index. The current snapshot cannot. A refresh needs a later
design; the [tags spec](../specs/2026-10-07-tags-design.md) records the
boundary.
