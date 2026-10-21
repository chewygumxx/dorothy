---
ctime: 2026-10-21
mtime: 2026-10-21
spdx: GPL-3.0-only
title: Secrets with sops and age
description: >-
  Design spec for replacing dotenvx, whose private key Dotenvx Armor held,
  with a sops-encrypted secrets.json opened by an age key kept outside the
  checkout.
tags:
  - dorothy
  - config
  - spec
---

<!--
   -
   - ~chewygumxx/dorothy.git
   - ::: :/docs/specs/2026-10-21-sops-secrets-design.md
   -
   -->

# Secrets with sops and age

## Summary

Dorothy's secrets were committed in `.env`, encrypted by dotenvx, whose
private key Dotenvx Armor held: a paid service the user will not keep.
On 2026-10-21 the user chose sops and age to replace dotenvx. The values
were copied that day into `secrets.json`, encrypted by sops to an age
key at `~/.config/sops/age/keys.txt`, and checked equal by hash; nothing
reads that file yet. This spec moves every reader and writer of `.env`
to it, and removes dotenvx.

## Decisions

| Decision | Choice | Why, and the cost if wrong |
| --- | --- | --- |
| Tool | sops 3.13 and age 1.3, declared in `mise.toml` | The user's choice; free, standard, no service. Cost: two binaries on `PATH`, which mise and CI's mise action provide |
| File | `secrets.json` at the checkout's root, a flat map of names to strings | sops encrypts dotenv and YAML comments, which would garble the house header; JSON carries none. Cost: no comments beside a secret |
| Rules | `.sops.yaml` names the recipients for `secrets.json` | sops finds the age recipient itself. Cost: a recipient added means `sops updatekeys` |
| The key | sops's default, `$XDG_CONFIG_HOME/sops/age/keys.txt`, or `SOPS_AGE_KEY_FILE` | No variable of Dorothy's own. Cost: the user backs up one file |
| Where | `secrets.ts` in `core`, which shells out to `sops` | `cli`, `memory` and `eval` all need it and depend on `core`. Cost: `core` spawns a process |
| Precedence | A variable already set is kept | As dotenvx kept it, so an exported key overrides the file. Cost: none |
| Editing | `sops edit secrets.json`, and `sops set --value-stdin` in code | The standard way; no value on a command line. Cost: none |
| Hooks | The launch passes `SOPS_AGE_KEY_FILE`, the key file it found, when unset | A `claude` started with another `XDG_CONFIG_HOME` would lose the key, as it lost dotenvx's session. Only a path travels. Cost: none |
| `.env` | Removed, with `.env.example` and `dotenvx-session.ts` | Nothing reads them. Cost: a stale checkout's `.env` is ignored |
| Guard | The pre-commit hook and `lint:secrets` refuse a plaintext value in `secrets.json`, any `.env` file, and any age secret key | As dotenvx's `protect` refused a plaintext `.env`. Cost: none |

## Reading

`loadSecrets(path, into, run?)` runs `sops decrypt --output-type json`
on `path`, parses the map, and sets each string value whose name `into`
lacks or holds empty. A missing file loads nothing and is no error. A
failure returns a code alone, `SOPS_MISSING`, `SOPS_FAILED` or
`SECRETS_INVALID`, never sops's own message, so a hook's log holds no
fragment of a secret. Its callers:

- `index.ts`'s model modes and the hook's entry, from the checkout's
  `secrets.json`, in place of dotenvx's `config()` and `loadDotenv`.
- `eval`, before a command that calls a model, from its checkout's
  `secrets.json`, so `bunx dotenvx run --` is no longer needed; its
  message for a missing key says `sops edit secrets.json`.

## Writing

`saveSecret(path, name, value, run?)` sets one value: into an existing
file with `sops set --value-stdin <path> '["<name>"]'`, the value JSON
encoded on standard input; into a missing one by encrypting `{name:
value}` from standard input with `--filename-override`, so
`.sops.yaml`'s rule applies, and writing the result privately. `memory`'s
`--mirror` uses it for `DOROTHY_MIRROR_KEY`, its messages naming
`secrets.json` and `sops decrypt --extract '["DOROTHY_MIRROR_KEY"]'` for
the copy kept elsewhere; it requires `secrets.json`'s directory to hold
`.sops.yaml` where it required `.env`.

## Removing dotenvx

`@dotenvx/dotenvx` leaves every `package.json`. `bunfig.toml`'s `[env]
file = false` stays, as does `--no-env-file` for hooks, since a
project's `.env` must still not reach Dorothy's environment; their
comments say so without dotenvx. README, the root and package
`AGENTS.md` files and `.gitignore` describe `secrets.json`, the key and
its backup. Plans and reports already written stay as they are.

## Testing

Tests never read the user's key or `secrets.json`. `core`'s tests make
an age key with `age-keygen` in a temporary directory and point
`SOPS_AGE_KEY_FILE` at it, over a temporary `.sops.yaml` and
`secrets.json`: a load sets missing names and keeps set ones; a missing
file loads nothing; a wrong key and a missing `sops` give their codes
with no sops output; a save creates the file, then changes one value
and keeps the rest. Callers' tests inject the loader and saver, as
`loadDotenv` and `setSecret` were injected.

## Verification

With the real key, `bun run dev -- --mirror` reports the mirror's status
and a one-shot reply decrypts the Claude token; `secrets.json` decrypts
to the three names. The user then cancels Armor and may delete
`~/.config/dotenvx`.

## Out of scope

- Another recipient, such as a second machine's key: `sops updatekeys`.
- A keyring for the age key itself.
