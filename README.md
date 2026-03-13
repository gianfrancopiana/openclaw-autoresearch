# openclaw-autoresearch

Faithful OpenClaw port of [`davebcn87/pi-autoresearch`](https://github.com/davebcn87/pi-autoresearch).

The primary entry path is the bundled `autoresearch-create` skill. It creates and resumes experiments through canonical repo-root files:

- `autoresearch.md`
- `autoresearch.sh`
- `autoresearch.jsonl`
- `autoresearch.ideas.md`

The core tool surface stays aligned with upstream:

- `init_experiment`
- `run_experiment`
- `log_experiment`

`/autoresearch` also exists, but it stays thin and optional. This is not a 1:1 port of Pi's widget or dashboard runtime; the goal is semantic fidelity, not UI parity.

Autoresearch runs an experiment loop around a benchmark or evaluation target:

`edit -> run benchmark -> log result -> keep/discard/crash -> repeat`

Typical uses include test or build speed, bundle size, benchmark tuning, and training or evaluation workflows. Session state remains file-first so a new agent can resume from the root files alone.

## Layout

- `extensions/openclaw-autoresearch/`: OpenClaw plugin implementation
- `skills/autoresearch-create/`: primary user entry path
- `openclaw.plugin.json`: plugin manifest, including bundled skills
- `docs/upstream-parity-map.md`: upstream contract and copy/adapt/defer map
- `docs/non-parity.md`: non-parity notes vs Pi

## Install

Load this repo directly through OpenClaw's plugin discovery config, then restart the gateway. Example shape:

```yaml
plugins:
  load:
    paths:
      - /absolute/path/to/openclaw-autoresearch
  entries:
    autoresearch:
      enabled: true
```

OpenClaw will discover `openclaw.plugin.json`, load `extensions/openclaw-autoresearch/index.ts`, and expose the bundled `autoresearch-create` skill.

If you prefer a manual install, copy the plugin root, `extensions/openclaw-autoresearch/`, and `skills/autoresearch-create/` into your managed OpenClaw locations, then restart.

After restart, verify these surfaces are available:

- skill: `autoresearch-create`
- tools: `init_experiment`, `run_experiment`, `log_experiment`
- command: `/autoresearch`

## Use

In the repo you want to optimize:

1. Load this plugin in OpenClaw.
2. Start or resume with `/skill:autoresearch-create`.
3. Answer the setup prompts for goal, benchmark command, metric, scope, and constraints.
4. Let the skill create the branch and root files.
5. Review `autoresearch.md` and `autoresearch.sh`.
6. Continue the loop with `run_experiment` and `log_experiment`.

`autoresearch.md` is the canonical session brief. `/autoresearch` can report terse status, but it is not the primary UX and does not replace a dashboard.

## Non-Parity And Tracking

Intentional non-parity is limited and documented: there is no Pi-style always-visible widget, no fullscreen dashboard or TUI parity, no Pi-specific editor shortcuts, and OpenClaw uses different runtime plumbing. [`docs/non-parity.md`](docs/non-parity.md) covers the differences in more detail.

Upstream attribution and tracking:

- upstream repo: `https://github.com/davebcn87/pi-autoresearch`
- pinned upstream commit for this port: `2227029fa5712944a36938b5fe59f709cb30ed22` (`2227029f`)
- docs: `docs/upstream-parity-map.md`, `docs/non-parity.md`, `docs/final-parity-review.md`, `docs/openclaw-port-progress.md`

## Validation

Local validation is part of the documented workflow and remains available:

```bash
npm install --include=dev
npm run typecheck
npm test
npm run validate
```

The local test shim allows typechecking and tests without a full OpenClaw host checkout. Runtime behavior still depends on a real OpenClaw host.

## License

MIT
