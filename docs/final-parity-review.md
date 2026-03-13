# Final Parity Review

This document is the PR 11 audit for the OpenClaw port against upstream `davebcn87/pi-autoresearch` at commit `2227029fa5712944a36938b5fe59f709cb30ed22` (`2227029f`).

Verdict: this repo is still best described as a faithful host adaptation, not a redesign.

## What stayed intact

- Canonical repo-root file contract stayed intact:
  - `autoresearch.md`
  - `autoresearch.sh`
  - `autoresearch.jsonl`
  - `autoresearch.ideas.md`
- Canonical tool names stayed intact:
  - `init_experiment`
  - `run_experiment`
  - `log_experiment`
- Skill-first UX stayed intact:
  - `autoresearch-create` remains the primary start and resume path
  - `/autoresearch` remains a thin optional helper, not a second product surface
- File-first resumability stayed intact:
  - session state is reconstructed from repo-root files
  - hidden plugin storage is not the canonical state boundary

## Audited divergences vs upstream

| Surface | Upstream | OpenClaw port | Review |
|---|---|---|---|
| Extension registration | Pi extension APIs | OpenClaw plugin registration and manifest | Required host adaptation; product semantics unchanged. |
| Skill wording | Pi-specific references to dashboard and queued steers | OpenClaw wording removes Pi-only UI/runtime assumptions | Correct adaptation; keeps the upstream loop and setup contract intact. |
| `/autoresearch` | Dashboard-oriented Pi command | Thin text command that detects canonical files and routes back to `autoresearch.md` | Acceptable adaptation; explicitly not a dashboard replacement. |
| `before_agent_start` context | Pi hook injects autoresearch guidance | OpenClaw hook adds short canonical-file guidance when the host exposes `registerHook` | Acceptable adaptation; intent preserved. |
| Status surface | Pi widget plus fullscreen dashboard | Read-only `autoresearch_status` helper tool plus `/autoresearch status` text output | Small additive helper; does not replace the core tool/file contract. |
| Queued user steers | Implemented in Pi runtime | Deferred | Honest non-parity due to host hook uncertainty. |
| `agent_end` continuation from ideas backlog | Implemented in Pi runtime | Deferred | Honest non-parity due to host hook uncertainty. |
| Widget/dashboard/shortcuts | Pi-only editor UI (`Ctrl+X`, `Escape`, widget) | Deferred | Honest non-parity; explicitly outside the v1 OpenClaw contract. |

## Why this is still a port

- The user-facing product identity is still `autoresearch`, not an OpenClaw- or provider-branded redesign.
- The durable contract is still upstream-shaped: skill plus repo-root files plus the three canonical tools.
- The main behavioral loop is still upstream-shaped: edit, run, log, keep/discard/crash, repeat.
- Remaining differences are concentrated in host integration and Pi-only UI/runtime behavior.

## Explicit non-parity carried forward

These are still deferred and should remain described as non-parity, not as missing core implementation:

- Pi always-visible widget
- Pi fullscreen dashboard / inline TUI
- Pi keyboard shortcuts such as `Ctrl+X` and `Escape`
- queued user-steer delivery
- `agent_end` ideas-backlog continuation

## Audit outcome

The repo is in a state that can be explained concisely and consistently:

> a faithful OpenClaw port of `pi-autoresearch` that preserves the root-file contract, canonical tool names, and skill-first workflow, while explicitly deferring Pi-only UI/runtime features
