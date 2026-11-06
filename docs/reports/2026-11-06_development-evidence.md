---
ctime: 2026-11-06
mtime: 2026-11-07
spdx: GPL-3.0-only
title: Development evidence helper implementation
description: >-
  Synthetic verification, operator reference comparison and limits of the
  manifest, encrypted packaging and scoped R2 transfer helpers.
tags:
  - evidence
  - verification
  - operations
---

<!--
   -
   - ~chewygumxx/dorothy.git
   - ::: :/docs/reports/2026-11-06_development-evidence.md
   -
   -->

# Development evidence helper implementation

The [operator procedure](../wiki/topics/development-evidence.md) now
explains implemented commands for explicit staging manifests, streamed
encrypted packaging and scoped R2 transfer. The repository-owned
[development evidence skill](../../.agents/skills/development-evidence/SKILL.md)
is a concise navigation and command reference, discoverable through the
existing Claude and Codex skill layout. It replaces no retention decision
and authorizes no additional private-data or cloud operation.

The [design](../specs/2026-11-06_development-evidence.md) and
[plan](../plans/2026-11-06_development-evidence.md) define this bounded
Linux workflow. The existing Pi manifest and catalogue formats remain
readable and their evidence is unchanged. No real credential, private
archive or live R2 operation was used to validate these helpers.

## Implemented behavior

- `scripts/evidence-manifest.ts` creates an exclusive private
  `MANIFEST.json` and verifies its pinned digest and complete payload
  entry set. Files have byte counts and SHA-256 digests; directories and
  literal symlink targets remain distinct entries. It streams file hashes
  and checks observed changes without following symlink targets. Numeric
  Pi nanosecond metadata stays readable; restored modes and timestamps
  need not match.
- `scripts/evidence-catalogue.ts` validates normalized relative prefixes,
  unique safe object keys and basenames, byte totals and hashes, retaining
  unknown metadata and object order. The controller also parsed the
  committed sanitized Pi catalogue: eight objects valid, metadata retained.
  That was a catalogue-only compatibility check, not private archive access.
- `scripts/evidence-package.ts` verifies staging, streams GNU tar through
  zstd and age, bounds ciphertext writes, hashes and splits ciphertext,
  and verifies staging again before writing a completed catalogue with
  status `packaged`. Only native lowercase `age1` public recipients are
  supported. No plaintext archive is written to disk.
- `scripts/evidence-transfer.ts` requires an explicit account and bucket
  in both modes. The bucket must match a trusted catalogue; account or
  endpoint metadata cannot redirect the client. Local validation and
  planned call admission precede secret loading and store construction.
  The loader's selected S3 credential pair alone reaches the adapter with
  the account and bucket; nonempty environment values retain precedence.
  Wrangler OAuth and Cloudflare API tokens are not S3 credential fallback.
- Upload preflights all keys, retains input checks across phases, sends
  parts in catalogue order and sends catalogue bytes last. Download
  exclusively creates private part files, verifies each part and the
  combined ciphertext, then retains the exact trusted catalogue. Neither
  mode decrypts, extracts, deletes originals or cleans remote partials.
- `scripts/evidence-r2.ts` is a thin Bun S3 adapter with an account-derived
  HTTPS endpoint, selected credentials, empty session token and retry zero.
  External failures return safe codes, without SDK messages or secrets.

Defaults are 128 MiB parts, 4 GiB ciphertext and 100 logical store calls.
Transfer catalogue metadata has a separate 1 MiB ceiling. Keeping joined
ciphertext plus parts needs about twice ciphertext size plus metadata.
These are byte and logical-call admission limits, not provider bill caps
or bounds on multipart HTTP traffic or other account usage.

## Helper test evidence

The following task-level results were recorded during implementation,
before the final integrated checks below. They use synthetic temporary
trees, injected process or secret adapters and loopback HTTP services.
No test relies on real user roots, archive bytes, keys or cloud services.

### Manifest

Command:

```sh
bun test scripts/evidence-manifest.test.ts
```

After tightening negative assertions against throwing stubs, RED was
0 pass, 27 fail, 20 assertions, exit 1. Expected failures included
`EVIDENCE_NOT_IMPLEMENTED` in place of manifest behavior and error codes.
The first GREEN was 27 pass, 0 fail, 50 assertions. Three subsequent
characterization cases brought the final task result to 30 pass, 0 fail,
56 assertions. They cover multi-buffer hashes, numeric metadata and a
later change to an earlier file. Task typecheck and scoped Biome passed.

### Catalogue and packaging

Command:

```sh
bun test scripts/evidence-catalogue.test.ts scripts/evidence-package.test.ts
```

Initial RED was 36 pass, 14 fail, 89 assertions against unimplemented
stubs, exit 1. Some negative assertions initially accepted any exception;
they were later tightened to `EVIDENCE_INVALID_CATALOGUE`. This report
makes no claim that every negative case individually failed initially.
A separate malformed native-recipient RED was 14 pass, 1 fail: invalid
public-looking input had reached the injected age process. The narrow
native checksum validator corrected it before output creation.
Final GREEN was 52 pass, 0 fail, 194 assertions. Typecheck and Biome passed.

Task 2 also recorded an actual synthetic round trip with GNU tar 1.35,
zstd 1.5.7 and age 1.3.2, using an ephemeral identity held in memory.
The actual temporary driver command was:

```sh
mise exec conda:zstd@1.5.7 -- bun /tmp/dorothy-task2-recovery.ts
```

This task-level driver is not a maintained helper. It exercised the
package CLI with 128-byte parts and a 65536-byte encrypted limit. It
produced 1954 encrypted bytes in 16 parts. Ordered part and combined
hashes matched; decryption, decompression and extraction each exited 0.
The recovered and retained source trees both passed manifest verification:
two files, two literal symlinks, one directory and 1047 payload bytes.
This was a synthetic local recovery, not recovery of the real Pi archive.
`mise.toml` pins `conda:zstd` 1.5.7; GNU tar remains a system prerequisite.

### Transfer policy and S3 adapter

Commands:

```sh
bun test scripts/evidence-transfer.test.ts
bun test scripts/evidence-r2.test.ts
```

Transfer scaffolding RED was 4 pass, 7 fail, 55 assertions with
`EVIDENCE_UNIMPLEMENTED`; adapter RED was 0 pass, 3 fail. Initial combined
GREEN was 14 pass, 0 fail, 106 assertions. Additional RED cases exposed a
catalogue larger than a tiny ciphertext allowance (3 pass, 1 fail) and
input mutation before catalogue completion (15 pass, 1 fail). Separate
metadata bounds and repeated input verification corrected those cases.

The final focused transfer and adapter run was 20 pass, 0 fail,
161 assertions. The combined five evidence suites recorded 102 pass,
0 fail, 411 assertions. Typecheck and scoped Biome passed afterward.
The actual Bun S3 client contacted only temporary `127.0.0.1` servers
with dummy credentials. Tests observed HEAD, PUT and GET, matching bytes,
no session token and one request for each failed call without retry.
The production account-derived endpoint is asserted through the injected
client factory. Stream-limit tests retain bounded partial ciphertext.
These tests do not validate live R2 authentication or multipart uploads.

## Operator reference comparison

Before skill writing, a separate evaluator answered three read-only
synthetic requests using maintained documentation alone. The same request
text was reused unchanged in the assisted evaluation:

1. Missing S3 credentials despite Wrangler OAuth and an API token.
2. Successful upload with no downloaded or decrypted recovery evidence,
   under disk pressure.
3. Two local directories on one disk, one R2 bucket, a Proton Pass key
   backup, and US$2/US$5 budget alerts.

All three baseline decisions were correct. The evaluator rejected wrong
credential substitution, kept recovery and cleanup incomplete, and
identified the independent data backup gap. It could not retrieve exact
reusable commands because the maintained page still described helpers as
proposed. This is a navigation/reference improvement; no baseline safety
failure or behavioral RED is invented.

A fresh evaluator then answered the same three supplied requests using
the skill, maintained guide and actual helper `--help`, without reading
implementation briefs, expected answers, baseline output or task reports.
The controller inspected all responses. All three assisted decisions
were correct, matching the three correct baseline decisions:

| Scenario | Baseline | With skill and current guide |
| --- | --- | --- |
| A: Missing S3 pair | Setup incomplete; OAuth/API token insufficient | Same ruling; retrieves SOPS entry and supported upload template |
| B: Uploaded only | Recovery incomplete; no cleanup justified | Same ruling; retrieves download, recovery and manifest commands |
| C: Backup inventory | Independent data backup outstanding | Same ruling; identifies separate access and failure boundaries |

The assisted responses selected explicit account and bucket arguments for
upload and download, distinguished encrypted download from full recovery,
included pipeline failure checking and complete manifest verification,
and explained disk space for retained parts plus joined ciphertext.
No behavioral failure or measured safety correction occurred. The
observed benefit is retrieval of supported commands and concrete limits.
The exercise measured neither completion time nor reliability in real use.
Only these actual helper commands were run by the assisted evaluator,
all exiting zero:

```sh
bun scripts/evidence-manifest.ts --help
bun scripts/evidence-package.ts --help
bun scripts/evidence-transfer.ts --help
```

The SOPS, upload, download and recovery commands in the responses were
proposed operator steps only. Neither evaluator accessed credentials,
private evidence or live services or changed the checkout. The detailed
scenario responses remain in the local development ledger; this report
retains their sanitized findings rather than private operational data.

## Asset discovery RED and GREEN

Before adding the skill, ignore exceptions, Claude link or `OWN` entry:

```sh
bun test agents.test.ts
```

RED: 94 pass, 1 skip, 3 fail, 223 assertions, exit 1. Failures were the
missing owned declaration, missing skill directory/link, and missing
frontmatter/reference asset. The existing tests still passed. After the
asset and discovery wiring were added, the same command produced 97 pass,
1 skip, 0 fail, 242 assertions, exit 0. The skip is the absent optional
remote `code-simplification` skill. Frontmatter validation was subsequently
strengthened to parse YAML and check house fields directly.

The generic skill-creator `quick_validate.py` was run on the skill. It
rejects `ctime`, `mtime`, `spdx` and `tags` as unexpected top-level keys;
its standard schema permits only name, description, license, metadata
and allowed-tools. This is a validator/schema incompatibility, not a
passing generic validation. House provenance is deliberately retained.
Repository asset, parsed YAML frontmatter, local link, header and docs
checks provide the applicable validation instead.

## Rulings and remaining work

- Inputs are explicitly staged, stable and quiescent. Repeated path and
  open-handle checks detect observed mutation; they are not atomic
  filesystem snapshots or hostile-filesystem confinement. A malicious
  concurrent ancestor swap or SDK read race is outside the accepted scope.
- Remote HEAD preflight cannot prevent a concurrent writer before PUT.
  Operators need exclusive capture prefixes. No mutation retry, remote
  cleanup, cloud administration, source discovery or scheduling was added.
- Partial outputs are retained and remain incomplete. No helper deletes
  originals, performs extraction or declares full recovery from upload.
- Credential creation/population is separate operator work. No real
  secret entry or live authentication validation took place in this work.
- The existing Pi evidence and accepted native run retain their original
  evidentiary limits. Catalogue readability does not extend those claims.
- Two local directories share a disk failure boundary. Proton Pass backs
  up a key, not archive data. Spending alerts do not stop usage. The
  additional independent backup destination remains the existing
  [high-priority candidate](../roadmap.md#candidates), with no new setup
  or completion claim in this work.

## Final integrated verification

After the independent assisted comparison, the finished integrated tree
ran this command once:

```sh
bun run check
```

Exit 0. Typecheck, formatting, lint, Markdown, YAML, secret scanning,
em-dash scanning, header validation and the complete test suite passed.
The final test result was:

```text
4688 pass
1 skip
0 fail
149867 expect() calls
Ran 4689 tests across 222 files. [164.04s]
```

The skip is the absent optional remote `code-simplification` skill. Biome
reported one existing nonfailing `lint/style/useTemplate` information item
in `packages/memory/src/memory/reviewer.test.ts`. Header validation parsed
820 files, with zero out-of-sync breadcrumbs, 776 correct and 44 existing
missing-header notices; zero files were unreadable and five were skipped.
No unrelated file was changed to silence these notices.

Focused integrated evidence checks also ran before that final check:

```sh
bun test scripts/evidence-manifest.test.ts \
  scripts/evidence-catalogue.test.ts scripts/evidence-package.test.ts \
  scripts/evidence-transfer.test.ts scripts/evidence-r2.test.ts
bun test agents.test.ts docs.test.ts header.test.ts
bun run typecheck
bunx biome check agents.test.ts
```

Results: 102 pass, 0 fail, 411 assertions across five evidence files;
107 pass, 1 skip, 0 fail, 269 assertions across three asset/docs/header
files; typecheck exit 0; Biome checked one file with no fixes, exit 0.
Scoped remark and markdownlint checks on every changed Markdown file
also exited 0 before the full check. All three helper help commands exited
0 and performed no operations.

Before the post-review correction below, only this report's text changed
after the full check to record actual results. The final documentation
checks rerun `bun run lint:md`,
`bun run lint:emdash`, the three asset/docs/header suites, and
`git diff --cached --check`; all exit 0. The test result remains 107 pass,
1 skip, 0 fail, 269 assertions. The full repository check is not repeated
for this report-only update. The separate generic skill schema rejection
above remains explicitly recorded and is not covered by the repository
checks' passing result.

## Post-review correction: 2026-11-07

Packaging now applies the existing transfer bucket-name policy before
creating output or invoking processes. Both workflows share the predicate
in the independent catalogue module. Historical catalogue parsing still
accepts legacy bucket spellings and retains unknown metadata.

```sh
bun test scripts/evidence-catalogue.test.ts \
  scripts/evidence-package.test.ts scripts/evidence-transfer.test.ts
bun run typecheck
bunx biome check scripts/evidence-catalogue{,.test}.ts \
  scripts/evidence-package{,.test}.ts scripts/evidence-transfer{,.test}.ts
```

The new packaging regression first failed because `Archive` completed
packaging: 70 pass, 1 fail, 346 assertions, exit 1. After the correction,
the same three suites passed: 71 pass, 0 fail, 342 assertions, exit 0.
They also cover valid destinations, legacy catalogue compatibility and
transfer rejection before credentials. Typecheck and scoped Biome exited
0; Biome checked six files without fixes. Tests used temporary synthetic
fixtures and injected processes, with no real keys, archive or cloud call.
The local full check recorded above preceded this code correction and
was not repeated. Normal PR CI must validate the final fixed head.
