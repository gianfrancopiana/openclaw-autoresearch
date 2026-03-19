---
name: autoresearch-create
description: Set up and run an autonomous experiment loop for any optimization target. Gathers what to optimize, then starts the loop immediately. Use when asked to "run autoresearch", "optimize X in a loop", "set up autoresearch for X", or "start experiments".
---

# Autoresearch

Autonomous experiment loop: try ideas, keep what works, discard what doesn't, never stop.

## Tools

- **`init_experiment`** — configure session (name, metric, unit, direction). Call again to re-initialize with a new baseline when the optimization target changes.
- **`run_experiment`** — runs the benchmark command, times it, captures output, parses `METRIC name=number` lines, and opens a pending run that must be logged before another run can start.
- **`log_experiment`** — records the pending run. `keep` auto-commits. `discard`/`crash` → `git checkout -- .` to revert. If the previous `run_experiment` captured the primary metric, `commit` and `metric` can be omitted and will default from the pending run.

## Setup

1. Ask (or infer): **Goal**, **Command**, **Metric** (+ direction), **Files in scope**, **Constraints**.
2. `git checkout -b autoresearch/<goal>-<date>`
3. Read the source files. Understand the workload deeply before writing anything.
4. Write `autoresearch.md` and `autoresearch.sh` (see below). Commit both.
5. `init_experiment` → `run_experiment` baseline → `log_experiment` → start looping immediately.

### `autoresearch.md`

This is the heart of the session. A fresh agent with no context should be able to read this file and run the loop effectively. Invest time making it excellent.

```markdown
# Autoresearch: <goal>

## Objective
<Specific description of what we're optimizing and the workload.>

## Metrics
- **Primary**: <name> (<unit>, lower/higher is better)
- **Secondary**: <name>, <name>, ...

## How to Run
`./autoresearch.sh` — outputs `METRIC name=number` lines.

## Files in Scope
<Every file the agent may modify, with a brief note on what it does.>

## Off Limits
<What must NOT be touched.>

## Constraints
<Hard rules: tests must pass, no new deps, etc.>

## What's Been Tried
<Update this section as experiments accumulate. Note key wins, dead ends,
and architectural insights so the agent doesn't repeat failed approaches.>
```

The plugin rewrites the Metrics, How to Run, What's Been Tried, and Plugin Checkpoint sections after init/log transitions. You may add context elsewhere in the file, but do not fight the plugin-managed sections.

### `autoresearch.sh`

Bash script (`set -euo pipefail`) that: pre-checks fast (syntax errors in <1s), runs the benchmark, outputs `METRIC name=number` lines. Keep it fast — every second is multiplied by hundreds of runs. Update it during the loop as needed.

## Loop Rules

**LOOP FOREVER.** Never ask "should I continue?" — the user expects autonomous work.

- **Primary metric is king.** Improved → `keep`. Worse/equal → `discard`. Secondary metrics rarely affect this.
- **Simpler is better.** Removing code for equal perf = keep. Ugly complexity for tiny gain = probably discard.
- **Don't thrash.** Repeatedly reverting the same idea? Try something structurally different.
- **Crashes:** fix if trivial, otherwise log and move on. Don't over-invest.
- **Think longer when stuck.** Re-read source files, study the profiling data, reason about what the CPU is actually doing. The best ideas come from deep understanding, not from trying random variations.
- **Resuming:** if `autoresearch.md` exists, read it plus `autoresearch.checkpoint.json`, then continue looping.
- **No raw benchmark exec:** during active autoresearch mode, benchmark/test commands should go through `run_experiment`, not raw `exec`/`bash`.

**NEVER STOP.** The user may be away for hours. Keep going until interrupted.

## Ideas Backlog

When you discover complex but promising optimizations that you decide not to pursue right now, **append them as bullet points to `autoresearch.ideas.md`**. Don't let good ideas get lost.

If the loop stops (context limit, crash, etc.) and `autoresearch.ideas.md` exists, you'll be asked to:
1. Read the ideas file and use it as inspiration for new experiment paths
2. Prune ideas that are duplicated, already tried, or clearly bad
3. Create experiments based on the remaining ideas
4. If nothing is left, try to come up with your own new ideas
5. If all paths are exhausted, delete `autoresearch.ideas.md` and write a final summary report

When there is no `autoresearch.ideas.md` file and the loop ends, the research is complete.

## User Steers

If the host exposes the OpenClaw message hooks, user steers that arrive while an experiment is running are captured and surfaced after your next `log_experiment` call. OpenClaw may also preserve the same steer in the normal followup backlog, so if the next turn repeats a steer you already saw in `log_experiment`, treat it as the same request rather than a brand new branch of work.

Finish the current experiment first, then incorporate the user's idea in the next experiment. Don't stop mid-experiment or ask for confirmation unless the user explicitly interrupts the loop.
