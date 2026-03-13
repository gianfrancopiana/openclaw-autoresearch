# OpenClaw Port Progress

## Status

Current state: PR 6 complete — `log_experiment` parity landed; PR 7 next

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
- [ ] decide exact `/autoresearch` command path

### Phase 2 — core tool port
- [x] port `init_experiment`
- [x] port `run_experiment`
- [x] port `log_experiment`
- [x] preserve root-level `autoresearch.jsonl` behavior
- [x] preserve config-header / segment behavior

### Phase 3 — resume behavior
- [ ] reconstruct state from `autoresearch.jsonl`
- [ ] detect active mode from `autoresearch.md`
- [ ] validate file-first resumability

### Phase 4 — entry surface
- [ ] implement skill-first start/resume flow
- [ ] add `/autoresearch` if it maps cleanly
- [ ] document fallback if command surface differs

### Phase 5 — non-core conveniences
- [ ] add lightweight status/readout
- [ ] add queued user steer behavior if cleanly supported
- [ ] add ideas-backlog continuation behavior if cleanly supported

### Phase 6 — docs and parity review
- [x] document non-parity items
- [ ] review all divergences against upstream
- [ ] tighten README/docs wording to reflect faithful port

## Blockers

- None currently for PR 6.
- GitHub remote now exists at `gianfrancopiana/openclaw-autoresearch`; collaborator access is being used via the current local auth context.

## Next recommended action

- Start PR 7: reconstruct state from `autoresearch.jsonl` for resume behavior and validate file-first resumability.
