import type { OpenClawPluginApi } from "openclaw/plugin-sdk/core";
import { RunExperimentParams } from "./schemas.js";
import { createPlaceholderToolResult } from "./placeholder.js";

export function createRunExperimentTool(_api: OpenClawPluginApi) {
  return {
    name: "run_experiment",
    label: "Run Experiment",
    description:
      "Run a shell command as an experiment. Times wall-clock duration, captures output, detects pass/fail via exit code. Use for any autoresearch experiment.",
    parameters: RunExperimentParams,
    async execute() {
      return createPlaceholderToolResult("run_experiment", "PR 5 — `run_experiment` parity");
    },
  };
}
