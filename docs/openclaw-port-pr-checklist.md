# OpenClaw Autoresearch — PR-by-PR Implementation Checklist

Reference plan snapshot:
- `AR-PORT-2026-03-13-A`
- `docs/plan-snapshots/AR-PORT-2026-03-13-A.md`

This checklist turns the current source-faithful, agent-agnostic port plan into a sequence of reviewable PRs.

---

## PR 1 — Freeze the source contract

Goal: lock the upstream target and the porting rules before implementation drifts.

### Deliverables
- [x] pin the upstream commit currently being ported
- [x] add `docs/upstream-parity-map.md`
- [x] add `docs/non-parity.md`
- [x] document exact canonical runtime files:
  - [x] `autoresearch.md`
  - [x] `autoresearch.sh`
  - [x] `autoresearch.jsonl`
  - [x] `autoresearch.ideas.md`
- [x] document exact tool names to preserve:
  - [x] `init_experiment`
  - [x] `run_experiment`
  - [x] `log_experiment`
- [x] document which upstream behaviors are core vs Pi-only UI/runtime

### Review bar
- [x] no implementation yet beyond doc scaffolding
- [x] parity map makes it obvious what is copy/adapt/rewrite
- [x] root-level file decision is clearly frozen for v1

---

## PR 2 — Plugin skeleton

Goal: create the OpenClaw plugin package in the right shape, without overbuilding.

### Deliverables
- [x] add plugin package / extension directory
- [x] add plugin manifest/config scaffolding
- [x] add plugin entrypoint
- [x] add internal module structure for:
  - [x] state reconstruction
  - [x] file IO
  - [x] experiment execution
  - [x] logging / JSONL append
  - [x] git actions
- [x] register placeholder v1 tools:
  - [x] `init_experiment`
  - [x] `run_experiment`
  - [x] `log_experiment`
- [x] consciously defer `autoresearch_status` in the skeleton to keep the v1 surface minimal

### Review bar
- [x] plugin shape follows existing OpenClaw patterns
- [x] no provider-specific runner is introduced as architecture
- [x] no hidden `.autoresearch/` redesign appears

---

## PR 3 — Skill port (minimal edit)

Goal: port `autoresearch-create` closely before changing behavior.

### Deliverables
- [x] add `skills/autoresearch-create/SKILL.md`
- [x] preserve upstream structure and wording wherever practical
- [ ] adapt only:
  - [x] tool invocation syntax
  - [x] Pi-only dashboard/widget references
  - [x] any host-specific lifecycle wording
- [x] keep skill-first UX as the main entry path
- [x] document any unavoidable wording divergence inline

### Review bar
- [x] skill still clearly feels like upstream `autoresearch-create`
- [x] “never stop” loop framing remains intact
- [x] no provider/runtime branding leaks into the skill

---

## PR 4 — `init_experiment` parity

Goal: land the first real core tool with faithful file semantics.

### Deliverables
- [x] implement `init_experiment`
- [x] write config header to `autoresearch.jsonl`
- [x] support re-init as a new baseline segment
- [x] preserve metric name / unit / direction semantics
- [x] preserve secondary metric contract shape
- [x] ensure root-level file discovery works

### Review bar
- [x] behavior matches upstream config-header / segment model
- [x] no destructive overwrite of prior history
- [x] root-level files remain canonical

---

## PR 5 — `run_experiment` parity

Goal: faithfully execute the benchmark command and capture the result contract.

### Deliverables
- [x] implement `run_experiment`
- [x] run command from repo root / correct working directory
- [x] capture duration, pass/fail, exit status, output tail
- [x] preserve primary metric + secondary metrics output expectations
- [x] document expected `autoresearch.sh` behavior clearly

### Review bar
- [x] tool surface still mirrors upstream semantics
- [x] no provider/runtime assumption is required to run the benchmark
- [x] result shape is sufficient for `log_experiment`

---

## PR 6 — `log_experiment` parity

Goal: preserve the core loop semantics that make the product what it is.

### Deliverables
- [x] implement `log_experiment`
- [x] append run entry to `autoresearch.jsonl`
- [x] preserve `keep` behavior
- [x] preserve `discard` behavior
- [x] preserve `crash` behavior
- [x] preserve commit/revert semantics closely to upstream
- [x] keep secondary metrics in the logged payload

### Review bar
- [x] append-only log remains the source of truth
- [x] keep/discard/crash semantics match upstream closely
- [x] no “cleaner” behavior change sneaks in here

---

## PR 7 — Resume + state reconstruction

Goal: make file-first resumability real.

### Deliverables
- [x] reconstruct state from `autoresearch.jsonl`
- [x] detect active mode from `autoresearch.md`
- [x] read `autoresearch.ideas.md` when relevant
- [x] optionally add thin `autoresearch_status`
- [x] add tests or fixtures for resumed sessions where practical

### Review bar
- [x] session can resume from files alone
- [x] hidden runtime state is not required
- [x] status surface is thin and truthful

---

## PR 8 — Minimal hooks / continuation behavior

Goal: add only the OpenClaw hooks that clearly map to upstream intent.

### Deliverables
- [x] add minimal `before_agent_start` integration if useful
- [x] inject short autoresearch context / file pointers, not huge prompts
- [x] evaluate `agent_end` continuation from `autoresearch.ideas.md`
- [x] add user-steer queueing only if it is reliable and simple

Notes:
- `before_agent_start` is implemented as a small OpenClaw hook registration only when the host API exposes a generic `registerHook` surface; the injected context is limited to root-file pointers and tool reminders.
- `agent_end` continuation from `autoresearch.ideas.md` was evaluated and deferred because the current workspace does not expose a stable, documented OpenClaw end-of-agent hook surface to implement it without brittle lifecycle assumptions.
- queued user-steer behavior was evaluated and deferred for the same reason; PR 8 intentionally avoids hidden queues or fragile input interception.

### Review bar
- [x] hooks are minimal and robust
- [x] no brittle lifecycle complexity is introduced
- [x] any non-parity is documented

---

## PR 9 — Optional `/autoresearch` command

Goal: add the command only if it stays thin and source-faithful.

### Deliverables
- [x] inspect whether the local OpenClaw plugin surface exposes a clean command registration path
- [x] implement `/autoresearch` via documented `api.registerCommand(...)`
- [x] keep the command thin and explicitly skill-first
- [x] detect canonical root-level session files and route users to setup or resume guidance
- [x] point users back to `autoresearch.md` instead of creating a second UI

Notes:
- The original defer rationale is now obsolete. Host docs at `/app/docs/tools/plugin.md` document `api.registerCommand(...)`, and `/app/extensions/device-pair/index.ts` provides a real in-tree example.
- This follow-up therefore implements `/autoresearch` as a thin text command: it checks for canonical repo-root files, reports a terse status when asked, and directs setup or resume back through `autoresearch.md` and `autoresearch-create`.
- The command remains optional polish, not architecture. The product entry path is still the skill plus canonical root files.

### Review bar
- [x] command is optional polish, not architecture
- [x] command does not redefine workflow semantics

---

## PR 10 — Shareability + open-source hardening

Goal: make it easy for another OpenClaw user to install and understand.

### Deliverables
- [x] write/refresh top-level `README.md`
- [x] add install instructions
- [x] add quickstart instructions
- [x] document non-parity vs Pi honestly
- [x] document upstream attribution and tracking
- [x] ensure no private local assumptions remain in docs or config

### Review bar
- [x] another OpenClaw user can adopt it without your local setup
- [x] repo reads like a standalone product, not a personal experiment
- [x] no provider-specific branding has become the identity

---

## PR 11 — Final parity review

Goal: verify that the port is still a port.

### Deliverables
- [ ] review every divergence against `docs/upstream-parity-map.md`
- [ ] confirm root-level file contract stayed intact
- [ ] confirm tool names stayed intact
- [ ] confirm skill-first UX stayed intact
- [ ] explicitly defer remaining Pi-only UI gaps

### Review bar
- [ ] final diff can still be described as host adaptation, not redesign
- [ ] the repo is ready to stay private for now or open-source later

---

## Guardrails for every PR

- [ ] preserve upstream names unless OpenClaw forces a change
- [ ] preserve root-level canonical files in v1
- [ ] do not make a provider/runtime the product identity
- [ ] do not move canonical state into hidden plugin storage
- [ ] do not add extra tools/services/commands unless clearly necessary
- [ ] document every meaningful divergence from upstream
