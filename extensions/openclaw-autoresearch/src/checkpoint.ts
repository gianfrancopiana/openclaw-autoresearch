import * as fs from "node:fs";
import { AUTORESEARCH_ROOT_FILES, getAutoresearchRootFilePath } from "./files.js";
import type {
  AutoresearchRunSnapshot,
  AutoresearchStateSnapshot,
} from "./state.js";
import type { PendingExperimentRun } from "./runtime-state.js";

export type AutoresearchCarryForwardContext = {
  readonly metricName: string;
  readonly metricUnit: string;
  readonly bestDirection: "lower" | "higher";
  readonly run: AutoresearchRunSnapshot;
};

export type AutoresearchCheckpoint = {
  readonly version: 1;
  readonly updatedAt: number;
  readonly sessionStartCommit: string | null;
  readonly canonicalBranch?: string | null;
  readonly carryForwardContext?: AutoresearchCarryForwardContext | null;
  readonly session: {
    readonly name: string | null;
    readonly metricName: string;
    readonly metricUnit: string;
    readonly bestDirection: "lower" | "higher";
    readonly currentSegment: number;
    readonly currentRunCount: number;
    readonly totalRunCount: number;
    readonly currentBaselineMetric: number | null;
    readonly currentBestMetric: number | null;
    readonly confidence: number | null;
  };
  readonly lastLoggedRun: AutoresearchRunSnapshot | null;
  readonly recentLoggedRuns: readonly AutoresearchRunSnapshot[];
  readonly pendingRun: PendingExperimentRun | null;
};

export function readAutoresearchCheckpoint(cwd: string): AutoresearchCheckpoint | null {
  const checkpointPath = getAutoresearchRootFilePath(cwd, "checkpoint");
  if (!fs.existsSync(checkpointPath)) {
    return null;
  }

  try {
    const parsed = JSON.parse(fs.readFileSync(checkpointPath, "utf8")) as AutoresearchCheckpoint;
    return parsed?.version === 1 ? parsed : null;
  } catch {
    return null;
  }
}

export function writeAutoresearchCheckpoint(options: {
  cwd: string;
  state: AutoresearchStateSnapshot;
  sessionStartCommit: string | null;
  canonicalBranch: string | null;
  carryForwardContext: AutoresearchCarryForwardContext | null;
  recentLoggedRuns: readonly AutoresearchRunSnapshot[];
  pendingRun: PendingExperimentRun | null;
}): AutoresearchCheckpoint {
  const checkpoint: AutoresearchCheckpoint = {
    version: 1,
    updatedAt: Date.now(),
    sessionStartCommit: options.sessionStartCommit,
    canonicalBranch: options.canonicalBranch,
    carryForwardContext: options.carryForwardContext,
    session: {
      name: options.state.name,
      metricName: options.state.metricName,
      metricUnit: options.state.metricUnit,
      bestDirection: options.state.bestDirection,
      currentSegment: options.state.currentSegment,
      currentRunCount: options.state.currentRunCount,
      totalRunCount: options.state.totalRunCount,
      currentBaselineMetric: options.state.currentBaselineMetric,
      currentBestMetric: options.state.currentBestMetric,
      confidence: options.state.confidence,
    },
    lastLoggedRun: options.state.lastRun,
    recentLoggedRuns: options.recentLoggedRuns,
    pendingRun: options.pendingRun,
  };

  const checkpointPath = getAutoresearchRootFilePath(options.cwd, "checkpoint");
  fs.writeFileSync(checkpointPath, `${JSON.stringify(checkpoint, null, 2)}\n`);
  return checkpoint;
}

export function deleteAutoresearchCheckpoint(cwd: string): void {
  const checkpointPath = getAutoresearchRootFilePath(cwd, "checkpoint");
  if (fs.existsSync(checkpointPath)) {
    fs.unlinkSync(checkpointPath);
  }
}
