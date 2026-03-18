import type { OpenClawPluginApi } from "openclaw/plugin-sdk";
import { InitExperimentParams } from "./schemas.js";
import { createConfigHeader, writeConfigHeader } from "../logging.js";
import {
  createEmptyStateSnapshot,
  reconstructStateFromJsonl,
  type AutoresearchStateSnapshot,
} from "../state.js";
import { resolveToolCwd } from "./tool-cwd.js";

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
      },
      _signal: AbortSignal,
      _onUpdate: unknown,
    ) {
      const cwd = resolveToolCwd(api, params.cwd);
      const previousState = reconstructStateFromJsonl(cwd);
      const isReinit = previousState.currentRunCount > 0;
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

      const reinitNote = isReinit
        ? " (re-initialized - previous results archived, new baseline needed)"
        : "";

      return {
        content: [
          {
            type: "text" as const,
            text:
              `Experiment initialized: "${nextState.name}"${reinitNote}\n` +
              `Metric: ${nextState.metricName} (${nextState.metricUnit || "unitless"}, ${nextState.bestDirection} is better)\n` +
              "Config written to autoresearch.jsonl. Now run the baseline with run_experiment.",
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
