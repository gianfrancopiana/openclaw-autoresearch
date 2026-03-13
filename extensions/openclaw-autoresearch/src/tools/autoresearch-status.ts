import type { OpenClawPluginApi } from "openclaw/plugin-sdk/core";
import { Type } from "@sinclair/typebox";
import { reconstructStateFromJsonl, type AutoresearchStateSnapshot } from "../state.js";
import { getAutoresearchRuntimeState, type AutoresearchRuntimeSnapshot } from "../runtime-state.js";

const AutoresearchStatusParams = Type.Object({}, { additionalProperties: false });

export function createAutoresearchStatusTool(_api: OpenClawPluginApi) {
  return {
    name: "autoresearch_status",
    label: "Autoresearch Status",
    description:
      "Read-only summary of autoresearch state reconstructed from root-level files.",
    parameters: AutoresearchStatusParams,
    async execute(
      _toolCallId: string,
      _params: Record<string, never>,
      _signal: AbortSignal,
      _onUpdate: unknown,
      ctx: { cwd: string },
    ) {
      const state = reconstructStateFromJsonl(ctx.cwd);
      const runtimeState = getAutoresearchRuntimeState(ctx.cwd);

      return {
        content: [{ type: "text" as const, text: formatAutoresearchStatusText(state, runtimeState) }],
        details: {
          status: "ok",
          state,
          runtime: runtimeState,
        },
      };
    },
  };
}

export function formatAutoresearchStatusText(
  state: AutoresearchStateSnapshot,
  runtimeState?: AutoresearchRuntimeSnapshot,
): string {
  const lines = [
    `Mode: ${state.mode}`,
    `Session doc: ${state.hasSessionDoc ? "present" : "missing"}`,
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
  }

  if (state.lastRun) {
    lines.push(
      `Last run: #${state.lastRun.run} ${state.lastRun.status} ${formatMetric(state.lastRun.metric, state.metricUnit)} ${state.lastRun.commit} ${state.lastRun.description}`.trim(),
    );
  }

  if (state.ideas.preview.length > 0) {
    lines.push(`Ideas preview: ${state.ideas.preview.join(" | ")}`);
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
