---
ctime: 2026-10-15
mtime: 2026-10-15
spdx: GPL-3.0-only
title: "Conversation with Claude: OpenClaw and Hermes Agent"
description: >-
  Claude's web-searched comparison of OpenClaw and Hermes Agent as hosts for a
  personal agent: memory, skills, OAuth and Claude Code runtimes.
tags:
  - dorothy
  - openclaw
  - hermes-agent
  - claude-code
  - notes
---

<!--
   -
   - ~chewygumxx/dorothy.git
   - ::: :/docs/notes/2026-10-15_claude-conversation-openclaw-hermes-agent.md
   -
   -->

# Conversation with Claude: OpenClaw and Hermes Agent

Exported on 2026-10-15 from a
[shared claude.ai conversation](https://claude.ai/share/5402ed59-3392-404e-83cd-86635bf963a0).
Its claims come from web search and were not verified; the
[objectives report](../reports/2026-10-15-objectives.md) takes from it what
bears on Dorothy.

## chewygumxx Prompt 1

Please compare OpenClaw and and Hermes Agent

---

## Claude Response 1

I’ll look up the current state of both projects and compare them.

> _Searched the web, read a page_

### The short version

Both are MIT-licensed, self-hosted personal agents that run on your own machine
or server and talk to you through chat apps. The difference is how they grow.
OpenClaw extends itself through skills that humans write and share on ClawHub,
whereas Hermes picks up new abilities by reflecting on its own work. In
practice, OpenClaw is the broader orchestration platform, and Hermes is the
leaner single agent that gets better the longer you use it.
[antropy](https://www.antropy.co.uk/blog/openclaw-vs-hermes/)

### At a glance

|                    | OpenClaw                                                                             | Hermes Agent                                                                                                                        |
| ------------------ | ------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------- |
| **Origin**         | Peter Steinberger; previously called Clawdbot and then Moltbot                       | Nous Research, released under MIT in February 2026                                                                                  |
| **Steward**        | OpenClaw Foundation, a U.S. 501(c)(3) non-profit                                     | Nous Research, venture-backed                                                                                                       |
| **Code execution** | JavaScript Code Mode on Node or QuickJS                                              | Python in a local child process or a configured terminal backend                                                                    |
| **Skills**         | Human-authored, distributed via ClawHub                                              | Auto-generated: novel task procedures are captured as reusable skills                                                               |
| **Sandboxing**     | Sandbox, node, or cloud-worker execution available, but sandboxing is off by default | Five isolated environments: local, Docker, SSH, Singularity and Modal                                                               |
| **Monetisation**   | Donation-funded, with no paid tier, hosted service, or token                         | Hosted tiers priced from $20 to $200 a month                                                                                        |
| **Latest found**   | Stable 2026.9.6, published 23 September 2026                                         | v0.21.0, tracking upstream release v2026.8.31 [OpenClaw Remains Open Source Despite OpenAI Tie-Up](https://www.opensourceforu.com/) |

### Philosophy and architecture

OpenClaw thinks in terms of an organisation of agents. It offers multi-agent
routing, where inbound channels go to isolated agents that each have their own
workspace and sessions, and its sub-agent orchestration lets a primary agent
spawn isolated background workers for parallel research and long jobs, which
Hermes does not match feature for feature. It also runs Codex app-server, the
Copilot SDK and the Claude Code CLI as native runtimes. The cost is weight: its
roughly 1.5M-line codebase was refactored into a plugin architecture in April,
and it can feel heavy once integrations, skills and background workflows pile
up. [openclaw vs hermes](https://www.antropy.co.uk/blog/openclaw-vs-hermes/)

Hermes centres on a single agent that improves over time, though it is not
single-agent only: its May “Velocity” release turned its Kanban feature into a
multi-agent platform. Composio’s hands-on review concluded that OpenClaw wins on
multi-agent and multi-channel work while Hermes wins on background execution.
[OpenClaw vs Hermes Agent: The best agent harness in 2026](https://composio.dev/blog/openclaw-vs-hermes-agent)

### Memory

Hermes keeps a curated memory of your preferences, projects, environment and
lessons learned across sessions. OpenClaw has invested heavily here too, with a
/dreaming feature that consolidates memory in Light, Deep and REM phases into a
human-readable DREAMS.md diary.
[respan](https://respan.ai/market-map/compare/hermes-agent-vs-openclaw)
[thursdai](https://thursdai.news/companies/openclaw)

The differences show up in provenance. According to OpenClaw’s own comparison
page (so read with that bias in mind), OpenClaw tracks session origins, gates
memory by trust, and keeps attributable purge records, whereas Hermes stores
plain string entries without source-session lineage or deletion tombstones, and
autonomous writes are on by default with an optional approval gate. Reviewers
lean the other way on usability: Composio gave the memory verdict to Hermes,
citing its tiered retrieval and visible context usage.
[openclaw and hermes agent](https://docs.openclaw.ai/start/why-openclaw/openclaw-and-hermes-agent.md)

### Ecosystem and channels

OpenClaw has the bigger ecosystem and channel catalogue. Hermes supports 16 or
more platforms, a solid range but narrower than OpenClaw’s, and its
plug-and-play ecosystem is smaller for now. Switching costs are real: moving
from OpenClaw to Hermes means giving up the ClawHub skills you rely on and
rebuilding that behaviour through Hermes’s learning loop, which takes time.
[openclaw vs hermes agent](https://toolradar.com/compare/openclaw-vs-hermes-agent)

Hermes has been closing the gap quickly. v0.20.0 shipped on 3 August with
streaming conversational voice, on-device wake words, and an agent-to-agent
protocol, and raised the default tool-iteration ceiling from 90 to 500 for long
autonomous runs.
[runtimewire](https://runtimewire.com/article/nous-research-hermes-agent-v0200-voice-a2a)
[runtimewire](https://runtimewire.com/article/nous-research-hermes-agent-v0200-voice-a2a)

One informal benchmark worth noting: on the same task, the OpenClaw agent used
about 35k tokens versus about 52k for Hermes, though the reviewer wondered
whether Hermes’s self-improvement would make it more efficient over time.
[antropy](https://www.antropy.co.uk/blog/openclaw-vs-hermes/)

### Security posture

Neither is safe to expose carelessly, but their histories differ.

OpenClaw’s openness bit it early. Koi Security audited all 2,857 ClawHub skills
and found 341 malicious ones, after which OpenClaw partnered with VirusTotal to
scan uploads and re-scans active skills daily. Its strengths now are structural:
configured per-person role ceilings, SecretRefs and egress sentinels.
[Hundreds of Malicious Skills Found in OpenClaw’s ClawHub | eSecurity Planet](https://esecurityplanet.com/threats/hundreds-of-malicious-skills-found-in-openclaws-clawhub)

Hermes avoids a third-party marketplace as its primary growth path, but has
weaker multi-user boundaries. It treats all authorised callers within an adapter
as equally trusted, and at the August review date it had third-party CVEs and
historical user reports but no public repository advisories. Nous’s own security
policy tells operators to isolate deployments, avoid public exposure, and review
third-party skills.
[openclaw and hermes agent](https://docs.openclaw.ai/start/why-openclaw/openclaw-and-hermes-agent.md)

### Governance and business model

Steinberger joined OpenAI, with Sam Altman saying OpenClaw would live in a
foundation OpenAI continues to support. The foundation insists it has sponsors
rather than owners, and Steinberger still makes most technical decisions.
[kilo](https://blog.kilo.ai/p/openclaw-founder-to-openainow-what)
[trendingtopics](https://www.trendingtopics.eu/opwnclaw-foundation-launches-with-openai-nvidia-microsoft-and-tencent-as-sponsors/)

Hermes is a commercial open-core play. Nous raised $90M, with the WSJ putting
its valuation at $1.5bn, to build Hermes for Businesses. The software stays open
while hosting, security, management and enterprise support are paid.
[thenextweb](https://thenextweb.com/news/nous-research-90m-1-5bn-hermes-agent-wsj)
[trendingtopics](https://www.trendingtopics.eu/nous-research-hermes-90-millionen/)

### Which to pick

#### Choose OpenClaw if you want

- A fleet of persistent, specialised agents (one per channel, plus a
  coordinator)
- The widest channel and skill catalogue, and native Codex or Claude Code
  runtimes
- Fine-grained multi-user roles and secrets handling
- Non-profit governance with no upsell

#### Choose Hermes Agent if you want

- One long-lived agent that writes its own skills and compounds over time
- A Python codebase and built-in remote backends like Modal, SSH or Singularity
- A lighter footprint and faster iteration
- An optional paid path for hosted models and tools

### Relevant specifications

- **Agent Skills (SKILL.md):** Hermes writes Markdown skill documents following
  the agentskills.io open standard, the same folder-based format OpenClaw’s
  skills use, so hand-authored skills are often portable between the two.
  [mythos](https://mythos.one/me/brianswichkow/857234)
- **MCP:** the common protocol for wiring external tools into either agent.
- **A2A v1.0:** Hermes ships a plugin implementing A2A v1.0 so compatible agents
  can discover it and delegate work.
  [runtimewire](https://runtimewire.com/article/nous-research-hermes-agent-v0200-voice-a2a)
- **OpenTelemetry (OTLP):** both export telemetry this way for observability.

### Sources

- [OpenClaw vs Hermes Agent (Antropy)](https://www.antropy.co.uk/blog/openclaw-vs-hermes/)
- [OpenClaw vs Hermes Agent (Composio)](https://composio.dev/blog/openclaw-vs-hermes-agent)
- [OpenClaw vs Hermes Agent (Hongkiat)](https://www.hongkiat.com/blog/openclaw-vs-hermes-agent/)
- [OpenClaw and Hermes Agent (OpenClaw docs)](https://docs.openclaw.ai/start/why-openclaw/openclaw-and-hermes-agent.md)
- [Hermes Agent vs OpenClaw (Respan)](https://respan.ai/market-map/compare/hermes-agent-vs-openclaw)
- [OpenClaw vs Hermes Agent (Toolradar)](https://toolradar.com/compare/openclaw-vs-hermes-agent)
- [Nous Research raises $90M (The Next Web)](https://thenextweb.com/news/nous-research-90m-1-5bn-hermes-agent-wsj)
- [Nous Research nears $75M round (AI Weekly)](https://aiweekly.co/alerts/nous-research-nears-75m-round-at-15b-valuation-for-hermes)
- [Hermes-Macher Nous Research holt 90 Millionen Dollar (Trending Topics)](https://www.trendingtopics.eu/nous-research-hermes-90-millionen/)
- [OpenClaw Rival Hermes (Trending Topics)](https://www.trendingtopics.eu/openclaw-rival-hermes-made-by-nous-research-in-talks-to-raise-at-1-5-billion-valuation/)
- [OpenClaw Foundation Launches (Trending Topics)](https://www.trendingtopics.eu/opwnclaw-foundation-launches-with-openai-nvidia-microsoft-and-tencent-as-sponsors/)
- [Hermes Agent v0.20.0 (RuntimeWire)](https://runtimewire.com/article/nous-research-hermes-agent-v0200-voice-a2a)
- [Nous Research pitches Hermes Agent (RuntimeWire)](https://runtimewire.com/article/nous-research-hermes-agent-open-harness-sovereignty)
- [Hermes Agent news](https://www.hermes-ai.net/news/)
- [forgeguard-ai/hermes-agent releases](https://github.com/forgeguard-ai/hermes-agent/releases)
- [OpenClaw latest version (BetterClaw)](https://www.betterclaw.io/blog/openclaw-latest-version)
- [OpenClaw on ThursdAI](https://thursdai.news/companies/openclaw)
- [OpenClaw founder to OpenAI (Kilo)](https://blog.kilo.ai/p/openclaw-founder-to-openainow-what)
- [OpenClaw Remains Open Source (Open Source For You)](https://www.opensourceforu.com/)
- [Hundreds of Malicious Skills Found in ClawHub (eSecurity Planet)](https://esecurityplanet.com/threats/hundreds-of-malicious-skills-found-in-openclaws-clawhub)
- [OpenClaw integrates VirusTotal scanning (The Hacker News)](https://thehackernews.com/2026/02/openclaw-integrates-virustotal-scanning.html)
- [Hermes Agent overview (Mythos)](https://mythos.one/me/brianswichkow/857234)

---

## chewygumxx Prompt 2

I am trying to understand why Hermes Agent is leagues ahead of OpenClaw right
now.

Also, how can Hermes Agent not have access to npx clawdhub?

---

## Claude Response 2

I’ll check the latest news on both and look into the ClawHub CLI question.

> _Searched the web_

### Is Hermes really “leagues ahead”?

On momentum and day-to-day experience as a single personal agent, Hermes has a
strong case right now. Across the board, though, “leagues ahead” overstates it.
The picture is closer to “Hermes is winning the mindshare race while OpenClaw
still leads on breadth.”

#### Where Hermes genuinely leads

- **Usage, not just stars.** Hermes recently moved ahead of OpenClaw on
  OpenRouter’s leaderboard of daily tokens consumed by agents. Nous’s own
  internal estimate is that Hermes drives about 2.5% of global token usage.
- **The core differentiator works.** The two products overlap heavily in what
  they can do. Hermes stands apart mainly through its memory architecture and
  its ability to build skills automatically from successful behaviour.
- **Stability over sprawl.** A common reason people switch is that frequent
  OpenClaw updates break things and feature bloat slows it down. Hermes instead
  ships fewer, themed releases. One prominent creator who switched now tells
  beginners, and anyone spending more time maintaining OpenClaw than using it,
  to start with Hermes.
- **Lower friction.** Hermes installs with a single curl command, and
  `hermes claw migrate` imports an existing OpenClaw setup. That makes trying it
  nearly free.
- **Money and velocity.** Nous raised $90M, and Hermes has been cloned more than
  24 million times. v0.20.0 alone covered roughly 3,650 commits and 1,400 merged
  PRs from more than 650 contributors.

#### Where OpenClaw still leads

- **Reach.** OpenClaw has over 360K GitHub stars and Hermes is still behind. It
  connects to more than 50 channels, and ClawHub hosts over 44,000 skills.
- **Multi-agent orchestration, per-person roles, and secrets handling**, as
  covered in the previous comparison.
- **Enterprise adoption.** Nvidia built an enterprise platform on top of
  OpenClaw.

Much of the “Hermes killed OpenClaw” framing comes from YouTube thumbnails, so
weigh hands-on reviews over headlines.

### Why `npx clawdhub` fails inside Hermes

`clawdhub` is not a Hermes tool. It is OpenClaw’s separate Node.js registry CLI,
so Hermes has no built-in reason to have it. Several things can also block it:

#### 1. The package name is stale

`clawdhub` is the Clawdbot-era name. Older third-party docs still show
`npx clawdhub@latest install ...`, but the current docs install the CLI as
`clawhub`, with no “d”. Lookalike names are also a known attack vector: the
ClawHavoc malware campaign used ClawHub typosquats such as `clawhubb` and
`cllawhub`. A cautious agent hesitating over a near-miss name is behaving
sensibly.

#### 2. Node may not exist where Hermes runs commands

Hermes is a Python application. The ClawHub CLI requires Node.js 22 or newer. If
your terminal backend is Docker, Modal, SSH or Singularity, `npx` runs inside
that environment, not on your host, and the image may not include Node at all.

#### 3. Hermes’s approval gate may be stopping it

- Hermes checks every shell command against a curated list of dangerous patterns
  before running it.
- Over a messaging gateway such as Telegram or Slack, it posts the command to
  chat and waits for your yes or no, so the run can look stuck.
- In cron and one-shot contexts, flagged commands are denied by default.
- Some package-firewall plugins block `npx` deliberately. For example,
  `hermes-sfw` rejects it because it can execute arbitrary programs.

#### Quick diagnostic

Run these where Hermes actually executes commands, not just on your host:

```bash
node --version             # needs v22 or newer
npm view clawhub version   # current CLI package
npm view clawdhub version  # legacy name; compare the results
```

### Better ways to get ClawHub skills into Hermes

Running OpenClaw’s CLI through Hermes’s shell is a roundabout path. Three more
direct options:

1. **Use Hermes’s own Skills Hub.** ClawHub and LobeHub skills show up when you
   run `hermes skills browse` or `hermes skills search`, and the base install
   command is `hermes skills install`. This is the native route.

   ```bash
   hermes skills search "calendar"
   hermes skills install <identifier-from-search>
   ```

2. **Run the real ClawHub CLI on your host, targeting Hermes’s directory.** This
   is the documented workaround for multi-file skills, because Hermes’s
   URL-based install only handles single files.

   ```bash
   npm i -g clawhub
   clawhub install <owner/skill> --workdir ~/.hermes
   ```

   Then run `/reload-skills` in Hermes so the current session picks up the new
   skill.

3. **Copy the folder by hand.** Hermes reads skill folders from
   `~/.hermes/skills/`, so you can download a skill, review its `SKILL.md` and
   any scripts, and drop it in.

Whichever you choose, read the skill before enabling it. ClawHub’s history
includes hundreds of malicious entries.

### Relevant specification

Both projects use the open **Agent Skills** format: a folder containing a
`SKILL.md` with `name` and `description` frontmatter. That shared format is why
a ClawHub skill usually works in Hermes unchanged, as long as any scripts it
bundles can run in Hermes’s execution environment (for example, a skill that
ships a `.mjs` helper still needs Node).

### Sources

- [Hermes Agent Challenges OpenClaw (The Batch)](https://charonhub.deeplearning.ai/hermes-agent-challenges-openclaw/)
- [Nous Research raises $90M (The Next Web)](https://thenextweb.com/news/nous-research-90m-1-5bn-hermes-agent-wsj)
- [Hermes Agent might have just killed OpenClaw (video summary)](https://videohighlight.com/v/Bg-IPiql7x8)
- [Hermes Agent might have just killed OpenClaw (transcript)](https://rosetta.to/u/sharbelxyz/hermes-agent-might-have-just-killed-openclaw)
- [Hermes Agent vs OpenClaw (LobsterPack)](https://www.lobsterpack.com/blog/hermes-agent-vs-openclaw/)
- [Hermes Agent v0.20.0 (RuntimeWire)](https://runtimewire.com/article/nous-research-hermes-agent-v0200-voice-a2a)
- [OpenClaw vs Hermes Agent (Brunch)](https://brunch.co.kr/@abrahamsong/170)
- [ClawHub docs](https://docs.openclaw.ai/vi/clawhub)
- [clawhub 0.20.2 release](https://github.com/openclaw/clawhub/releases/tag/v0.20.2)
- [LettaBot README](https://github.com/letta-ai/lettabot)
- [341 malicious ClawHub skills (The Hacker News)](https://thehackernews.com/2026/02/researchers-find-341-malicious-clawhub.html)
- [Hermes Agent Security (Fast.io)](https://fast.io/resources/hermes-agent-security/)
- [hermes-sfw plugin](https://pypi.org/project/hermes-sfw/0.2.11/)
- [Hermes Agent Skills Hub (Fast.io)](https://fast.io/resources/hermes-agent-skills-hub-marketplace/)
- [Automate It: Connect Hermes](https://docs.automate.it.com/connect/hermes)
- [tmchow/agent-skills](https://github.com/tmchow/agent-skills)

---

## chewygumxx Prompt 3

Also, did you fr just convey that OpenClaw can run OpenAI and Anthropic binaries
natively? As in, OAuth can be utilised with OpenClaw but not Hermes?

---

## Claude Response 3

I’ll verify what each project actually supports for OAuth and vendor harnesses
before answering.

> _Searched the web_

### Short answer

Not quite. My wording made it sound like more than it is.

That line came straight from OpenClaw’s own comparison page, which lists Codex
app-server, the Copilot SDK and the Claude Code CLI as “native runtimes.” It is
misleading in two ways.

#### “Native runtime” means handing work to the vendor’s agent, not running vendor binaries inside OpenClaw

The models still run on OpenAI’s and Anthropic’s servers either way. “Native
runtime” means OpenClaw can pass a turn to the vendor’s own agent CLI installed
on your machine and let that agent do the work. For Claude, OpenClaw switches
your Anthropic model selection from `anthropic/...` to a `claude-cli/...`
backend that drives the Claude CLI you have already logged into on that host.

Hermes does the same thing for Codex. Running `/codex-runtime codex_app_server`
makes Codex the engine, while Hermes keeps handling memory, slash commands and
skill review. The difference is depth: per OpenClaw’s review, Hermes’s version
accepts text-only input and starts a fresh Codex thread after a restart instead
of resuming the old one.

#### OAuth is not exclusive to OpenClaw

Hermes supports subscription sign-in for many providers:

- Nous Portal
- ChatGPT/Codex
- xAI Grok
- Qwen
- MiniMax
- Anthropic: Hermes’s docs list Claude Max OAuth as supported via
  `hermes model`.

In one respect Hermes goes further. `hermes proxy` turns any provider you’re
signed into via OAuth into a local OpenAI-compatible endpoint, so tools like
Codex CLI, Aider and Cline can use your subscription.

### Where the real difference is: Claude subscriptions

|                                | OpenClaw                                                              | Hermes Agent                                                                               |
| ------------------------------ | --------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| **ChatGPT/Codex subscription** | Supported; OpenAI explicitly allows Codex OAuth outside the Codex CLI | Supported via device-code login; can also import existing `~/.codex/auth.json` credentials |
| **Claude Pro/Max**             | Prefers reusing the Claude CLI login and `claude -p`                  | Uses the OAuth token in its own adapter, calling the Messages API directly                 |
| **Status**                     | OpenClaw says Anthropic staff told them this usage is allowed again   | Several user reports of failures (below)                                                   |

Because Hermes calls the API itself instead of going through Claude Code, the
traffic can be treated differently. Reported problems include:

- A Max subscriber found Hermes sending requests to the standard pay-per-token
  endpoint instead of drawing on the subscription.
- Another saw every request rejected with HTTP 400 once tools were attached.
- A third pointed out that detecting your OAuth credentials doesn’t
  automatically route usage through the Max quota.

These reports span roughly v0.10 to v0.15, so some may be fixed by now. Still,
there were open feature requests to add a Claude Agent SDK provider or to run
Claude Code as a subprocess provider, so the gap was acknowledged.

Third-party patches exist that disguise Hermes’s requests as Claude Code’s to
get past this. I’d avoid them. They work by getting around Anthropic’s
server-side validation, which can break without notice and may breach
Anthropic’s terms.

Anthropic’s policy has also shifted this year. Older translations of OpenClaw’s
docs said Anthropic required Extra Usage for OpenClaw-driven Claude traffic,
while the current English page says it’s allowed again. Check Anthropic’s help
article on
[using Claude Code with your Pro or Max plan](https://support.claude.com/en/articles/11145838-using-claude-code-with-your-pro-or-max-plan)
for current terms.

### Bottom line

- **ChatGPT subscription:** both work.
- **Claude subscription:** OpenClaw’s route through the official Claude CLI is
  currently the cleaner path.
- **Claude on Hermes:** an Anthropic API key, or routing through Nous Portal or
  OpenRouter, is the reliable option for now.

### Relevant specifications

- **OAuth 2.0 Device Authorization Grant (RFC 8628):** the flow behind Hermes’s
  ChatGPT login, where you approve a code in a browser.
- **PKCE (RFC 7636):** the flow used by Hermes’s browser-based Qwen and MiniMax
  logins.

### Sources

- [OpenClaw and Hermes Agent (OpenClaw docs)](https://docs.openclaw.ai/start/why-openclaw/openclaw-and-hermes-agent.md)
- [OAuth (OpenClaw docs)](https://docs.openclaw.ai/concepts/oauth)
- [OAuth, Indonesian (OpenClaw docs)](https://docs.openclaw.ai/id/concepts/oauth)
- [Providers (Hermes Agent docs)](https://hermes-agent.nousresearch.com/docs/integrations/providers/)
- [Hermes Agent v0.14.0 release](https://github.com/NousResearch/Hermes-Agent/releases/tag/v2026.5.16)
- [Hermes Just Made Codex the Engine (AlphaSignal)](https://alphasignalai.substack.com/p/hermes-just-made-codex-the-engine)
- [Hermes Agent and Codex Subscription (DEV)](https://dev.to/bettertoken_ai/hermes-agent-and-codex-subscription-oauth-setup-quotas-and-api-1amc)
- [Hermes issue #40014](https://github.com/NousResearch/hermes-agent/issues/40014)
- [Hermes issue #15080](https://github.com/NousResearch/hermes-agent/issues/15080)
- [Hermes issue #12905](https://github.com/NousResearch/hermes-agent/issues/12905)
- [Hermes issue #48176](https://github.com/NousResearch/hermes-agent/issues/48176)
- [Hermes issue #25267](https://github.com/NousResearch/hermes-agent/issues/25267)
- [hermes-claude-auth](https://github.com/kristianvast/hermes-claude-auth/wiki)

---

## chewygumxx Prompt 4

I heard the same somwhere about OpenClaw 'getting back to its roots' with
respect to Claude Code re-integration. Is that valid?

---

## Claude Response 4

I’ll check the history and the recent news on this.

> _Searched the web_

### Short answer

Partly valid. Claude support is genuinely back as a first-class option. But
“back to its roots” overstates it: the mechanism is different, the permission is
informal, and Claude is no longer the centre of the project.

### The roots

The original name, Clawdbot, was a play on “Claude,” and Steinberger recommended
connecting it to Claude Opus 4.5. Many users ran it with Claude as the
underlying model, which sent a lot of business Anthropic’s way.

### The break and the return

| When                | What happened                                                                                                                                                       |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **9 Jan 2026**      | Anthropic quietly switched on server-side blocks so Claude subscription tokens stopped working outside the official Claude Code client                              |
| **27 Jan**          | Anthropic made a trademark request, forcing the rename to Moltbot                                                                                                   |
| **Days later**      | Third rename, to OpenClaw, backed by a full trademark search                                                                                                        |
| **4 Apr**           | Claude subscriptions stopped covering third-party tools like OpenClaw; users had to buy extra usage or switch to an API key                                         |
| **April**           | OpenClaw 2026.4.5 made GPT-5.4 the default model                                                                                                                    |
| **Since then**      | OpenClaw’s bundled `claude-cli` backend is supported again and is now the preferred path, which OpenClaw attributes to Anthropic staff saying this usage is allowed |
| **13 May / 15 Jun** | Anthropic announced it would move programmatic usage onto a separate monthly credit from 15 June, then paused the change that same day                              |

### What the re-integration actually is

OpenClaw does not use your Claude tokens itself anymore. Instead, it drives the
official Claude Code binary:

- It keeps one live Claude process running per session and resumes from the
  stored session ID if that process exits.
- It maps OpenClaw’s `/think` levels to Claude Code’s `--effort` flag.
- It hands OpenClaw’s skills to Claude Code as a temporary plugin.

This matters for why Anthropic tolerates it. Anthropic’s stated reason for the
April cutoff was that its own tools are built to maximise prompt-cache reuse,
which keeps inference costs down. Routing through the real Claude Code binary
means requests look like ordinary interactive Claude Code use.

Setup is two commands on the gateway host:

```bash
claude auth login
openclaw models auth login --provider anthropic --method cli --set-default
```

### Why “back to its roots” is a stretch

#### It’s a different mechanism

The original setup used subscription credentials directly from OpenClaw’s own
code, which is exactly what the January blocks shut down. The new path delegates
to Anthropic’s own client. It’s closer to a sanctioned adapter than a return to
how things were.

#### OpenClaw is no longer Claude-first

The April release made GPT-5.4 the default model. Claude CLI is now one of
several local CLI runtimes, alongside `codex-cli` and `google-gemini-cli`. With
Steinberger working at OpenAI, provider-neutral is the honest description.

#### The permission is informal

OpenClaw’s docs base the “allowed” status on what Anthropic staff told them.
OpenClaw itself says this holds only until Anthropic publishes a new policy.
Secondhand reports point to Boris Cherny’s posts on X as Anthropic’s
confirmation, but I couldn’t find it in a formal Anthropic policy document.

#### It sits on a fragile billing arrangement

- OpenClaw’s Claude runs go through `claude -p`, which Anthropic currently
  classes as programmatic (Agent SDK) usage.
- The May plan would have moved `claude -p` and third-party app usage off
  subscription limits entirely.
- That was paused on 15 June, and such usage still draws from your normal
  subscription limits.
- Commentators read the pause as “delayed, not dead,” so a revived version would
  hit this exact path.

### Why this matters for the Hermes comparison

This is the root of the Claude gap from my last answer. Hermes users have filed
a feature request for a provider that routes Claude through `claude -p`,
explicitly citing OpenClaw’s backend as the model to copy. An earlier issue
about Hermes not working through the Claude CLI was closed as “not planned.”

### Sources

- [Clawdbot Becomes Moltbot (Trending Topics)](https://www.trendingtopics.eu/clawdbot-moltbot-anthropic/)
- [Clawdbot is now Moltbot (Techloy)](https://www.techloy.com/clawdbot-is-now-moltbot-everything-you-need-to-know-about-the-viral-personal-ai-assistant/)
- [Clawdbot rebrands a third time (AlternativeTo)](https://alternativeto.net/news/2026/1/the-viral-ai-agent-clawdbot-rebrands-a-third-time-and-now-has-a-social-network-for-bots/)
- [Anthropic cuts OpenClaw from Claude subscriptions (Implicator)](https://www.implicator.ai/anthropic-cuts-openclaw-from-claude-subscriptions-citing-unsustainable-compute-costs/)
- [OpenClaw on ThursdAI](https://thursdai.news/companies/openclaw)
- [Authentication (OpenClaw docs)](https://docs.openclaw.ai/gateway/authentication.md)
- [CLI Backends (OpenClaw docs)](https://docs.openclaw.ai/gateway/cli-backends.md)
- [openclaw models (OpenClaw docs)](https://docs.openclaw.ai/cli/models.md)
- [Model Providers (OpenClaw docs)](https://docs.openclaw.ai/concepts/model-providers.md)
- [Anthropic provider, Hindi (OpenClaw docs)](https://docs.openclaw.ai/hi/providers/anthropic.md)
- [OpenClaw Claude subscription OAuth (KocPC)](https://en.kocpc.com.tw/)
- [OpenClaw on your $20 Claude sub (Botmonster)](https://botmonster.com/ai/openclaw-claude-sub-after-anthropic-ban/)
- [Anthropic pauses Agent SDK change (The New Stack)](https://thenewstack.io/anthropic-pauses-claude-agent-sdk-subscription-change/)
- [Anthropic Pauses Claude Agent SDK Billing Overhaul](https://letsdatascience.com/news/anthropic-pauses-claude-agent-sdk-billing-overhaul-1cff2071)
- [Anthropic hits pause (DevOps.com)](https://devops.com/anthropic-hits-pause-on-claude-agent-sdk-billing-change-for-now/)
- [Hermes issue #48320](https://github.com/NousResearch/hermes-agent/issues/48320)

---

## chewygumxx Prompt 5

Why is claude-cli integration a request? Surely it could be implemented as a
Hermes plugin.

---

## Claude Response 5

I’ll check the Hermes issue threads and whether anyone has already built this as
a plugin.

> _Searched the web, read 2 pages_

### You’re right, and it now exists

My last answer was out of date. Nous has since shipped exactly what you’re
describing as an official plugin, **Claude Subscription DirectSDK
(Experimental)**. It’s listed in the Hermes plugin catalog, runs Hermes turns on
a Claude Pro/Max subscription through the official Claude Code CLI, and needs no
separate API key. It is very new: the original repo was archived on 10 October
2026 when the plugin moved into Nous’s `hermes-official-plugins` collection.

```bash
claude auth login
hermes plugins install claude-subscription-directsdk
hermes model    # pick "Claude Subscription DirectSDK (Experimental)"
```

Or pin it in config:

```yaml
model:
  provider: claude-subscription-directsdk-experimental
  default: sonnet
```

It needs Hermes 0.21.4 or newer. On older versions it refuses to load with a
clear warning rather than half-working.

### Why it started life as a request

#### 1. The plugin API couldn’t host it yet

Your instinct was right about where it should live, but the hooks weren’t there.
The original feature request proposed a plugin folder plus edits to several core
files: the auxiliary client, the runtime helpers, the conversation loop’s
streaming logic, and the provider and auth registries. Those had to land in core
first. They arrived via PR #117451, which added generic support for providers
that run as a local process instead of an HTTP endpoint, a way to replay each
provider’s native message history, gating in the setup flow, and model-picker
plumbing. Only after that could the Claude-specific part ship as a standalone
plugin.

#### 2. Claude Code is an agent, not a model endpoint

This is the genuinely hard part. Hermes wants a “brain” that returns tool calls
for Hermes to execute. Claude Code wants to run its own tools. To make it behave
like a plain model, the plugin:

- **Disables Claude Code’s own machinery:** each request runs in a fresh process
  in a private temp directory with native tools, skills and setting sources
  turned off.
- **Advertises Hermes’s tools to it** through MCP, but with execution denied, so
  Claude decides which tool to call and Hermes actually runs it.
- **Runs a local relay** that forwards only the first API request per call.
  Claude Code can otherwise attempt extra generations even when told to stop
  after one turn.

The result is that Hermes keeps its own agent loop, tools, approvals and context
compaction. It took about 80 commits of work and is explicitly labelled a review
build, not a claim of production readiness.

#### 3. Nous’s packaging policy

Even once it worked, it was never going into core: Hermes deliberately keeps
vendor-specific subscription transports out of the main codebase, so this was
always going to be a plugin.

### Two different kinds of “Claude Code plugin”

Part of the confusion is that one kind always worked as a plugin and the other
didn’t.

| Approach                                         | What Claude Code does                                       | Needed core changes?                             |
| ------------------------------------------------ | ----------------------------------------------------------- | ------------------------------------------------ |
| **Delegation tool**, e.g. `hermes-claude-bridge` | Hermes hands Claude Code a whole coding task as a tool call | No; plain tool or MCP plugin                     |
| **Model provider**, i.e. DirectSDK               | Claude becomes Hermes’s brain for every turn                | Yes, the external-process provider support above |

### Caveats before you switch

- **Metering:** it draws subscription usage at the same rate as `claude -p` and
  the Agent SDK. In Nous’s measurement, interactive Claude Code was metered at
  roughly 0.58x that rate, so expect about 60% of the throughput you’d get in
  the Claude Code app. If you don’t want overage charges, turn off extra usage
  on your Claude account.
- **Naming trap:** `--provider claude-code` is _not_ this plugin. It’s an alias
  for the old `anthropic` OAuth path. Hermes’s own docs say that path only
  consumes purchased extra-usage credits on Max and doesn’t work for Pro
  subscribers at all.
- **Contrast with OpenClaw:** OpenClaw keeps one live Claude process per
  session. Hermes’s plugin starts a fresh process each request and replays the
  history, relying on prompt caching to keep that cheap, so Hermes stays in
  charge of tools and compaction.

### Relevant specification

The bridge depends on **MCP**: it’s the standard channel the plugin uses to
present Hermes’s tools to Claude Code with descriptions and schemas intact,
while Hermes keeps ownership of execution.

### Sources

- [Claude Subscription DirectSDK plugin README](https://github.com/NousResearch/hermes-plugin-claude-subscription-directsdk)
- [Hermes plugin catalog listing](https://hermes-agent.nousresearch.com/docs/plugins/blender)
- [Hermes issue #48320](https://github.com/NousResearch/hermes-agent/issues/48320)
- [Hermes providers docs (Simplified Chinese)](https://hermes-agent.nousresearch.com/docs/zh-Hans/integrations/providers)
- [Hermes-Claude Bridge (Glama)](https://glama.ai/mcp/servers/t66viuifdi)
- [OpenClaw CLI Backends docs](https://docs.openclaw.ai/gateway/cli-backends.md)
