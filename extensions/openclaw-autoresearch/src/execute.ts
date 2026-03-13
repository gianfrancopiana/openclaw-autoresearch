import { spawn } from "node:child_process";

const OUTPUT_TAIL_LINES = 80;
const DEFAULT_TIMEOUT_SECONDS = 600;
const FORCE_KILL_GRACE_MS = 1_000;

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
  command: string;
  cwd: string;
  timeoutSeconds?: number;
  signal?: AbortSignal;
}): Promise<ExperimentExecutionResult> {
  const timeoutSeconds = options.timeoutSeconds ?? DEFAULT_TIMEOUT_SECONDS;
  const timeoutMs = Math.max(0, timeoutSeconds) * 1_000;
  const startedAt = Date.now();

  return await new Promise<ExperimentExecutionResult>((resolve) => {
    const child = spawn("bash", ["-c", options.command], {
      cwd: options.cwd,
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";
    let timedOut = false;
    let forceKillTimer: NodeJS.Timeout | undefined;

    const timeoutTimer =
      timeoutMs > 0
        ? setTimeout(() => {
            timedOut = true;
            child.kill("SIGTERM");
            forceKillTimer = setTimeout(() => {
              if (!child.killed) {
                child.kill("SIGKILL");
              }
            }, FORCE_KILL_GRACE_MS);
          }, timeoutMs)
        : undefined;

    const abortHandler = () => {
      child.kill("SIGTERM");
      forceKillTimer = setTimeout(() => {
        if (!child.killed) {
          child.kill("SIGKILL");
        }
      }, FORCE_KILL_GRACE_MS);
    };

    if (options.signal) {
      if (options.signal.aborted) {
        abortHandler();
      } else {
        options.signal.addEventListener("abort", abortHandler, { once: true });
      }
    }

    child.stdout.on("data", (chunk: string | Buffer) => {
      stdout += chunk.toString();
    });

    child.stderr.on("data", (chunk: string | Buffer) => {
      stderr += chunk.toString();
    });

    child.on("error", (error) => {
      stderr += `${stderr ? "\n" : ""}${String(error.message || error)}`;
    });

    child.on("close", (code) => {
      if (timeoutTimer) {
        clearTimeout(timeoutTimer);
      }
      if (forceKillTimer) {
        clearTimeout(forceKillTimer);
      }
      if (options.signal) {
        options.signal.removeEventListener("abort", abortHandler);
      }

      const durationSeconds = (Date.now() - startedAt) / 1_000;
      const passed = code === 0 && !timedOut;

      resolve({
        command: options.command,
        exitCode: code,
        durationSeconds,
        passed,
        crashed: !passed,
        timedOut,
        tailOutput: createOutputTail(stdout, stderr),
        stdout,
        stderr,
      });
    });
  });
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
