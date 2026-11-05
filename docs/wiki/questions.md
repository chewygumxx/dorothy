---
ctime: 2026-11-03
mtime: 2026-11-04
spdx: GPL-3.0-only
title: Questions
description: >-
  Short answers to the questions a reader of this repository asks, each
  linking the page that explains the subject in full.
tags:
  - wiki
  - questions
---

<!--
   -
   - ~chewygumxx/dorothy.git
   - ::: :/docs/wiki/questions.md
   -
   -->

# Questions

[Wiki home](../README.md)

These are questions a reader of this repository asks, answered in a few
sentences each. An answer here is short on purpose: the page it links
explains the subject, and this page does not explain it a second time.
What goes wrong, and how to tell, is on [problems](./problems.md); why a
choice was made is on [decisions](./decisions.md).

## Reading the wiki

### What is the difference between a record and a reference page?

A record is a dated file in `specs/`, `plans/`, `reports/`, `notes/` or
`deferred/`. It says what was true or intended on its day and is never
rewritten, so it may describe what has since changed. A reference page, in
`docs/README.md` or `docs/wiki/`, has a stable name and is kept current: it
says what is true now and links the records as its evidence. When the two
disagree, the page says so and follows the most recent record that
verified the point. The conventions are in
[`docs/AGENTS.md`](../AGENTS.md), and every record is listed once in the
[catalogue](./records.md).

### How do I tell a design from something built?

A spec says what and why; a plan says how; a report says what was done and
checked. A finished plan alone does not make a capability built, and a
spec's existence is not approval of its design. Each topic page marks what
it describes as built (code and tests exist), designed, awaiting a live
check, a dated historical comparison or superseded. For a host, the live
check is a separate state from the code, and
[harnesses](./profiles/harnesses.md) holds it. Only the
[roadmap](../roadmap.md) orders work; its Status lines say what a phase
has reached.

### Where does a subject live?

The [wiki's home](../README.md) lists every page. In brief: how her memory
works is [memory](./topics/memory.md) and how it is measured is
[evaluation](./topics/evaluation.md); her models and fallback are
[models and routing](./topics/models-and-routing.md); the chat is
[the terminal](./topics/terminal.md); how one definition of her reaches a
host is [identity, harnesses and delivery](./topics/identity-and-harnesses.md).
Hosts, protocols, packages and outside services each have a profile under
`profiles/`. A subject has one page that explains it, and the others link
to it.

### Why was a choice made, and who made it?

Look it up on [decisions](./decisions.md), which groups entries under the
seven subjects. Each entry gives the context, the alternatives, the choice
and who chose when the record says, the reason, the cost, whether the
choice still stands, and its sources. Where a record gives no reason or does
not say who ruled, the entry says so. The reports hold the longer rulings
the entries cite.

### What comes next?

The [roadmap](../roadmap.md) alone orders the work: its Ahead section is in
order, and the first item is next. Its Candidates hold the findings not yet
placed, and each topic page's closing section on what awaits, such as
[what awaits](./topics/memory.md#what-awaits) for memory, holds that
subject's remainder. Checks of a host that are still to run are on
[harnesses](./profiles/harnesses.md). The wiki does not reorder or schedule.

## The shape of Dorothy

### What is a package to Dorothy?

Dorothy is eight Bun workspace packages under `packages/`, run from source.
`core` holds the contracts the others meet on and `identity` who she is;
`memory` and `tui` depend on `core` alone, `agent` and `gateway` on those
two and never on each other, `eval` on `core` and `memory`, and `cli` wires
the rest. A package imports only what it declares and exports only the entry
points its `package.json` names, and `workspace.test.ts` pins the graph.
[Packages](./profiles/packages.md) profiles each one and links its guide.

### What is a host, and which hosts does she serve?

A host is a harness that runs a model for someone, such as Claude Code. No
one harness hosts Dorothy: one definition of her is carried into each, and
one memory service serves them all. On 2026-10-19 the user chose Claude
Code, Codex, OpenClaw and Hermes Agent as the four she is provided for and
tested against, and on 2026-11-03 made Pi the highest priority, a fifth.
What each receives, and what has been run against each, is
on [harnesses](./profiles/harnesses.md); how the definition is carried is
under [identity, harnesses and
delivery](./topics/identity-and-harnesses.md#one-definition-of-her).

### Can she run in Pi, and what has been checked?

Yes: `dorothy --pi` runs the published Pi 1.5.0 in its own terminal
interface, under Node 22.19 or later, with her identity, memory tools and
a memory layer before each prompt, on a Featherless model. It was run in a
pseudo-terminal against a scripted provider, and for three requests live,
and merged in #129. Its production wiring has not run: `dorothy --pi
--dump`, then one real launch, is the user's to do. Stewardship's runner
and offline tests are built; its live trial waits on two temporary worker
homes the user signs in and an approved Featherless budget. See
[harnesses](./profiles/harnesses.md#pi), the
[delivery report](../reports/2026-11-03_pi-delivery.md) and the
[stewardship report](../reports/2026-11-03_pi-stewardship.md).

### What is a service or a provider to her?

Two things share the word. Her own memory service is one local process that
speaks the memory contract to every host
([the shared service](./topics/memory.md#the-shared-service)). A model
provider is an outside service her chat or her background reviews send
requests to, through one of five provider kinds
([models and routing](./topics/models-and-routing.md#providers-and-routes)).
The outside services her records weigh, marked used, proposed or compared,
are on [services and providers](./profiles/services-and-providers.md).

### Which protocols does she speak?

MCP for the memory tools, the Anthropic Messages API and OpenAI's Chat
Completions for models, each host's hook payloads for recording, and the
Agent Skills and `AGENTS.md` conventions for guidance. ACP was
weighed for orchestration, and A2A for exposing her as a peer and for
message provenance; neither is in her code. See
[protocols](./profiles/protocols.md).

### Can she run on a local model?

The `local` provider kind is built, for a server on the user's machine. It
has met only the live run's stand-in, as the user has no local model, so it
has not been run on a real one
([models and routing](./topics/models-and-routing.md#not-built)).

## Memory and its measure

### Why did Dorothy keep her own memory engine?

The first evaluation found she found the right conversation and answered
from its note, not the passage holding the fact. The engine's first step
delivered passages, and under the changed judges her strict accuracy rose
from 7 to 43 of 125 questions, past lexical search's 27, with every correct
abstention kept. The user overturned a first ruling on preference answers
before the judges were changed. The entry gives the alternatives and the
condition for reconsidering:
[her engine stays hers](./decisions.md#her-engine-stays-hers).

### What is the difference between finding a conversation and delivering it?

Finding ranks the conversations and knowledge that match a query; delivering
turns the ranked hits into text within a budget, and only that text reaches
the model. She can find a source and still deliver only its note, which was
the failure the first evaluation measured and the engine's first step fixed.
[What `deliver` hands over](./topics/memory.md#what-deliver-hands-over)
explains the step, and
[finding a conversation does not hand over the passage](./problems.md#a-question-she-should-answer-is-declined-though-the-conversation-is-in-her-memory)
what can still go wrong.

### Can I trust the evaluation's figures?

As far as its [limits](./topics/evaluation.md#limits) allow. They are one
user's data, one answering model and one judge; the judges changed between
the first run and the rerun, so earlier figures are not comparable with
later ones; small types are within noise; and the test set is private, so
no one else can rerun it. The current figures are the
[rerun's](../reports/2026-10-31-memory-engine.md#the-rerun), and what they
establish is
[set out on the evaluation page](./topics/evaluation.md#what-the-results-establish).

### Is anything she remembers ever deleted?

Not by design: nothing is forgotten, as a preference. A retired fact sinks
below live facts but stays in the store, in search and in history, and the
data directory is a git repository. The cost is that history and sealed
bundles accumulate without bound, which consolidation and pruning would
address, with a design of their own
([history on the memory page](./topics/memory.md#history),
[the decision](./decisions.md#nothing-is-forgotten-as-a-preference),
[the deferred finding](../deferred/2026-10-08_memory-history-deferred.md)).

## Models and the terminal

### Why does she no longer use Anthropic's Agent SDK?

Her calls went through the Agent SDK, which spawns the Claude Code CLI and
spends a subscription's token. The 2026-11-01 spec gave three reasons: it
tied her to one vendor, it added the CLI's own context to every request, and
it sat outside what Anthropic's terms permit, as the spec read them that day.
She now runs on the Vercel AI SDK. See
[why her own runtime](./topics/models-and-routing.md#why-her-own-runtime)
and, for the context it added,
[the leak report](../reports/2026-10-07-context-leak.md).

### What happens when a model provider fails?

The call moves to the next entry in the role's route, unless the caller
cancelled or the turn has already had effects, once text has streamed or
`remember` has run. A refusal for credit or a rate limit also puts that
provider or model in a cooldown for the process. Each move leaves a note the
chat shows as a warning.
[Fallback](./topics/models-and-routing.md#fallback) explains the rule, and
[a reply that stops part way with an
error](./problems.md#a-reply-stops-part-way-with-an-error) is the case a
reader meets.

### How is the chat different from the one-shot reply?

The chat is the terminal conversation with memory and tools; the one-shot
reply streams a single answer to standard output with no tools, memory or
transcript. `--dump-context` sends the chat's first request to a capture
server and prints it, so it shows exactly what a chat would send. See
[the calls](./topics/models-and-routing.md#the-calls) and
[the terminal](./topics/terminal.md).

## Orchestration and the workflow

### What are the two kinds of orchestration?

One is a feature of Dorothy's own: a toolset by which she would run Claude
Code and Codex workers. It is designed in a spec and not built, and no
roadmap phase orders it. The other is how the agents that develop her are
coordinated today, with herdr, a skill and some scripts, which are in use
and are no part of her application. They are different work, although the
spec places the first as an alternative to the second in time. See
[orchestration](./topics/orchestration.md), which explains both.

### What do I run before committing, and what must I read first?

`bun run check` runs everything CI runs, ending with the tests;
`bun run test` runs the tests alone. Before working in a package, read its
`packages/<name>/AGENTS.md`, and before writing docs, `docs/AGENTS.md`.
Commits are granular Conventional Commits with a header of at most 50
characters. [The checks](./topics/repository-workflow.md#the-checks) lists
what each step does, and
[keeping documentation
current](./topics/repository-workflow.md#keeping-documentation-current) says
what a change must update with it.

### How are secrets handled?

Dorothy's secrets are in `secrets.json`, encrypted by sops to an age key
the user backs up off the machine. An agent edits it only with
`sops edit secrets.json` or core's `saveSecret`, and never prints a value or
puts one in argv or a URL; the pre-commit hook rejects a plaintext value. See
[secrets](./topics/repository-workflow.md#secrets) and, for why dotenvx was
replaced,
[the decision](./decisions.md#secrets-move-from-dotenvx-to-sops-and-age).

## Related

- [Decisions](./decisions.md)
- [Problems](./problems.md)
- [Priorities](./priorities.md)
- [Memory](./topics/memory.md)
- [Models and routing](./topics/models-and-routing.md)
- [Repository workflow](./topics/repository-workflow.md)
