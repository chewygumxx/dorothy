---
ctime: 2026-10-07
mtime: 2026-10-07
spdx: GPL-3.0-only
title: Context leak findings
description: "What the Agent SDK's CLI adds to Dorothy's context, where it comes from, and what was fixed"
tags:
  - dorothy
  - sdk
  - report
---

<!--
   -
   - ~chewygumxx/dorothy.git
   - ::: :/docs/reports/2026-10-07-context-leak.md
   -
   -->

# Context leak findings

## Summary

The Agent SDK spawns its bundled `claude` CLI for every `query()`, and the CLI
adds context of its own to every request, whatever `systemPrompt` and
`settingSources: []` say. Probing for it while building Recall found two
leaks: the user's email address, and Claude Code's auto-memory for the
working directory, which in this repository is the coding agent's notes on
developing Dorothy, introduced as instructions that "OVERRIDE any default
behavior". A third addition, an environment message after every user turn,
turned out larger than this repository's notes described: run from a git
worktree, it carried Claude Code's worktree and `git stash` instructions.

Asked directly, Dorothy confirmed all of it, and declined only to name her
model, as her persona tells her to.

The fix (`850fbd4`) runs the CLI in a private home and disables auto-memory.
The email, the auto-memory and everything derived from the repository are
gone; an environment message with the platform, model, a token budget and
the date remains, and only the move to the Messages API removes it.

## How it was found

The CLI honours `ANTHROPIC_BASE_URL`. A throwaway probe pointed it at a local
`Bun.serve` that records the body of each `POST /v1/messages`, never the
headers, and answers 400, so nothing reaches the API and no tokens are spent.
The probe ran `query()` with Dorothy's own `baseOptions` and the prompt `hi`,
then searched the captured request. It ran with this Claude Code session's
environment and with every `CLAUDE_CODE_*` variable but the OAuth token
removed, to match a plain shell; the results agreed.

## What the CLI sends

| Part of the request                       | Contents                                                          | Seen by the model |
| ----------------------------------------- | ----------------------------------------------------------------- | ----------------- |
| `system[0]`                               | `x-anthropic-billing-header: cc_version=…; cc_entrypoint=sdk-ts;` | yes               |
| `system[1]`                               | "You are a Claude agent, built on Anthropic's Claude Agent SDK."  | yes               |
| `system[2]`                               | Dorothy's persona, memory block and history                       | yes               |
| `messages[0]`, before the user's text     | a `<system-reminder>` with auto-memory, another with `userEmail`  | yes               |
| `messages[1]`, role `system`              | the environment message (below)                                   | yes               |
| `max_tokens`, `thinking`, `output_config` | 128000, adaptive, effort `medium`                                 | no                |
| `cache_control`                           | `{"type": "ephemeral", "ttl": "1h"}` on three blocks              | no                |
| `safeguards[0].classifier_context`        | permission rules, trusted directories, git state                  | no                |

The environment message, as sent from a worktree before the fix:

```text
# Environment
You have been invoked in the following environment:
 - Primary working directory: /home/…/dorothy/.claude/worktrees/context-leak
 - This is a git worktree … (instructions to stay inside it)
 - The git stash stack is shared with the main checkout and all other
   worktrees, … (about 120 tokens of stash instructions)
 - Is a git repository: true
 - Platform: linux
 - Shell: zsh
 - OS Version: Linux 7.2.8-arch1-2

You are powered by the model named Sonnet 5.5. …

<total_tokens>15000000 tokens left</total_tokens>

Today's date is 2026-10-07.
```

## Sources and fixes

| Addition                                       | Source                                                      | Why `settingSources: []` misses it | Fix                                                                |
| ---------------------------------------------- | ----------------------------------------------------------- | ---------------------------------- | ------------------------------------------------------------------ |
| The user's email                               | `oauthAccount` in `.claude.json` under `$CLAUDE_CONFIG_DIR` | global config, not a settings file | `CLAUDE_CONFIG_DIR` set to a private home                          |
| Auto-memory                                    | `MEMORY.md` of the working directory's repository           | auto-memory has its own switch     | `CLAUDE_CODE_DISABLE_AUTO_MEMORY=1`, and the private home as `cwd` |
| Working directory, git and worktree lines      | the working directory                                       | not a setting                      | the private home as `cwd`                                          |
| Platform, shell, OS, model, token budget, date | the CLI itself                                              | not a setting                      | none under the Agent SDK                                           |

`cliOptions()` (`src/persona.ts`) returns the home,
`$XDG_CACHE_HOME/dorothy/claude`, as both `cwd` and `CLAUDE_CONFIG_DIR`, with
auto-memory disabled; `Conversation`, the review and one-shot spread it into
their options. It is a function, not part of `baseOptions`, because the
entry guard decrypts `.env` with dotenvx after the modules are imported: an
environment captured at import would lack the OAuth token. The entry guard
creates the home 0700, like the recall index beside it, since the CLI cannot
start in a missing working directory and would create it 0755.

Ruled out:

- **`--bare`** (`CLAUDE_CODE_SIMPLE`) turns off auto-memory and more, but
  ignores OAuth tokens, so with `CLAUDE_CODE_OAUTH_TOKEN` the CLI never sent a
  request.
- **Disabling auto-memory alone** leaves the email.
- **A private config directory alone** leaves the auto-memory, which follows
  the working directory's repository, not the config directory.
- **`excludeDynamicSections`** applies only to the `claude_code` preset, not
  to a custom system prompt.

## Verification

- `bun run check`: 572 tests, including `cliOptions`, `prepareCliHome` and
  the options of `Conversation` and the review.
- The probe with the fix: the first user message is only `hi`; the
  environment message names the private home, `Is a git repository: false`,
  and no worktree text; no email, auto-memory or repository path anywhere in
  the messages. Two runs over one persistent home, with nonessential traffic
  allowed, never stored an `oauthAccount`, so the email cannot return later.
- Asked the same question as before, one-shot Dorothy saw neither the notes
  nor the email.
- After a real run the home holds `.claude.json`, `remote-settings.json`,
  `policy-limits.json`, `backups/` and `sessions/`, and no account.

## Notes

- **`total_tokens` is not `max_tokens`.** `max_tokens` (128000) caps one
  response's output. `<total_tokens>N tokens left</total_tokens>` is an
  internal Claude Code setting for agent sessions, a budget across a whole
  session that counts down as work proceeds (this agent's own counter read
  14,995,848 while Dorothy's read 15,000,000). It means nothing to a chat
  and costs tokens on every request.
- **The one-hour cache is the CLI's choice for subscribers.** With an OAuth
  subscription and no overage, requests from the SDK get a `1h` TTL; on
  overage, or with an API key, `5m`. `FORCE_PROMPT_CACHING_5M` and
  `CLAUDE_CODE_PROMPT_CACHE_TTL` override it. A one-hour write costs twice
  the base input price against 1.25 times for five minutes, while reads cost
  the same; at the pace of a chat, where a reply often takes longer than
  five minutes, the one-hour cache is usually the cheaper.
- **The environment message follows each user turn,** outside the cached
  prefix, so its tokens are paid at the full input price on every request.
- **Dorothy passes her whole environment to the CLI.** Launched from inside a
  Claude Code session, that includes the session's own `CLAUDE_CODE_*`
  variables. No effect on the context was found, but the CLI reads many of
  them.

## Follow-ups

- `--dump-context`: print the exact request Dorothy would send, so a check
  like this one needs no throwaway probe.
- A prompt built from components by purpose (identity, voice, capabilities,
  plumbing, provenance, memory behaviour), with a development mode that drops
  the provenance rule, so Dorothy can be asked directly about her context.
- The move to the Messages API, the only way to remove the CLI's identity
  line and environment message.
