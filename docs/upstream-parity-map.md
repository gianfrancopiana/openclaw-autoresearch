# Upstream Parity Map

Pinned upstream source for this port:

- Repo: `https://github.com/davebcn87/pi-autoresearch`
- Branch at capture time: `main`
- Pinned commit: `2227029fa5712944a36938b5fe59f709cb30ed22`
- Short commit: `2227029f`

This document is the contract for a **faithful OpenClaw port**. It exists to stop implementation drift.

## Porting rule

Default decision order:

1. **Copy** upstream semantics, names, and file layout.
2. **Adapt** only when Pi runtime/UI APIs do not map cleanly to OpenClaw.
3. **Defer** rather than invent a cleaner-but-different pattern.

## Canonical runtime files (preserve in v1)

These are canonical and user-facing in v1. They stay at repo root.

- `autoresearch.md`
- `autoresearch.sh`
- `autoresearch.jsonl`
- `autoresearch.ideas.md`

Do **not** move these under `.autoresearch/` in v1.

## Canonical tool names (preserve in v1)

- `init_experiment`
- `run_experiment`
- `log_experiment`

These names are part of the product identity and should remain unchanged unless OpenClaw absolutely forces a change.

## Copy / adapt / rewrite map

| Upstream surface | V1 decision | Notes |
|---|---|---|
| Extension + skill split | **Copy** | OpenClaw plugin is the extension analog; skill remains a first-class part of the product. |
| Product name `autoresearch` | **Copy** | Do not rebrand around any provider or runner. |
| `autoresearch.md` at repo root | **Copy** | Central session brief and resumability contract. |
| `autoresearch.sh` at repo root | **Copy** | Benchmark entrypoint stays user-visible and editable. |
| `autoresearch.jsonl` at repo root | **Copy** | Append-only ledger remains the source of truth. |
| `autoresearch.ideas.md` at repo root | **Copy** | Keep the backlog/continuation pattern intact. |
| `init_experiment` semantics | **Copy** | Writes config header, initializes segment/baseline semantics. |
| `run_experiment` semantics | **Copy** | Runs benchmark command, times wall clock, captures output/metrics. |
| `log_experiment` semantics | **Copy** | Keep/discard/crash behavior must stay close to upstream. |
| Re-init creates a new baseline segment | **Copy** | Never destructively overwrite prior history. |
| Secondary metrics contract | **Copy** | `metrics` payload remains part of the interface. |
| Skill-first start/resume flow | **Copy** | The skill remains the main entry path in v1. |
| `git checkout -b autoresearch/<goal>-<date>` flow | **Copy** | Preserve user-facing branch workflow unless OpenClaw forces a small syntax/documentation change. |
| “Never stop” loop framing | **Copy** | Core operating philosophy stays intact. |
| Resume from files alone | **Copy** | Hidden runtime state must not be required. |
| Status widget above the editor | **Rewrite / defer** | Pi UI concept has no 1:1 OpenClaw equivalent; replace with thinner status surfaces later. |
| Full inline dashboard + `Ctrl+X` | **Rewrite / defer** | Non-parity item for v1. |
| `Escape`-driven UI interrupts | **Rewrite / defer** | OpenClaw interaction model differs. |
| `pi.registerTool(...)` calls | **Adapt** | Re-express as OpenClaw plugin tool registration. |
| `pi.registerCommand("autoresearch", ...)` | **Adapt** | Optional `/autoresearch` command only if it stays thin and source-faithful. |
| `before_agent_start` injection of `autoresearch.md` | **Adapt** | Use the closest OpenClaw hook, but keep the intent: point the agent at the canonical files. |
| `agent_end` continuation via `autoresearch.ideas.md` | **Adapt** | Only if OpenClaw hooks support this cleanly. |
| `input` hook for queued user steers | **Adapt / maybe defer** | Keep semantics if reliable; defer if brittle. |
| `session_start` / `session_switch` / `session_fork` / `session_tree` reconstruction hooks | **Adapt / maybe defer** | Preserve resume behavior, but do not force exact event parity. |
| Pi packaging/install instructions | **Rewrite** | Replace with OpenClaw installation and usage docs. |
| Provider-specific runners | **Defer from core architecture** | Allowed later as adapters only, never as product identity. |

## Core behavior that must survive the port

These are the behaviors that make the product what it is:

- setup asks or infers goal, command, metric, files in scope, and constraints
- root-level session files are created and then become the durable state boundary
- the loop stays: edit → run → log → keep/discard/crash → repeat
- the JSONL history is append-only and segment-aware
- improvements are kept; failed ideas are reverted or discarded
- ideas backlog is preserved for continuation after interruptions
- a fresh agent can resume from files alone

## Pi-only behavior that should not drive architecture

These are real upstream features, but they are **host-specific presentation/runtime**, not the core contract:

- always-visible widget above the editor
- fullscreen dashboard / inline TUI
- keyboard shortcuts (`Ctrl+X`, `Escape`)
- exact Pi event model and command plumbing

## OpenClaw implementation boundary

OpenClaw-native code should be limited to:

- plugin tool registration
- optional command registration
- minimal hooks/services if truly needed
- internal helpers for file IO, state reconstruction, execution, and logging

It should **not** redefine:

- canonical file names
- tool names
- loop semantics
- product identity
