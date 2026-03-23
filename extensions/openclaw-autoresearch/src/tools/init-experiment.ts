import type { OpenClawPluginApi } from "openclaw/plugin-sdk";
import { InitExperimentParams } from "./schemas.js";
import { createConfigHeader, writeConfigHeader } from "../logging.js";
import {
  createEmptyStateSnapshot,
  readBestLoggedRun,
  readRecentLoggedRuns,
  reconstructStateFromJsonl,
  type AutoresearchStateSnapshot,
} from "../state.js";
import { readAutoresearchCheckpoint, writeAutoresearchCheckpoint } from "../checkpoint.js";
import { syncAutoresearchSessionDoc } from "../session-doc.js";
import { readCurrentBranch, readShortHeadCommit } from "../git.js";
import { setAutoresearchPendingRun, setAutoresearchRunInFlight } from "../runtime-state.js";
import { resolveToolCwd } from "./tool-cwd.js";
import { acquireAutoresearchSessionLock } from "../session-lock.js";

export function createInitExperimentTool(api: OpenClawPluginApi) {
  return {
    name: "init_experiment",
    label: "Init Experiment",
    description:
      "Initialize the experiment session. Call once before the first run_experiment to set the name, primary metric, unit, and direction. Writes the config header to autoresearch.jsonl.",
    parameters: InitExperimentParams,
    async execute(
      _toolCallId: string,
      params: {
        cwd?: string;
        name: string;
        metric_name: string;
        metric_unit?: string;
        direction?: "lower" | "higher";
        reset?: boolean;
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
                `Another autoresearch loop already holds ${"autoresearch.lock"}.\n` +
                `Lock owner PID: ${lockStatus.pid}\n` +
                `Started: ${new Date(lockStatus.timestamp ?? 0).toISOString()}\n` +
                "Resume that loop instead of starting a parallel session, or remove the stale lock after confirming the process is gone.",
            },
          ],
          details: {
            status: "error",
            phase: "lock",
          },
        };
      }

      const previousState = reconstructStateFromJsonl(cwd);
      const previousCheckpoint = readAutoresearchCheckpoint(cwd);
      const hasLoggedRuns = previousState.totalRunCount > 0;
      const isReinit = hasLoggedRuns && (params.reset ?? false);

      if (previousCheckpoint?.pendingRun) {
        return {
          content: [
            {
              type: "text" as const,
              text:
                "A run_experiment result is still pending log_experiment.\n" +
                `Pending command: ${previousCheckpoint.pendingRun.command}\n` +
                "Log or clear that run before re-initializing the session.",
            },
          ],
          details: {
            status: "error",
            phase: "pending_log",
          },
        };
      }

      if (hasLoggedRuns && !params.reset) {
        return {
          content: [
            {
              type: "text" as const,
              text:
                `This session already has ${previousState.totalRunCount} logged experiment${previousState.totalRunCount === 1 ? "" : "s"} across ${previousState.currentSegment + 1} segment${previousState.currentSegment === 0 ? "" : "s"}.\n` +
                "init_experiment now requires reset: true before starting a new segment so the reset is explicit and prior results stay comparable.",
            },
          ],
          details: {
            status: "error",
            phase: "reset_required",
          },
        };
      }

      const nextState: AutoresearchStateSnapshot = {
        ...createEmptyStateSnapshot(),
        name: params.name,
        metricName: params.metric_name,
        metricUnit: params.metric_unit ?? "",
        bestDirection: params.direction ?? "lower",
        currentSegment: isReinit ? previousState.currentSegment + 1 : previousState.currentSegment,
      };

      try {
        writeConfigHeader(
          cwd,
          createConfigHeader({
            name: nextState.name ?? params.name,
            metricName: nextState.metricName,
            metricUnit: nextState.metricUnit,
            bestDirection: nextState.bestDirection,
          }),
          isReinit ? "append" : "create",
        );
      } catch (error) {
        return {
          content: [
            {
              type: "text" as const,
              text: `Failed to write autoresearch.jsonl: ${
                error instanceof Error ? error.message : String(error)
              }`,
            },
          ],
          details: {
            status: "error",
          },
        };
      }

      setAutoresearchPendingRun(cwd, null);
      setAutoresearchRunInFlight(cwd, false);

      const nextPersistentState = reconstructStateFromJsonl(cwd);
      const sessionStartCommit = await readShortHeadCommit({
        runCommandWithTimeout: api.runtime.system.runCommandWithTimeout,
        cwd,
      });
      const currentBranch = await readCurrentBranch({
        runCommandWithTimeout: api.runtime.system.runCommandWithTimeout,
        cwd,
      });
      const previousBestRun =
        isReinit
          ? readBestLoggedRun(cwd, previousState.bestDirection, previousState.currentSegment)
          : null;
      const checkpoint = writeAutoresearchCheckpoint({
        cwd,
        state: nextPersistentState,
        sessionStartCommit: sessionStartCommit ?? previousCheckpoint?.sessionStartCommit ?? null,
        canonicalBranch: previousCheckpoint?.canonicalBranch ?? currentBranch,
        carryForwardContext:
          previousBestRun && isReinit
            ? {
                metricName: previousState.metricName,
                metricUnit: previousState.metricUnit,
                bestDirection: previousState.bestDirection,
                run: previousBestRun,
              }
            : previousCheckpoint?.carryForwardContext ?? null,
        recentLoggedRuns: readRecentLoggedRuns(cwd, 8),
        pendingRun: null,
      });
      syncAutoresearchSessionDoc(cwd, checkpoint);

      const reinitNote = isReinit
        ? " (re-initialized - previous results archived, new baseline needed)"
        : "";
      const carryForwardNote =
        checkpoint.carryForwardContext
          ? `\nCarry-forward context: best prior result was ${checkpoint.carryForwardContext.metricName}=${checkpoint.carryForwardContext.run.metric}${checkpoint.carryForwardContext.metricUnit} on ${checkpoint.carryForwardContext.run.commit}.`
          : "";

      return {
        content: [
          {
            type: "text" as const,
            text:
              `Experiment initialized: "${nextState.name}"${reinitNote}\n` +
              `Metric: ${nextState.metricName} (${nextState.metricUnit || "unitless"}, ${nextState.bestDirection} is better)\n` +
              "Config written to autoresearch.jsonl. Now run the baseline with run_experiment, then log it before starting another run." +
              carryForwardNote,
          },
        ],
        details: {
          status: "ok",
          state: nextState,
        },
      };
    },
  };
}
