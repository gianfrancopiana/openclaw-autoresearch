/**
 * autoresearch — Pi Extension
 *
 * Generic autonomous experiment loop infrastructure.
 * Domain-specific behavior comes from skills (what command to run, what to optimize).
 *
 * Provides:
 * - `run_experiment` tool — runs any command, times it, captures output, detects pass/fail
 * - `log_experiment` tool — records results with session-persisted state
 * - Status widget showing experiment count + best metric
 * - Ctrl+R toggle to expand/collapse full dashboard inline above the editor
 *
 * Supports multiple metrics (primary + secondaries) and "new baseline" marking
 * for tracking the reference point against which improvements are measured.
 */

import type {
  ExtensionAPI,
  ExtensionContext,
  Theme,
} from "@mariozechner/pi-coding-agent";
import { truncateTail } from "@mariozechner/pi-coding-agent";
import { StringEnum } from "@mariozechner/pi-ai";
import { Text, truncateToWidth } from "@mariozechner/pi-tui";
import { Type } from "@sinclair/typebox";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface ExperimentResult {
  commit: string;
  metric: number;
  /** Additional tracked metrics: { name: value } */
  metrics: Record<string, number>;
  status: "keep" | "discard" | "crash";
  description: string;
  /** If true, this row becomes the new reference baseline */
  newBaseline: boolean;
  timestamp: number;
}

interface MetricDef {
  name: string;
  unit: string;
}

interface ExperimentState {
  results: ExperimentResult[];
  /** Best primary metric = metric from most recent newBaseline row */
  bestMetric: number | null;
  bestDirection: "lower" | "higher";
  metricName: string;
  metricUnit: string;
  /** Definitions for secondary metrics (order preserved) */
  secondaryMetrics: MetricDef[];
  runTag: string | null;
  totalExperiments: number;
}

interface RunDetails {
  command: string;
  exitCode: number | null;
  durationSeconds: number;
  passed: boolean;
  crashed: boolean;
  timedOut: boolean;
  tailOutput: string;
}

interface LogDetails {
  experiment: ExperimentResult;
  state: ExperimentState;
}

// ---------------------------------------------------------------------------
// Tool Schemas
// ---------------------------------------------------------------------------

const RunParams = Type.Object({
  command: Type.String({
    description:
      "Shell command to run (e.g. 'pnpm test:vitest', 'uv run train.py')",
  }),
  timeout_seconds: Type.Optional(
    Type.Number({
      description: "Kill after this many seconds (default: 600)",
    })
  ),
});

const LogParams = Type.Object({
  commit: Type.String({ description: "Git commit hash (short, 7 chars)" }),
  metric: Type.Number({
    description:
      "The primary optimization metric value (e.g. seconds, val_bpb). 0 for crashes.",
  }),
  status: StringEnum(["keep", "discard", "crash"] as const),
  description: Type.String({
    description: "Short description of what this experiment tried",
  }),
  metrics: Type.Optional(
    Type.Record(Type.String(), Type.Number(), {
      description:
        'Additional metrics to track as { name: value } pairs, e.g. { "compile_µs": 4200, "render_µs": 9800 }. These are shown alongside the primary metric for tradeoff monitoring.',
    })
  ),
  new_baseline: Type.Optional(
    Type.Boolean({
      description:
        "Mark this experiment as the new baseline reference point (default: false). The most recent baseline is used as the 'best' metric for comparison.",
    })
  ),
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Format a number with comma-separated thousands: 15586 → "15,586" */
function commas(n: number): string {
  const s = String(Math.round(n));
  const parts: string[] = [];
  for (let i = s.length; i > 0; i -= 3) {
    parts.unshift(s.slice(Math.max(0, i - 3), i));
  }
  return parts.join(",");
}

/** Format number with commas, preserving one decimal for fractional values */
function fmtNum(n: number, decimals: number = 0): string {
  if (decimals > 0) {
    const int = Math.floor(Math.abs(n));
    const frac = (Math.abs(n) - int).toFixed(decimals).slice(1); // ".3"
    return (n < 0 ? "-" : "") + commas(int) + frac;
  }
  return commas(n);
}

function formatMetric(value: number | null, unit: string): string {
  if (value === null) return "—";
  if (unit === "s") return `${fmtNum(value, 1)}s`;
  if (unit === "µs") return `${fmtNum(value)}µs`;
  if (unit === "ms") return `${fmtNum(value)}ms`;
  if (Math.abs(value) >= 1000 && value === Math.round(value)) return fmtNum(value);
  return value.toFixed(6);
}

function formatCompact(value: number | null, unit: string): string {
  if (value === null) return "—";
  if (unit === "s") return `${fmtNum(value, 1)}s`;
  if (unit === "µs" || unit === "ms") return `${fmtNum(value)}${unit}`;
  if (Math.abs(value) >= 1000 && value === Math.round(value)) return fmtNum(value);
  return value.toFixed(4);
}

function isBetter(
  current: number,
  best: number,
  direction: "lower" | "higher"
): boolean {
  return direction === "lower" ? current < best : current > best;
}

/** Find the metric value from the most recent new-baseline row */
function findBaselineMetric(results: ExperimentResult[]): number | null {
  for (let i = results.length - 1; i >= 0; i--) {
    if (results[i].newBaseline) return results[i].metric;
  }
  return null;
}

/**
 * Find secondary metric baselines from the most recent new-baseline row.
 * For metrics that didn't exist at baseline time, falls back to the first
 * occurrence of that metric across all results.
 */
function findBaselineSecondary(
  results: ExperimentResult[],
  knownMetrics?: MetricDef[]
): Record<string, number> {
  // Start with the most recent baseline's metrics
  let base: Record<string, number> = {};
  for (let i = results.length - 1; i >= 0; i--) {
    if (results[i].newBaseline) {
      base = { ...(results[i].metrics ?? {}) };
      break;
    }
  }

  // Fill in any known metrics missing from baseline with their first occurrence
  if (knownMetrics) {
    for (const sm of knownMetrics) {
      if (base[sm.name] === undefined) {
        for (const r of results) {
          const val = (r.metrics ?? {})[sm.name];
          if (val !== undefined) {
            base[sm.name] = val;
            break;
          }
        }
      }
    }
  }

  return base;
}

// ---------------------------------------------------------------------------
// Extension
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Dashboard table renderer (pure function, no UI deps)
// ---------------------------------------------------------------------------

function renderDashboardLines(
  st: ExperimentState,
  width: number,
  th: Theme
): string[] {
  const lines: string[] = [];

  if (st.totalExperiments === 0) {
    lines.push(`  ${th.fg("dim", "No experiments yet.")}`);
    return lines;
  }

  const kept = st.results.filter((r) => r.status === "keep").length;
  const discarded = st.results.filter((r) => r.status === "discard").length;
  const crashed = st.results.filter((r) => r.status === "crash").length;
  const best = formatMetric(st.bestMetric, st.metricUnit);

  lines.push(
    truncateToWidth(
      `  ${th.fg("muted", "Total:")} ${th.fg("text", String(st.totalExperiments))}` +
        `  ${th.fg("success", `${kept} kept`)}` +
        `  ${th.fg("warning", `${discarded} discarded`)}` +
        `  ${th.fg("error", `${crashed} crashed`)}`,
      width
    )
  );

  // Baseline (primary metric bolded with star)
  lines.push(
    truncateToWidth(
      `  ${th.fg("muted", "Baseline:")} ${th.fg("warning", th.bold(`★ ${st.metricName}: ${best}`))}`,
      width
    )
  );

  // Secondary metric baselines
  if (st.secondaryMetrics.length > 0) {
    const baselines = findBaselineSecondary(st.results, st.secondaryMetrics);
    const secondaryParts: string[] = [];
    for (const sm of st.secondaryMetrics) {
      const val = baselines[sm.name];
      if (val !== undefined) {
        secondaryParts.push(`${sm.name}: ${formatCompact(val, sm.unit)}`);
      }
    }
    if (secondaryParts.length > 0) {
      lines.push(
        truncateToWidth(
          `  ${th.fg("muted", "         ")} ${th.fg("muted", secondaryParts.join("  "))}`,
          width
        )
      );
    }
  }

  if (st.runTag) {
    lines.push(
      truncateToWidth(
        `  ${th.fg("muted", "Tag:")} ${th.fg("dim", st.runTag)}`,
        width
      )
    );
  }

  lines.push("");

  // Column definitions
  const secMetrics = st.secondaryMetrics;
  const col = { idx: 4, commit: 9, primary: 14, status: 9 };
  const secColWidth = 14;
  const totalSecWidth = secMetrics.length * secColWidth;
  const descW = Math.max(
    10,
    width - col.idx - col.commit - col.primary - totalSecWidth - col.status - 10
  );

  // Table header — primary metric name bolded with ★
  let headerLine =
    `  ${th.fg("muted", "#".padEnd(col.idx))}` +
    `${th.fg("muted", "commit".padEnd(col.commit))}` +
    `${th.fg("warning", th.bold(("★ " + st.metricName).slice(0, col.primary - 1).padEnd(col.primary)))}`;

  for (const sm of secMetrics) {
    headerLine += th.fg(
      "muted",
      sm.name.slice(0, secColWidth - 1).padEnd(secColWidth)
    );
  }

  headerLine +=
    `${th.fg("muted", "status".padEnd(col.status))}` +
    `${th.fg("muted", "description")}`;

  lines.push(truncateToWidth(headerLine, width));
  lines.push(
    truncateToWidth(
      `  ${th.fg("borderMuted", "─".repeat(width - 4))}`,
      width
    )
  );

  // Baseline values for delta display
  const baselinePrimary = findBaselineMetric(st.results);
  const baselineSecondary = findBaselineSecondary(
    st.results,
    st.secondaryMetrics
  );

  for (let i = 0; i < st.results.length; i++) {
    const r = st.results[i];
    const color =
      r.status === "keep"
        ? "success"
        : r.status === "crash"
          ? "error"
          : "warning";

    const isBaseline = r.newBaseline;

    // Primary metric with color coding
    const primaryStr = formatCompact(r.metric, st.metricUnit);
    let primaryColor: string = "text";
    if (isBaseline) {
      primaryColor = "warning";
    } else if (
      baselinePrimary !== null &&
      r.status === "keep" &&
      r.metric > 0
    ) {
      if (isBetter(r.metric, baselinePrimary, st.bestDirection)) {
        primaryColor = "success";
      } else if (r.metric !== baselinePrimary) {
        primaryColor = "error";
      }
    }

    const idxStr = th.fg("dim", String(i + 1).padEnd(col.idx));

    let rowLine =
      `  ${idxStr}` +
      `${th.fg("accent", r.commit.padEnd(col.commit))}` +
      `${th.fg(primaryColor, th.bold(primaryStr.padEnd(col.primary)))}`;

    // Secondary metrics
    const rowMetrics = r.metrics ?? {};
    for (const sm of secMetrics) {
      const val = rowMetrics[sm.name];
      if (val !== undefined) {
        const secStr = formatCompact(val, sm.unit);
        let secColor: string = "dim";
        const bv = baselineSecondary[sm.name];
        if (isBaseline) {
          secColor = "muted";
        } else if (bv !== undefined && bv !== 0) {
          secColor = val <= bv ? "success" : "error";
        }
        rowLine += th.fg(secColor, secStr.padEnd(secColWidth));
      } else {
        rowLine += th.fg("dim", "—".padEnd(secColWidth));
      }
    }

    rowLine +=
      `${th.fg(color, r.status.padEnd(col.status))}` +
      `${th.fg("muted", r.description.slice(0, descW))}`;

    lines.push(truncateToWidth(rowLine, width));
  }

  return lines;
}

// ---------------------------------------------------------------------------
// Extension
// ---------------------------------------------------------------------------

export default function autoresearchExtension(pi: ExtensionAPI) {
  let dashboardExpanded = false;
  let lastCtx: ExtensionContext | null = null;

  let state: ExperimentState = {
    results: [],
    bestMetric: null,
    bestDirection: "lower",
    metricName: "metric",
    metricUnit: "s",
    secondaryMetrics: [],
    runTag: null,
    totalExperiments: 0,
  };

  // -----------------------------------------------------------------------
  // State reconstruction
  // -----------------------------------------------------------------------

  const reconstructState = (ctx: ExtensionContext) => {
    state = {
      results: [],
      bestMetric: null,
      bestDirection: "lower",
      metricName: "metric",
      metricUnit: "s",
      secondaryMetrics: [],
      runTag: null,
      totalExperiments: 0,
    };

    for (const entry of ctx.sessionManager.getBranch()) {
      if (entry.type !== "message") continue;
      const msg = entry.message;
      if (msg.role !== "toolResult" || msg.toolName !== "log_experiment")
        continue;
      const details = msg.details as LogDetails | undefined;
      if (details?.state) {
        state = details.state;
        // Migrate older state that lacks secondaryMetrics
        if (!state.secondaryMetrics) state.secondaryMetrics = [];
        // Migrate older results that lack metrics/newBaseline
        for (const r of state.results) {
          if (!r.metrics) r.metrics = {};
          if (r.newBaseline === undefined) r.newBaseline = false;
        }
      }
    }

    updateWidget(ctx);
  };

  const updateWidget = (ctx: ExtensionContext) => {
    if (!ctx.hasUI) return;
    lastCtx = ctx;

    if (state.totalExperiments === 0) {
      ctx.ui.setWidget("autoresearch", undefined);
      return;
    }

    if (dashboardExpanded) {
      // Expanded: full dashboard table rendered as widget
      ctx.ui.setWidget("autoresearch", (_tui, theme) => {
        const width = process.stdout.columns || 120;
        const lines: string[] = [];

        lines.push(
          truncateToWidth(
            theme.fg("borderMuted", "─".repeat(3)) +
              theme.fg("accent", " 🔬 autoresearch ") +
              theme.fg("borderMuted", "─".repeat(Math.max(0, width - 22))),
            width
          )
        );

        lines.push(...renderDashboardLines(state, width, theme));

        lines.push(
          `  ${theme.fg("dim", "ctrl+r to collapse")}`
        );
        lines.push("");

        return new Text(lines.join("\n"), 0, 0);
      });
    } else {
      // Collapsed: compact one-liner
      const kept = state.results.filter((r) => r.status === "keep").length;
      const crashed = state.results.filter((r) => r.status === "crash").length;
      const best = formatMetric(state.bestMetric, state.metricUnit);

      ctx.ui.setWidget("autoresearch", (_tui, theme) => {
        const parts = [
          theme.fg("accent", "🔬 autoresearch"),
          theme.fg("muted", ` ${state.totalExperiments} runs`),
          theme.fg("success", ` ${kept} kept`),
          crashed > 0 ? theme.fg("error", ` ${crashed} crashed`) : "",
          theme.fg("dim", " │ "),
          theme.fg("warning", theme.bold(`★ ${state.metricName}: ${best}`)),
        ];

        // Show secondary metric baselines
        if (state.secondaryMetrics.length > 0) {
          const baselines = findBaselineSecondary(
            state.results,
            state.secondaryMetrics
          );
          for (const sm of state.secondaryMetrics) {
            const val = baselines[sm.name];
            if (val !== undefined) {
              parts.push(
                theme.fg("dim", "  "),
                theme.fg(
                  "muted",
                  `${sm.name}: ${formatCompact(val, sm.unit)}`
                )
              );
            }
          }
        }

        if (state.runTag) {
          parts.push(theme.fg("dim", ` │ ${state.runTag}`));
        }

        parts.push(theme.fg("dim", "  (ctrl+r to expand)"));

        return new Text(parts.join(""), 0, 0);
      });
    }
  };

  pi.on("session_start", async (_e, ctx) => reconstructState(ctx));
  pi.on("session_switch", async (_e, ctx) => reconstructState(ctx));
  pi.on("session_fork", async (_e, ctx) => reconstructState(ctx));
  pi.on("session_tree", async (_e, ctx) => reconstructState(ctx));

  // -----------------------------------------------------------------------
  // run_experiment tool
  // -----------------------------------------------------------------------

  pi.registerTool({
    name: "run_experiment",
    label: "Run Experiment",
    description:
      "Run a shell command as an experiment. Times wall-clock duration, captures output, detects pass/fail via exit code. Use for any autoresearch experiment.",
    promptSnippet:
      "Run a timed experiment command (captures duration, output, exit code)",
    promptGuidelines: [
      "Use run_experiment instead of bash when running experiment commands — it handles timing and output capture automatically.",
      "After run_experiment, always call log_experiment to record the result.",
    ],
    parameters: RunParams,

    async execute(_toolCallId, params, signal, onUpdate, ctx) {
      const timeout = (params.timeout_seconds ?? 600) * 1000;

      onUpdate?.({
        content: [{ type: "text", text: `Running: ${params.command}` }],
        details: { phase: "running" },
      });

      const t0 = Date.now();

      const result = await pi.exec("bash", ["-c", params.command], {
        signal,
        timeout,
        cwd: ctx.cwd,
      });

      const durationSeconds = (Date.now() - t0) / 1000;
      const output = (result.stdout + "\n" + result.stderr).trim();
      const passed = result.code === 0 && !result.killed;

      const details: RunDetails = {
        command: params.command,
        exitCode: result.code,
        durationSeconds,
        passed,
        crashed: !passed,
        timedOut: !!result.killed,
        tailOutput: output.split("\n").slice(-80).join("\n"),
      };

      // Build LLM response
      let text = "";
      if (details.timedOut) {
        text += `⏰ TIMEOUT after ${durationSeconds.toFixed(1)}s\n`;
      } else if (!passed) {
        text += `💥 FAILED (exit code ${result.code}) in ${durationSeconds.toFixed(1)}s\n`;
      } else {
        text += `✅ PASSED in ${durationSeconds.toFixed(1)}s\n`;
      }

      if (state.bestMetric !== null && passed) {
        const delta = durationSeconds - state.bestMetric;
        if (isBetter(durationSeconds, state.bestMetric, state.bestDirection)) {
          text += `🎉 NEW BEST! Improved by ${Math.abs(delta).toFixed(1)}s over baseline (${formatMetric(state.bestMetric, state.metricUnit)})\n`;
        } else {
          text += `❌ Slower by ${delta.toFixed(1)}s vs baseline (${formatMetric(state.bestMetric, state.metricUnit)}). Consider reverting.\n`;
        }
      }

      text += `\nLast 80 lines of output:\n${details.tailOutput}`;

      const truncation = truncateTail(text, {
        maxLines: 150,
        maxBytes: 40000,
      });

      return {
        content: [{ type: "text", text: truncation.content }],
        details,
      };
    },

    renderCall(args, theme) {
      let text = theme.fg("toolTitle", theme.bold("run_experiment "));
      text += theme.fg("muted", args.command);
      if (args.timeout_seconds) {
        text += theme.fg("dim", ` (timeout: ${args.timeout_seconds}s)`);
      }
      return new Text(text, 0, 0);
    },

    renderResult(result, { expanded, isPartial }, theme) {
      if (isPartial) {
        return new Text(
          theme.fg("warning", "⏳ Running experiment..."),
          0,
          0
        );
      }

      const d = result.details as RunDetails | undefined;
      if (!d) {
        const t = result.content[0];
        return new Text(t?.type === "text" ? t.text : "", 0, 0);
      }

      if (d.timedOut) {
        let text = theme.fg(
          "error",
          `⏰ TIMEOUT ${d.durationSeconds.toFixed(1)}s`
        );
        if (expanded) text += "\n" + theme.fg("dim", d.tailOutput.slice(-500));
        return new Text(text, 0, 0);
      }

      if (d.crashed) {
        let text = theme.fg(
          "error",
          `💥 FAIL exit=${d.exitCode} ${d.durationSeconds.toFixed(1)}s`
        );
        if (expanded) text += "\n" + theme.fg("dim", d.tailOutput.slice(-500));
        return new Text(text, 0, 0);
      }

      let text =
        theme.fg("success", "✅ ") +
        theme.fg("accent", `${d.durationSeconds.toFixed(1)}s`);

      if (expanded) {
        text += "\n" + theme.fg("dim", d.tailOutput.slice(-1000));
      }

      return new Text(text, 0, 0);
    },
  });

  // -----------------------------------------------------------------------
  // log_experiment tool
  // -----------------------------------------------------------------------

  pi.registerTool({
    name: "log_experiment",
    label: "Log Experiment",
    description:
      "Record an experiment result. Tracks metrics, updates the status widget and dashboard. Call after every run_experiment.",
    promptSnippet:
      "Log experiment result (commit, metric, status, description)",
    promptGuidelines: [
      "Always call log_experiment after run_experiment to record the result.",
      "After run_experiment, always call log_experiment to record the result.",
      "Use status 'keep' if the metric improved, 'discard' if worse, 'crash' if it failed.",
      "Update dailyContext.md throughout the session: log completed work, decisions, and carry-forward items.",
    ],
    parameters: LogParams,

    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      const secondaryMetrics = params.metrics ?? {};
      const isBaseline = params.new_baseline ?? false;

      const experiment: ExperimentResult = {
        commit: params.commit.slice(0, 7),
        metric: params.metric,
        metrics: secondaryMetrics,
        status: params.status,
        description: params.description,
        newBaseline: isBaseline,
        timestamp: Date.now(),
      };

      state.results.push(experiment);
      state.totalExperiments++;

      // Register any new secondary metric names we haven't seen before
      for (const name of Object.keys(secondaryMetrics)) {
        if (!state.secondaryMetrics.find((m) => m.name === name)) {
          // Infer unit from name suffix or default
          let unit = "";
          if (name.endsWith("_µs") || name.includes("µs")) unit = "µs";
          else if (name.endsWith("_ms") || name.includes("ms")) unit = "ms";
          else if (name.endsWith("_s") || name.includes("sec")) unit = "s";
          state.secondaryMetrics.push({ name, unit });
        }
      }

      // Update bestMetric: use most recent baseline's primary metric
      if (isBaseline && params.metric > 0) {
        state.bestMetric = params.metric;
      } else if (state.bestMetric === null && params.status === "keep" && params.metric > 0) {
        // If no baseline has ever been set, fall back to absolute best for compatibility
        state.bestMetric = params.metric;
      }

      // If a new baseline was set, recalculate from it
      const baselineMetric = findBaselineMetric(state.results);
      if (baselineMetric !== null) {
        state.bestMetric = baselineMetric;
      }

      updateWidget(ctx);

      // Build response text
      let text = `Logged #${state.totalExperiments}: ${experiment.status}`;
      if (isBaseline) text += " NEW BASELINE";
      text += ` — ${experiment.description}`;

      if (state.bestMetric !== null) {
        text += `\nBaseline ${state.metricName}: ${formatMetric(state.bestMetric, state.metricUnit)}`;
        if (!isBaseline && params.status === "keep" && params.metric > 0) {
          const delta = params.metric - state.bestMetric;
          const pct = ((delta / state.bestMetric) * 100).toFixed(1);
          const sign = delta > 0 ? "+" : "";
          text += ` | this: ${formatMetric(params.metric, state.metricUnit)} (${sign}${pct}%)`;
        }
      }

      // Show secondary metrics
      if (Object.keys(secondaryMetrics).length > 0) {
        const baselines = findBaselineSecondary(state.results, state.secondaryMetrics);
        const parts: string[] = [];
        for (const [name, value] of Object.entries(secondaryMetrics)) {
          const def = state.secondaryMetrics.find((m) => m.name === name);
          const unit = def?.unit ?? "";
          let part = `${name}: ${formatCompact(value, unit)}`;
          const bv = baselines[name];
          if (bv !== undefined && !isBaseline && bv !== 0) {
            const d = value - bv;
            const p = ((d / bv) * 100).toFixed(1);
            const s = d > 0 ? "+" : "";
            part += ` (${s}${p}%)`;
          }
          parts.push(part);
        }
        text += `\nSecondary: ${parts.join("  ")}`;
      }

      text += `\n(${state.totalExperiments} experiments total)`;

      return {
        content: [{ type: "text", text }],
        details: { experiment, state: { ...state } } as LogDetails,
      };
    },

    renderCall(args, theme) {
      let text = theme.fg("toolTitle", theme.bold("log_experiment "));
      const color =
        args.status === "keep"
          ? "success"
          : args.status === "crash"
            ? "error"
            : "warning";
      text += theme.fg(color, args.status);
      if (args.new_baseline) text += theme.fg("accent", " baseline");
      text += " " + theme.fg("dim", args.description);
      return new Text(text, 0, 0);
    },

    renderResult(result, _options, theme) {
      const d = result.details as LogDetails | undefined;
      if (!d) {
        const t = result.content[0];
        return new Text(t?.type === "text" ? t.text : "", 0, 0);
      }

      const { experiment: exp, state: s } = d;
      const color =
        exp.status === "keep"
          ? "success"
          : exp.status === "crash"
            ? "error"
            : "warning";
      const icon =
        exp.status === "keep" ? "✓" : exp.status === "crash" ? "✗" : "–";

      let text =
        theme.fg(color, `${icon} `) +
        theme.fg("accent", `#${s.totalExperiments}`);



      text += " " + theme.fg("muted", exp.description);

      if (s.bestMetric !== null) {
        text +=
          theme.fg("dim", " │ ") +
          theme.fg("warning", theme.bold(`★ ${formatMetric(s.bestMetric, s.metricUnit)}`));
      }

      // Show secondary metrics inline
      if (Object.keys(exp.metrics).length > 0) {
        const parts: string[] = [];
        for (const [name, value] of Object.entries(exp.metrics)) {
          const def = s.secondaryMetrics.find((m) => m.name === name);
          parts.push(`${name}=${formatCompact(value, def?.unit ?? "")}`);
        }
        text += theme.fg("dim", `  ${parts.join(" ")}`);
      }

      return new Text(text, 0, 0);
    },
  });

  // -----------------------------------------------------------------------
  // Ctrl+R — toggle dashboard expand/collapse
  // -----------------------------------------------------------------------

  pi.registerShortcut("ctrl+r", {
    description: "Toggle autoresearch dashboard",
    handler: async (ctx) => {
      if (state.totalExperiments === 0) {
        ctx.ui.notify("No experiments yet", "info");
        return;
      }
      dashboardExpanded = !dashboardExpanded;
      updateWidget(ctx);
    },
  });
}
