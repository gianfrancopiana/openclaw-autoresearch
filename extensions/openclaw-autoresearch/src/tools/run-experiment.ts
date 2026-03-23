import type { OpenClawPluginApi } from "openclaw/plugin-sdk";
import { RunExperimentParams } from "./schemas.js";
import { executeExperimentCommand } from "../execute.js";
import {
  getAutoresearchPendingRun,
  setAutoresearchPendingRun,
  setAutoresearchRunInFlight,
} from "../runtime-state.js";
import { resolveToolCwd } from "./tool-cwd.js";
import { parseMetricLines } from "../metrics.js";
import { readCurrentBranch, readShortHeadCommit } from "../git.js";
import { readAutoresearchCheckpoint, writeAutoresearchCheckpoint } from "../checkpoint.js";
import { readRecentLoggedRuns, reconstructStateFromJsonl } from "../state.js";
import { syncAutoresearchSessionDoc } from "../session-doc.js";
import { acquireAutoresearchSessionLock } from "../session-lock.js";

export function createRunExperimentTool(api: OpenClawPluginApi) {
  return {
    name: "run_experiment",
    label: "Run Experiment",
    description:
      "Run a shell command as an experiment. Times wall-clock duration, captures output, detects pass/fail via exit code. Use for any autoresearch experiment.",
    parameters: RunExperimentParams,
    async execute(
      _toolCallId: string,
      params: {
        cwd?: string;
        command: string;
        timeout_seconds?: number;
      },
      signal: AbortSignal,
      onUpdate: ((update: unknown) => void | Promise<void>) | undefined,
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
                "Resume that loop instead of running a parallel experiment session.",
            },
          ],
          details: {
            status: "error",
            phase: "lock",
          },
        };
      }

      const checkpoint = readAutoresearchCheckpoint(cwd);
      const existingPendingRun = getAutoresearchPendingRun(cwd) ?? checkpoint?.pendingRun ?? null;

      if (existingPendingRun) {
        return {
          content: [
            {
              type: "text" as const,
              text:
                "The previous run_experiment result has not been logged yet.\n" +
                `Pending command: ${existingPendingRun.command}\n` +
                "Call log_experiment next. You can omit commit/metric and the tool will use the pending run by default.",
            },
          ],
          details: {
            status: "error",
            phase: "pending_log",
            pendingRun: existingPendingRun,
          },
        };
      }

      setAutoresearchRunInFlight(cwd, true);

      if (onUpdate) {
        await onUpdate({
          content: [{ type: "text" as const, text: `Running: ${params.command}` }],
          details: { phase: "running" },
        });
      }

      let details;
      try {
        details = await executeExperimentCommand({
          runCommandWithTimeout: api.runtime.system.runCommandWithTimeout,
          command: params.command,
          cwd,
          timeoutSeconds: params.timeout_seconds,
          signal,
        });
      } catch (error) {
        setAutoresearchRunInFlight(cwd, false);
        throw error;
      }

      const state = reconstructStateFromJsonl(cwd);
      const parsedMetrics = parseMetricLines([details.stdout, details.stderr].join("\n"));
      const detectedPrimaryMetricName =
        parsedMetrics[state.metricName] !== undefined
          ? state.metricName
          : Object.keys(parsedMetrics).length === 1
            ? Object.keys(parsedMetrics)[0] ?? null
            : null;
      const primaryMetric =
        detectedPrimaryMetricName !== null ? parsedMetrics[detectedPrimaryMetricName] ?? null : null;
      const secondaryMetrics =
        detectedPrimaryMetricName !== null
          ? Object.fromEntries(
              Object.entries(parsedMetrics).filter(([name]) => name !== detectedPrimaryMetricName),
            )
          : parsedMetrics;
      const currentCommit = await readShortHeadCommit({
        runCommandWithTimeout: api.runtime.system.runCommandWithTimeout,
        cwd,
      });
      const currentBranch = await readCurrentBranch({
        runCommandWithTimeout: api.runtime.system.runCommandWithTimeout,
        cwd,
      });
      const pendingRun = {
        command: params.command,
        commit: currentCommit,
        primaryMetric,
        metrics: secondaryMetrics,
        durationSeconds: details.durationSeconds,
        exitCode: details.exitCode,
        passed: details.passed,
        timedOut: details.timedOut,
        tailOutput: details.tailOutput,
        capturedAt: Date.now(),
      } as const;
      setAutoresearchPendingRun(cwd, pendingRun);
      const nextCheckpoint = writeAutoresearchCheckpoint({
        cwd,
        state,
        sessionStartCommit: checkpoint?.sessionStartCommit ?? currentCommit,
        canonicalBranch: checkpoint?.canonicalBranch ?? currentBranch,
        carryForwardContext: checkpoint?.carryForwardContext ?? null,
        recentLoggedRuns: readRecentLoggedRuns(cwd, 8),
        pendingRun,
      });
      syncAutoresearchSessionDoc(cwd, nextCheckpoint);

      let text = "";
      if (details.timedOut) {
        text += `TIMEOUT after ${details.durationSeconds.toFixed(1)}s\n`;
      } else if (!details.passed) {
        text += `FAILED (exit code ${details.exitCode ?? "null"}) in ${details.durationSeconds.toFixed(1)}s\n`;
      } else {
        text += `PASSED in ${details.durationSeconds.toFixed(1)}s\n`;
      }

      text += `\nLast 80 lines of output:\n${details.tailOutput || "(no output)"}`;
      if (Object.keys(parsedMetrics).length > 0) {
        text += `\n\nParsed METRIC lines: ${Object.entries(parsedMetrics)
          .map(([name, value]) => `${name}=${value}`)
          .join(", ")}`;
      } else {
        text += `\n\nNo METRIC lines were detected.`;
      }
      text +=
        "\nNext step: call log_experiment before another run. When the primary METRIC was captured, log_experiment can infer commit and metric from this run.";

      return {
        content: [{ type: "text" as const, text }],
        details: {
          ...details,
          metrics: parsedMetrics,
          secondaryMetrics,
          primaryMetric,
          pendingRun,
        },
      };
    },
  };
}
