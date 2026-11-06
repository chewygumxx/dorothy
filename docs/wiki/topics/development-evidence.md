---
ctime: 2026-11-06
mtime: 2026-11-06
spdx: GPL-3.0-only
title: Development evidence
description: >-
  A reusable procedure for preserving private development evidence,
  cataloguing encrypted archives and verifying recovery.
tags:
  - evidence
  - backup
  - operations
---

<!--
   -
   - ~chewygumxx/dorothy.git
   - ::: :/docs/wiki/topics/development-evidence.md
   -
   -->

# Development evidence

[Wiki home](../../README.md)

Preserve development data when it may help later or would be expensive to
reproduce: sessions, failures, tool observations, review packages, model
accounting, interventions and the code revisions they describe. Keep
original evidence distinct from interpretations and derived recovery
copies. Detailed classification and database querying can follow later.

The [Pi preservation
report](../../reports/2026-11-06_pi-evidence-preservation.md)
is a completed example with an object catalogue and executable recovery
checks. Its original private corpus remains encrypted outside Git. This
page describes the repeatable method; it does not schedule uploads.

## Decide the capture

Record a short purpose, the selected source roots, exclusions, related
commits, the authorized storage destination and access recipients. Include
separate trial roots and job logs, not merely local pointers to them.
Retain failures, operator assistance and accounting uncertainty alongside
successful results. Document changes in conditions between attempts.

An initial complete snapshot can be cheaper than immediate classification.
Downloaded runtimes and caches can be retained when that is affordable;
record their versions so later retention decisions need not guess.
Credentials and decryption private keys are not capture inputs.

## Capture and seal

1. Copy selected inputs into a new private staging directory. Preserve
   symlinks as links and never follow their external targets. Refuse
   special files; record exclusions. Compare source and copied bytes and
   check that the sources did not change during copying. A stable copy
   is not an atomic filesystem snapshot.
2. Retain raw SQLite files and sidecars. Where a readable recovery copy
   is useful, work on a separate private copy, reject symlinked database
   or sidecar paths, create a SQLite backup and close all connections
   before inventory. Keep the source-to-derivative mapping and report
   `quick_check` results and failures accurately.
3. Review sensitivity without printing values. Distinguish known-secret
   comparisons, pattern matches and manual adjudication. A marker in a
   test or example is not proof of a credential; a narrow scan is not a
   comprehensive privacy audit. Record any transformations or exclusions.
4. Build a manifest covering every payload entry: regular-file size and
   SHA-256, entry type and symlink target. Modes and timestamps may be
   recorded for recovery without restoring privileged permissions. State
   which generated manifest files are excluded from their own inventory.
5. Verify the recipient against a recoverable private key, then compress
   and encrypt before upload or staging in Git. Recheck staged content
   for changes while packaging. Retain an incomplete result as incomplete.
6. Split the encrypted stream if the transfer tool needs bounded objects.
   Record the exact part order, sizes, part hashes, complete ciphertext
   hash and payload-manifest hash. Individual parts need not be separately
   decryptable; reconstruct the original stream in the recorded order.

## Store and prove recovery

Use private object storage and a unique archive identity or content-based
prefix. Refuse unintended overwrites. Review public access, expiration
and retention settings against the approved preservation purpose. R2's
prefix locks are administrator-removable protections, not a separate
backup or an irrevocable retention guarantee.

Download the stored bytes into a new private directory. Check every part
and the combined ciphertext before decryption. Extract into a fresh owned
directory with path containment and link handling checked, then verify the
payload manifest and complete entry set. Check derived databases using
immutable read access where applicable. Record actual results and any
remaining verification gap before removing generated working copies.

Keep originals and a canonical local encrypted bundle unless a different
retention decision was explicitly made. Remove only generated staging,
transfer and recovery duplicates after the verified copies exist. A
second directory on the same disk is not an independent backup location.
An additional independent destination remains
[high priority](../../roadmap.md#candidates).

## Catalogue and completion record

Commit a small sanitized catalogue and recovery guide, not raw private
sessions. Record archive identity and purpose, related commits, storage
location, ordered object keys, sizes and hashes, encryption requirements,
verified recovery time and scope, and outstanding backup work.

Report copy locations and failure boundaries separately. A private cloud
bucket, local directory, key backup, lifecycle rule and spending alert are
different controls. State whether a claim was observed by the agent,
confirmed by the owner, estimated, or remains unknown. The owner's key
backup is required for recovery but is not another copy of the data.

For the Pi capture, the US$5 monthly amount is a target. Cloudflare budget
alerts are informational and do not stop R2 usage. Bounds on logical
commands and archive size do not cap SDK retries or other account usage.
[Budget alerts](https://developers.cloudflare.com/billing/manage/budget-alerts/)

## Authenticate without an interactive login

The Pi capture used Wrangler OAuth because an authorized login was
available. `wrangler login` is not a requirement of object storage.

There are two distinct credential paths:

- **Wrangler and Cloudflare REST:** a scoped API token in
  `CLOUDFLARE_API_TOKEN`, for authorized bucket administration and
  compatible Wrangler operations.
- **R2 S3-compatible API:** an Access Key ID and Secret Access Key, for
  routine object upload and recovery with bucket-scoped permissions.

Wrangler also accepts the older global API key plus email, but prefer a
scoped token over account-wide credentials. R2 Object Read/Write and
Object Read-only credentials are supported by the S3-compatible API, not
by the Cloudflare REST API; do not substitute one credential type for the
other. [Wrangler authentication][wrangler-auth],
[R2 authentication](https://developers.cloudflare.com/r2/api/tokens/)

Use `sops edit secrets.json` or core's `saveSecret` to store credential
values. Preserve existing entries; never put values in command arguments,
URLs, logs, a plaintext config file or a pasted conversation. Wrangler
does not automatically read the encrypted file. A repository helper must
load the required values through the existing secret loader and pass only
the selected credentials to the intended client.

For routine R2 transfers, the proposed helper credential names are:

- `CLOUDFLARE_R2_ACCESS_KEY_ID`.
- `CLOUDFLARE_R2_SECRET_ACCESS_KEY`.
- `CLOUDFLARE_ACCOUNT_ID` for the intended account; this is an identifier,
  not a password, but it need not be published in the catalogue.

Use Object Read and Write scoped to the archive bucket for an archiving
operator, or Object Read-only for recovery alone. Bucket creation, public
access configuration, locks and lifecycle changes are separate authorized
administration. Credential creation and population remain operator setup;
placeholder values must not be presented as working authentication.

## Reusable helpers

Focused helpers for manifest verification, encrypted packaging and
credential-backed transfer are being designed. Their specification must
preserve compatibility with the existing Pi catalogue and keep source
selection and retention decisions with the operator. Until those helpers
are implemented and verified, use the completed report's explicit
procedure; this page does not claim an unbuilt command exists.

[wrangler-auth]:
https://developers.cloudflare.com/workers/wrangler/system-environment-variables/
