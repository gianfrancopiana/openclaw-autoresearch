# 1. Executive Summary

- Build this as a **faithful OpenClaw port of `pi-autoresearch`**, not as a Codex-centric product.
- Keep the **upstream split** intact:
  - **plugin/extension** = generic experiment-loop infrastructure
  - **skill** = setup and operating instructions
- Preserve upstream **names, file contracts, and flow** wherever OpenClaw allows:
  - `init_experiment`
  - `run_experiment`
  - `log_experiment`
  - `autoresearch.md`
  - `autoresearch.sh`
  - `autoresearch.jsonl`
  - `autoresearch.ideas.md`
- Treat Pi-only UI/runtime features as **non-parity items**, not as architectural drivers.
- Provider-specific execution backends can exist later, but only as **adapters behind the plugin**, never as the product identity.

# 2. Repo Strategy

- Use a **new standalone repo**, not a GitHub fork in the product sense.
- Seed it from upstream source and keep an `upstream` remote to the original repo.
- Preserve upstream paths and filenames where practical so diffs stay understandable.
- Track upstream with:
  - a pinned upstream commit reference in docs
  - a `docs/upstream-parity-map.md`
  - periodic manual sync reviews
- Open-source-friendly posture:
  - standalone name and README
  - explicit attribution to upstream
  - no dependency on private local runtime glue
  - no Codex-branded architecture in core docs

**Recommendation:** standalone repo with upstream remote, source-faithful layout, explicit parity docs. This is the easiest path for later publishing and for other OpenClaw users to adopt.

# 3. Porting Philosophy

## Must Stay Source-Faithful

- Core product identity: `autoresearch`
- Extension + skill split
- Root-level session artifacts
- Append-only JSONL history with config-header semantics
- Re-init as a new baseline segment, not destructive overwrite
- Keep/discard/crash semantics
- File-first resumability
- Secondary metrics contract
- Skill-first setup and resume flow
- “never stop” loop framing

## Can Be Adapted

- Pi widget/dashboard rendering
- Pi command registration details
- Pi lifecycle hook names
- Prompt injection point names if OpenClaw uses different events
- Packaging/install instructions
- Optional status presentation

## Explicitly Deferred

- Pi dashboard parity
- fullscreen TUI parity
- keyboard shortcut parity
- advanced queued-steer UX if OpenClaw hooks are not clean enough
- unattended runner orchestration
- provider-specific worker daemons

# 4. Architecture

## Core Shape

- **Plugin**: owns durable experiment semantics and OpenClaw runtime integration.
- **Skill**: owns setup workflow, operating rules, and the loop prompt contract.
- **Repo files**: remain the durable state boundary.
- **OpenClaw runtime**: invokes tools/hooks/commands.
- **Provider runner adapters**: optional implementation detail later.

## Agent/Runtime-Agnostic Center of Gravity

The architecture should be:

- **stateful through files**
- **behavioral through tool contracts**
- **guided through the skill**
- **integrated through OpenClaw plugin APIs**

Not:

- tied to Codex CLI
- tied to a single shell harness
- tied to a single agent provider
- defined by one background worker model

## Where Provider-Specific Runners Fit

- Put them behind an internal adapter boundary, such as:
  - experiment command execution adapter
  - optional autonomous-run orchestration adapter
- They are acceptable only as:
  - backend choices
  - optional integrations
  - future extensions
- They must not rename the product, redefine the workflow, or replace the file/tool contract.

# 5. Exact Recommendation on File Layout

## Root-Level User-Facing Files

Keep these at repo root in v1:

- `autoresearch.md`
- `autoresearch.sh`
- `autoresearch.jsonl`
- `autoresearch.ideas.md`

Do **not** hide them under `.autoresearch/` in v1.

## Hidden Internal State

Allow hidden internal state only for plugin-private implementation details, if needed:

- `.openclaw/plugins/autoresearch/...`

Use that only for:

- ephemeral caches
- internal plugin bookkeeping not present upstream
- optional future status/index artifacts

Do **not** move canonical experiment state there.

## Recommended Repo Layout

- `extensions/openclaw-autoresearch/`
- `skills/autoresearch-create/`
- `docs/`
- optional `examples/` later
- no hidden repo-level internal storage as the main UX

# 6. Exact Plugin Surface for V1

## Tools

Ship these in v1:

- `init_experiment`
- `run_experiment`
- `log_experiment`

Add one optional read-only helper only if clearly useful:

- `autoresearch_status`

Do not add more v1 tools unless required by OpenClaw ergonomics.

## Commands

- Optional `/autoresearch` command if OpenClaw command UX maps cleanly.
- Command should be thin:
  - detect existing session
  - tell the agent to read `autoresearch.md` and continue
  - or route into setup
- If command support is awkward, **skip it in v1** and stay skill-first.

## Hooks

Use only minimal hooks that map directly to upstream intent:

- `before_agent_start`
  - inject short autoresearch mode guidance
  - point agent at `autoresearch.md`
- `agent_end`
  - optionally continue from `autoresearch.ideas.md` if present
- user-input/message hook
  - only if OpenClaw can safely queue user steers without brittle behavior

## Services

No mandatory long-running service for v1.

Optional later service area:

- lightweight status/session reconstruction helper
- provider-runner adapter layer

**Recommendation:** v1 should work without a dedicated service.

# 7. Exact Skill Strategy for V1

## Port Closely from Upstream

Port `skills/autoresearch-create/SKILL.md` almost verbatim for:

- setup questions
- branch creation flow
- root file creation
- baseline run
- immediate loop start
- loop rules
- ideas backlog rules
- user steer semantics
- resume semantics

## Minimal Required Changes

Change only:

- tool invocation syntax for OpenClaw
- references to Pi dashboard/widget/shortcuts
- wording for any OpenClaw-specific command surface
- host-specific lifecycle notes where Pi behavior cannot be replicated

## Do Not Change in V1

- the operating philosophy
- the “never stop” instruction
- the centrality of `autoresearch.md`
- the idea that the skill starts the loop immediately
- the keep/discard logic described to the agent

# 8. Shareability / Adoption Story

Another OpenClaw user should be able to:

- install the plugin
- install the skill
- reload OpenClaw
- run the skill
- get root-level session files in their project
- resume later from files alone

## Packaging Shape

- one installable OpenClaw plugin package
- one bundled skill directory
- a README with:
  - what it is
  - install
  - quickstart
  - non-parity notes vs Pi
  - file contract
  - upgrade/upstream tracking notes

## Docs Shape

- `README.md` for users
- `docs/openclaw-port-plan.md`
- `docs/openclaw-port-progress.md`
- `docs/upstream-parity-map.md`
- `docs/non-parity.md`

That is enough for open-source use without overengineering.

# 9. Plan/Progress Tracking

Keep durable planning artifacts in-repo:

- `docs/openclaw-port-plan.md`
- `docs/openclaw-port-progress.md`
- `docs/upstream-parity-map.md`
- `docs/non-parity.md`

Track work as PR-sized checklists, not vague phases.

Recommended checklist buckets:

- source capture
- plugin skeleton
- skill port
- file semantics
- tool parity
- resume behavior
- command surface
- docs/open-source readiness

If issues are used later, mirror the same structure.

# 10. Phased Implementation Plan

## Phase 0: Source Capture

- Pin the upstream commit being ported.
- Capture exact contracts for:
  - files
  - tool parameters
  - JSONL schema
  - resume behavior
  - keep/discard/crash behavior
  - ideas backlog behavior
  - queued user steer behavior
- Separate Pi-only UI/runtime behavior from core semantics.

## Phase 1: Repo and Layout Freeze

- Freeze repo strategy as standalone + upstream remote.
- Freeze root-level file decision.
- Create parity-map docs before code drift starts.
- Decide exact OpenClaw extension path and skill path.

## Phase 2: Skill Port First

- Port `autoresearch-create` with minimal edits.
- Keep upstream structure and wording where possible.
- Remove only Pi-specific UI references.
- Document any unavoidable host changes inline.

## Phase 3: Plugin Skeleton

- Create OpenClaw plugin entrypoint in the style of existing plugins.
- Register only the v1 tools.
- Add minimal prompt-build/agent-start integration.
- Avoid services unless they are proven necessary.

## Phase 4: Core Tool Port

- Port `init_experiment`
- Port `run_experiment`
- Port `log_experiment`
- Preserve JSONL config-header and run-entry behavior closely.
- Preserve commit/revert semantics closely.

## Phase 5: Resume and Continuation

- Reconstruct state from `autoresearch.jsonl`
- Detect mode from `autoresearch.md`
- Support `autoresearch.ideas.md` continuation path if OpenClaw hooks permit it cleanly
- Add queued user steers only if behavior is reliable

## Phase 6: Entry Surface

- Add `/autoresearch` only if it is thin and source-faithful.
- Otherwise document skill-first usage as the primary interface.

## Phase 7: Shareability Hardening

- Write README
- Write non-parity notes
- Write install instructions for OpenClaw users
- Review naming so nothing implies Codex-specific architecture

## Phase 8: Parity Review

- Compare behavior against upstream docs and tool semantics.
- Record every divergence explicitly.
- Reject “cleaner” changes that alter product behavior without necessity.

# 11. Acceptance Criteria for a Faithful and Shareable V1

- OpenClaw port still presents as **`autoresearch`**, not as a provider wrapper.
- The repo contains both:
  - a plugin
  - a skill
- Root-level files are used exactly as the primary user-facing contract.
- Tool names are unchanged:
  - `init_experiment`
  - `run_experiment`
  - `log_experiment`
- Session can be resumed from repo files alone.
- JSONL history remains append-only with re-init segment behavior.
- Keep/discard/crash semantics are preserved closely.
- Skill remains the main setup/start UX.
- Any `/autoresearch` command is thin and optional.
- Pi-specific UI gaps are documented honestly.
- Another OpenClaw user can install and use it without local private assumptions.

# 12. Biggest Risks / Traps

- Making Codex CLI the de facto architecture.
- Rebranding the port around a provider instead of around `autoresearch`.
- Moving session files into hidden internal storage.
- Replacing the skill-first workflow with a plugin-only workflow.
- Overusing OpenClaw-native abstractions and drifting from upstream semantics.
- Treating Pi UI as core product behavior instead of host-specific presentation.
- Adding too many v1 tools/commands/services.
- Quietly changing commit/revert behavior.
- Writing cleaner but different prompts that alter agent loop behavior.

# 13. Copy/Adapt vs Rewrite Map

## Port Nearly Directly

- upstream README concepts and terminology
- skill structure and most wording
- tool names
- JSONL schema and config-header model
- root-level artifact names
- baseline/re-init semantics
- keep/discard/crash semantics
- ideas backlog semantics
- resume-from-files semantics

## Re-Express in OpenClaw Plugin Form

- tool registration
- lifecycle hook wiring
- optional command registration
- any prompt-build integration
- status presentation
- internal helper modules for state reconstruction/execution/logging

## Explicit Rewrite Area

Only rewrite these because the host demands it:

- Pi widget/dashboard UI
- fullscreen overlay/TUI interactions
- keyboard shortcut behavior
- Pi-specific command plumbing
- Pi-specific lifecycle names and event wiring

The decisive v1 recommendation is: **ship a source-faithful OpenClaw plugin + skill port with root-level files and preserved tool semantics, while treating provider backends as optional future adapters rather than the architecture itself.**