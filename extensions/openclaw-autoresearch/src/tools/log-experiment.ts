import * as fs from "node:fs";
import type { OpenClawPluginApi } from "openclaw/plugin-sdk";
import { LogExperimentParams } from "./schemas.js";
import { commitKeptExperiment, readCurrentBranch, readShortHeadCommit } from "../git.js";
import { appendResultEntry, type AutoresearchResultEntry } from "../logging.js";
import { getAutoresearchRootFilePath } from "../files.js";
import { appendIdeaBacklogEntry } from "../ideas.js";
import {
  readRecentLoggedRuns,
  reconstructStateFromJsonl,
  type AutoresearchStateSnapshot,
  type SecondaryMetricDef,
} from "../state.js";
import {
  consumeAutoresearchPendingRun,
  getAutoresearchPendingRun,
  consumeAutoresearchSteers,
  setAutoresearchRunInFlight,
} from "../runtime-state.js";
import { resolveToolCwd } from "./tool-cwd.js";
import { readAutoresearchCheckpoint, writeAutoresearchCheckpoint } from "../checkpoint.js";
import { syncAutoresearchSessionDoc } from "../session-doc.js";
import { computeConfidence, formatConfidenceLine } from "../confidence.js";
import { acquireAutoresearchSessionLock } from "../session-lock.js";

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
        commit?: string;
        metric?: number;
        status: "keep" | "discard" | "crash";
        description: string;
        idea?: string;
        metrics?: Record<string, number>;
        force?: boolean;
      },
      _signal: AbortSignal,
      _onUpdate: unknown,
    ) {
      const cwd = resolveToolCwd(api, params.cwd);
      const lockStatus = acquireAutoresearchSessionLock(cwd);
      if (lockStatus.state === "active" && !lockStatus.ownedByCurrentProcess) {
        return {
          content: [
            {
              type: "text" as const,
              text:
                "Another autoresearch loop is already active for this repo.\n" +
                `Lock owner PID: ${lockStatus.pid}\n` +
                `Started: ${new Date(lockStatus.timestamp ?? 0).toISOString()}\n` +
                "Resume that loop instead of logging results from a parallel session.",
            },
          ],
          details: {
            status: "error",
            phase: "lock",
          },
        };
      }

      const checkpoint = readAutoresearchCheckpoint(cwd);
      const pendingRun = getAutoresearchPendingRun(cwd) ?? checkpoint?.pendingRun ?? null;
      const state = reconstructStateFromJsonl(cwd);
      const secondaryMetrics = params.metrics ?? pendingRun?.metrics ?? {};
      const inferredCommit =
        params.commit ??
        pendingRun?.commit ??
        (await readShortHeadCommit({
          runCommandWithTimeout: api.runtime.system.runCommandWithTimeout,
          cwd,
        })) ??
        "";
      const inferredMetric = params.metric ?? pendingRun?.primaryMetric;

      if (inferredMetric === null || inferredMetric === undefined) {
        return {
          content: [
            {
              type: "text" as const,
              text:
                "No primary metric is available to log.\n" +
                `Expected a METRIC line for ${state.metricName} from run_experiment, or provide metric explicitly.`,
            },
          ],
          details: {
            status: "error",
            phase: "metric",
            pendingRun,
          },
        };
      }

      if (params.status === "discard" && !(params.idea ?? "").trim()) {
        return {
          content: [
            {
              type: "text" as const,
              text:
                "Discarded experiments must record what was learned.\n" +
                'Provide idea with a short note like "cache key was too coarse; retry with per-file invalidation". It will be appended to autoresearch.ideas.md automatically.',
            },
          ],
          details: {
            status: "error",
            phase: "idea_required",
          },
        };
      }

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
      const isBaselineRun = currentResults.length === 0;
      const experiment: AutoresearchResultEntry = {
        run: state.currentRunCount + 1,
        commit: inferredCommit.slice(0, 7),
        metric: inferredMetric,
        metrics: secondaryMetrics,
        status: params.status,
        baseline: isBaselineRun,
        description: params.description,
        timestamp: Date.now(),
        segment: state.currentSegment,
        confidence: null,
      };
      let finalExperiment = experiment;

      let gitSummary = "";
      let gitAction: Record<string, unknown> = {
        action: params.status === "keep" ? "commit" : "skip",
        attempted: params.status === "keep",
      };

      if (params.status === "keep") {
        const gitResult = await commitKeptExperiment({
          runCommandWithTimeout: api.runtime.system.runCommandWithTimeout,
          cwd: cwd,
          description: params.description,
          metricName: state.metricName,
          metric: inferredMetric,
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

      finalExperiment = {
        ...finalExperiment,
        confidence: computeConfidence(
          [
            ...currentResults,
            {
              metric: finalExperiment.metric,
              metrics: finalExperiment.metrics,
              status: finalExperiment.status,
            },
          ],
          state.bestDirection,
        ),
      };

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

      let ideaAppended = false;
      if ((params.idea ?? "").trim()) {
        appendIdeaBacklogEntry(cwd, params.idea ?? "");
        ideaAppended = true;
      }

      const baselineMetric =
        currentResults.length > 0 ? currentResults[0].metric : experiment.metric;
      const baselineSecondaryMetrics = findBaselineSecondaryMetrics(
        currentResults,
        knownSecondaryMetrics,
      );
      const nextState: AutoresearchStateSnapshot = reconstructStateFromJsonl(cwd);
      const queuedSteers = consumeAutoresearchSteers(cwd);
      consumeAutoresearchPendingRun(cwd);
      setAutoresearchRunInFlight(cwd, false);
      const currentBranch = await readCurrentBranch({
        runCommandWithTimeout: api.runtime.system.runCommandWithTimeout,
        cwd,
      });
      const nextCheckpoint = writeAutoresearchCheckpoint({
        cwd,
        state: nextState,
        sessionStartCommit: checkpoint?.sessionStartCommit ?? experiment.commit,
        canonicalBranch: checkpoint?.canonicalBranch ?? currentBranch,
        carryForwardContext: checkpoint?.carryForwardContext ?? null,
        recentLoggedRuns: readRecentLoggedRuns(cwd, 8),
        pendingRun: null,
      });
      syncAutoresearchSessionDoc(cwd, nextCheckpoint);

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
              usedPendingRun: pendingRun !== null,
              baseline: isBaselineRun,
              ideaAppended,
              confidence: finalExperiment.confidence,
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
  readonly status: "keep" | "discard" | "crash";
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
      status:
        entry.status === "keep" || entry.status === "discard" || entry.status === "crash"
          ? entry.status
          : "keep",
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
  usedPendingRun: boolean;
  baseline: boolean;
  ideaAppended: boolean;
  confidence: number | null;
}): string {
  let text = options.baseline
    ? `Logged #${options.experiment.run}: baseline - ${options.experiment.description}`
    : `Logged #${options.experiment.run}: ${options.experiment.status} - ${options.experiment.description}`;
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

  if (options.confidence !== null) {
    text += `\n${formatConfidenceLine(options.confidence)}`;
  }

  text += `\n(${options.totalRunCount} experiments in current segment)`;
  if (options.usedPendingRun) {
    text += "\nUsed the pending run_experiment result as the source of truth for commit/metric defaults.";
  }
  if (options.baseline) {
    text += "\nThis run established the baseline for the current segment.";
  }
  if (options.ideaAppended) {
    text += "\nAdded a follow-up idea to autoresearch.ideas.md.";
  }
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
