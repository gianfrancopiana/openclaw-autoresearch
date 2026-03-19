# openclaw-autoresearch

Autonomous experiment loop for any optimization target.

Faithful OpenClaw port of [`davebcn87/pi-autoresearch`](https://github.com/davebcn87/pi-autoresearch).

## How it works

The agent runs a loop: edit code, run a benchmark, measure the result, keep or discard. Each iteration is logged. The loop runs autonomously until interrupted.

Three tools drive the loop:

| Tool | What it does |
|---|---|
| `init_experiment` | Configures the session: name, primary metric, unit, direction (lower/higher). Re-calling starts a new segment. |
| `run_experiment` | Executes a shell command, times it, captures stdout/stderr, parses `METRIC name=number` lines, and opens a pending experiment window that must be logged before another run can start. |
| `log_experiment` | Records the pending run. `keep` auto-commits to git. `discard`/`crash` log without committing. If the prior `run_experiment` captured the primary metric, `log_experiment` can infer `commit` and `metric` automatically. |

Each tool also accepts an optional `cwd` so callers can target a nested repo explicitly instead of relying on the current session working directory.

All state lives in five repo-root files:

| File | Purpose |
|---|---|
| `autoresearch.md` | Session doc. The plugin keeps the Metrics, How to Run, What's Been Tried, and Plugin Checkpoint sections synchronized so resumes are less agent-dependent. |
| `autoresearch.sh` | Benchmark script. Outputs `METRIC name=number` lines. |
| `autoresearch.jsonl` | Structured log: config headers + experiment entries (metric, status, timestamp, segment, commit hash). |
| `autoresearch.ideas.md` | Backlog of promising ideas not yet tried. Optional. |
| `autoresearch.checkpoint.json` | Plugin-managed checkpoint: latest logged state, recent runs, and any pending unlogged run. |

The design is file-first: any agent can pick up the repo-root files and continue the loop without prior context.

## Install

Requires OpenClaw `2026.3.13` or newer.

Use OpenClaw's plugin installer:

```bash
openclaw plugins install @gianfrancopiana/openclaw-autoresearch
```

If you're running from a local OpenClaw checkout, use:

```bash
pnpm openclaw plugins install @gianfrancopiana/openclaw-autoresearch
```

For local plugin development, link your working copy instead of copying files:

```bash
openclaw plugins install --link /absolute/path/to/openclaw-autoresearch
# or from a local OpenClaw checkout:
# pnpm openclaw plugins install --link /absolute/path/to/openclaw-autoresearch
```

For a packaged local install, build the tarball and install that artifact:

```bash
npm install
npm pack
openclaw plugins install ./gianfrancopiana-openclaw-autoresearch-<version>.tgz
```

The install command records the plugin, enables it, and exposes the plugin surfaces on restart. The installer reads `package.json#openclaw.extensions`, loads the root [`index.ts`](index.ts), and discovers the manifest in [`openclaw.plugin.json`](openclaw.plugin.json).

Verify:

- skill: `autoresearch-create`
- tools: `init_experiment`, `run_experiment`, `log_experiment`
- command: `/autoresearch` (recommended)
- direct skill fallback: `/skill autoresearch-create`

Prefer the explicit `/autoresearch` command surface in OpenClaw. The auto-generated native skill alias `/autoresearch_create` may not trigger reliably on some hosts, so use `/skill autoresearch-create` if you need to invoke the skill directly.

## Workflow Guarantees

- `run_experiment` refuses to start a second run until the previous one is logged.
- `run_experiment` parses `METRIC name=number` lines and stores a pending run so `log_experiment` can default from the actual benchmark output.
- During active autoresearch mode, raw benchmark execution through OpenClaw `exec`/`bash` is blocked. Use `run_experiment` instead.
- `autoresearch_status` warns when a pending run is unlogged or git history has moved ahead of the last logged experiment.
- The plugin updates `autoresearch.checkpoint.json` and refreshes plugin-managed sections in `autoresearch.md` after init, run, and log transitions.

## Use

In the repo you want to optimize:

1. Load the plugin.
2. Run `/autoresearch` or `/autoresearch setup <goal>`.
3. Send a normal message with the goal, command, metric (+ direction), files in scope, and constraints.
4. If you need the raw skill invocation, use `/skill autoresearch-create`.
5. The agent writes `autoresearch.md` and `autoresearch.sh`, runs a baseline with `run_experiment`, then records it with `log_experiment`.
6. Use `/autoresearch` or `/autoresearch status` to re-prime context on a later turn.

To resume an existing session, a new agent reads the repo-root files and continues from where the last one stopped.

### User steers

Messages sent while an experiment is running are queued and surfaced after the next `log_experiment`. The agent finishes the current experiment before incorporating the steer.

### Ideas backlog

When the agent discovers promising but complex ideas mid-loop, it appends them to `autoresearch.ideas.md`. On resume, the agent reads the backlog, prunes stale entries, and uses the remaining ideas as experiment paths.

## Upstream reference

This port preserves upstream semantics, names, and file contracts while adapting presentation to OpenClaw. There is no Pi-style widget, dashboard, or editor shortcut layer. Remaining differences are tracked in [`docs/non-parity.md`](docs/non-parity.md).

- upstream repo: `https://github.com/davebcn87/pi-autoresearch`
- pinned upstream commit: `2227029fa5712944a36938b5fe59f709cb30ed22` (`2227029f`)

## Validation

```bash
npm install --include=dev
npm run typecheck
npm test
npm run validate
npm run release:verify
```

Release instructions, including npm 2FA publishing, live in [`RELEASING.md`](RELEASING.md).

The local test shim supports typechecking and tests without a full OpenClaw host checkout. Runtime behavior depends on a real OpenClaw host.

## License

MIT
