import type { OpenClawPluginApi } from "openclaw/plugin-sdk";

const OUTPUT_TAIL_LINES = 80;
const DEFAULT_TIMEOUT_SECONDS = 600;
const NO_TIMEOUT_MS = 2_147_483_647;

type RunCommandWithTimeout = OpenClawPluginApi["runtime"]["system"]["runCommandWithTimeout"];

export type ExperimentExecutionResult = {
  readonly command: string;
  readonly exitCode: number | null;
  readonly durationSeconds: number;
  readonly passed: boolean;
  readonly crashed: boolean;
  readonly timedOut: boolean;
  readonly tailOutput: string;
  readonly stdout: string;
  readonly stderr: string;
};

export async function executeExperimentCommand(options: {
  runCommandWithTimeout: RunCommandWithTimeout;
  command: string;
  cwd: string;
  timeoutSeconds?: number;
  signal?: AbortSignal;
}): Promise<ExperimentExecutionResult> {
  const timeoutSeconds = options.timeoutSeconds ?? DEFAULT_TIMEOUT_SECONDS;
  const timeoutMs =
    timeoutSeconds > 0 ? Math.max(1, Math.floor(timeoutSeconds * 1_000)) : NO_TIMEOUT_MS;
  const startedAt = Date.now();

  if (options.signal?.aborted) {
    const error = new Error("Experiment run aborted before start.");
    error.name = "AbortError";
    throw error;
  }

  const result = await options.runCommandWithTimeout(["bash", "-c", options.command], {
    cwd: options.cwd,
    timeoutMs,
  });
  const durationSeconds = (Date.now() - startedAt) / 1_000;
  const timedOut = result.termination === "timeout";
  const passed = result.code === 0 && result.termination === "exit";

  return {
    command: options.command,
    exitCode: result.code,
    durationSeconds,
    passed,
    crashed: !passed,
    timedOut,
    tailOutput: createOutputTail(result.stdout, result.stderr),
    stdout: result.stdout,
    stderr: result.stderr,
  };
}

function createOutputTail(stdout: string, stderr: string): string {
  const combined = [stdout, stderr]
    .filter((value) => value.trim().length > 0)
    .join("\n")
    .trim();

  if (!combined) {
    return "";
  }

  return combined.split(/\r?\n/).slice(-OUTPUT_TAIL_LINES).join("\n");
}
