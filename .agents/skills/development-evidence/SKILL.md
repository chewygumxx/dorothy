---
name: development-evidence
description: >-
  Use when preserving private development captures, packaging encrypted
  evidence, transferring archive parts to or from R2, or assessing recovery
  and independent backup status.
ctime: 2026-11-06
mtime: 2026-11-06
spdx: GPL-3.0-only
tags:
  - agents
  - evidence
---

<!--
   -
   - ~chewygumxx/dorothy.git
   - ::: :/.agents/skills/development-evidence/SKILL.md
   -
   -->

# Development evidence

Read the maintained [operator
procedure](../../../docs/wiki/topics/development-evidence.md) for capture
selection, safe secret entry, packaging, transfer and recovery examples.
This skill is a navigation and command reference; it grants no additional
permission to access private data or operate cloud services.

From the checkout root, inspect the actual helper interfaces:

```sh
bun scripts/evidence-manifest.ts --help
bun scripts/evidence-package.ts --help
bun scripts/evidence-transfer.ts --help
```

- **Manifest:** create and verify an explicit quiescent staging tree.
  Preserve literal symlinks without following their targets. These checks
  detect observed changes; they are not hostile filesystem confinement.
- **Package:** stream GNU tar through zstd and age. Only native lowercase
  `age1` public recipients are supported. Keep the private key recoverable
  elsewhere. No plaintext archive is written to disk.
- **Transfer:** choose the account and bucket explicitly for both modes.
  Use bucket-scoped S3 Access Key ID and Secret Access Key through the
  repository secret loader. Wrangler OAuth and Cloudflare API tokens do
  not substitute for that pair. Missing credentials mean setup remains
  incomplete; never expose values in argv, logs or conversation.
- **Bounds:** defaults are 128 MiB parts, 4 GiB ciphertext and 100 logical
  store calls. Transfer catalogue metadata has a separate 1 MiB ceiling.
  Ciphertext plus retained parts need approximately twice ciphertext size.
  Logical calls do not cap provider charges or multipart HTTP requests;
  preflight cannot exclude a concurrent remote writer.
- **Completion:** packaging, upload, verified encrypted download and full
  recovery are separate results. Decrypt into fresh owned recovery space
  and verify the payload manifest before considering generated-copy
  cleanup. Helpers retain partial outputs and never delete originals.

Record observations and remaining gaps accurately. Two directories on one
local disk share a failure boundary; a key backup is not a data copy.
Budget alerts are informational. The additional independent backup remains
[high priority](../../../docs/roadmap.md#candidates); do not declare it
complete from local copies and one cloud account.
