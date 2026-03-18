import type { OpenClawPluginApi } from "openclaw/plugin-sdk";

const GIT_TIMEOUT_MS = 30_000;

type RunCommandWithTimeout = OpenClawPluginApi["runtime"]["system"]["runCommandWithTimeout"];

export type GitCommandResult = {
  readonly code: number | null;
  readonly stdout: string;
  readonly stderr: string;
  readonly combinedOutput: string;
};

export type GitKeepResult = {
  readonly attempted: true;
  readonly committed: boolean;
  readonly commit: string;
  readonly summary: string;
  readonly command: GitCommandResult;
};

async function runGitCommand(
  runCommandWithTimeout: RunCommandWithTimeout,
  cwd: string,
  args: readonly string[],
): Promise<GitCommandResult> {
  const result = await runCommandWithTimeout(["git", ...args], {
    cwd,
    timeoutMs: GIT_TIMEOUT_MS,
  });
  const stdout = result.stdout ?? "";
  const stderr = result.stderr ?? "";
  const combinedOutput = `${stdout}${stderr}`.trim() || describeTermination(result.termination);

  return {
    code: result.code,
    stdout,
    stderr,
    combinedOutput,
  };
}

export async function commitKeptExperiment(options: {
  runCommandWithTimeout: RunCommandWithTimeout;
  cwd: string;
  description: string;
  metricName: string;
  metric: number;
  metrics: Record<string, number>;
  commit: string;
  status: "keep";
}): Promise<GitKeepResult> {
  const resultData: Record<string, unknown> = {
    status: options.status,
    [options.metricName || "metric"]: options.metric,
    ...options.metrics,
  };
  const commitMessage = `${options.description}\n\nResult: ${JSON.stringify(resultData)}`;

  const repoRootResult = await runGitCommand(options.runCommandWithTimeout, options.cwd, [
    "rev-parse",
    "--show-toplevel",
  ]);
  if (repoRootResult.code !== 0 || repoRootResult.stdout.trim().length === 0) {
    return {
      attempted: true,
      committed: false,
      commit: options.commit,
      summary: `Git repo check failed${formatExit(repoRootResult.code)}: ${truncateOutput(repoRootResult.combinedOutput)}`,
      command: repoRootResult,
    };
  }

  const repoRoot = repoRootResult.stdout.trim();

  const addResult = await runGitCommand(options.runCommandWithTimeout, repoRoot, ["add", "-A"]);
  if (addResult.code !== 0) {
    return {
      attempted: true,
      committed: false,
      commit: options.commit,
      summary: `Git add failed${formatExit(addResult.code)}: ${truncateOutput(addResult.combinedOutput)}`,
      command: addResult,
    };
  }

  const diffResult = await runGitCommand(options.runCommandWithTimeout, repoRoot, [
    "diff",
    "--cached",
    "--quiet",
  ]);
  if (diffResult.code === 0) {
    return {
      attempted: true,
      committed: false,
      commit: options.commit,
      summary: "Git: nothing to commit (working tree clean)",
      command: diffResult,
    };
  }
  if (diffResult.code !== 1) {
    return {
      attempted: true,
      committed: false,
      commit: options.commit,
      summary: `Git diff check failed${formatExit(diffResult.code)}: ${truncateOutput(diffResult.combinedOutput)}`,
      command: diffResult,
    };
  }

  const commitResult = await runGitCommand(options.runCommandWithTimeout, repoRoot, [
    "commit",
    "-m",
    commitMessage,
  ]);
  if (commitResult.code !== 0) {
    return {
      attempted: true,
      committed: false,
      commit: options.commit,
      summary: `Git commit failed${formatExit(commitResult.code)}: ${truncateOutput(commitResult.combinedOutput)}`,
      command: commitResult,
    };
  }

  const revParseResult = await runGitCommand(options.runCommandWithTimeout, repoRoot, [
    "rev-parse",
    "--short=7",
    "HEAD",
  ]);
  const actualCommit =
    revParseResult.code === 0 && revParseResult.stdout.trim().length >= 7
      ? revParseResult.stdout.trim().slice(0, 7)
      : options.commit;
  const firstLine = commitResult.combinedOutput.split("\n")[0]?.trim() || "commit created";

  return {
    attempted: true,
    committed: true,
    commit: actualCommit,
    summary: `Git: committed - ${firstLine}`,
    command: commitResult,
  };
}

function truncateOutput(output: string): string {
  const normalized = output.trim();
  if (!normalized) {
    return "no output";
  }
  return normalized.length > 200 ? `${normalized.slice(0, 200)}...` : normalized;
}

function formatExit(code: number | null): string {
  return code === null ? "" : ` (exit ${code})`;
}

function describeTermination(termination: "exit" | "timeout" | "no-output-timeout" | "signal"): string {
  switch (termination) {
    case "timeout":
      return "command timed out";
    case "no-output-timeout":
      return "command timed out waiting for output";
    case "signal":
      return "command terminated by signal";
    default:
      return "";
  }
}
