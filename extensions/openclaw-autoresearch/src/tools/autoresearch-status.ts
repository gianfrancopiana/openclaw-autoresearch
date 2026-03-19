import type { OpenClawPluginApi } from "openclaw/plugin-sdk";
import { Type } from "@sinclair/typebox";
import { reconstructStateFromJsonl, type AutoresearchStateSnapshot } from "../state.js";
import {
  getAutoresearchRuntimeState,
  type AutoresearchRuntimeSnapshot,
} from "../runtime-state.js";
import { resolveToolCwd } from "./tool-cwd.js";
import {
  readAutoresearchCheckpoint,
  type AutoresearchCheckpoint,
} from "../checkpoint.js";
import { countCommitsSince, readShortHeadCommit } from "../git.js";

export type AutoresearchStatusDiagnostics = {
  readonly warnings: readonly string[];
  readonly checkpoint: AutoresearchCheckpoint | null;
  readonly gitHead: string | null;
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

export function createAutoresearchStatusTool(api: OpenClawPluginApi) {
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
      const cwd = resolveToolCwd(api, params.cwd);
      const state = reconstructStateFromJsonl(cwd);
      const runtimeState = getAutoresearchRuntimeState(cwd);
      const diagnostics = await buildAutoresearchStatusDiagnostics(api, cwd, state);

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
  cwd: string,
  state: AutoresearchStateSnapshot,
): Promise<AutoresearchStatusDiagnostics> {
  const checkpoint = readAutoresearchCheckpoint(cwd);
  const gitHead = await readShortHeadCommit({
    runCommandWithTimeout: api.runtime.system.runCommandWithTimeout,
    cwd,
  });
  const warnings: string[] = [];

  if (checkpoint?.pendingRun) {
    warnings.push(
      `A previous run_experiment is still pending log_experiment: ${checkpoint.pendingRun.command}`,
    );
  }

  const driftBase =
    state.lastRun?.commit && state.lastRun.commit.length > 0
      ? state.lastRun.commit
      : checkpoint?.sessionStartCommit ?? null;
  if (driftBase) {
    const commitsAhead = await countCommitsSince({
      runCommandWithTimeout: api.runtime.system.runCommandWithTimeout,
      cwd,
      sinceCommit: driftBase,
    });

    if (commitsAhead !== null && commitsAhead > 0) {
      warnings.push(
        state.lastRun
          ? `${commitsAhead} commit${commitsAhead === 1 ? "" : "s"} since the last logged experiment (${state.lastRun.commit}).`
          : `${commitsAhead} commit${commitsAhead === 1 ? "" : "s"} since init_experiment, but no experiment has been logged yet.`,
      );
    }
  }

  return {
    warnings,
    checkpoint,
    gitHead,
  };
}
