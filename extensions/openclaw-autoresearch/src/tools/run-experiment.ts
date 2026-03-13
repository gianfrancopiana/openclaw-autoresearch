import type { OpenClawPluginApi } from "openclaw/plugin-sdk/core";
import { RunExperimentParams } from "./schemas.js";
import { executeExperimentCommand } from "../execute.js";

export function createRunExperimentTool(_api: OpenClawPluginApi) {
  return {
    name: "run_experiment",
    label: "Run Experiment",
    description:
      "Run a shell command as an experiment. Times wall-clock duration, captures output, detects pass/fail via exit code. Use for any autoresearch experiment.",
    parameters: RunExperimentParams,
    async execute(
      _toolCallId: string,
      params: {
        command: string;
        timeout_seconds?: number;
      },
      signal: AbortSignal,
      onUpdate: ((update: unknown) => void | Promise<void>) | undefined,
      ctx: { cwd: string },
    ) {
      if (onUpdate) {
        await onUpdate({
          content: [{ type: "text" as const, text: `Running: ${params.command}` }],
          details: { phase: "running" },
        });
      }

      const details = await executeExperimentCommand({
        command: params.command,
        cwd: ctx.cwd,
        timeoutSeconds: params.timeout_seconds,
        signal,
      });

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
