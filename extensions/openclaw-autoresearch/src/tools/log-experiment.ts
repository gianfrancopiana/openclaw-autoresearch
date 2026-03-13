import type { OpenClawPluginApi } from "openclaw/plugin-sdk/core";
import { LogExperimentParams } from "./schemas.js";
import { createPlaceholderToolResult } from "./placeholder.js";

export function createLogExperimentTool(_api: OpenClawPluginApi) {
  return {
    name: "log_experiment",
    label: "Log Experiment",
    description:
      "Record an experiment result. Tracks metrics and preserves keep/discard/crash semantics. Call after every run_experiment.",
    parameters: LogExperimentParams,
    async execute() {
      return createPlaceholderToolResult("log_experiment", "PR 6 — `log_experiment` parity");
    },
  };
}
