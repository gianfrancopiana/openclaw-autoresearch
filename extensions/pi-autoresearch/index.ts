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
 * - Ctrl+X toggle to expand/collapse full dashboard inline above the editor
 * - Injects autoresearch.md into context on every turn via before_agent_start
 */

import type {
  ExtensionAPI,
  ExtensionContext,
  Theme,
} from "@mariozechner/pi-coding-agent";
import { truncateTail } from "@mariozechner/pi-coding-agent";
import { StringEnum } from "@mariozechner/pi-ai";
import { Text, truncateToWidth, matchesKey, visibleWidth } from "@mariozechner/pi-tui";
import { Type } from "@sinclair/typebox";
import * as fs from "node:fs";
import * as path from "node:path";

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
  timestamp: number;
}

interface MetricDef {
  name: string;
  unit: string;
}

interface ExperimentState {
  results: ExperimentResult[];
  /** Baseline primary metric (from first experiment) */
  bestMetric: number | null;
  bestDirection: "lower" | "higher";
  metricName: string;
  metricUnit: string;
  /** Definitions for secondary metrics (order preserved) */
  secondaryMetrics: MetricDef[];
  name: string | null;
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

const InitParams = Type.Object({
  name: Type.String({
    description:
      'Human-readable name for this experiment session (e.g. "Optimizing liquid for fastest execution and parsing")',
  }),
  metric_name: Type.String({
    description:
      'Display name for the primary metric (e.g. "total_µs", "bundle_kb", "val_bpb"). Shown in dashboard headers.',
  }),
  metric_unit: Type.Optional(
    Type.String({
      description:
        'Unit for the primary metric. Use "µs", "ms", "s", "kb", "mb", or "" for unitless. Affects number formatting. Default: ""',
    })
  ),
  direction: Type.Optional(
    Type.String({
      description:
        'Whether "lower" or "higher" is better for the primary metric. Default: "lower".',
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
  force: Type.Optional(
    Type.Boolean({
      description:
        "Set to true to allow adding a new secondary metric that wasn't tracked before. Only use for metrics that have proven very valuable to watch.",
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

function formatNum(value: number | null, unit: string): string {
  if (value === null) return "—";
  const u = unit || "";
  // Integers: no decimals
  if (value === Math.round(value)) return fmtNum(value) + u;
  // Fractional: 2 decimal places
  return fmtNum(value, 2) + u;
}

function isBetter(
  current: number,
  best: number,
  direction: "lower" | "higher"
): boolean {
  return direction === "lower" ? current < best : current > best;
}

/** Baseline = first experiment */
function findBaselineMetric(results: ExperimentResult[]): number | null {
  return results.length > 0 ? results[0].metric : null;
}

/**
 * Find secondary metric baselines from the first experiment.
 * For metrics that didn't exist at baseline time, falls back to the first
 * occurrence of that metric across all results.
 */
function findBaselineSecondary(
  results: ExperimentResult[],
  knownMetrics?: MetricDef[]
): Record<string, number> {
  const base: Record<string, number> = results.length > 0
    ? { ...(results[0].metrics ?? {}) }
    : {};

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
  th: Theme,
  maxRows: number = 6
): string[] {
  const lines: string[] = [];

  if (st.results.length === 0) {
    lines.push(`  ${th.fg("dim", "No experiments yet.")}`);
    return lines;
  }

  const kept = st.results.filter((r) => r.status === "keep").length;
  const discarded = st.results.filter((r) => r.status === "discard").length;
  const crashed = st.results.filter((r) => r.status === "crash").length;

  const baseline = st.bestMetric;
  const baselineSec = findBaselineSecondary(st.results, st.secondaryMetrics);

  // Find best kept primary metric and its run number
  let bestPrimary: number | null = null;
  let bestSecondary: Record<string, number> = {};
  let bestRunNum = 0;
  for (let i = st.results.length - 1; i >= 0; i--) {
    const r = st.results[i];
    if (r.status === "keep" && r.metric > 0) {
      if (bestPrimary === null || isBetter(r.metric, bestPrimary, st.bestDirection)) {
        bestPrimary = r.metric;
        bestSecondary = r.metrics ?? {};
        bestRunNum = i + 1;
      }
    }
  }

  // Runs summary
  lines.push(
    truncateToWidth(
      `  ${th.fg("muted", "Runs:")} ${th.fg("text", String(st.results.length))}` +
        `  ${th.fg("success", `${kept} kept`)}` +
        (discarded > 0 ? `  ${th.fg("warning", `${discarded} discarded`)}` : "") +
        (crashed > 0 ? `  ${th.fg("error", `${crashed} crashed`)}` : ""),
      width
    )
  );

  // Baseline: first run's primary metric
  lines.push(
    truncateToWidth(
      `  ${th.fg("muted", "Baseline:")} ${th.fg("dim", `★ ${st.metricName}: ${formatNum(baseline, st.metricUnit)} #1`)}`,
      width
    )
  );


  // Progress: best primary metric with delta + run number
  if (bestPrimary !== null) {
    let progressLine = `  ${th.fg("muted", "Progress:")} ${th.fg("warning", th.bold(`★ ${st.metricName}: ${formatNum(bestPrimary, st.metricUnit)}`))}${th.fg("dim", ` #${bestRunNum}`)}`;

    if (baseline !== null && baseline !== 0 && bestPrimary !== baseline) {
      const pct = ((bestPrimary - baseline) / baseline) * 100;
      const sign = pct > 0 ? "+" : "";
      const color = isBetter(bestPrimary, baseline, st.bestDirection) ? "success" : "error";
      progressLine += th.fg(color, ` (${sign}${pct.toFixed(1)}%)`);
    }

    lines.push(truncateToWidth(progressLine, width));

    // Progress secondary metrics on next line with deltas
    if (st.secondaryMetrics.length > 0) {
      const secParts: string[] = [];
      for (const sm of st.secondaryMetrics) {
        const val = bestSecondary[sm.name];
        const bv = baselineSec[sm.name];
        if (val !== undefined) {
          let part = `${sm.name}: ${formatNum(val, sm.unit)}`;
          if (bv !== undefined && bv !== 0 && val !== bv) {
            const p = ((val - bv) / bv) * 100;
            const s = p > 0 ? "+" : "";
            const c = val <= bv ? "success" : "error";
            part += th.fg(c, ` ${s}${p.toFixed(1)}%`);
          }
          secParts.push(part);
        }
      }
      if (secParts.length > 0) {
        lines.push(
          truncateToWidth(
            `  ${th.fg("dim", "          ")}${th.fg("muted", secParts.join("  "))}`,
            width
          )
        );
      }
    }
  }

  lines.push("");

  // Determine visible rows for column pruning
  const effectiveMax = maxRows <= 0 ? st.results.length : maxRows;
  const startIdx = Math.max(0, st.results.length - effectiveMax);
  const visibleRows = st.results.slice(startIdx);

  // Only show secondary metric columns that have at least one value in visible rows
  const secMetrics = st.secondaryMetrics.filter((sm) =>
    visibleRows.some((r) => (r.metrics ?? {})[sm.name] !== undefined)
  );

  // Column definitions
  const col = { idx: 3, commit: 8, primary: 11, status: 8 };
  const secColWidth = 11;
  const totalSecWidth = secMetrics.length * secColWidth;
  const descW = Math.max(
    10,
    width - col.idx - col.commit - col.primary - totalSecWidth - col.status - 6
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

  // Show max 6 recent runs, with a note about hidden earlier ones
  if (startIdx > 0) {
    lines.push(
      truncateToWidth(
        `  ${th.fg("dim", `… ${startIdx} earlier run${startIdx === 1 ? "" : "s"}`)}`,
        width
      )
    );
  }

  for (let i = startIdx; i < st.results.length; i++) {
    const r = st.results[i];
    const color =
      r.status === "keep"
        ? "success"
        : r.status === "crash"
          ? "error"
          : "warning";

    // Primary metric with color coding
    const primaryStr = formatNum(r.metric, st.metricUnit);
    let primaryColor: string = "text";
    if (i === 0) {
      primaryColor = "muted"; // baseline row
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
        const secStr = formatNum(val, sm.unit);
        let secColor: string = "dim";
        const bv = baselineSecondary[sm.name];
        if (i === 0) {
          secColor = "muted"; // baseline row
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
  let autoresearchMode = false;
  let lastCtx: ExtensionContext | null = null;

  let state: ExperimentState = {
    results: [],
    bestMetric: null,
    bestDirection: "lower",
    metricName: "metric",
    metricUnit: "",
    secondaryMetrics: [],
    name: null,
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
      metricUnit: "",
      secondaryMetrics: [],
      name: null,
    };

    // Primary: read from autoresearch.jsonl (alongside autoresearch.md/sh)
    const jsonlPath = path.join(ctx.cwd, "autoresearch.jsonl");
    let loadedFromJsonl = false;
    try {
      if (fs.existsSync(jsonlPath)) {
        const lines = fs.readFileSync(jsonlPath, "utf-8").trim().split("\n").filter(Boolean);
        for (const line of lines) {
          try {
            const entry = JSON.parse(line);

            // Config header line
            if (entry.type === "config") {
              if (entry.name) state.name = entry.name;
              if (entry.metricName) state.metricName = entry.metricName;
              if (entry.metricUnit !== undefined) state.metricUnit = entry.metricUnit;
              if (entry.bestDirection) state.bestDirection = entry.bestDirection;
              continue;
            }

            // Experiment result line
            state.results.push({
              commit: entry.commit ?? "",
              metric: entry.metric ?? 0,
              metrics: entry.metrics ?? {},
              status: entry.status ?? "keep",
              description: entry.description ?? "",
              timestamp: entry.timestamp ?? 0,
            });

            // Register secondary metrics
            for (const name of Object.keys(entry.metrics ?? {})) {
              if (!state.secondaryMetrics.find((m) => m.name === name)) {
                let unit = "";
                if (name.endsWith("_µs") || name.includes("µs")) unit = "µs";
                else if (name.endsWith("_ms") || name.includes("ms")) unit = "ms";
                else if (name.endsWith("_s") || name.includes("sec")) unit = "s";
                state.secondaryMetrics.push({ name, unit });
              }
            }
          } catch {
            // Skip malformed lines
          }
        }
        if (state.results.length > 0) {
          loadedFromJsonl = true;
          state.bestMetric = findBaselineMetric(state.results);
        }
      }
    } catch {
      // Fall through to session history
    }

    // Fallback: reconstruct from session history (backward compat)
    if (!loadedFromJsonl) {
      for (const entry of ctx.sessionManager.getBranch()) {
        if (entry.type !== "message") continue;
        const msg = entry.message;
        if (msg.role !== "toolResult" || msg.toolName !== "log_experiment")
          continue;
        const details = msg.details as LogDetails | undefined;
        if (details?.state) {
          state = details.state;
          if (!state.secondaryMetrics) state.secondaryMetrics = [];
          if (state.metricUnit === "s" && state.metricName === "metric") {
            state.metricUnit = "";
          }
          for (const r of state.results) {
            if (!r.metrics) r.metrics = {};
          }
        }
      }
    }

    // Also detect autoresearch mode from file presence
    if (fs.existsSync(path.join(ctx.cwd, "autoresearch.md"))) {
      autoresearchMode = true;
    }

    updateWidget(ctx);
  };

  const updateWidget = (ctx: ExtensionContext) => {
    if (!ctx.hasUI) return;
    lastCtx = ctx;

    if (state.results.length === 0) {
      ctx.ui.setWidget("autoresearch", undefined);
      return;
    }

    if (dashboardExpanded) {
      // Expanded: full dashboard table rendered as widget
      ctx.ui.setWidget("autoresearch", (_tui, theme) => {
        const width = process.stdout.columns || 120;
        const lines: string[] = [];

        const hintText = " ctrl+x collapse • ctrl+shift+x fullscreen ";
        const labelPrefix = "🔬 autoresearch";
        const nameStr = state.name ? `: ${state.name}` : "";
        // 3 leading dashes + space + label + space + fill + hint
        const maxLabelLen = width - 3 - 2 - hintText.length - 1;
        let label = labelPrefix + nameStr;
        if (label.length > maxLabelLen) {
          label = label.slice(0, maxLabelLen - 1) + "…";
        }
        const fillLen = Math.max(0, width - 3 - 1 - label.length - 1 - hintText.length);
        lines.push(
          truncateToWidth(
            theme.fg("borderMuted", "───") +
              theme.fg("accent", " " + label + " ") +
              theme.fg("borderMuted", "─".repeat(fillLen)) +
              theme.fg("dim", hintText),
            width
          )
        );

        lines.push(...renderDashboardLines(state, width, theme));

        return new Text(lines.join("\n"), 0, 0);
      });
    } else {
      // Collapsed: compact one-liner — compute everything inside render
      ctx.ui.setWidget("autoresearch", (_tui, theme) => {
        const kept = state.results.filter((r) => r.status === "keep").length;
        const crashed = state.results.filter((r) => r.status === "crash").length;
        const baseline = state.bestMetric;
        const baselineSec = findBaselineSecondary(state.results, state.secondaryMetrics);

        // Find best kept primary metric, its secondary values, and run number
        let bestPrimary: number | null = null;
        let bestSec: Record<string, number> = {};
        let bestRunNum = 0;
        for (let i = state.results.length - 1; i >= 0; i--) {
          const r = state.results[i];
          if (r.status === "keep" && r.metric > 0) {
            if (bestPrimary === null || isBetter(r.metric, bestPrimary, state.bestDirection)) {
              bestPrimary = r.metric;
              bestSec = r.metrics ?? {};
              bestRunNum = i + 1;
            }
          }
        }

        const displayVal = bestPrimary ?? baseline;
        const parts = [
          theme.fg("accent", "🔬"),
          theme.fg("muted", ` ${state.results.length} runs`),
          theme.fg("success", ` ${kept} kept`),
          crashed > 0 ? theme.fg("error", ` ${crashed}💥`) : "",
          theme.fg("dim", " │ "),
          theme.fg("warning", theme.bold(`★ ${state.metricName}: ${formatNum(displayVal, state.metricUnit)}`)),
          bestRunNum > 0 ? theme.fg("dim", ` #${bestRunNum}`) : "",
        ];

        // Show delta % vs baseline for primary
        if (baseline !== null && bestPrimary !== null && baseline !== 0 && bestPrimary !== baseline) {
          const pct = ((bestPrimary - baseline) / baseline) * 100;
          const sign = pct > 0 ? "+" : "";
          const deltaColor = isBetter(bestPrimary, baseline, state.bestDirection) ? "success" : "error";
          parts.push(theme.fg(deltaColor, ` (${sign}${pct.toFixed(1)}%)`));
        }

        // Show secondary metrics with delta %
        if (state.secondaryMetrics.length > 0) {
          for (const sm of state.secondaryMetrics) {
            const val = bestSec[sm.name];
            const bv = baselineSec[sm.name];
            if (val !== undefined) {
              parts.push(theme.fg("dim", "  "));
              let secText = `${sm.name}: ${formatNum(val, sm.unit)}`;
              if (bv !== undefined && bv !== 0 && val !== bv) {
                const p = ((val - bv) / bv) * 100;
                const s = p > 0 ? "+" : "";
                const c = val <= bv ? "success" : "error";
                secText += theme.fg(c, ` ${s}${p.toFixed(1)}%`);
              }
              parts.push(theme.fg("muted", secText));
            }
          }
        }

        if (state.name) {
          parts.push(theme.fg("dim", ` │ ${state.name}`));
        }

        parts.push(theme.fg("dim", "  (ctrl+x expand • ctrl+shift+x fullscreen)"));

        return new Text(parts.join(""), 0, 0);
      });
    }
  };

  pi.on("session_start", async (_e, ctx) => reconstructState(ctx));
  pi.on("session_switch", async (_e, ctx) => reconstructState(ctx));
  pi.on("session_fork", async (_e, ctx) => reconstructState(ctx));
  pi.on("session_tree", async (_e, ctx) => reconstructState(ctx));

  // When in autoresearch mode, add a static note to the system prompt.
  // Only a short pointer — no file content, fully cache-safe.
  pi.on("before_agent_start", async (event, ctx) => {
    if (!autoresearchMode) return;

    const mdPath = path.join(ctx.cwd, "autoresearch.md");

    return {
      systemPrompt: event.systemPrompt +
        "\n\n## Autoresearch Mode (ACTIVE)" +
        "\nYou are in autoresearch mode. Optimize the primary metric through an autonomous experiment loop." +
        "\nUse init_experiment, run_experiment, and log_experiment tools. NEVER STOP until interrupted." +
        `\nExperiment rules: ${mdPath} — read this file at the start of every session and after compaction.`,
    };
  });

  // -----------------------------------------------------------------------
  // init_experiment tool — one-time setup
  // -----------------------------------------------------------------------

  pi.registerTool({
    name: "init_experiment",
    label: "Init Experiment",
    description:
      "Initialize the experiment session. Call once before the first run_experiment to set the name, primary metric, unit, and direction. Writes the config header to autoresearch.jsonl.",
    promptSnippet:
      "Initialize experiment session (name, metric, unit, direction). Call once before first run.",
    promptGuidelines: [
      "Call init_experiment exactly once at the start of an autoresearch session, before the first run_experiment.",
      "If autoresearch.jsonl already exists with a config, do NOT call init_experiment again.",
    ],
    parameters: InitParams,

    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      // Don't re-init if already configured from jsonl
      if (state.results.length > 0) {
        return {
          content: [{
            type: "text",
            text: `⚠️ Experiment already initialized with ${state.results.length} results. Config: name="${state.name}", metric="${state.metricName}" (${state.metricUnit || "unitless"}, ${state.bestDirection} is better). To start fresh, delete autoresearch.jsonl.`,
          }],
          details: {},
        };
      }

      state.name = params.name;
      state.metricName = params.metric_name;
      state.metricUnit = params.metric_unit ?? "";
      if (params.direction === "lower" || params.direction === "higher") {
        state.bestDirection = params.direction;
      }

      // Write config header to jsonl
      try {
        const jsonlPath = path.join(ctx.cwd, "autoresearch.jsonl");
        const config = JSON.stringify({
          type: "config",
          name: state.name,
          metricName: state.metricName,
          metricUnit: state.metricUnit,
          bestDirection: state.bestDirection,
        });
        fs.writeFileSync(jsonlPath, config + "\n");
      } catch (e) {
        return {
          content: [{
            type: "text",
            text: `⚠️ Failed to write autoresearch.jsonl: ${e instanceof Error ? e.message : String(e)}`,
          }],
          details: {},
        };
      }

      autoresearchMode = true;
      updateWidget(ctx);

      return {
        content: [{
          type: "text",
          text: `✅ Experiment initialized: "${state.name}"\nMetric: ${state.metricName} (${state.metricUnit || "unitless"}, ${state.bestDirection} is better)\nConfig written to autoresearch.jsonl. Now run the baseline with run_experiment.`,
        }],
        details: { state: { ...state } },
      };
    },

    renderCall(args, theme) {
      let text = theme.fg("toolTitle", theme.bold("init_experiment "));
      text += theme.fg("accent", args.name ?? "");
      return new Text(text, 0, 0);
    },

    renderResult(result, _options, theme) {
      const t = result.content[0];
      return new Text(t?.type === "text" ? t.text : "", 0, 0);
    },
  });

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

      if (state.bestMetric !== null) {
        text += `📊 Current best ${state.metricName}: ${formatNum(state.bestMetric, state.metricUnit)}\n`;
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
      "log_experiment automatically runs git add -A && git commit with the description and a Result trailer. Do NOT commit manually before calling log_experiment.",
      "Use status 'keep' if the PRIMARY metric improved. 'discard' if worse or unchanged. 'crash' if it failed. Secondary metrics are for monitoring — they almost never affect keep/discard. Only discard a primary improvement if a secondary metric degraded catastrophically, and explain why in the description.",

    ],
    parameters: LogParams,

    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      const secondaryMetrics = params.metrics ?? {};

      // Validate secondary metrics consistency (after first experiment establishes them)
      if (state.secondaryMetrics.length > 0) {
        const knownNames = new Set(state.secondaryMetrics.map((m) => m.name));
        const providedNames = new Set(Object.keys(secondaryMetrics));

        // Check for missing metrics
        const missing = [...knownNames].filter((n) => !providedNames.has(n));
        if (missing.length > 0) {
          return {
            content: [{
              type: "text",
              text: `❌ Missing secondary metrics: ${missing.join(", ")}\n\nYou must provide all previously tracked metrics. Expected: ${[...knownNames].join(", ")}\nGot: ${[...providedNames].join(", ") || "(none)"}\n\nFix: include ${missing.map((m) => `"${m}": <value>`).join(", ")} in the metrics parameter.`,
            }],
            details: {},
          };
        }

        // Check for new metrics not yet tracked
        const newMetrics = [...providedNames].filter((n) => !knownNames.has(n));
        if (newMetrics.length > 0 && !params.force) {
          return {
            content: [{
              type: "text",
              text: `❌ New secondary metric${newMetrics.length > 1 ? "s" : ""} not previously tracked: ${newMetrics.join(", ")}\n\nExisting metrics: ${[...knownNames].join(", ")}\n\nIf this metric has proven very valuable to watch, call log_experiment again with force: true to add it. Otherwise, remove it from the metrics parameter.`,
            }],
            details: {},
          };
        }
      }

      const experiment: ExperimentResult = {
        commit: params.commit.slice(0, 7),
        metric: params.metric,
        metrics: secondaryMetrics,
        status: params.status,
        description: params.description,
        timestamp: Date.now(),
      };

      state.results.push(experiment);

      // Register any new secondary metric names
      for (const name of Object.keys(secondaryMetrics)) {
        if (!state.secondaryMetrics.find((m) => m.name === name)) {
          let unit = "";
          if (name.endsWith("_µs") || name.includes("µs")) unit = "µs";
          else if (name.endsWith("_ms") || name.includes("ms")) unit = "ms";
          else if (name.endsWith("_s") || name.includes("sec")) unit = "s";
          state.secondaryMetrics.push({ name, unit });
        }
      }

      // Baseline = first run
      state.bestMetric = findBaselineMetric(state.results);

      // Build response text
      let text = `Logged #${state.results.length}: ${experiment.status} — ${experiment.description}`;

      if (state.bestMetric !== null) {
        text += `\nBaseline ${state.metricName}: ${formatNum(state.bestMetric, state.metricUnit)}`;
        if (state.results.length > 1 && params.status === "keep" && params.metric > 0) {
          const delta = params.metric - state.bestMetric;
          const pct = ((delta / state.bestMetric) * 100).toFixed(1);
          const sign = delta > 0 ? "+" : "";
          text += ` | this: ${formatNum(params.metric, state.metricUnit)} (${sign}${pct}%)`;
        }
      }

      // Show secondary metrics
      if (Object.keys(secondaryMetrics).length > 0) {
        const baselines = findBaselineSecondary(state.results, state.secondaryMetrics);
        const parts: string[] = [];
        for (const [name, value] of Object.entries(secondaryMetrics)) {
          const def = state.secondaryMetrics.find((m) => m.name === name);
          const unit = def?.unit ?? "";
          let part = `${name}: ${formatNum(value, unit)}`;
          const bv = baselines[name];
          if (bv !== undefined && state.results.length > 1 && bv !== 0) {
            const d = value - bv;
            const p = ((d / bv) * 100).toFixed(1);
            const s = d > 0 ? "+" : "";
            part += ` (${s}${p}%)`;
          }
          parts.push(part);
        }
        text += `\nSecondary: ${parts.join("  ")}`;
      }

      text += `\n(${state.results.length} experiments total)`;

      // Auto-commit only on keep — discards/crashes get reverted anyway
      if (params.status === "keep") {
        try {
          const resultData: Record<string, unknown> = {
            status: params.status,
            [state.metricName || "metric"]: params.metric,
            ...secondaryMetrics,
          };
          const trailerJson = JSON.stringify(resultData);
          const commitMsg = `${params.description}\n\nResult: ${trailerJson}`;

          const gitResult = await pi.exec("bash", ["-c",
            `git add -A && git diff --cached --quiet && echo "NOTHING_TO_COMMIT" || git commit -m ${JSON.stringify(commitMsg)}`
          ], { cwd: ctx.cwd, timeout: 10000 });

          const gitOutput = (gitResult.stdout + gitResult.stderr).trim();
          if (gitOutput.includes("NOTHING_TO_COMMIT")) {
            text += `\n📝 Git: nothing to commit (working tree clean)`;
          } else if (gitResult.code === 0) {
            const firstLine = gitOutput.split("\n")[0] || "";
            text += `\n📝 Git: committed — ${firstLine}`;

            // Update experiment record with the actual new commit hash
            try {
              const shaResult = await pi.exec("git", ["rev-parse", "--short=7", "HEAD"], { cwd: ctx.cwd, timeout: 5000 });
              const newSha = (shaResult.stdout || "").trim();
              if (newSha && newSha.length >= 7) {
                experiment.commit = newSha;
              }
            } catch {
              // Keep the original commit hash if rev-parse fails
            }
          } else {
            text += `\n⚠️ Git commit failed (exit ${gitResult.code}): ${gitOutput.slice(0, 200)}`;
          }
        } catch (e) {
          text += `\n⚠️ Git commit error: ${e instanceof Error ? e.message : String(e)}`;
        }
      } else {
        text += `\n📝 Git: skipped commit (${params.status}) — revert with git checkout -- .`;
      }

      // Persist to autoresearch.jsonl AFTER git commit (so commit hash is correct)
      try {
        const jsonlPath = path.join(ctx.cwd, "autoresearch.jsonl");
        fs.appendFileSync(jsonlPath, JSON.stringify({
          run: state.results.length,
          ...experiment,
        }) + "\n");
      } catch {
        // Don't fail if write fails
      }

      updateWidget(ctx);

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
        theme.fg("accent", `#${s.results.length}`);



      text += " " + theme.fg("muted", exp.description);

      if (s.bestMetric !== null) {
        text +=
          theme.fg("dim", " │ ") +
          theme.fg("warning", theme.bold(`★ ${formatNum(s.bestMetric, s.metricUnit)}`));
      }

      // Show secondary metrics inline
      if (Object.keys(exp.metrics).length > 0) {
        const parts: string[] = [];
        for (const [name, value] of Object.entries(exp.metrics)) {
          const def = s.secondaryMetrics.find((m) => m.name === name);
          parts.push(`${name}=${formatNum(value, def?.unit ?? "")}`);
        }
        text += theme.fg("dim", `  ${parts.join(" ")}`);
      }

      return new Text(text, 0, 0);
    },
  });

  // -----------------------------------------------------------------------
  // Ctrl+R — toggle dashboard expand/collapse
  // -----------------------------------------------------------------------

  pi.registerShortcut("ctrl+x", {
    description: "Toggle autoresearch dashboard",
    handler: async (ctx) => {
      if (state.results.length === 0) {
        if (!autoresearchMode && !fs.existsSync(path.join(ctx.cwd, "autoresearch.md"))) {
          ctx.ui.notify("No experiments yet — run /autoresearch to get started", "info");
        } else {
          ctx.ui.notify("No experiments yet", "info");
        }
        return;
      }
      dashboardExpanded = !dashboardExpanded;
      updateWidget(ctx);
    },
  });

  // -----------------------------------------------------------------------
  // Ctrl+Shift+X — fullscreen scrollable dashboard overlay
  // -----------------------------------------------------------------------

  pi.registerShortcut("ctrl+shift+x", {
    description: "Fullscreen autoresearch dashboard",
    handler: async (ctx) => {
      if (state.results.length === 0) {
        ctx.ui.notify("No experiments yet", "info");
        return;
      }

      await ctx.ui.custom<void>(
        (tui, theme, _kb, done) => {
          let scrollOffset = 0;
          let cachedLines: string[] | null = null;

          function getContentLines(): string[] {
            if (!cachedLines) {
              const w = (process.stdout.columns || 120) - 4; // inner width (border padding)
              cachedLines = renderDashboardLines(state, w, theme, 0);
            }
            return cachedLines;
          }

          return {
            render(width: number): string[] {
              const height = (process.stdout.rows || 40) - 2; // leave room for border
              const innerW = width - 4; // │ + space + content + space + │
              const content = getContentLines();
              const totalRows = content.length;
              const viewportRows = height - 4; // top border + title + bottom border + help

              // Clamp scroll
              const maxScroll = Math.max(0, totalRows - viewportRows);
              if (scrollOffset > maxScroll) scrollOffset = maxScroll;
              if (scrollOffset < 0) scrollOffset = 0;

              const out: string[] = [];

              // Top border with title
              const titlePrefix = "🔬 autoresearch";
              const nameStr = state.name ? `: ${state.name}` : "";
              const maxTitleLen = innerW - 4;
              let title = titlePrefix + nameStr;
              if (title.length > maxTitleLen) {
                title = title.slice(0, maxTitleLen - 1) + "…";
              }
              const topFill = Math.max(0, innerW + 2 - 1 - title.length - 1);
              out.push(
                theme.fg("border", "╭") +
                theme.fg("accent", " " + title + " ") +
                theme.fg("border", "─".repeat(topFill) + "╮")
              );

              // Scrollbar indicator
              const scrollInfo = totalRows > viewportRows
                ? ` ${scrollOffset + 1}-${Math.min(scrollOffset + viewportRows, totalRows)}/${totalRows}`
                : "";

              // Content rows
              const pad = (s: string, len: number) => {
                const vis = visibleWidth(s);
                return s + " ".repeat(Math.max(0, len - vis));
              };
              const row = (s: string) =>
                theme.fg("border", "│") + " " + pad(s, innerW) + " " + theme.fg("border", "│");

              const visible = content.slice(scrollOffset, scrollOffset + viewportRows);
              for (const line of visible) {
                out.push(row(line));
              }
              // Fill remaining viewport with empty rows
              for (let i = visible.length; i < viewportRows; i++) {
                out.push(row(""));
              }

              // Bottom border with help
              const helpText = ` ↑↓/j/k scroll • esc close${scrollInfo} `;
              const botFill = Math.max(0, innerW + 2 - helpText.length);
              out.push(
                theme.fg("border", "╰" + "─".repeat(botFill)) +
                theme.fg("dim", helpText) +
                theme.fg("border", "╯")
              );

              return out;
            },

            handleInput(data: string): void {
              const content = getContentLines();
              const height = (process.stdout.rows || 40) - 2;
              const viewportRows = height - 4;
              const maxScroll = Math.max(0, content.length - viewportRows);

              if (matchesKey(data, "escape") || data === "q") {
                done(undefined);
                return;
              }
              if (matchesKey(data, "up") || data === "k") {
                scrollOffset = Math.max(0, scrollOffset - 1);
              } else if (matchesKey(data, "down") || data === "j") {
                scrollOffset = Math.min(maxScroll, scrollOffset + 1);
              } else if (matchesKey(data, "pageup") || data === "u") {
                scrollOffset = Math.max(0, scrollOffset - viewportRows);
              } else if (matchesKey(data, "pagedown") || data === "d") {
                scrollOffset = Math.min(maxScroll, scrollOffset + viewportRows);
              } else if (data === "g") {
                scrollOffset = 0;
              } else if (data === "G") {
                scrollOffset = maxScroll;
              }
              tui.requestRender();
            },

            invalidate(): void {
              cachedLines = null;
            },
          };
        },
        { overlay: true }
      );
    },
  });

  // -----------------------------------------------------------------------
  // /autoresearch command — enter autoresearch mode
  // -----------------------------------------------------------------------

  pi.registerCommand("autoresearch", {
    description: "Toggle autoresearch mode on/off, or start a new experiment",
    handler: async (args, ctx) => {
      if (args === "off") {
        autoresearchMode = false;
        ctx.ui.notify("Autoresearch mode OFF", "info");
        return;
      }

      autoresearchMode = true;

      const mdPath = path.join(ctx.cwd, "autoresearch.md");
      const hasRules = fs.existsSync(mdPath);

      if (hasRules) {
        ctx.ui.notify("Autoresearch mode ON — rules loaded from autoresearch.md", "success");
        if (args) {
          // User gave specific instructions, pass them along
          pi.sendUserMessage(`Autoresearch mode active. ${args}`);
        } else {
          pi.sendUserMessage(
            "Autoresearch mode active. Read autoresearch.md and autoresearch.sh, then resume the experiment loop."
          );
        }
      } else {
        ctx.ui.notify("Autoresearch mode ON — no autoresearch.md found, setting up", "info");
        pi.sendUserMessage(
          args
            ? `Start autoresearch: ${args}`
            : "Start autoresearch. No autoresearch.md found — gather context and set up the experiment (create autoresearch.md and autoresearch.sh)."
        );
      }
    },
  });
}
