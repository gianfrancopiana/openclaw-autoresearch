# OpenClaw Port Progress

## Status

Current state: post-plan validation follow-up in progress — local `npm run validate` now passes on the validation branch, giving the repo a real typecheck + test path in addition to the completed PR 1–11 port plan

## Current reference snapshot

- Plan reference name: `AR-PORT-2026-03-13-A`
- Full plan snapshot: `docs/plan-snapshots/AR-PORT-2026-03-13-A.md`
- PR checklist: `docs/openclaw-port-pr-checklist.md`

## Repository strategy

- Local repo path: `/home/node/.openclaw/workspace/projects/openclaw-autoresearch`
- Source repo: `https://github.com/davebcn87/pi-autoresearch`
- Local remote: `upstream`
- Hosted repo: `https://github.com/gianfrancopiana/openclaw-autoresearch`
- Local remotes: `origin` (hosted repo), `upstream` (source repo)

## Working decisions

- This should be a **new dedicated repo**, but seeded from upstream history rather than created as a blank greenfield project.
- We are treating this as a **faithful port**, not a redesign.
- Root-level session files will be preserved in v1.
- Core tool names will be preserved in v1.
- The architecture should stay **agent/runtime-agnostic** in the OpenClaw style; no single provider CLI should become the product identity.
- Plugin design should follow existing OpenClaw patterns: tools, commands, hooks, and services where appropriate.

## Phase checklist

### Phase 0 — source capture
- [x] review upstream README
- [x] review upstream extension entrypoint
- [x] review upstream skill
- [x] decide source-first vs redesign-first approach
- [x] write versioned port plan into repo docs
- [x] run fresh Codex review against cloned upstream + OpenClaw plugin examples
- [x] pin the upstream commit being ported (`2227029f`)
- [x] add `docs/upstream-parity-map.md`
- [x] add `docs/non-parity.md`

### Phase 1 — mechanical import
- [x] create OpenClaw plugin skeleton
- [x] create OpenClaw skill skeleton
- [x] map upstream names/files to OpenClaw locations
- [x] decide exact `/autoresearch` command path

### Phase 2 — core tool port
- [x] port `init_experiment`
- [x] port `run_experiment`
- [x] port `log_experiment`
- [x] preserve root-level `autoresearch.jsonl` behavior
- [x] preserve config-header / segment behavior

### Phase 3 — resume behavior
- [x] reconstruct state from `autoresearch.jsonl`
- [x] detect active mode from `autoresearch.md`
- [x] validate file-first resumability

### Phase 4 — entry surface
- [x] implement skill-first start/resume flow
- [x] evaluate `/autoresearch` command path
- [x] implement thin `/autoresearch` command via documented `registerCommand(...)`
- [x] keep `/autoresearch` thin and route users back to `autoresearch.md`

### Phase 5 — non-core conveniences
- [x] add lightweight status/readout
- [ ] add queued user steer behavior if cleanly supported
- [ ] add ideas-backlog continuation behavior if cleanly supported
- [x] add minimal before-agent autoresearch context injection
- [x] explicitly defer queued steers and agent-end continuation when hook support would be brittle

### Phase 6 — docs and parity review
- [x] document non-parity items
- [x] review all divergences against upstream
- [x] tighten README/docs wording to reflect faithful port
- [x] add a concise final parity review doc
- [x] confirm root-level file contract, tool names, and skill-first UX stayed intact
- [x] explicitly defer remaining Pi-only UI/runtime gaps in-versioned docs

### Phase 7 — shareability + open-source hardening
- [x] refresh top-level `README.md`
- [x] document OpenClaw install/setup story for another user
- [x] document quickstart and canonical repo-root workflow
- [x] make public docs self-sufficient without private chat context
- [x] document honest product shape, attribution, and current limits

## Blockers

- No stable OpenClaw hook example or SDK source is present in this workspace beyond tool registration imports, so PR 8 limits itself to a conservative `before_agent_start` registration path and documents the rest as deferred.
- The earlier PR 9 defer conclusion is superseded. We now have documented host command support in `/app/docs/tools/plugin.md` plus a real `api.registerCommand(...)` example in `/app/extensions/device-pair/index.ts`, so this follow-up implements `/autoresearch` as a thin command that detects canonical root files and routes users back to `autoresearch.md`.
- GitHub remote now exists at `gianfrancopiana/openclaw-autoresearch`; collaborator access is being used via the current local auth context.

## Next recommended action

- Validate the README against a clean OpenClaw install path once the repo is exercised outside this workspace.
