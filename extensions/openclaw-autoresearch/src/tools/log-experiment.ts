import * as fs from "node:fs";
import type { OpenClawPluginApi, OpenClawPluginToolContext } from "openclaw/plugin-sdk/core";
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
import { resolveToolExecutionScope } from "./tool-cwd.js";
import { readAutoresearchCheckpoint, writeAutoresearchCheckpoint } from "../checkpoint.js";
import { syncAutoresearchSessionDoc } from "../session-doc.js";
import { computeConfidence, formatConfidenceLine } from "../confidence.js";
import { acquireAutoresearchSessionLock } from "../session-lock.js";
import { prepareAutoresearchToolExecution } from "./preflight.js";

export function createLogExperimentTool(
  api: OpenClawPluginApi,
  toolContext?: Pick<OpenClawPluginToolContext, "sessionKey" | "sessionId" | "workspaceDir">,
) {
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
      const resolvedScope = resolveToolExecutionScope({
        toolContext,
        requestedCwd: params.cwd,
      });
      const prepared = await prepareAutoresearchToolExecution({
        runCommandWithTimeout: api.runtime.system.runCommandWithTimeout,
        scope: resolvedScope,
      });
      if (!prepared.ok) {
        return prepared.failure;
      }

      const scope = prepared.scope;
      const cwd = scope.repoDir;
      const lockStatus = acquireAutoresearchSessionLock(scope);
      if (lockStatus.state === "active" && !lockStatus.ownedByCurrentSession) {
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
      const pendingRun = getAutoresearchPendingRun(scope) ?? checkpoint?.pendingRun ?? null;
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
          cwd,
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
      const queuedSteers = consumeAutoresearchSteers(scope);
      consumeAutoresearchPendingRun(scope);
      setAutoresearchRunInFlight(scope, false);
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

    const metricsValue = entry.metrics;
    const metrics =
      metricsValue && typeof metricsValue === "object" && !Array.isArray(metricsValue)
        ? Object.fromEntries(
            Object.entries(metricsValue).filter(([, value]) => typeof value === "number"),
          )
        : {};
    results.push({
      metric: entry.metric,
      metrics,
      status:
        entry.status === "discard" || entry.status === "crash" ? entry.status : "keep",
    });
  }

  return results;
}

function inferMetricUnit(metricName: string): string {
  const lower = metricName.toLowerCase();
  if (lower.endsWith("_ms") || lower.includes("millisecond")) {
    return "ms";
  }
  if (lower.endsWith("_s") || lower.includes("second")) {
    return "s";
  }
  if (lower.endsWith("_kb") || lower.includes("kilobyte")) {
    return "kb";
  }
  if (lower.endsWith("_mb") || lower.includes("megabyte")) {
    return "mb";
  }
  if (lower.endsWith("_pct") || lower.endsWith("_percent") || lower.includes("percent")) {
    return "%";
  }
  return "";
}

function findBaselineSecondaryMetrics(
  currentResults: readonly CurrentSegmentResult[],
  knownMetrics: readonly SecondaryMetricDef[],
): Record<string, number> {
  if (currentResults.length === 0) {
    return Object.fromEntries(knownMetrics.map((metric) => [metric.name, NaN]));
  }

  const baseline = currentResults[0]?.metrics ?? {};
  return Object.fromEntries(
    knownMetrics.map((metric) => [metric.name, baseline[metric.name] ?? NaN]),
  );
}

function buildResultText(params: {
  state: AutoresearchStateSnapshot;
  experiment: AutoresearchResultEntry;
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
  const delta = params.experiment.metric - params.baselineMetric;
  const direction = params.state.bestDirection === "lower" ? -1 : 1;
  const baselineComparison =
    params.baseline
      ? "This run established the baseline for the current segment."
      : delta === 0
        ? `Matched baseline (${params.baselineMetric}${params.state.metricUnit}).`
        : direction * delta > 0
          ? `Improved vs baseline by ${Math.abs(delta)}${params.state.metricUnit}.`
          : `Regressed vs baseline by ${Math.abs(delta)}${params.state.metricUnit}.`;

  const secondaryMetricLines = params.knownSecondaryMetrics
    .map((metric) => {
      const value = params.experiment.metrics[metric.name];
      const baselineValue = params.baselineSecondaryMetrics[metric.name];
      if (value === undefined) {
        return null;
      }
      const change =
        typeof baselineValue === "number" && Number.isFinite(baselineValue)
          ? value - baselineValue
          : null;
      const deltaText =
        change === null
          ? ""
          : change === 0
            ? " (matched baseline)"
            : `${change > 0 ? " (+" : " ("}${change}${metric.unit})`;
      return `- ${metric.name}: ${value}${metric.unit}${deltaText}`;
    })
    .filter((line): line is string => line !== null);

  const lines = [
    `Logged #${params.totalRunCount}: ${params.experiment.status} - ${params.experiment.description}`,
    `Metric: ${params.experiment.metric}${params.state.metricUnit}`,
    baselineComparison,
    params.gitSummary,
  ];

  if (secondaryMetricLines.length > 0) {
    lines.push("", "Secondary metrics:", ...secondaryMetricLines);
  }

  if (params.usedPendingRun) {
    lines.push("", "Used the pending run_experiment result as the source of truth for commit and/or metric.");
  }

  if (params.queuedSteers.length > 0) {
    lines.push("", "Queued user steers captured during this experiment:");
    for (const steer of params.queuedSteers) {
      lines.push(`- ${steer}`);
    }
  }

  if (params.ideaAppended) {
    lines.push("", "Appended the idea note to autoresearch.ideas.md.");
  }

  if (params.confidence !== null) {
    lines.push("", formatConfidenceLine(params.confidence));
  }

  return lines.join("\n");
}
