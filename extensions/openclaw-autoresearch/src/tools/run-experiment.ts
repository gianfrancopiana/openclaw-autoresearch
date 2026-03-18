import type { OpenClawPluginApi } from "openclaw/plugin-sdk";
import { RunExperimentParams } from "./schemas.js";
import { executeExperimentCommand } from "../execute.js";
import { setAutoresearchRunInFlight } from "../runtime-state.js";
import { resolveToolCwd } from "./tool-cwd.js";

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

      let text = "";
      if (details.timedOut) {
        text += `TIMEOUT after ${details.durationSeconds.toFixed(1)}s\n`;
      } else if (!details.passed) {
        text += `FAILED (exit code ${details.exitCode ?? "null"}) in ${details.durationSeconds.toFixed(1)}s\n`;
      } else {
        text += `PASSED in ${details.durationSeconds.toFixed(1)}s\n`;
      }

      text += `\nLast 80 lines of output:\n${details.tailOutput || "(no output)"}`;

      return {
        content: [{ type: "text" as const, text }],
        details,
      };
    },
  };
}
