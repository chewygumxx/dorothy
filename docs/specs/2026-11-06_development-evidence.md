---
ctime: 2026-11-06
mtime: 2026-11-06
spdx: GPL-3.0-only
title: Reusable development evidence preservation
description: >-
  Proposed focused helpers and a repository skill for encrypted development
  archives, verified recovery and scoped secret-backed R2 transfers.
tags:
  - evidence
  - agents
  - spec
---

<!--
   -
   - ~chewygumxx/dorothy.git
   - ::: :/docs/specs/2026-11-06_development-evidence.md
   -
   -->

# Reusable development evidence preservation

## Status and intent

Proposed for user review on 2026-11-06. The user selected the focused
helper scope and requested a committed,
repeatable methodology, an appropriate agent skill, assisting scripts,
secret-backed authentication and a high-priority record for an additional
independent backup destination. The priority record is separate work;
it does not mean that destination exists.

The completed [Pi capture](../reports/2026-11-06_pi-evidence-preservation.md)
provides observed evidence. The maintained
[procedure](../wiki/topics/development-evidence.md) generalizes it.
The existing archive and its hashes remain unchanged by this work.

## Goals

- Make preservation and recovery repeatable without inventing a database
  or detailed classification scheme.
- Keep source selection, sensitivity adjudication and retention decisions
  visible to the operator, with deterministic mechanics in tested helpers.
- Authenticate routine R2 object transfers using selected credentials from
  encrypted `secrets.json`, without requiring Wrangler OAuth login.
- Preserve the existing Pi manifest and catalogue as readable version-1
  examples; keep raw data outside Git and support verified recovery.
- Provide a discoverable repository skill linked through the existing
  agent-asset mechanism, with one maintained procedure as its reference.

## Approaches

**Selected scope: focused helpers and an operator skill.** Three
helpers cover manifests, encrypted packaging and R2 transfers. The skill
handles source selection, sensitivity review, independent backup status
and the order in which successful verification permits cleanup. This
keeps each command useful and testable without hidden orchestration.

**Alternative: one end-to-end archive command.** It could coordinate all
steps and resume them, but needs a persistent state machine, source and
exclusion configuration, interrupted-step reconciliation and broader
integration tests. That is useful if unattended recurring capture becomes
an explicit requirement; it is not required for the first reusable tools.

The user selected the focused-helper scope. The interfaces below remain
proposed for design review; the helpers and skill are not implemented yet.

## Scope and authority

The helpers operate on explicitly supplied staging roots, new private
output directories and catalogue-listed objects. They do not discover
user homes, choose sources, copy credentials, delete originals, schedule
recurring work, create buckets, change locks or lifecycle policies, or
configure billing. They do not create the additional backup destination.
An operator authorizes those separate actions when needed.

The initial target is Linux with Bun, GNU tar, zstd and age. Declare
required tools in the repository's existing dependency mechanism. Use
Bun's S3 client at a thin transport edge; no new model-provider SDK or
standalone account client is needed. Test adapters remain injectable.

## Manifest helper

`scripts/evidence-manifest.ts` provides:

- `create --root <staging>`: write a new `MANIFEST.json` exclusively,
  excluding itself, and print its SHA-256 and entry counts.
- `verify --root <recovered> --expected-sha256 <hash>`: verify that manifest
  hash, its complete entry set, file sizes/content hashes and link targets.

The format remains compatible with the Pi manifest: a relative-path map
of `file`, `directory` and `symlink` entries. Modes and timestamps are
recorded; verification does not restore ownership or privileged bits.
Do not recurse through symlinks. Reject absolute/traversing manifest paths,
file entries reached through link parents, special files, changed inputs,
missing entries, extra entries and wrong hashes. Handle Unicode and shell
metacharacters as filenames, without interpreting them as commands.

## Packaging helper

`scripts/evidence-package.ts` accepts an explicitly staged root, its
expected manifest SHA-256, a new output directory, archive ID, target
bucket, object prefix and age recipient. It:

1. Verifies the staging manifest and validates all arguments before work.
2. Compresses and encrypts through argument-array subprocesses, with
   pipeline errors propagated and no plaintext archive written to disk.
3. Rechecks staging after packaging to detect changes during the operation.
4. Hashes the ciphertext and splits it into ordered parts, default 128 MiB.
5. Writes a version-1-compatible catalogue with sizes, hashes and format.

Default encrypted-output limit is 4 GiB; explicit positive bounded options
may change local limits. These are workflow controls, not a provider bill
cap. Refuse existing output directories, including empty directories and
symlink aliases. Partial results stay explicitly incomplete. The command
never deletes staging or original sources. It takes a public recipient,
not the decryption key, and does not claim recovery has passed.

## Transfer helper and credentials

`scripts/evidence-transfer.ts` has separate `upload` and `download` modes.
Both take a trusted catalogue, an explicitly selected account and bucket,
a local package or new download directory, and optional injected secret
loading for tests. Production uses the existing checkout secret loader.

Required selected credential names are:

- `CLOUDFLARE_R2_ACCESS_KEY_ID`.
- `CLOUDFLARE_R2_SECRET_ACCESS_KEY`.

`CLOUDFLARE_ACCOUNT_ID` or an explicit account option selects the account.
Construct the default-jurisdiction R2 HTTPS endpoint from the validated
account ID, not an endpoint supplied by a downloaded catalogue. Preserve
existing nonempty environment values as the core loader already does.
Only selected values reach the S3 client; do not forward unrelated secrets
or serialize decrypted credentials. Missing credentials or SOPS failures
produce code-only failures and never fall back to another login identity.

Use an R2 Object Read and Write credential restricted to the archive
bucket for upload, and Object Read-only when recovery alone is needed.
The user must create and enter real values with `sops edit secrets.json`
or core's `saveSecret`; this work supplies no dummy working credential.

Wrangler remains available for authorized administration. It can use
`CLOUDFLARE_API_TOKEN` instead of OAuth, but R2's bucket-scoped object
credentials are S3 credentials, not interchangeable REST tokens. The
routine transfer helper uses S3 and does not require `wrangler login`.

### Transfer contract

Validate schema, part order, unique filenames, byte limits, expected
account/bucket and prefix containment before loading secrets or making
network calls. Default limit is 100 logical object operations; document
that SDK retries and multipart requests are distinct provider requests.

Upload verifies local part and full-cipher hashes first. Use unique
content-based prefixes and reject existing remote keys; do not silently
overwrite or automatically retry an uncertain mutation. A preflight check
alone is not an atomic concurrent-writer guarantee. Report protection
provided by configured server-side locks separately.

Download creates a new private output directory, fetches only listed
parts, checks each part and the joined ciphertext, and produces a local
ciphertext bundle. Refuse an existing output. A successful download is
not full recovery: the operator decrypts/extracts into a fresh directory
using the procedure, then runs the manifest verifier. Record partial
failures without claiming completion or deleting useful evidence.

The existing Pi catalogue remains usable as an input. Validate untrusted
fields, but do not require newly proposed optional metadata to read an
older catalogue. Never use S3 multipart ETags as content SHA-256 values.

## Agent skill and maintained documentation

Create `.agents/skills/development-evidence/SKILL.md`, linked for the
repository's supported agents through its existing asset mechanism.
Update ignore exceptions, asset tests and discovery links as required.

The short skill applies when preserving, cataloguing, transferring or
recovering private development evidence. It routes to the maintained
procedure and helper `--help` rather than duplicating implementation.
It distinguishes captured originals, derivatives, encrypted local copy,
off-machine copy, key backup and an additional independent destination.
It preserves sensitivity-scan limitations and actual versus owner-reported
verification. It does not grant additional cloud or deletion authority.

## Verification and acceptance

Use synthetic temporary roots and injected secret/network/process runners;
normal tests never access the real archive, key or user data. Tests cover
path/link escape, changing input, extra/missing entries, wrong checksums,
existing output, pipeline interruption and failed final verification.

Credential tests prove missing/failing secrets make no network request,
selected credential use honors environment precedence, unrelated secrets
are not forwarded, and error/output paths do not reveal secret values.
Transport tests cover wrong destination, duplicate/unsafe part paths,
existing keys, partial transfer, unexpected bytes and bounded operations.
Exercise the real S3 adapter against a local synthetic S3 test service
where useful; do not require live cloud credentials for CI.

Package and recover a tiny synthetic fixture with actual tar/zstd/age and
run the manifest verifier against its recovered files and links. Keep the
private key in the fixture only. Record live S3 authentication as untested
until real credentials are explicitly configured; use a bounded read-only
check when available, without uploading another copy of the Pi archive.

Validate skill discovery and links mechanically. Use independent task
scenarios to check that a future agent can find the guide, choose the
right authentication path and distinguish upload from verified recovery.
Record baseline and skill-assisted outcomes without inventing failures or
claiming a behavioral improvement that the comparison does not establish.

Acceptance requires focused tests, repository checks, independent review,
and the normal PR/CI process. No new inference trial is required.
