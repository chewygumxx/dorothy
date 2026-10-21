---
ctime: 2026-10-21
mtime: 2026-10-21
spdx: GPL-3.0-only
title: Secrets with sops and age
description: >-
  The move of Dorothy's secrets from dotenvx and Dotenvx Armor to a
  sops-encrypted secrets.json: the migration, the tasks, rulings,
  reviews and verification.
tags:
  - dorothy
  - config
  - report
---

<!--
   -
   - ~chewygumxx/dorothy.git
   - ::: :/docs/reports/2026-10-21-sops-secrets.md
   -
   -->

# Secrets with sops and age

## Summary

Dorothy's `.env` was encrypted by dotenvx, whose private key Dotenvx
Armor held; the user would not keep paying for Armor, and chose sops and
age to replace dotenvx. Following
[the spec](../specs/2026-10-21-sops-secrets-design.md) and
[the plan](../plans/2026-10-21-sops-secrets.md), the secrets now live in
`secrets.json`, encrypted by sops to an age key at
`~/.config/sops/age/keys.txt`, and dotenvx is gone. Codex implemented
Tasks 1 to 4 through herdr; Claude subagents reviewed each task and the
branch; the controller migrated the values and verified with the real
key.

## The migration

Before any code changed, the three values `.env` held
(`CLAUDE_CODE_OAUTH_TOKEN`, `DOROTHY_MIRROR_TOKEN`, `DOROTHY_MIRROR_KEY`)
were decrypted by dotenvx through Armor and piped straight into
`sops encrypt`, so no value touched disk or output. Each was then
compared by SHA-256 between dotenvx and sops: all three matched
(`a8aecd4`). From that commit, losing Armor loses nothing, provided the
age key is backed up.

Two sops behaviours shaped the file. sops encrypts comments in dotenv
and YAML files, which would garble the house header, and its
`unencrypted_comment_regex` leaves the value after a matching comment
in plain text, which a probe with dummy values showed. JSON carries
neither a header nor comments, so the file is `secrets.json`.

## Tasks

| Task | Commits | Review |
| --- | --- | --- |
| 1: `core`'s `loadSecrets` and `saveSecret` | `9b57e88`, `819ccfb` | Approved; minors parked or folded into Task 2 |
| 2: the CLI | `aca2c5a`, `2f11842`, `1fe18d3`, `fd2dee3` | One Important (a load block in triplicate), fixed in one round |
| 3: the mirror and the evaluation | `f1f08a9`, `79e3190` | Approved; minors folded into Task 4 |
| 4: tooling and documents | `0043a0c`, `7045cbb`, `72b733f` | Approved; minors to the final fix pass |

## Rulings

1. The evaluation loads secrets only for commands that call a model, so
   `snapshot`, `mine` and dry or retrieval-only runs never decrypt.
   Cost if wrong: a user exports the key by hand.
2. `saveSecret` refuses a name with brackets or JSON escapes, as sops's
   `set` paths do not unescape them. Cost if wrong: an odd name needs
   another update path.
3. No macOS default key path: sops's own default covers it when
   `SOPS_AGE_KEY_FILE` is unset. Cost: none.
4. The guard matches a real age secret key, `AGE-SECRET-KEY-1` and 58
   Bech32 characters, not the bare prefix, so prose naming the prefix
   stays legal with no exemption. Cost if wrong: a fragment slips past,
   which age could not use anyway.

## Final review

The whole-branch review found one Critical, no Important and ten Minor
points. The Critical: `runSops` spawned `sops` in the caller's working
directory, and mise resolves its shim only inside the checkout, so a
hook or the service started from another project would have loaded no
secret, silently. dotenvx ran in-process and never depended on it; the
plan and the first verification both ran from the checkout, so neither
caught it. `sops` now runs with the checkout as its working directory,
every path made absolute first (`2a82c94`). Of the Minor points, one was
treated as important: after a failed load, `--mirror <url>` could have
made a new `DOROTHY_MIRROR_KEY` over the one in `secrets.json`; it now
refuses, and saves to the checkout's file, not the working directory's
(`89f197f`). The rest, in `c498c42`, removed a dead dotenvx check and
restored the user's wording of rules a budget trim had reworded.

## Verification

With the real key, by the controller: `bun run dev -- --mirror` reported
the mirror's status, and `loadSecrets` on the real `secrets.json`
returned no failure and the three names, at the lengths dotenvx gave,
with every value withheld; after the fix, the same from a process
whose working directory was outside the checkout. Each task review ran
its package's tests; Task 4's ran `bun run check` under temporary XDG
roots: 3,241 passed, one existing skip, none failed; after the final
fixes, 3,247.

## Left to the user

- Back up `~/.config/sops/age/keys.txt` off this machine: without it
  `secrets.json` cannot be read, nor, through `DOROTHY_MIRROR_KEY`, the
  mirror.
- Cancel Armor, and delete `~/.config/dotenvx`, which holds its token.
- Add `OPENROUTER_API_KEY` with `sops edit secrets.json` for the
  evaluation.
