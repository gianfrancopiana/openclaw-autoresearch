import { spawn } from "node:child_process";

type CommandOptions = {
  timeoutMs: number;
  cwd?: string;
  input?: string;
  env?: NodeJS.ProcessEnv;
  windowsVerbatimArguments?: boolean;
  noOutputTimeoutMs?: number;
};

type SpawnResult = {
  pid?: number;
  stdout: string;
  stderr: string;
  code: number | null;
  signal: NodeJS.Signals | null;
  killed: boolean;
  termination: "exit" | "timeout" | "no-output-timeout" | "signal";
  noOutputTimedOut?: boolean;
};

export async function runCommandWithTimeout(
  argv: string[],
  optionsOrTimeout: number | CommandOptions,
): Promise<SpawnResult> {
  const options =
    typeof optionsOrTimeout === "number"
      ? { timeoutMs: optionsOrTimeout }
      : optionsOrTimeout;

  return await new Promise<SpawnResult>((resolve, reject) => {
    const child = spawn(argv[0] ?? "", argv.slice(1), {
      cwd: options.cwd,
      env: options.env,
      stdio: ["pipe", "pipe", "pipe"],
      windowsVerbatimArguments: options.windowsVerbatimArguments,
    });

    let stdout = "";
    let stderr = "";
    let settled = false;
    let timedOut = false;
    let noOutputTimedOut = false;
    let noOutputTimer: NodeJS.Timeout | undefined;

    const clearNoOutputTimer = () => {
      if (noOutputTimer) {
        clearTimeout(noOutputTimer);
        noOutputTimer = undefined;
      }
    };

    const armNoOutputTimer = () => {
      clearNoOutputTimer();
      if (!options.noOutputTimeoutMs || options.noOutputTimeoutMs <= 0) {
        return;
      }
      noOutputTimer = setTimeout(() => {
        noOutputTimedOut = true;
        child.kill("SIGKILL");
      }, options.noOutputTimeoutMs);
    };

    const timeoutTimer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGKILL");
    }, options.timeoutMs);

    armNoOutputTimer();

    if (options.input !== undefined && child.stdin) {
      child.stdin.write(options.input);
    }
    child.stdin?.end();

    child.stdout?.on("data", (chunk: string | Buffer) => {
      stdout += chunk.toString();
      armNoOutputTimer();
    });

    child.stderr?.on("data", (chunk: string | Buffer) => {
      stderr += chunk.toString();
      armNoOutputTimer();
    });

    child.on("error", (error) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timeoutTimer);
      clearNoOutputTimer();
      reject(error);
    });

    child.on("close", (code, signal) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timeoutTimer);
      clearNoOutputTimer();
      resolve({
        pid: child.pid ?? undefined,
        stdout,
        stderr,
        code,
        signal,
        killed: child.killed,
        termination: noOutputTimedOut ? "no-output-timeout" : timedOut ? "timeout" : signal ? "signal" : "exit",
        noOutputTimedOut,
      });
    });
  });
}
