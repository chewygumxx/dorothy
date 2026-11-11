---
ctime: 2026-11-06
mtime: 2026-11-11
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
alerts are informational and do not stop R2 usage. The transfer helper
disables SDK retries, but its logical-call and byte limits do not cap
multipart HTTP traffic, charges or other account usage.
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

For routine R2 transfers, the helper loads these credential names:

- `CLOUDFLARE_R2_ACCESS_KEY_ID`.
- `CLOUDFLARE_R2_SECRET_ACCESS_KEY`.

Both transfer modes require the intended account identifier through
`--account-id`, and an explicit `--bucket` matching the trusted catalogue.
The account identifier must contain 32 hexadecimal digits. It is not a
password and need not be published in the catalogue. The helper derives
the default-jurisdiction R2 endpoint from this explicit account selection;
it does not trust account or endpoint metadata in a catalogue. Nonempty
environment credential values take precedence over encrypted file values.
Only the selected credential pair, account and bucket reach the client.
Use `--secrets` for an explicit encrypted file when needed.

Use Object Read and Write scoped to the archive bucket for an archiving
operator, or Object Read-only for recovery alone. Bucket creation, public
access configuration, locks and lifecycle changes are separate authorized
administration. Credential creation and population remain operator setup;
placeholder values must not be presented as working authentication.

## Reusable helpers

The repository-owned [development evidence
skill](../../../.agents/skills/development-evidence/SKILL.md) routes agents
here. Run each helper's `--help` from the checkout root for its exact
interface:

```sh
bun scripts/evidence-manifest.ts --help
bun scripts/evidence-package.ts --help
bun scripts/evidence-transfer.ts --help
```

These Linux helpers use Bun, GNU tar, zstd and age.
`.config/mise/config.toml` pins zstd and age; GNU tar is a system
prerequisite. They operate on an explicit,
quiescent staging tree, not on discovered source roots. They reject
symlinked ancestry and special files, preserve literal payload links, and
check observed changes. They provide neither atomic snapshots nor OS
confinement against malicious concurrent ancestry replacement. Keep inputs
stable throughout packaging and transfer.

Defaults are 128 MiB parts, 4 GiB complete ciphertext and 100 logical
store calls. The transfer catalogue has a separate 1 MiB ceiling. Package
and download outputs retain both ciphertext and parts, requiring roughly
twice the ciphertext size plus metadata. An upload plans two calls per
part and two for its catalogue (HEAD and PUT); a download plans one GET
per listed part. This is an operation admission limit, not a provider bill
cap. Large-file multipart behavior and live R2 authentication remain
untested; tests use synthetic files and local services. The
[implementation report](../../reports/2026-11-06_development-evidence.md)
records concrete verification and limits.

### Prepare secrets and manifest

Real bucket-scoped credential creation and population remain separate
operator setup. Use the encrypted editor, preserving all existing fields,
to add the two credential names above; never paste their values into a
shell command or this documentation:

```sh
sops edit secrets.json
```

The examples below are templates, not performed transfers. Set `STAGE` to
the selected private, already-copied staging tree; `PACKAGE` and `FETCH`
to fresh output paths whose parents exist; `ARCHIVE_ID` and `PREFIX` to a
unique capture identity and normalized relative prefix ending in `/`;
`BUCKET` and `ACCOUNT_ID` to the authorized existing destination; and
`RECIPIENT` to the verified native lowercase `age1` public recipient.
Private key values never belong in these variables. No helper selects
sources, creates buckets or schedules work.

```sh
bun scripts/evidence-manifest.ts create --root "$STAGE"
```

Set `MANIFEST_SHA256` to the returned `manifestSha256` and retain it in the
sanitized recovery record. Creation exclusively writes `MANIFEST.json`
with mode 0600 and excludes that file from its own inventory. Verification
checks the pinned manifest digest, complete entry set, entry types, file
sizes and hashes, and literal symlink targets. Historical Pi numeric
nanosecond timestamps remain readable metadata; recovery need not match
file modes or timestamps exactly.

```sh
bun scripts/evidence-manifest.ts verify \
  --root "$STAGE" --expected-sha256 "$MANIFEST_SHA256"
bun scripts/evidence-package.ts \
  --root "$STAGE" --expected-sha256 "$MANIFEST_SHA256" \
  --out "$PACKAGE" --id "$ARCHIVE_ID" --bucket "$BUCKET" \
  --prefix "$PREFIX" --recipient "$RECIPIENT"
```

Packaging checks the bucket name against the transfer policy before
creating output or invoking processes. Names use 3 to 63 lowercase
letters, digits or hyphens, beginning and ending with a letter or digit.
Historical catalogue parsing remains permissive for compatibility.

Packaging streams tar through zstd and age without a plaintext archive on
disk, then hashes and splits the ciphertext. It verifies staging again
before writing the completed `archive.json` with status `packaged`. SSH
and plugin recipients are unsupported. The private output directory holds
`archive.tar.zst.age`, `parts/` and `archive.json`; the prefix gains the
ciphertext digest. Any failure leaves outputs incomplete for inspection,
without a completed catalogue. Never treat retained partial output as a
completed package or silently reuse its output path.

### Transfer and verify recovery

Review and retain the trusted catalogue independently before transfer.
Its existing metadata is preserved byte for byte on transfer; legacy Pi
catalogues remain readable. Use an exclusive capture prefix: all keys are
preflighted before any upload, but HEAD cannot prevent a concurrent writer
between the check and PUT. There is no automatic mutation retry or remote
cleanup. Parts upload in catalogue order and the catalogue uploads last.

```sh
bun scripts/evidence-transfer.ts upload \
  --catalogue "$PACKAGE/archive.json" --directory "$PACKAGE/parts" \
  --account-id "$ACCOUNT_ID" --bucket "$BUCKET"
bun scripts/evidence-transfer.ts download \
  --catalogue "$PACKAGE/archive.json" --out "$FETCH" \
  --account-id "$ACCOUNT_ID" --bucket "$BUCKET"
```

A successful download checks every listed part and the joined ciphertext,
then retains exact trusted catalogue bytes as `archive.json`. Files are
0600 under a new 0700 directory. Failures retain visibly partial output
without a success catalogue. Download neither decrypts nor extracts; it
does not prove complete recovery or update an uploaded package's status.

For a trusted archive, review expected paths and link handling before
extracting with an unprivileged account into fresh owned space. Set
`RESTORE` to an absent path under a private parent and `KEY_FILE` to the
recoverable identity file path, never to a private key value. Enable
pipeline failure checking so any failed stage blocks a recovery claim:

```sh
set -o pipefail
mkdir -m 700 -- "$RESTORE" && \
  age --decrypt --identity "$KEY_FILE" "$FETCH/archive.tar.zst.age" | \
  zstd --decompress --stdout --quiet | \
  tar --extract --file=- --directory "$RESTORE" && \
  bun scripts/evidence-manifest.ts verify \
  --root "$RESTORE" --expected-sha256 "$MANIFEST_SHA256"
```

Check each exit status before continuing. A failed extraction remains
incomplete, even if some files appeared. Verify derived databases through
immutable reads where applicable, following the Pi report's concrete
recovery checks. Record the actual recovery scope and results separately
from packaging and upload. No helper deletes originals, extracts archives,
configures cloud storage or completes the outstanding independent backup.

[wrangler-auth]:
https://developers.cloudflare.com/workers/wrangler/system-environment-variables/
