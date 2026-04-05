import type { OpenClawPluginApi, OpenClawPluginToolContext } from "openclaw/plugin-sdk";
import { Type } from "@sinclair/typebox";
import { reconstructStateFromJsonl, type AutoresearchStateSnapshot } from "../state.js";
import {
  getAutoresearchRuntimeState,
  type AutoresearchRuntimeSnapshot,
} from "../runtime-state.js";
import { resolveToolExecutionScope } from "./tool-cwd.js";
import {
  readAutoresearchCheckpoint,
  type AutoresearchCheckpoint,
} from "../checkpoint.js";
import { countCommitsSince, readCurrentBranch, readShortHeadCommit } from "../git.js";
import { formatConfidenceLine } from "../confidence.js";
import {
  getAutoresearchSessionLockStatus,
  type AutoresearchSessionLockStatus,
} from "../session-lock.js";

export type AutoresearchStatusDiagnostics = {
  readonly warnings: readonly string[];
  readonly checkpoint: AutoresearchCheckpoint | null;
  readonly gitHead: string | null;
  readonly gitBranch: string | null;
  readonly lock: AutoresearchSessionLockStatus;
};

const AutoresearchStatusParams = Type.Object(
  {
    cwd: Type.Optional(
      Type.String({
        description:
          "Optional working directory for repo-local autoresearch state. Use this when the tool call originates outside the target repo session cwd.",
      }),
    ),
  },
  { additionalProperties: false },
);

export function createAutoresearchStatusTool(
  api: OpenClawPluginApi,
  toolContext?: Pick<OpenClawPluginToolContext, "sessionKey" | "sessionId" | "workspaceDir">,
) {
  return {
    name: "autoresearch_status",
    label: "Autoresearch Status",
    description:
      "Read-only summary of autoresearch state reconstructed from root-level files.",
    parameters: AutoresearchStatusParams,
    async execute(
      _toolCallId: string,
      params: {
        cwd?: string;
      },
      _signal: AbortSignal,
      _onUpdate: unknown,
    ) {
      const scope = resolveToolExecutionScope({
        toolContext,
        requestedCwd: params.cwd,
      });
      const cwd = scope.repoDir;
      const state = reconstructStateFromJsonl(cwd);
      const runtimeState = getAutoresearchRuntimeState(scope);
      const diagnostics = await buildAutoresearchStatusDiagnostics(api, scope, state);

      return {
        content: [
          {
            type: "text" as const,
            text: formatAutoresearchStatusText(state, runtimeState, diagnostics),
          },
        ],
        details: {
          status: "ok",
          state,
          runtime: runtimeState,
          diagnostics,
        },
      };
    },
  };
}

export function formatAutoresearchStatusText(
  state: AutoresearchStateSnapshot,
  runtimeState?: AutoresearchRuntimeSnapshot,
  diagnostics?: AutoresearchStatusDiagnostics,
): string {
  const lines = [
    `Mode: ${state.mode}`,
    `Session doc: ${state.hasSessionDoc ? "present" : "missing"}`,
    `Checkpoint: ${diagnostics?.checkpoint ? "present" : "missing"}`,
    `Ideas backlog: ${state.ideas.hasBacklog ? `${state.ideas.pendingCount} pending` : "empty"}`,
    `Metric: ${state.metricName} (${state.metricUnit || "unitless"}, ${state.bestDirection} is better)`,
    `Current segment: ${state.currentSegment}`,
    `Runs: ${state.currentRunCount} current / ${state.totalRunCount} total`,
    `Baseline: ${formatMetric(state.currentBaselineMetric, state.metricUnit)}`,
    `Best kept: ${formatMetric(state.currentBestMetric, state.metricUnit)}`,
    formatConfidenceLine(state.confidence),
  ];

  if (state.name) {
    lines.splice(1, 0, `Session: ${state.name}`);
  }

  if (runtimeState) {
    lines.splice(
      state.name ? 2 : 1,
      0,
      `Runtime mode: ${runtimeState.mode}`,
      `Experiment window: ${runtimeState.runInFlight ? "running" : "idle"}`,
      `Queued steers: ${runtimeState.queuedSteers.length}`,
    );
    lines.splice(state.name ? 5 : 4, 0, `Pending run: ${runtimeState.pendingRun ? "yes" : "no"}`);
  }

  if (state.lastRun) {
    lines.push(
      `Last run: #${state.lastRun.run} ${state.lastRun.status} ${formatMetric(state.lastRun.metric, state.metricUnit)} ${state.lastRun.commit} ${state.lastRun.description}`.trim(),
    );
  }

  if (state.ideas.preview.length > 0) {
    lines.push(`Ideas preview: ${state.ideas.preview.join(" | ")}`);
  }

  if (diagnostics?.gitHead) {
    lines.push(`Git HEAD: ${diagnostics.gitHead}`);
  }

  if (diagnostics?.gitBranch) {
    lines.push(`Current branch: ${diagnostics.gitBranch}`);
  }

  if (diagnostics?.checkpoint?.canonicalBranch) {
    lines.push(`Canonical branch: ${diagnostics.checkpoint.canonicalBranch}`);
  }

  if (diagnostics?.checkpoint?.carryForwardContext) {
    lines.push(
      `Carry-forward best: ${diagnostics.checkpoint.carryForwardContext.metricName} ${formatMetric(diagnostics.checkpoint.carryForwardContext.run.metric, diagnostics.checkpoint.carryForwardContext.metricUnit)} from ${diagnostics.checkpoint.carryForwardContext.run.commit}`,
    );
  }

  if (diagnostics?.lock) {
    lines.push(`Session lock: ${formatLockStatus(diagnostics.lock)}`);
  }

  if (diagnostics && diagnostics.warnings.length > 0) {
    lines.push("", "Warnings:");
    for (const warning of diagnostics.warnings) {
      lines.push(`- ${warning}`);
    }
  }

  return lines.join("\n");
}

function formatMetric(value: number | null, unit: string): string {
  if (value === null) {
    return "n/a";
  }

  const rendered = value === Math.round(value) ? `${Math.round(value)}` : value.toFixed(2);
  return `${rendered}${unit}`;
}

async function buildAutoresearchStatusDiagnostics(
  api: OpenClawPluginApi,
  scope: ReturnType<typeof resolveToolExecutionScope>,
  state: AutoresearchStateSnapshot,
): Promise<AutoresearchStatusDiagnostics> {
  const checkpoint = readAutoresearchCheckpoint(scope.repoDir);
  const gitHead = await readShortHeadCommit({
    runCommandWithTimeout: api.runtime.system.runCommandWithTimeout,
    cwd: scope.repoDir,
  });
  const gitBranch = await readCurrentBranch({
    runCommandWithTimeout: api.runtime.system.runCommandWithTimeout,
    cwd: scope.repoDir,
  });
  const lock = getAutoresearchSessionLockStatus(scope);
  const warnings: string[] = [];

  if (checkpoint?.pendingRun) {
    warnings.push(
      `A previous run_experiment is still pending log_experiment: ${checkpoint.pendingRun.command}`,
    );
  }

  if (lock.state === "stale") {
    warnings.push(
      `Stale autoresearch.lock detected for PID ${lock.pid}. Remove it after confirming that process is gone.`,
    );
  } else if (lock.state === "active" && !lock.ownedByCurrentSession) {
    warnings.push(
      `Another live autoresearch loop appears active (PID ${lock.pid}, started ${new Date(lock.timestamp ?? 0).toISOString()}). Resume that loop instead of branching off a new one.`,
    );
  }

  if (checkpoint?.canonicalBranch && gitBranch && checkpoint.canonicalBranch !== gitBranch) {
    warnings.push(
      `Branch drift: current branch is ${gitBranch}, but the canonical autoresearch branch is ${checkpoint.canonicalBranch}. Switch back before continuing the loop.`,
    );
  }

  const driftBase =
    state.lastRun?.commit && state.lastRun.commit.length > 0
      ? state.lastRun.commit
      : checkpoint?.sessionStartCommit ?? null;
  if (driftBase) {
    const commitsAhead = await countCommitsSince({
      runCommandWithTimeout: api.runtime.system.runCommandWithTimeout,
      cwd: scope.repoDir,
      sinceCommit: driftBase,
    });

    if (commitsAhead !== null && commitsAhead > 0) {
      const branchLabel = gitBranch ? `Branch ${gitBranch}` : "Current HEAD";
      const shouldBlockPush =
        (gitBranch ?? checkpoint?.canonicalBranch ?? "").startsWith("autoresearch/");
      warnings.push(
        shouldBlockPush
          ? state.lastRun
            ? `UNLOGGED COMMITS: ${branchLabel} is ${commitsAhead} commit${commitsAhead === 1 ? "" : "s"} ahead of the last logged experiment (${state.lastRun.commit}). Do not push this branch until each commit is captured by run_experiment -> log_experiment.`
            : `UNLOGGED COMMITS: ${branchLabel} is ${commitsAhead} commit${commitsAhead === 1 ? "" : "s"} ahead of init_experiment with no logged experiment yet. Do not push this branch until the baseline and follow-up runs are logged.`
          : state.lastRun
            ? `${commitsAhead} commit${commitsAhead === 1 ? "" : "s"} since the last logged experiment (${state.lastRun.commit}).`
            : `${commitsAhead} commit${commitsAhead === 1 ? "" : "s"} since init_experiment, but no experiment has been logged yet.`,
      );
    }
  }

  return {
    warnings,
    checkpoint,
    gitHead,
    gitBranch,
    lock,
  };
}

function formatLockStatus(lock: AutoresearchSessionLockStatus): string {
  if (lock.state === "missing") {
    return "missing";
  }

  const owner = `pid ${lock.pid}`;
  const timestamp = lock.timestamp ? new Date(lock.timestamp).toISOString() : "unknown time";
  if (lock.state === "stale") {
    return `stale (${owner}, started ${timestamp})`;
  }
  return lock.ownedByCurrentSession
    ? `active (current session, ${owner}, started ${timestamp})`
    : `active (${owner}, started ${timestamp})`;
}
