import { spawnSync } from "node:child_process";

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

export type GitRevertResult = {
  readonly attempted: true;
  readonly reverted: boolean;
  readonly summary: string;
  readonly command: GitCommandResult;
};

function runGitCommand(cwd: string, args: readonly string[]): GitCommandResult {
  const result = spawnSync("git", [...args], {
    cwd,
    encoding: "utf8",
  });

  const stdout = result.stdout ?? "";
  const stderr = result.stderr ?? "";

  return {
    code: result.status,
    stdout,
    stderr,
    combinedOutput: `${stdout}${stderr}`.trim(),
  };
}

export function commitKeptExperiment(options: {
  cwd: string;
  description: string;
  metricName: string;
  metric: number;
  metrics: Record<string, number>;
  commit: string;
  status: "keep";
}): GitKeepResult {
  const resultData: Record<string, unknown> = {
    status: options.status,
    [options.metricName || "metric"]: options.metric,
    ...options.metrics,
  };
  const commitMessage = `${options.description}\n\nResult: ${JSON.stringify(resultData)}`;

  const addResult = runGitCommand(options.cwd, ["add", "-A"]);
  if (addResult.code !== 0) {
    return {
      attempted: true,
      committed: false,
      commit: options.commit,
      summary: `Git add failed${formatExit(addResult.code)}: ${truncateOutput(addResult.combinedOutput)}`,
      command: addResult,
    };
  }

  const diffResult = runGitCommand(options.cwd, ["diff", "--cached", "--quiet"]);
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

  const commitResult = runGitCommand(options.cwd, ["commit", "-m", commitMessage]);
  if (commitResult.code !== 0) {
    return {
      attempted: true,
      committed: false,
      commit: options.commit,
      summary: `Git commit failed${formatExit(commitResult.code)}: ${truncateOutput(commitResult.combinedOutput)}`,
      command: commitResult,
    };
  }

  const revParseResult = runGitCommand(options.cwd, ["rev-parse", "--short=7", "HEAD"]);
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

export function revertTrackedChanges(cwd: string): GitRevertResult {
  const result = runGitCommand(cwd, ["checkout", "--", "."]);

  if (result.code === 0) {
    return {
      attempted: true,
      reverted: true,
      summary: "Git: reverted tracked changes with git checkout -- .",
      command: result,
    };
  }

  return {
    attempted: true,
    reverted: false,
    summary: `Git revert failed${formatExit(result.code)}: ${truncateOutput(result.combinedOutput)}`,
    command: result,
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
