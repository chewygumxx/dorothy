---
ctime: 2026-11-06
mtime: 2026-11-06
spdx: GPL-3.0-only
title: Development evidence helper plan
description: >-
  Implement the approved manifest, encrypted packaging and scoped R2
  transfer helpers, then expose them through a tested repository skill.
tags:
  - evidence
  - agents
  - plan
---

<!--
   -
   - ~chewygumxx/dorothy.git
   - ::: :/docs/plans/2026-11-06_development-evidence.md
   -
   -->

# Development Evidence Implementation Plan

> For agentic workers: REQUIRED SUB-SKILL: use
> superpowers:subagent-driven-development, as repository instructions
> require. Execute the tasks in order, with one writer and task review.

**Goal:** Deliver focused, reusable preservation helpers and an operator
skill with secret-backed R2 authentication and verified recovery.

**Architecture:** Manifest mechanics are independent of packaging.
Packaging produces a version-1 catalogue. Transfer consumes that format
through an injected store, with Bun S3 isolated at the edge. The skill
routes operators to the maintained procedure and command help.

**Tech stack:** Bun/TypeScript, GNU tar, zstd, age, existing SOPS loader,
Bun S3 client. Tests use synthetic roots, keys and transports.

**Spec:** [Approved design](../specs/2026-11-06_development-evidence.md).
The user approved this design on 2026-11-06.

## Global Constraints

- Existing Pi manifest/catalogue inputs remain readable and unchanged.
- Never follow symlinks into another tree or interpret paths as shell code.
- No originals deletion, source discovery, cloud administration or scheduling.
- Fresh private outputs only; partial failures remain visibly incomplete.
- Encrypt before upload; never write a plaintext archive to disk.
- Default parts: 128 MiB; encrypted-output limit: 4 GiB.
- Default transfer limit: 100 logical store calls, not provider bill cap.
- Credentials remain in memory; no key values in argv, logs or files.
- Only selected R2 credentials reach the client; no OAuth fallback.
- Tests never use real user roots, keys, archive bytes or live services.
- Focused tests and typecheck per task; one final full repository check.
- Commit granularly without agent trailers; reports and test proof in ledger.

## Review Focus

1. Symlink parent/path traversal and a changing file: Task 1 must refuse.
2. Partial pipeline and existing output: Task 2 must preserve evidence.
3. Unsafe/duplicate catalogue fields before key loading: Tasks 2 and 3.
4. Wrong account, credential failures and SDK error leaks: Task 3.
5. Upload mistaken for recovery and third-copy claims: Task 4 scenarios.

## Task 1: Manifest creation and verification

**Files:** create `scripts/evidence-manifest.ts` and its `.test.ts`.

**Interfaces:** export `hashFile(path): Promise<string>`,
`createManifest(root): Promise<ManifestSummary>` and
`verifyManifest(root, expectedSha256): Promise<ManifestSummary>`.
`ManifestSummary` has `files`, `symlinks`, `directories`, `bytes` and
`manifestSha256`. The manifest is `MANIFEST.json`, excluded from itself.

Keep the Pi relative-path map: file entries have `type`, `size`, `sha256`,
`mode`, `mtimeNs`; directories and links have appropriate metadata and
links have `target`. New nanosecond timestamps may be exact decimal
strings; accept old numeric timestamps as metadata. Verification checks
content/type/link targets, not restored ownership or permission bits.

CLI: `create --root <path>` and
`verify --root <path> --expected-sha256 <hash>`. Print JSON success summary
or code-only failure with nonzero exit. `--help` has no side effects.
Use import-safe entry points. Optional injected I/O is permitted for
repeatable file-change tests; do not add production timing hacks.

- [ ] Write failing tests for nested files, Unicode/metacharacter names,
  broken/outward links preserved as links, exact counts and old numeric
  metadata. Assert content mutation, extra/missing entries and wrong hash
  fail; assert absolute/traversing entries, symlink parents, special files
  and existing manifest creation fail without following or overwriting.
- [ ] Run `bun test scripts/evidence-manifest.test.ts` and record RED.
- [ ] Implement the exported functions and CLI with streaming hashes and
  before/read/after identity/size/time checks for changed inputs.
- [ ] Run that test and `bun run typecheck`; record GREEN and self-review.
- [ ] Commit and report exact files, commands, results and remaining limits.

## Task 2: Encrypted packaging and shared catalogue

**Files:** create `scripts/evidence-package.ts`,
`scripts/evidence-package.test.ts`, `scripts/evidence-catalogue.ts`,
`scripts/evidence-catalogue.test.ts`; declare zstd in `mise.toml` using the
repository's explicit backend/version convention. GNU tar is a Linux
system prerequisite; age is already pinned.

**Consumes:** Task 1's hash and verification interfaces.
**Produces:** `EvidenceCatalogue` and `parseCatalogue(value, limits?)` from
`evidence-catalogue.ts`; `packageEvidence(options, deps?)` from packaging.

The version-1 catalogue retains `archiveId`, `schemaVersion`, `bucket`,
`prefix`, `format`, `cipherSha256`, `cipherBytes`, `payloadManifestSha256`,
`objects: {key, bytes, sha256}[]`; keep unknown existing metadata readable.
Object keys must be unique, contained by a normalized relative prefix,
with unique safe basenames and valid positive safe-integer sizes/digests.
Sums must match the complete cipher size. Catalogue key, if present, must
be the prefix's `archive.json` and not collide with a part.

CLI options: `--root`, `--expected-sha256`, `--out`, `--id`, `--bucket`,
`--prefix`, `--recipient`, optional positive `--part-bytes` and `--max-bytes`.
Validate before creating output; output must not overlap staging. A new
0700 output holds `archive.tar.zst.age`, `parts/` and `archive.json`.
Append cipher SHA to the chosen prefix. Parts use `part-000.agepart`
and increasing numbers. Encryption is one stream, split afterward.

Use argument-array processes for tar, zstd and age, checking every exit
and terminating remaining owned pipeline children on failure. Age receives
only a public recipient. Status can say packaged/incomplete, never recovered.
Reverify staged content after packaging. Leave owned partial outputs for
inspection on failure; no destructive cleanup or silent retries.

- [ ] Write failing tests for catalogue validation, existing/symlink output,
  output inside staging, invalid limits and pipeline failure. Assert a
  mutated stage fails its second verification and source bytes survive.
- [ ] Run the two focused test files and record RED.
- [ ] Implement catalogue functions, packaging pipeline and CLI.
- [ ] Run focused tests with injected processes, then a tiny fixture using
  actual tar/zstd/age, a temporary age key, multiple small parts, decrypt
  and extract into a fresh directory, and Task 1 verification. Failures
  propagate even if a later pipeline process exits successfully.
- [ ] Run typecheck/format checks, commit and report actual RED/GREEN proof.

## Task 3: Scoped R2 transfer and secret loading

**Files:** create `scripts/evidence-transfer.ts` and `.test.ts`,
`scripts/evidence-r2.ts` and `.test.ts`. No real secret entry or live write.

**Consumes:** shared catalogue parser and `hashFile`.
**Produces:** `uploadEvidence(options, deps?)` and
`downloadEvidence(options, deps?)`; injected `EvidenceStore` interface
`exists(key): Promise<boolean>`, `put(key, path): Promise<void>`,
`get(key, path): Promise<void>`. The thin R2 adapter implements it with
Bun S3, explicitly selected credentials and upload retry set to zero.

CLI: `upload --catalogue <path> --directory <parts> --account-id <id>`;
`download --catalogue <trusted-path> --out <new-path> --account-id <id>`.
Optional `--secrets <path>` is explicit; default is checkout secrets.
Optional positive `--max-operations` and `--max-bytes` set local limits.
The caller supplies an explicit bucket matching the catalogue if needed;
do not accept endpoint redirection from catalogue fields.

Use existing checkout/core secret loading with a fresh local environment
map, preserving existing nonempty selected environment values. Only
`CLOUDFLARE_R2_ACCESS_KEY_ID`, `CLOUDFLARE_R2_SECRET_ACCESS_KEY` and the
explicit validated account selection configure the client. Account ID
must be 32 hexadecimal characters; endpoint is the default-jurisdiction
R2 HTTPS endpoint. Unrelated loaded values never reach client options or
child processes. Missing/failed secrets stop before any store call.

Validate local paths/catalogue and all upload hashes before secret loading.
Preflight every upload key including the catalogue; any existing key
refuses the upload, with no overwrite. Upload parts then catalogue bytes.
Count each logical `exists`, `put` and `get`; admit the whole planned set
before calls. No script retry of uncertain mutations; partial outcomes
remain explicit. SDK multipart traffic is not a logical-call bill cap.

Download obtains only parts named by the trusted local catalogue into a
new 0700 directory, verifies parts and joined cipher, and retains the
catalogue and joined cipher. It does not extract, delete data or call this
full recovery. Failures print safe codes, not SDK messages or credentials.

- [ ] Write failing fake-store/secret tests for malformed catalogue and
  wrong account/bucket before key load; missing/SOPS failure before calls;
  environment precedence, unrelated-secret isolation, error redaction,
  existing remote keys, partial get/put, wrong bytes and operation limits.
- [ ] Run focused tests and record RED.
- [ ] Implement transfer and the small isolated Bun S3 adapter.
- [ ] Test the real adapter against a local synthetic HTTP S3 service with
  dummy credentials, including PUT/GET/HEAD and failure. No public endpoint
  or user secret in any test. Use stream/file APIs rather than loading
  archive-sized buffers. Assert upload retry configuration is zero.
- [ ] Exercise catalogue compatibility with a synthetic copy of the Pi
  shape, run focused tests/typecheck, commit and write report.

## Task 4: Operator skill, discovery and runbook integration

**Files:** create `.agents/skills/development-evidence/SKILL.md`;
modify `.gitignore`, `agents.test.ts`, and create the normal
`.claude/skills/development-evidence` link. Update the maintained procedure,
repository workflow page and `AGENTS.md` commands only where useful.
Add final implementation report under `docs/reports/` and its record link.

**Consumes:** the actual commands/help and test evidence from Tasks 1-3.
The skill is a concise operator reference, normally under 500 words, with
`name: development-evidence` and a triggering-only `Use when...`
description. Point to one maintained procedure and helper help rather
than duplicate options. Link via existing skill mechanism, not user-only
settings or a remote-skill lock entry.

- [ ] Write failing asset/discovery tests before changing `OWN`/links.
- [ ] Run independent baseline application scenarios before writing skill:
  absent token versus wrong auth type; upload succeeded but recovery has
  not; key backup/two directories versus independent data backup. Use
  synthetic examples and read-only decisions, not real cloud operations.
  Record actual results; do not invent a baseline failure. If the skill is
  only a navigation/reference improvement, label that honestly.
- [ ] Write the minimal skill and update links/ignore exceptions/assets.
- [ ] Run the same scenarios with skill and actual helper help available;
  verify command selection, boundaries and honest status. Validate skill
  frontmatter and check all links. Record concrete outcomes.
- [ ] Replace proposal wording in maintained docs with actual tested
  interfaces and show safe SOPS entry, pack, upload, download and verify
  examples. Real token creation/population remains separate operator work;
  live S3 authentication is untested until credentials are provided.
- [ ] Run all evidence tests, agents/docs/header tests and `bun run check`
  once on the completed code; report results and commit.

## Final gate

Perform one whole-branch review and its bounded fix wave under SDD.
Preserve every ruling and deferred finding. Normal push/PR/CI/merge is
already authorized by repository instructions. Keep the host worktree;
remove only owned temporary review/implementation worktrees with user
worktree tools once their commits are integrated and safe.
