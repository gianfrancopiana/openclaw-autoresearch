import * as fs from "node:fs";
import type { OpenClawPluginApi } from "openclaw/plugin-sdk/core";
import { LogExperimentParams } from "./schemas.js";
import { commitKeptExperiment } from "../git.js";
import { appendResultEntry, type AutoresearchResultEntry } from "../logging.js";
import { getAutoresearchRootFilePath } from "../files.js";
import {
  reconstructStateFromJsonl,
  type AutoresearchStateSnapshot,
  type SecondaryMetricDef,
} from "../state.js";
import {
  consumeAutoresearchSteers,
  setAutoresearchRunInFlight,
} from "../runtime-state.js";
import { resolveToolCwd } from "./tool-cwd.js";

export function createLogExperimentTool(api: OpenClawPluginApi) {
  return {
    name: "log_experiment",
    label: "Log Experiment",
    description:
      "Record an experiment result. Tracks metrics and preserves keep/discard/crash semantics. Call after every run_experiment.",
    parameters: LogExperimentParams,
    async execute(
      _toolCallId: string,
      params: {
        cwd?: string;
        commit: string;
        metric: number;
        status: "keep" | "discard" | "crash";
        description: string;
        metrics?: Record<string, number>;
        force?: boolean;
      },
      _signal: AbortSignal,
      _onUpdate: unknown,
    ) {
      const cwd = resolveToolCwd(api, params.cwd);
      const state = reconstructStateFromJsonl(cwd);
      const secondaryMetrics = params.metrics ?? {};

      if (state.secondaryMetrics.length > 0) {
        const validationError = validateSecondaryMetrics(
          state.secondaryMetrics,
          secondaryMetrics,
          params.force ?? false,
        );
        if (validationError) {
          return {
            content: [{ type: "text" as const, text: validationError }],
            details: {
              status: "error",
              phase: "validate",
            },
          };
        }
      }

      const knownSecondaryMetrics = mergeSecondaryMetrics(state.secondaryMetrics, secondaryMetrics);
      const currentResults = readCurrentSegmentResults(cwd, state.currentSegment);
      const experiment: AutoresearchResultEntry = {
        run: state.currentRunCount + 1,
        commit: params.commit.slice(0, 7),
        metric: params.metric,
        metrics: secondaryMetrics,
        status: params.status,
        description: params.description,
        timestamp: Date.now(),
        segment: state.currentSegment,
      };
      let finalExperiment = experiment;

      let gitSummary = "";
      let gitAction: Record<string, unknown> = {
        action: params.status === "keep" ? "commit" : "skip",
        attempted: params.status === "keep",
      };

      if (params.status === "keep") {
        const gitResult = commitKeptExperiment({
          cwd: cwd,
          description: params.description,
          metricName: state.metricName,
          metric: params.metric,
          metrics: secondaryMetrics,
          commit: experiment.commit,
          status: "keep",
        });
        gitSummary = gitResult.summary;
        gitAction = {
          action: "commit",
          attempted: true,
          committed: gitResult.committed,
          commit: gitResult.commit,
        };
        if (gitResult.committed) {
          finalExperiment = {
            ...experiment,
            commit: gitResult.commit,
          };
        }
      } else {
        gitSummary =
          `Git: skipped commit (${params.status}) - ` +
          "revert tracked changes yourself with git checkout -- . when you want to discard them.";
        gitAction = {
          action: "skip",
          attempted: false,
        };
      }

      try {
        appendResultEntry(cwd, finalExperiment);
      } catch (error) {
        return {
          content: [
            {
              type: "text" as const,
              text: `Failed to append autoresearch.jsonl: ${
                error instanceof Error ? error.message : String(error)
              }`,
            },
          ],
          details: {
            status: "error",
            phase: "write",
          },
        };
      }

      const baselineMetric =
        currentResults.length > 0 ? currentResults[0].metric : experiment.metric;
      const baselineSecondaryMetrics = findBaselineSecondaryMetrics(
        currentResults,
        knownSecondaryMetrics,
      );
      const nextState: AutoresearchStateSnapshot = reconstructStateFromJsonl(cwd);
      const queuedSteers = consumeAutoresearchSteers(cwd);
      setAutoresearchRunInFlight(cwd, false);

      return {
        content: [
          {
            type: "text" as const,
            text: buildResultText({
              state,
              experiment: finalExperiment,
              baselineMetric,
              baselineSecondaryMetrics,
              totalRunCount: finalExperiment.run,
              gitSummary,
              knownSecondaryMetrics,
              queuedSteers,
            }),
          },
        ],
        details: {
          status: "ok",
          experiment: finalExperiment,
          state: nextState,
          git: gitAction,
        },
      };
    },
  };
}

type CurrentSegmentResult = {
  readonly metric: number;
  readonly metrics: Record<string, number>;
};

function validateSecondaryMetrics(
  knownMetrics: readonly SecondaryMetricDef[],
  providedMetrics: Record<string, number>,
  force: boolean,
): string | null {
  const knownNames = new Set(knownMetrics.map((metric) => metric.name));
  const providedNames = new Set(Object.keys(providedMetrics));

  const missing = [...knownNames].filter((name) => !providedNames.has(name));
  if (missing.length > 0) {
    return (
      `Missing secondary metrics: ${missing.join(", ")}\n\n` +
      `You must provide all previously tracked metrics. Expected: ${[...knownNames].join(", ")}\n` +
      `Got: ${[...providedNames].join(", ") || "(none)"}\n\n` +
      `Fix: include ${missing.map((name) => `"${name}": <value>`).join(", ")} in the metrics parameter.`
    );
  }

  const added = [...providedNames].filter((name) => !knownNames.has(name));
  if (added.length > 0 && !force) {
    return (
      `New secondary metric${added.length > 1 ? "s" : ""} not previously tracked: ${added.join(", ")}\n\n` +
      `Existing metrics: ${[...knownNames].join(", ")}\n\n` +
      "If this metric has proven very valuable to watch, call log_experiment again with force: true to add it. Otherwise, remove it from the metrics parameter."
    );
  }

  return null;
}

function mergeSecondaryMetrics(
  knownMetrics: readonly SecondaryMetricDef[],
  providedMetrics: Record<string, number>,
): readonly SecondaryMetricDef[] {
  const merged = [...knownMetrics];
  for (const metricName of Object.keys(providedMetrics)) {
    if (!merged.find((metric) => metric.name === metricName)) {
      merged.push({
        name: metricName,
        unit: inferMetricUnit(metricName),
      });
    }
  }
  return merged;
}

function readCurrentSegmentResults(cwd: string, segment: number): CurrentSegmentResult[] {
  const jsonlPath = getAutoresearchRootFilePath(cwd, "resultsLog");
  if (!fs.existsSync(jsonlPath)) {
    return [];
  }

  const results: CurrentSegmentResult[] = [];
  let currentSegment = 0;
  let hasSeenResult = false;
  const lines = fs
    .readFileSync(jsonlPath, "utf8")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);

  for (const line of lines) {
    let entry: Record<string, unknown>;
    try {
      entry = JSON.parse(line) as Record<string, unknown>;
    } catch {
      continue;
    }

    if (entry.type === "config") {
      if (hasSeenResult) {
        currentSegment += 1;
      }
      continue;
    }

    hasSeenResult = true;
    if (currentSegment !== segment || typeof entry.metric !== "number") {
      continue;
    }

    results.push({
      metric: entry.metric,
      metrics:
        entry.metrics && typeof entry.metrics === "object"
          ? (entry.metrics as Record<string, number>)
          : {},
    });
  }

  return results;
}

function findBaselineSecondaryMetrics(
  currentResults: readonly CurrentSegmentResult[],
  secondaryMetrics: readonly SecondaryMetricDef[],
): Record<string, number> {
  const baseline =
    currentResults.length > 0 ? { ...currentResults[0].metrics } : {};

  for (const metric of secondaryMetrics) {
    if (baseline[metric.name] !== undefined) {
      continue;
    }
    for (const result of currentResults) {
      const value = result.metrics[metric.name];
      if (value !== undefined) {
        baseline[metric.name] = value;
        break;
      }
    }
  }

  return baseline;
}

function buildResultText(options: {
  state: AutoresearchStateSnapshot;
  experiment: {
    run: number;
    commit: string;
    metric: number;
    metrics: Record<string, number>;
    status: "keep" | "discard" | "crash";
    description: string;
  };
  baselineMetric: number;
  baselineSecondaryMetrics: Record<string, number>;
  totalRunCount: number;
  gitSummary: string;
  knownSecondaryMetrics: readonly SecondaryMetricDef[];
  queuedSteers: readonly string[];
}): string {
  let text = `Logged #${options.experiment.run}: ${options.experiment.status} - ${options.experiment.description}`;
  text += `\nBaseline ${options.state.metricName}: ${formatMetric(options.baselineMetric, options.state.metricUnit)}`;

  if (options.experiment.run > 1 && options.experiment.status === "keep" && options.experiment.metric > 0) {
    const delta = options.experiment.metric - options.baselineMetric;
    const pct = options.baselineMetric === 0 ? null : (delta / options.baselineMetric) * 100;
    text += ` | this: ${formatMetric(options.experiment.metric, options.state.metricUnit)}`;
    if (pct !== null) {
      const sign = delta > 0 ? "+" : "";
      text += ` (${sign}${pct.toFixed(1)}%)`;
    }
  }

  if (Object.keys(options.experiment.metrics).length > 0) {
    const parts = Object.entries(options.experiment.metrics).map(([name, value]) => {
      const metricDef = options.knownSecondaryMetrics.find((metric) => metric.name === name);
      let part = `${name}: ${formatMetric(value, metricDef?.unit ?? "")}`;
      const baselineValue = options.baselineSecondaryMetrics[name];
      if (
        baselineValue !== undefined &&
        options.experiment.run > 1 &&
        baselineValue !== 0
      ) {
        const delta = value - baselineValue;
        const sign = delta > 0 ? "+" : "";
        part += ` (${sign}${((delta / baselineValue) * 100).toFixed(1)}%)`;
      }
      return part;
    });
    text += `\nSecondary: ${parts.join("  ")}`;
  }

  text += `\n(${options.totalRunCount} experiments in current segment)`;
  text += `\n${options.gitSummary}`;

  if (options.queuedSteers.length > 0) {
    const steerLabel = options.queuedSteers.length === 1 ? "steer" : "steers";
    text += `\n\nQueued user ${steerLabel} captured during this experiment:`;
    for (const steer of options.queuedSteers) {
      text += `\n- ${steer}`;
    }
    text +=
      "\nTreat any immediate followup turn that repeats the same steer as the normal OpenClaw queue/backlog delivery for these messages.";
  }

  return text;
}

function inferMetricUnit(name: string): string {
  if (name.endsWith("_µs") || name.includes("µs")) {
    return "µs";
  }
  if (name.endsWith("_ms") || name.includes("ms")) {
    return "ms";
  }
  if (name.endsWith("_s") || name.includes("sec")) {
    return "s";
  }
  return "";
}

function formatMetric(value: number, unit: string): string {
  const rendered =
    value === Math.round(value) ? `${Math.round(value)}` : value.toFixed(2);
  return `${addCommas(rendered)}${unit}`;
}

function addCommas(value: string): string {
  const [integerPart, fractionalPart] = value.split(".");
  const normalizedInteger = integerPart.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return fractionalPart ? `${normalizedInteger}.${fractionalPart}` : normalizedInteger;
}
