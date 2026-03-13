# openclaw-autoresearch

Faithful OpenClaw port of [`davebcn87/pi-autoresearch`](https://github.com/davebcn87/pi-autoresearch).

This repo keeps the upstream product shape intact where OpenClaw allows:

- skill-first setup and resume via `autoresearch-create`
- canonical repo-root files:
  - `autoresearch.md`
  - `autoresearch.sh`
  - `autoresearch.jsonl`
  - `autoresearch.ideas.md`
- the core tools:
  - `init_experiment`
  - `run_experiment`
  - `log_experiment`
- `/autoresearch` as a thin optional command, not a second UI

It is not a 1:1 port of Pi's widget/dashboard runtime. The contract here is semantic fidelity, not Pi UI parity.

## What It Does

Autoresearch runs an autonomous experiment loop for any optimization target:

`edit -> run benchmark -> log result -> keep/discard/crash -> repeat`

Typical uses:

- speed up tests or builds
- reduce bundle size
- tune benchmark scripts
- iterate on training or evaluation workloads

The extension supplies durable experiment tools. The skill gathers setup context, writes the root files, and starts the loop.

## Repository Layout

- `extensions/openclaw-autoresearch/`: OpenClaw plugin implementation
- `skills/autoresearch-create/`: primary user entry path
- `openclaw.plugin.json`: plugin manifest, including bundled skills
- `docs/upstream-parity-map.md`: upstream contract and copy/adapt/defer map
- `docs/non-parity.md`: honest non-parity notes vs Pi

## Install

Prerequisites:

- a working OpenClaw installation
- access to your OpenClaw config and plugin load paths
- `git` available in the repo you want to optimize

### Option A: load this repo directly during development

OpenClaw's plugin docs support loading plugins from an extension directory or `plugins.load.paths`. Point OpenClaw at this repo, then restart the gateway.

Example config shape:

```yaml
plugins:
  load:
    paths:
      - /absolute/path/to/openclaw-autoresearch
  entries:
    autoresearch:
      enabled: true
```

OpenClaw discovers `openclaw.plugin.json`, loads `extensions/openclaw-autoresearch/index.ts`, and exposes the bundled `skills/autoresearch-create` skill.

### Option B: copy into managed plugin/skill locations

If you prefer manual installation, copy this repo into one of your OpenClaw plugin discovery locations, or copy the relevant pieces into your managed locations:

- plugin root containing `openclaw.plugin.json`
- `extensions/openclaw-autoresearch/`
- `skills/autoresearch-create/`

Then restart OpenClaw and verify the plugin is loaded.

### Verify install

After restart, confirm all three surfaces are available:

- skill: `autoresearch-create`
- tools: `init_experiment`, `run_experiment`, `log_experiment`
- command: `/autoresearch`

## Quickstart

In the repo you want to optimize:

1. Load this plugin in OpenClaw.
2. Start the skill with `/skill:autoresearch-create`.
3. Answer the setup questions:
   - optimization goal
   - benchmark command
   - primary metric and direction
   - files in scope
   - constraints
4. Let the skill create the branch and root files.
5. Review `autoresearch.md` and `autoresearch.sh`.
6. Continue the loop. The agent should use `run_experiment` and `log_experiment` against the canonical root files.

The session state lives in files at the repo root. A fresh agent should be able to resume from those files alone.

## Daily Use

Primary path:

- start or resume through `/skill:autoresearch-create`
- treat `autoresearch.md` as the canonical session brief

Optional helper:

- `/autoresearch`
- `/autoresearch status`

The command is intentionally thin. It detects canonical root files, reports terse status, and points the agent back to `autoresearch.md`. It is not a dashboard replacement.

## Canonical Root Files

These files are user-facing and preserved at repo root in v1:

- `autoresearch.md`: session brief, scope, constraints, and accumulated learnings
- `autoresearch.sh`: benchmark entrypoint; should emit `METRIC name=number` lines
- `autoresearch.jsonl`: append-only run ledger and baseline segments
- `autoresearch.ideas.md`: backlog for promising ideas worth revisiting later

This repo does not move the canonical session state under hidden plugin storage.

## Current Product Shape

This repository should be described as:

> a faithful OpenClaw port of `pi-autoresearch`, with a skill-first entry path, canonical repo-root session files, and a thin optional `/autoresearch` command

That means:

- the upstream extension + skill split is preserved
- the upstream file and tool names are preserved
- file-first resumability is preserved
- OpenClaw-specific code is limited to plugin registration, hooks, and the thin command surface

## Known Non-Parity Vs Pi

Current intentional non-parity:

- no Pi-style always-visible widget above the editor
- no fullscreen dashboard or TUI parity
- no `Ctrl+X`, `Escape`, or other Pi-specific editor shortcuts
- different hook names and runtime plumbing under OpenClaw
- `/autoresearch` is text-first and optional, not the primary UX

Non-parity is documented in [`docs/non-parity.md`](docs/non-parity.md). The full upstream copy/adapt/defer map lives in [`docs/upstream-parity-map.md`](docs/upstream-parity-map.md).
The final PR 11 audit is summarized in [`docs/final-parity-review.md`](docs/final-parity-review.md).

## Upstream Attribution And Tracking

Source project:

- upstream repo: `https://github.com/davebcn87/pi-autoresearch`
- pinned upstream commit for this port: `2227029fa5712944a36938b5fe59f709cb30ed22` (`2227029f`)

Tracking docs in this repo:

- `docs/upstream-parity-map.md`
- `docs/non-parity.md`
- `docs/final-parity-review.md`
- `docs/openclaw-port-progress.md`

The goal is to keep future diffs against upstream understandable instead of silently redesigning the product.

## Status And Limits

What is here now:

- the three core tools are implemented
- skill-first start/resume is implemented
- `/autoresearch` exists as a thin optional command
- minimal OpenClaw hook integration exists

What is not here:

- Pi dashboard/widget parity
- brittle queued-steer or agent-end continuation behavior
- any provider-specific runner as the product identity

## License

MIT
