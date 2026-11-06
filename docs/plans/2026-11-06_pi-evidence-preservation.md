---
ctime: 2026-11-06
mtime: 2026-11-06
spdx: GPL-3.0-only
title: Pi evidence preservation plan
description: >-
  Preserve the private Pi integration evidence, catalogue its location,
  and prove recovery from encrypted off-machine storage.
tags:
  - pi
  - evidence
  - operations
---

<!--
   -
   - ~chewygumxx/dorothy.git
   - ::: :/docs/plans/2026-11-06_pi-evidence-preservation.md
   -
   -->

# Pi Evidence Preservation Implementation Plan

> For agentic workers: use subagent-driven-development for independent
> review. These are operational steps, verified against captured and
> restored bytes; they introduce no runtime feature.

**Goal:** Preserve potentially useful or expensive Pi development data,
with a small catalogue and authenticated recovery.

**Architecture:** Keep self-contained encrypted bundles in private R2
Standard storage and retain local originals. Commit a sanitized catalogue
and recovery instructions. Detailed classification and querying wait.

**Tech stack:** Git bundles, SHA-256, tar, zstd, age, SQLite and Wrangler.

**Spec:** The [approved design](#approved-design) below records the user's
choices in the preservation discussion.

## Approved design

The user selected private access for themselves and authorized agents,
confirmed that the existing age private key is backed up in Proton Pass,
and set a US$5 monthly spending target. They have no independent backup
destination. The local originals and R2 provide two storage locations;
an additional independent backup remains outstanding.

Cloudflare R2 is the selected destination. A separate Git repository,
database, detailed classification and access application are unnecessary
for this first capture. A small public catalogue must contain no raw
private transcripts or credentials.

## Global constraints

- Retain originals; preserve links without following external targets.
- Preserve failed attempts and operator interventions alongside success.
- Keep raw SQLite files and sidecars; identify derived backups separately.
- Encrypt before upload with the existing repository age recipient.
- Keep bucket access private and completed objects free of expiration.
- Limit this capture to 4 GiB encrypted and 100 logical object commands.
- Treat US$5 as a target, not an account-wide provider-enforced cap.
- Distinguish informational alerts from limits and record setup gaps.
- Verify downloaded bytes and recovered files before claiming recovery.
- Keep key values and private filesystem inventories out of Git.

## Review focus

- Separate trial and job roots must not disappear behind local pointers.
- Link preservation must not let SQLite derivative creation follow links.
- Original-to-capture and capture-to-restore checks cover every input.
- Scan results must describe their actual scope, including limitations.
- Public claims must match remote bytes, settings and backup status.

## Task 1: Capture

- [ ] Inventory all Pi trial roots, prior plan archive and relevant logs.
- [ ] Copy and hash originals, retaining source mappings privately.
- [ ] Include complete Git history through the Pi closeout merge.
- [ ] Check credentials locally without printing their values.
- [ ] Preserve raw databases and create checked, separate derivatives.

Expected: copied bytes match retained sources, the content manifest
covers every payload entry, and any exclusions or derivative failures
are explicit.

## Task 2: Store and recover

- [ ] Verify the recipient against the existing local private key.
- [ ] Compress, encrypt and record complete and per-object checksums.
- [ ] Upload uniquely named objects to private R2 Standard storage.
- [ ] Download, hash, decrypt, extract and verify every manifest entry.
- [ ] Inspect public access, lifecycle and overwrite protection settings.

Expected: recovery from downloaded objects matches the captured payload.
No public endpoint or completed-object expiration is configured.

## Task 3: Catalogue and close

- [ ] Record object names, sizes, hashes, scope and recovery commands.
- [ ] Record actual spending controls and outstanding backup work.
- [ ] Link the catalogue from the wiki and obtain independent review.
- [ ] Run documentation checks and merge through normal PR and CI.

Expected: the repository can lead an authorized reader to the archive and
explain how to verify it. It makes no unsupported backup or billing claim.
