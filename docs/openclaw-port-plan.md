# OpenClaw Port Plan for `pi-autoresearch`

## Goal

Create a faithful OpenClaw port of `davebcn87/pi-autoresearch`.

The default rule is:

- preserve upstream names
- preserve upstream file layout
- preserve upstream semantics
- preserve the upstream split of extension/plugin + skill
- diverge only where Pi runtime/UI APIs do not exist in OpenClaw

This is a **port-first** effort, not a redesign-first effort.

## Executive summary

The upstream repo is already opinionated in the right way for a port: one generic infrastructure layer plus one setup skill, with project-root session files and a resumable loop driven by `init_experiment`, `run_experiment`, and `log_experiment`.

For v1, OpenClaw should preserve that shape as closely as practical:

- OpenClaw plugin = Pi extension analog
- OpenClaw skill = close port of `autoresearch-create`
- execution stays agent/runtime-agnostic, the way other OpenClaw plugins expose capabilities without binding the architecture to one provider or CLI

We should not chase Pi’s widget, fullscreen TUI, keyboard shortcuts, or exact runtime hooks in v1.

## Preserve almost as-is

### Architecture
- extension/plugin + skill split
- skill-driven setup and resume flow
- generic experiment infrastructure underneath the skill

### Root-level files
Keep these at the target repo root in v1:
- `autoresearch.md`
- `autoresearch.sh`
- `autoresearch.jsonl`
- `autoresearch.ideas.md`

Do **not** move them under `.autoresearch/` in v1.

### Core tools and semantics
Preserve these tool names and roles:
- `init_experiment`
- `run_experiment`
- `log_experiment`

Preserve these behaviors closely:
- config-header + run-entry JSONL history
- re-baselining through repeated `init_experiment`
- auto-commit on `keep`
- revert on `discard` / `crash`
- secondary metrics tracking
- resume from repo files first
- queued user steer concept
- "never stop" loop framing

## Adapt only where required

### Unavoidable divergences
- Pi widget/dashboard rendering
- fullscreen TUI overlay
- keyboard shortcuts
- Pi-specific command registration
- Pi-specific lifecycle hooks (`before_agent_start`, `input`, `agent_end`, etc.)
- Pi packaging/install metadata

### OpenClaw replacements
- plugin tools instead of Pi `registerTool`
- OpenClaw skill instead of Pi skill packaging
- lightweight status summaries instead of Pi dashboard UI
- OpenClaw-native plugin surfaces — tools, commands, hooks, and services — instead of binding the port to any single execution backend

Useful reference shapes inside OpenClaw today:
- `diffs`: tool + prompt guidance hook
- `memory-core`: tools + CLI
- `phone-control`: command + service

## Recommended file layout

### Keep upstream root-level layout in v1
Why:
- upstream docs and skill assume exact file names and locations
- root files are part of the resumability contract
- hiding them is a product-level divergence, not just cleanup

If we ever support hidden storage later, support both layouts rather than replacing upstream layout.

## Revised plugin / tool / command plan

### Plugin
Implement a minimal OpenClaw plugin that preserves upstream semantics.

Core tools:
- `init_experiment`
- `run_experiment`
- `log_experiment`

Optional read-only helper:
- `autoresearch_status`

### Skill
Port `skills/autoresearch-create/SKILL.md` closely.

Allowed edits:
- OpenClaw-specific tool invocation syntax
- removal/replacement of Pi-only UI references
- safety adjustments only where host differences require them

Not allowed by default:
- new workflow philosophy
- hidden storage redesign
- worker-centric rewrite

### Command surface
If OpenClaw supports a clean custom command path, add `/autoresearch` with semantics close to upstream.

If that mapping is awkward, ship skill-first and add command polish later.

### Execution model
The public architecture should be agent/runtime-agnostic.

That means:
- the durable contract is files + tool semantics, not a specific worker binary
- any OpenClaw-capable agent or harness should be able to drive the same loop
- if unattended execution is added later, it should sit behind an internal adapter layer rather than becoming the product identity
- provider-specific runners (Codex, ACP, others) are implementation choices, not the core architecture

## Phased implementation plan

### Phase 0 — source capture
- freeze upstream behavior from current repo
- extract exact contracts for files, tools, resume behavior, commit/revert behavior, steering
- separate core semantics from Pi-only UI/runtime

### Phase 1 — mechanical import
- create OpenClaw-side skeletons mirroring upstream naming where practical
- preserve `autoresearch` naming everywhere practical
- port skill text first with minimal edits

### Phase 2 — core tool port
- port `init_experiment`
- port `run_experiment`
- port `log_experiment`
- keep root-level `autoresearch.jsonl`
- preserve config-header / segment behavior

### Phase 3 — resume behavior
- reconstruct state from `autoresearch.jsonl`
- detect active mode from `autoresearch.md`
- keep file-first resumability

### Phase 4 — entry surface
- add `/autoresearch` only if it maps cleanly in OpenClaw
- otherwise ship skill-first and document the flow clearly

### Phase 5 — non-core conveniences
- lightweight status/readout
- queued user steer behavior if hooks allow it cleanly
- ideas-backlog continuation behavior if lifecycle hooks allow it reliably

### Phase 6 — docs and parity review
- document the port as faithful-with-adaptations, not a redesign
- list explicit non-parity items

## Acceptance criteria for a faithful v1 port

- setup creates `autoresearch.md` and `autoresearch.sh` at repo root
- runtime uses `autoresearch.jsonl` at repo root
- tool names remain `init_experiment`, `run_experiment`, `log_experiment`
- a resumed agent can continue from files alone
- `log_experiment` preserves keep/discard/crash semantics closely to upstream
- re-init creates a new baseline segment instead of overwriting history
- secondary metrics remain part of the contract
- docs still describe the system as plugin + skill
- the diff can be explained mostly as host adaptation, not behavior redesign

## Biggest traps

- optimizing for OpenClaw elegance and silently changing the product
- moving files under `.autoresearch/`
- replacing skill-first setup with plugin-only or worker-only design
- treating Pi UI as core behavior instead of host-specific packaging
- losing file-first resumability
- changing commit/revert semantics enough to alter experiment flow
- rewriting prompts enough that loop behavior drifts from upstream

## Current stance

For v1, the decisive posture is:

- keep root-level artifacts
- keep the extension/skill split
- keep upstream tool names and semantics
- accept a thinner UI if that is the price of semantic fidelity
