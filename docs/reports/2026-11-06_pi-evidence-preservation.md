---
ctime: 2026-11-06
mtime: 2026-11-06
spdx: GPL-3.0-only
title: Pi evidence preservation
description: >-
  The private Pi integration archive, its minimal catalogue, encrypted R2
  storage, recovery procedure and remaining backup work.
tags:
  - pi
  - evidence
  - operations
---

<!--
   -
   - ~chewygumxx/dorothy.git
   - ::: :/docs/reports/2026-11-06_pi-evidence-preservation.md
   -
   -->

# Pi evidence preservation

## Purpose and scope

The user requested preservation of development data that might be useful
later or expensive to reproduce. Detailed classification and database
querying are deferred. The
[plan](../plans/2026-11-06_pi-evidence-preservation.md) records the approved
private access, existing age recipient and US$5 monthly target.

The archive is `pi-integration-2026-11-06`. Its
[catalogue](./2026-11-06_pi-evidence-preservation/archive.json) records
ordered object names, sizes, SHA-256 hashes and verification status.
Raw private data is stored in the private R2 bucket
`development-archives`, encrypted before upload. The bucket uses Standard
storage in Oceania. Its location is a placement result, not a separate
jurisdictional guarantee.

Preserved content includes:

- The prior plan archive, implementation and review sessions, accounting,
  reports, review packages and 23 historical stewardship rulings.
- All Pi-owned native, smoke and identity trial roots, including failed
  attempts, original prompts, worker histories, interventions and results.
- Relevant Pi job logs/results and controller recovery notes.
- A Git bundle with complete history through Pi closeout merge `350eee86`.
- Downloaded runtimes, plugins and caches retained in this first complete
  capture, without deciding their long-term classification.
- Original SQLite files and sidecars, plus separately mapped, consistent
  recovery copies for the 49 discovered `.sqlite` and `.db` databases.

The payload manifest lists 63,272 files, 74 symlinks and 24,551 directories,
with 3,543,507,422 bytes of regular-file content. The manifest itself is
one additional file. It records paths, content hashes, modes, times and
link targets. Symlinks were preserved without following external targets.
A recovered symlink may still refer to the original machine.

Originals remain in place. Primary source trees received full
before/copy/after comparisons; 122 separately copied log, controller and
bundle files received additional original/copy hash checks. This is an
observed stable capture, not an atomic filesystem snapshot.

## Sensitivity and evidence limits

The local scan checked exact values of nine repository secrets and private
key patterns, without printing values. It found no exact known-secret
match. Eighteen files contained markers from test/log placeholders and npm
documentation; these were adjudicated and retained. No complete age key or
usable complete PEM key block was found among those matches. Selected
source roots excluded the user's decryption key and current Cloudflare
credential configuration.

This scan is not a comprehensive privacy audit and does not unpack nested
archives or Git objects. The raw corpus remains private and encrypted.
Only the catalogue and recovery instructions belong in Git.

Raw SQLite bytes and WAL evidence are retained. Separate recovery copies
were made from private working copies, with regular-file checks on
sidecars and explicit connection closure before inventory. All 49 passed
`PRAGMA quick_check`; discovery by suffix is not exhaustive database
classification. The mapping is inside the archive at
`preservation/sqlite-backups.json`.

The corpus includes configured, operator-assisted experiments. Failed
attempts remain failed or incomplete; retaining them does not turn this
sequence into a controlled model comparison or reliability estimate.

## Storage and recovery verification

On 2026-11-06 at 06:48:51 UTC, recovery from fresh R2 downloads passed.
Every part and the joined ciphertext matched SHA-256 before decryption.
The published Python verifier then checked the complete restored entry
set, file hashes/sizes, entry types and all 74 link targets. It also
rejected a deliberately incorrect manifest hash. All 49 restored SQLite
recovery copies passed `PRAGMA quick_check` with immutable read access.

Public `r2.dev` access is disabled and no custom domain is attached. There
is no expiration rule for completed objects. An indefinite lock protects
the archive prefix against overwrite/deletion while that rule remains in
place; an administrator can remove the rule. The same catalogue is stored
privately as `archive.json` beneath the prefix recorded in the index.

The encrypted bundle is 1,059,741,480 bytes, stored as eight ordered parts.
The complete ciphertext SHA-256 is:

```text
1a2f9fb6bf99af7758afad052798de24764b6ef779ec4bfbb34232a4cb255d36
```

The contained payload manifest SHA-256 is:

```text
a080921fdda180327ccc24b3aea39ad37b4ebaeeaff2e099e13d2b8876f23a5f
```

## Retrieve

Use an authorized Cloudflare account session and the existing repository
age private key. The owner confirms the private key has an off-machine
backup; a local encrypt/decrypt check matched `.sops.yaml`'s recipient.
Private key values never belong in the catalogue, shell arguments or Git.

From the repository root, copy the catalogue into a new private directory:

```sh
mkdir -m 700 recovered-pi
cp docs/reports/2026-11-06_pi-evidence-preservation/archive.json recovered-pi/
cd recovered-pi
wrangler whoami
```

If several Cloudflare accounts are available, set `CLOUDFLARE_ACCOUNT_ID`
to the intended account from `whoami`. Download only the catalogue's
objects and check their hashes before joining them:

```python
import hashlib
import json
from pathlib import Path
import shutil
import subprocess

index = json.loads(Path("archive.json").read_text())
for item in index["objects"]:
    target = Path(item["key"]).name
    subprocess.run([
        "wrangler", "r2", "object", "get",
        index["bucket"] + "/" + item["key"],
        "--remote", "--file", target,
    ], check=True)
    with open(target, "rb") as stream:
        actual = hashlib.file_digest(stream, "sha256").hexdigest()
    if actual != item["sha256"]:
        raise SystemExit("Part checksum mismatch")
with open("archive.tar.zst.age", "wb") as output:
    for item in index["objects"]:
        with open(Path(item["key"]).name, "rb") as part:
            shutil.copyfileobj(part, output)
with open("archive.tar.zst.age", "rb") as stream:
    actual = hashlib.file_digest(stream, "sha256").hexdigest()
if actual != index["cipherSha256"]:
    raise SystemExit("Complete checksum mismatch")
```

Run that Python block with Python 3.11 or later. Then decrypt and extract
into a new directory, preserving links as links. This is a Linux capture;
do not execute captured programs or follow its machine-specific links.

```sh
mkdir -m 700 payload
set -o pipefail
age -d -i ~/.config/sops/age/keys.txt archive.tar.zst.age |
    zstd -d |
    tar --no-same-owner --no-same-permissions --keep-old-files -xf - -C payload
```

Verify the manifest, all recorded files and links, and the entry set:

```python
import hashlib
import json
import os
from pathlib import Path

index = json.loads(Path("archive.json").read_text())
root = Path("payload").resolve()
raw = (root / "MANIFEST.json").read_bytes()
if hashlib.sha256(raw).hexdigest() != index["payloadManifestSha256"]:
    raise SystemExit("Manifest checksum mismatch")
manifest = json.loads(raw)
actual = {str(p.relative_to(root)) for p in root.rglob("*")}
if actual != set(manifest) | {"MANIFEST.json"}:
    raise SystemExit("Missing or extra entries")
for name, entry in manifest.items():
    relative = Path(name)
    if relative.is_absolute() or ".." in relative.parts:
        raise SystemExit("Unsafe manifest path")
    path = root / relative
    if entry["type"] == "symlink":
        valid = path.is_symlink() and os.readlink(path) == entry["target"]
    elif entry["type"] == "directory":
        valid = path.is_dir() and not path.is_symlink()
    else:
        valid = path.is_file() and not path.is_symlink()
        valid = valid and not any(p.is_symlink() for p in path.parents)
        if valid:
            with path.open("rb") as stream:
                digest = hashlib.file_digest(stream, "sha256").hexdigest()
            valid = digest == entry["sha256"]
            valid = valid and path.stat().st_size == entry["size"]
    if not valid:
        raise SystemExit("Entry verification failed: " + name)
print("All manifest entries verified")
```

The manifest excludes itself. Modes and timestamps are recorded for later
recovery; owner identities and privileged permissions are not restored by
these instructions. Normalized SQLite recovery copies can be opened
without the raw WAL arrangement.

## Spending and backup status

The user's target is US$5 per month. This workflow bounds the initial
capture to 4 GiB encrypted and at most 100 logical object commands, uses
private access, and schedules no repeating uploads or automatic deletion.
The actual capture is about 1.06 GB with 18 planned object commands.
Cloudflare SDK retries and other account activity are outside that local
command bound.

R2 Standard currently includes 10 GB-month, one million Class A and ten
million Class B operations monthly. This archive by itself fits those
allowances; this is an estimate, not an invoice or an account-wide limit.
[Pricing](https://developers.cloudflare.com/r2/pricing/)

Cloudflare's budget alerts are informational and do not pause or cap R2
usage. The Wrangler token could not configure alerts, and browser access
was unavailable to the agent. The owner confirmed that both US$2 and US$5
alerts were created in the dashboard. This is owner-confirmed status,
not an independent API inspection.
[Budget alerts](https://developers.cloudflare.com/billing/manage/budget-alerts/)

The local originals and encrypted bundle plus R2 are two storage locations.
There is no third independent backup destination yet. A second directory
on the same disk does not provide that independence. Additional backup
setup remains outstanding; no three-copy protection is claimed.
