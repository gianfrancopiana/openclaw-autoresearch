# OpenClaw Port Progress

## Status

Current state: planning / source capture

## Repository strategy

- Local repo path: `/home/node/.openclaw/workspace/projects/openclaw-autoresearch`
- Source repo: `https://github.com/davebcn87/pi-autoresearch`
- Local remote: `upstream`
- Intended hosted repo: private repo under `gianfrancopiana` once GitHub auth is available for that account

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

### Phase 1 — mechanical import
- [ ] create OpenClaw plugin skeleton
- [ ] create OpenClaw skill skeleton
- [ ] map upstream names/files to OpenClaw locations
- [ ] decide exact `/autoresearch` command path

### Phase 2 — core tool port
- [ ] port `init_experiment`
- [ ] port `run_experiment`
- [ ] port `log_experiment`
- [ ] preserve root-level `autoresearch.jsonl` behavior
- [ ] preserve config-header / segment behavior

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
- [ ] document non-parity items
- [ ] review all divergences against upstream
- [ ] tighten README/docs wording to reflect faithful port

## Blockers

- GitHub CLI is currently authenticated as `hub-computer`, not `gianfrancopiana`, so the private GitHub repo has not been created yet.

## Next recommended action

- Authenticate `gh` as `gianfrancopiana`, then create a private remote repo and push this local working repo.
