import * as fs from "node:fs";
import { getAutoresearchRootFilePath } from "./files.js";

export type SecondaryMetricDef = {
  readonly name: string;
  readonly unit: string;
};

export type AutoresearchStateSnapshot = {
  readonly name: string | null;
  readonly metricName: string;
  readonly metricUnit: string;
  readonly bestDirection: "lower" | "higher";
  readonly secondaryMetrics: readonly SecondaryMetricDef[];
  readonly currentSegment: number;
  readonly currentRunCount: number;
  readonly currentBestMetric: number | null;
};

type MutableStateSnapshot = {
  name: string | null;
  metricName: string;
  metricUnit: string;
  bestDirection: "lower" | "higher";
  currentSegment: number;
  currentRunCount: number;
  currentBestMetric: number | null;
};

type JsonlEntry = {
  readonly type?: string;
  readonly name?: string;
  readonly metricName?: string;
  readonly metricUnit?: string;
  readonly bestDirection?: "lower" | "higher";
  readonly metric?: number;
  readonly metrics?: Record<string, number>;
};

export function createEmptyStateSnapshot(): AutoresearchStateSnapshot {
  return {
    name: null,
    metricName: "metric",
    metricUnit: "",
    bestDirection: "lower",
    secondaryMetrics: [],
    currentSegment: 0,
    currentRunCount: 0,
    currentBestMetric: null,
  };
}

function createMutableEmptyStateSnapshot(): MutableStateSnapshot {
  return {
    ...createEmptyStateSnapshot(),
  };
}

export function reconstructStateFromJsonl(cwd: string): AutoresearchStateSnapshot {
  const jsonlPath = getAutoresearchRootFilePath(cwd, "resultsLog");
  if (!fs.existsSync(jsonlPath)) {
    return createEmptyStateSnapshot();
  }

  const state = createMutableEmptyStateSnapshot();
  const secondaryMetrics = new Map<string, SecondaryMetricDef>();
  let segment = 0;
  let hasAnyResult = false;

  const lines = fs
    .readFileSync(jsonlPath, "utf8")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);

  for (const line of lines) {
    let entry: JsonlEntry;
    try {
      entry = JSON.parse(line) as JsonlEntry;
    } catch {
      continue;
    }

    if (entry.type === "config") {
      if (entry.name) {
        state.name = entry.name;
      }
      if (entry.metricName) {
        state.metricName = entry.metricName;
      }
      if (entry.metricUnit !== undefined) {
        state.metricUnit = entry.metricUnit;
      }
      if (entry.bestDirection === "lower" || entry.bestDirection === "higher") {
        state.bestDirection = entry.bestDirection;
      }
      if (hasAnyResult) {
        segment += 1;
      }
      state.currentSegment = segment;
      state.currentRunCount = 0;
      state.currentBestMetric = null;
      continue;
    }

    hasAnyResult = true;
    if (typeof entry.metric === "number") {
      state.currentRunCount += 1;
      if (state.currentBestMetric === null) {
        state.currentBestMetric = entry.metric;
      }
    }

    for (const metricName of Object.keys(entry.metrics ?? {})) {
      if (!secondaryMetrics.has(metricName)) {
        secondaryMetrics.set(metricName, {
          name: metricName,
          unit: inferMetricUnit(metricName),
        });
      }
    }
  }

  return {
    ...state,
    secondaryMetrics: [...secondaryMetrics.values()],
  };
}

function inferMetricUnit(name: string): string {
  if (name.endsWith("_µs") || name.includes("µs")) {
    return "µs";
  }
  if (name.endsWith("_ms") || name.includes("ms")) {
    return "ms";
  }
  if (name.endsWith("_s") || name.includes("sec")) {
    return "s";
  }
  return "";
}
