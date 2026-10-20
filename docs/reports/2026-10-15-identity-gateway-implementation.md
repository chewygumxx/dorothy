---
ctime: 2026-10-15
mtime: 2026-10-20
spdx: GPL-3.0-only
title: Dorothy's identity implementation report
description: >-
  How Dorothy's identity was built: the plan's tasks, the rulings made,
  what the probes and the review changed, every commit and what is left.
tags:
  - dorothy
  - gateway
  - report
---

<!--
   -
   - ~chewygumxx/dorothy.git
   - ::: :/docs/reports/2026-10-15-identity-gateway-implementation.md
   -
   -->

# Dorothy's identity implementation report

## Summary

Dorothy is no longer only a chat. Any host can now give a model her
identity, and `dorothy --claude` runs the user's own Claude Code with her
as its main agent:

- **`@dorothy/identity`.** Her identity, voice and provenance as plain
  text, with no dependencies and nothing that varies, so every host
  gives a model the same words and a request keeps its prompt cache.
  Provenance is one stance everywhere: a host's identity line names her
  host, not her, and she answers plainly when asked what runs her.
- **`@dorothy/gateway`.** A loopback stand-in for the API. In a request
  to `/v1/messages` or `count_tokens` whose system prompt carries the
  marker `<!-- dorothy:identity -->`, it puts her identity after the
  client's identity line and removes the marker; everything else it
  forwards byte for byte, streaming replies as they come.
- **`dorothy --claude [args...]`.** Starts the gateway and runs `claude`
  from `PATH` with `ANTHROPIC_BASE_URL` at it, `ENABLE_TOOL_SEARCH=1` and
  the marker appended to its prompt. Subagents build prompts of their
  own, so only the main thread is Dorothy.
- **The chat persona** takes its identity, voice and provenance from the
  package, so she is the same Dorothy in her own TUI. Its tests pin the
  new text byte for byte and lose the checks the pin already made.

- Spec: [`docs/specs/2026-10-15-identity-gateway-design.md`](../specs/2026-10-15-identity-gateway-design.md)
- Plan: [`docs/plans/2026-10-15-identity-gateway.md`](../plans/2026-10-15-identity-gateway.md)
- Probes: [`docs/reports/2026-10-15-identity-gateway.md`](2026-10-15-identity-gateway.md),
  with their summaries in
  [`2026-10-15-identity-gateway/`](2026-10-15-identity-gateway/)
- Roadmap: [`docs/roadmap.md`](../roadmap.md)
- Branch: `feat/identity-gateway`, from `main` at `942cdfa`

The probes changed the launcher, and a fresh reviewer of the whole
branch found three faults worth fixing before merge, all fixed. End to
end against the API, she introduced herself as Dorothy, a second turn
read its prompt from the cache, and a subagent stayed Claude; the first
attempt at those runs, made inside a Claude Code session, wrote into
that session, and the plan's cleanup would have deleted the project's
transcripts (see [Verification](#verification)). At the head of the
branch `bun run check` passes with 1,224 tests across 70 files, up from
1,168 on `main`, in 18 seconds.

## How it was built

**The design** came out of brainstorming on 2026-10-15. Output styles
were ruled out as Claude Code's alone; the user chose a wrapper that
starts a gateway and points `ANTHROPIC_BASE_URL` at it. Of three ways
to tell the main thread from subagents, a marker appended with
`--append-system-prompt` was chosen: only the main thread and its forks
carry it, and the gateway adds rather than replaces, leaving Claude
Code's identity line in place. The phase went ahead of Model Providers.

**The persona draft.** Before planning, the user had reworded the
persona in the working tree: "a warm, curious and accommodating agentic
assistant", in place of "conversational assistant, in the spirit of the
chat experience at <https://claude.ai>". The draft's memory sentence
left a double space when recall was off; the user had a word common to
both branches added ("say"). It was committed on its own first, with
the comma after "Dorothy" restored and identity and voice kept as two
components, before Task 2 moved them into the package.

**The plan's six tasks ran inline**, test first, each ending with
`bun run check` and a commit, then a fresh reviewer read the whole
branch.

1. **The probe.** Claude Code put the marker at the end of its last
   `system` block, as the spec assumed, but kept only the last of two
   `--append-system-prompt` flags: a user's own would have dropped
   Dorothy silently. Three more runs showed the `=` form behaves the
   same and that `--append-system-prompt-file` stacks with the flag.
2. **The identity package**, and the persona built on it.
3. **The rewrite.** The probe showed Claude Code's last block opening
   with a newline, so `unmark` trims only the whitespace next to the
   marker, leaving the block's own ends as sent; a fixture of that shape
   pins it.
4. **The server.**
5. **The launcher**, with `claudeArgs` merging the user's appended text
   into the marker's flag.
6. **Roadmap, reports and verification.** Before any token was spent,
   `dorothy --claude` ran through the built gateway to the probe's
   stand-in, which the gateway took as its upstream: the identity
   arrived as its own block, every breakpoint in place.

## Rulings

### Settled in the plan

- `startGateway` takes `{ upstream }` only. The spec's `log` went: the
  gateway is silent while `claude` runs, and `stats` carries what a log
  would.
- `SIGINT` is ignored while `claude` runs rather than forwarded: the
  terminal already sends it to the whole foreground group, and a second
  one makes Claude Code quit. `SIGTERM` and `SIGHUP` are forwarded.
- A request carrying the marker outside `system`, or with a
  `content-encoding` other than none, `identity` or `gzip`, is forwarded
  unchanged and counted as drift.
- The gateway strips the client's `accept-encoding`, leaving Bun's
  `fetch` to negotiate and decode, and strips `content-encoding` and
  `content-length` from replies.
- `Bun.serve` runs with `idleTimeout: 0`.

### Made during the implementation

- **The persona draft was committed on its own**, as the user asked,
  before the plan's Task 2 absorbed it.
- **The user's `--append-system-prompt` goes with the marker.** The plan
  expected the user's text to survive beside the marker, and would have
  listed a loss as a known limitation; the probe showed the marker was
  what was lost. `claudeArgs` takes the last of the user's (spaced or
  `=`, before any `--`) out of their arguments and passes it in the
  marker's flag, before the marker. `--append-system-prompt-file` needs
  nothing, as it stacks.
- **Only the whitespace next to the marker goes**, not the block's own
  leading and trailing whitespace, so Claude Code's text reaches the API
  as it sent it.
- **`idleTimeout: 0` is kept but no test shows it.** The plan's
  11-second pause passed with it and without it, as Bun 1.4.2 does not
  cut a reply in flight, and cost every test run 11 seconds; the user
  ruled that excessive. The streaming test holds the second event until
  the client has read the first, which fails a buffering gateway, and
  waits for nothing.
- **Commit headers stay within 50 characters**, which commitlint
  enforces; four of the plan's messages were shortened.
- **The core package's guide** said every other package depends on
  `core`; `identity` does not, so it says so.

## Review

A fresh reviewer read the whole branch against the spec, the plan and
the probes, ran `bun run check`, and reproduced each finding with
throwaway scripts. It found the rewrite and its placement right, unmarked
bodies passing byte for byte, replies streaming unbuffered, and
`claudeArgs` and the signal handling as specified.

### The important findings, fixed

- **A dropped reply reached the screen.** When the upstream reset a
  connection mid-stream, Bun printed the failure, five lines, to
  dorothy's stderr: the terminal Claude Code draws on. The gateway now
  wraps each reply's body; on a read error an event stream ends with the
  API's `error` event and anything else simply ends. Run in its own
  process against an upstream that drops mid-body, the gateway wrote
  nothing to stderr.
- **Drift was warned of when nothing had drifted.** The plan counted a
  marker outside `system` as drift, but a conversation quoting the
  marker, as any subagent reading this repository would, carries it in
  its messages. Only a marker in `system` that cannot be placed is drift
  now; one in the messages alone passes as unmarked.
- **`bun run dev -- --claude` would open Claude Code on Dorothy.**
  `bun run` starts a script in this checkout, with the script's `npm_`
  variables set and `node_modules/.bin` entries first on `PATH`. The
  first fix refused a package script; the user pointed out that
  `bun run dev` is how Dorothy is run, so it was made to work instead.
  Bun records the directory it was run from in
  `npm_config_local_prefix`, and prepends its node shim or the project's
  root, then one `node_modules/.bin` for each directory from there up to
  `/node_modules/.bin`. `userShell` gives `claude` that directory, the
  `PATH` after `/node_modules/.bin`, and none of the `npm_` variables, so
  a `node_modules/.bin` of the user's own, later on `PATH`, stays. Run
  from `docs/`, Claude Code started in `docs/` and loaded its
  `AGENTS.md`.

### The minors

Fixed: a client's abort now reaches the upstream before the reply's
headers too; a 502 names the upstream's origin, never credentials in its
URL; the upstream's query joins the request's instead of breaking the
path; the hop headers include `te`, `trailer`, `upgrade`, the proxy
headers and any the `connection` header names; a user's own
`ENABLE_TOOL_SEARCH` stands; the signal comment no longer claims `HUP`
reaches dorothy alone; and the exit code test kills a real child with
`TERM`. New tests cover the emptied first block whose breakpoint moves
to the identity, `HEAD`, and the stripped request headers. Each of the
five new server tests fails against the server as it was.

### Set aside

- **`HTTP_PROXY` and loopback.** Claude Code might send the gateway's
  loopback traffic through a user's proxy; unverified, so `NO_PROXY` is
  left alone and the case is a known limitation.
- **"development mode: The user".** The capital after the colon is the
  user's own wording, accepted with the draft.

## Commits

### Design and plan

```text
9128459 docs: Specify Dorothy's identity and gateway
0cd5702 docs: Correct the spec's account of the persona
308a7ea docs: Plan Dorothy's identity
```

### Tasks

```text
d95b4d2 feat(agent): Make Dorothy an agentic assistant
4b27b80 docs: Probe where Claude Code appends its prompt
7bf5530 feat(identity): Give any host Dorothy's identity
63f669b feat(gateway): Rewrite the marker as her identity
4248504 feat(gateway): Forward requests to the API
61d9178 feat(cli): Add --claude, Claude Code as Dorothy
fd866f6 docs: Amend the identity spec with what was found
```

### Review fixes, and the user's corrections

```text
2c0aef8 fix(gateway): Count drift only in system
0de2653 fix(gateway): Keep a dropped reply off the screen
ef6a65f fix(cli): Refuse --claude from a package script
8fb3f49 docs: Explain dorothy --claude in the README
f8be710 test(gateway): Stream without an 11-second pause
d5e7394 fix(cli): Run --claude where bun run was run
```

This report and the roadmap came in `docs: Report Dorothy's identity`,
and were revised for the end-to-end runs in one more commit.

## Verification

- `bun run check` at the head: typecheck, format, lint, Markdown, YAML,
  env, em dash and header checks, and 1,224 tests across 70 files, none
  failing, in 18 seconds.
- Without tokens, through the real chain: `claude` 2.1.296 run by
  `dorothy --claude -p --no-session-persistence hi` from an empty
  directory, with `ANTHROPIC_BASE_URL` at a stand-in the gateway took as
  its upstream. The stand-in received Dorothy's identity as its own block
  after the identity line, the marker gone, both one-hour breakpoints in
  place; with `--append-system-prompt 'probe-user-text'`, the user's text
  too. No drift warning. See the
  [probes](2026-10-15-identity-gateway.md#through-the-gateway).
- `dorothy --claude --version` printed Claude Code's version and exited
  0; with no `claude` on `PATH`, it said so and exited 127.
- End to end against the API, on the user's login, from an empty
  directory; the answers and token counts are in the
  [probes](2026-10-15-identity-gateway.md#end-to-end). She introduced
  herself as Dorothy; asked what runs her, she answered plainly; the
  second turn read 15,131 tokens from the cache and wrote 298; a
  general-purpose subagent called itself Claude. No drift warning.

### The end-to-end runs went wrong first

The first attempt ran inside this session's own shell, whose
`CLAUDE_CODE_PROJECT_DIR_NAME` and `CLAUDE_CODE_SESSION_ID` every child
inherits. Its first run's transcript went into the repository's own
project, and the plan's `-c` then continued the most recent session
there: the live session building this branch. It answered from that
conversation, wrote 215,115 tokens to the cache, and appended a turn
to that session's transcript, which is the user's to keep or trim. It
did show the spec's resumed-session risk: a session started without
the marker and resumed through the gateway has no identity.

The plan's cleanup, `claude purge "$D" --yes`, would have been worse.
Its dry run, inheriting the same variable, listed the repository's
whole project, every Dorothy session's transcripts, for deletion. It
was not run. The runs were repeated with the session's `CLAUDE_CODE_`
variables unset and `--resume <id>` in place of `-c`, and only the
test runs' own transcripts were removed, by hand.

## Known limitations

Forks, interactive sessions and the HTTP proxy probe.
Closed by the roadmap sweep: see
[the sweep report](./2026-10-19-roadmap-sweep.md). Remaining limits
are recorded there.

- **Forks** were not observed: a fork needs a model reply, which the
  probes' stand-in never gives. If a fork drops the marker it runs as
  plain Claude Code, and nothing breaks.
- **Resumed sessions.** Claude Code records a conversation's system
  prompt on its first request. A session started without
  `dorothy --claude` and resumed with it carries no marker, so no
  identity; one started with it and resumed in plain `claude` sends the
  marker, an HTML comment, through to the API.
- **Interactive sessions** were probed only through `-p`; the gateway
  does not depend on the identity line's wording, only on its position.
- **The identity line stays.** "You are Claude Code" still opens the
  prompt; provenance tells her it names her host.
- **A user's `HTTP_PROXY`** may carry Claude Code's requests to the
  loopback gateway through the proxy; not verified.
- **Run from inside a Claude Code session**, as from its Bash tool,
  `claude` inherits that session's `CLAUDE_CODE_` variables, and its
  sessions land in the outer session's project. `--claude` passes them
  on, as `claude` would be run there anyway.
- **Claude Code's requests may change.** The marker fails safe, without
  the identity and with nothing broken, and the drift warning after
  `claude` exits reports a marked request the gateway could not rewrite.
