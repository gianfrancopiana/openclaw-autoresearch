import type { OpenClawPluginApi } from "openclaw/plugin-sdk/core";
import { InitExperimentParams } from "./schemas.js";
import { createPlaceholderToolResult } from "./placeholder.js";

export function createInitExperimentTool(_api: OpenClawPluginApi) {
  return {
    name: "init_experiment",
    label: "Init Experiment",
    description:
      "Initialize the experiment session. Call once before the first run_experiment to set the name, primary metric, unit, and direction. Writes the config header to autoresearch.jsonl.",
    parameters: InitExperimentParams,
    async execute() {
      return createPlaceholderToolResult("init_experiment", "PR 4 — `init_experiment` parity");
    },
  };
}
