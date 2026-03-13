# openclaw-autoresearch

Faithful OpenClaw port of [`davebcn87/pi-autoresearch`](https://github.com/davebcn87/pi-autoresearch).

The main entry is the bundled `autoresearch-create` skill. It creates and resumes experiments from these repo-root files:

- `autoresearch.md`
- `autoresearch.sh`
- `autoresearch.jsonl`
- `autoresearch.ideas.md`

Core tools:

- `init_experiment`
- `run_experiment`
- `log_experiment`

`/autoresearch` also exists, but it is thin and optional. This is not a 1:1 port of Pi's widget or dashboard runtime.

## Install

Load this repo path in OpenClaw plugin discovery, then restart the gateway:

```yaml
plugins:
  load:
    paths:
      - /absolute/path/to/openclaw-autoresearch
  entries:
    autoresearch:
      enabled: true
```

OpenClaw will discover `openclaw.plugin.json`, load `extensions/openclaw-autoresearch/index.ts`, and expose `autoresearch-create`.

Manual install is also possible: copy the plugin root, `extensions/openclaw-autoresearch/`, and `skills/autoresearch-create/` into your managed OpenClaw locations, then restart.

Verify:

- skill: `autoresearch-create`
- tools: `init_experiment`, `run_experiment`, `log_experiment`
- command: `/autoresearch`

## Use

In the repo you want to optimize:

1. Load the plugin.
2. Run `/skill:autoresearch-create`.
3. Answer the setup prompts.
4. Review `autoresearch.md` and `autoresearch.sh`.
5. Continue with `run_experiment` and `log_experiment`.

The session stays file-first, so a new agent can resume from the root files alone.

## Notes

This port aims for semantic fidelity, not UI parity. There is no Pi-style always-visible widget, fullscreen dashboard, or Pi-specific editor shortcut layer. Differences are tracked in [`docs/non-parity.md`](docs/non-parity.md).

Upstream and tracking docs:

- upstream repo: `https://github.com/davebcn87/pi-autoresearch`
- pinned upstream commit: `2227029fa5712944a36938b5fe59f709cb30ed22` (`2227029f`)
- docs: `docs/upstream-parity-map.md`, `docs/non-parity.md`, `docs/final-parity-review.md`, `docs/openclaw-port-progress.md`

## Validation

```bash
npm install --include=dev
npm run typecheck
npm test
npm run validate
```

The local test shim supports typechecking and tests without a full OpenClaw host checkout. Runtime behavior still depends on a real OpenClaw host.

## License

MIT
