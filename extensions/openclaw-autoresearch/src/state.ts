import { readAutoresearchRootFile } from "./files.js";
import { computeConfidence, type ConfidenceRun } from "./confidence.js";

export type SecondaryMetricDef = {
  readonly name: string;
  readonly unit: string;
};

export type AutoresearchMode = "inactive" | "active";

export type AutoresearchIdeasSnapshot = {
  readonly hasBacklog: boolean;
  readonly pendingCount: number;
  readonly preview: readonly string[];
};

export type AutoresearchRunSnapshot = {
  readonly run: number;
  readonly commit: string;
  readonly metric: number;
  readonly metrics: Record<string, number>;
  readonly status: "keep" | "discard" | "crash";
  readonly baseline: boolean;
  readonly description: string;
  readonly timestamp: number;
  readonly segment: number;
  readonly confidence: number | null;
};

export type AutoresearchStateSnapshot = {
  readonly name: string | null;
  readonly metricName: string;
  readonly metricUnit: string;
  readonly bestDirection: "lower" | "higher";
  readonly secondaryMetrics: readonly SecondaryMetricDef[];
  readonly currentSegment: number;
  readonly currentRunCount: number;
  readonly totalRunCount: number;
  readonly currentBaselineMetric: number | null;
  readonly currentBestMetric: number | null;
  readonly confidence: number | null;
  readonly lastRun: AutoresearchRunSnapshot | null;
  readonly mode: AutoresearchMode;
  readonly hasSessionDoc: boolean;
  readonly ideas: AutoresearchIdeasSnapshot;
};

type MutableStateSnapshot = {
  name: string | null;
  metricName: string;
  metricUnit: string;
  bestDirection: "lower" | "higher";
  currentSegment: number;
  currentRunCount: number;
  totalRunCount: number;
  currentBaselineMetric: number | null;
  currentBestMetric: number | null;
  confidence: number | null;
  lastRun: AutoresearchRunSnapshot | null;
  mode: AutoresearchMode;
  hasSessionDoc: boolean;
  ideas: AutoresearchIdeasSnapshot;
};

type JsonlEntry = {
  readonly type?: string;
  readonly name?: string;
  readonly metricName?: string;
  readonly metricUnit?: string;
  readonly bestDirection?: "lower" | "higher";
  readonly run?: number;
  readonly commit?: string;
  readonly metric?: number;
  readonly metrics?: Record<string, number>;
  readonly status?: "keep" | "discard" | "crash";
  readonly baseline?: boolean;
  readonly description?: string;
  readonly timestamp?: number;
  readonly segment?: number;
  readonly confidence?: number | null;
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
    totalRunCount: 0,
    currentBaselineMetric: null,
    currentBestMetric: null,
    confidence: null,
    lastRun: null,
    mode: "inactive",
    hasSessionDoc: false,
    ideas: {
      hasBacklog: false,
      pendingCount: 0,
      preview: [],
    },
  };
}

function createMutableEmptyStateSnapshot(): MutableStateSnapshot {
  return {
    ...createEmptyStateSnapshot(),
  };
}

export function reconstructStateFromJsonl(cwd: string): AutoresearchStateSnapshot {
  const sessionDoc = readAutoresearchRootFile(cwd, "sessionDoc");
  const ideasBacklog = readAutoresearchRootFile(cwd, "ideasBacklog");
  const jsonl = readAutoresearchRootFile(cwd, "resultsLog");

  const state = createMutableEmptyStateSnapshot();
  state.hasSessionDoc = sessionDoc !== null;
  state.mode = detectAutoresearchMode(sessionDoc);
  state.ideas = summarizeIdeasBacklog(ideasBacklog);

  if (jsonl === null) {
    return {
      ...state,
      secondaryMetrics: [],
    };
  }

  const currentSecondaryMetrics = new Map<string, SecondaryMetricDef>();
  let currentSegmentRuns: ConfidenceRun[] = [];
  let currentRunIndex = 0;
  let hasSeenAnyRun = false;

  const lines = jsonl
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
      if (hasSeenAnyRun) {
        state.currentSegment += 1;
      }
      state.currentRunCount = 0;
      state.currentBaselineMetric = null;
      state.currentBestMetric = null;
      state.confidence = null;
      currentRunIndex = 0;
      currentSegmentRuns = [];
      currentSecondaryMetrics.clear();
      continue;
    }

    if (typeof entry.metric !== "number") {
      continue;
    }

    hasSeenAnyRun = true;
    currentRunIndex += 1;
    state.currentRunCount = currentRunIndex;
    state.totalRunCount += 1;
    const isBaseline = entry.baseline === true || currentRunIndex === 1;

    const run: AutoresearchRunSnapshot = {
      run: typeof entry.run === "number" ? entry.run : currentRunIndex,
      commit: entry.commit ?? "",
      metric: entry.metric,
      metrics: normalizeMetrics(entry.metrics),
      status: entry.status ?? "keep",
      baseline: isBaseline,
      description: entry.description ?? "",
      timestamp: typeof entry.timestamp === "number" ? entry.timestamp : 0,
      segment: typeof entry.segment === "number" ? entry.segment : state.currentSegment,
      confidence: typeof entry.confidence === "number" ? entry.confidence : null,
    };

    if (state.currentBaselineMetric === null) {
      state.currentBaselineMetric = run.metric;
    }

    if (run.status === "keep" && run.metric > 0) {
      if (
        state.currentBestMetric === null ||
        isBetter(run.metric, state.currentBestMetric, state.bestDirection)
      ) {
        state.currentBestMetric = run.metric;
      }
    }

    for (const metricName of Object.keys(run.metrics)) {
      if (!currentSecondaryMetrics.has(metricName)) {
        currentSecondaryMetrics.set(metricName, {
          name: metricName,
          unit: inferMetricUnit(metricName),
        });
      }
    }

    currentSegmentRuns.push({
      metric: run.metric,
      status: run.status,
    });
    state.lastRun = run;
  }

  return {
    ...state,
    confidence: computeConfidence(currentSegmentRuns, state.bestDirection),
    secondaryMetrics: [...currentSecondaryMetrics.values()],
  };
}

export function readRecentLoggedRuns(
  cwd: string,
  limit: number,
): readonly AutoresearchRunSnapshot[] {
  const runs = readAllLoggedRuns(cwd);
  return limit <= 0 ? [] : runs.slice(-limit);
}

export function readBestLoggedRun(
  cwd: string,
  direction: "lower" | "higher",
  segment?: number,
): AutoresearchRunSnapshot | null {
  const runs = readAllLoggedRuns(cwd).filter((run) =>
    typeof segment === "number" ? run.segment === segment : true,
  );
  if (runs.length === 0) {
    return null;
  }

  const keepRuns = runs.filter((run) => run.status === "keep");
  const candidates = keepRuns.length > 0 ? keepRuns : runs;
  let best = candidates[0] ?? null;
  for (const run of candidates.slice(1)) {
    if (!best || isBetter(run.metric, best.metric, direction)) {
      best = run;
    }
  }
  return best;
}

function readAllLoggedRuns(cwd: string): readonly AutoresearchRunSnapshot[] {
  const jsonl = readAutoresearchRootFile(cwd, "resultsLog");
  if (jsonl === null) {
    return [];
  }

  const runs: AutoresearchRunSnapshot[] = [];
  let currentSegment = 0;
  let currentRunIndex = 0;
  let hasSeenAnyRun = false;

  const lines = jsonl
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
      if (hasSeenAnyRun) {
        currentSegment += 1;
      }
      currentRunIndex = 0;
      continue;
    }

    if (typeof entry.metric !== "number") {
      continue;
    }

    hasSeenAnyRun = true;
    currentRunIndex += 1;
    const isBaseline = entry.baseline === true || currentRunIndex === 1;
    runs.push({
      run: typeof entry.run === "number" ? entry.run : currentRunIndex,
      commit: entry.commit ?? "",
      metric: entry.metric,
      metrics: normalizeMetrics(entry.metrics),
      status: entry.status ?? "keep",
      baseline: isBaseline,
      description: entry.description ?? "",
      timestamp: typeof entry.timestamp === "number" ? entry.timestamp : 0,
      segment: typeof entry.segment === "number" ? entry.segment : currentSegment,
      confidence: typeof entry.confidence === "number" ? entry.confidence : null,
    });
  }

  return runs;
}

function normalizeMetrics(metrics: Record<string, number> | undefined): Record<string, number> {
  if (!metrics || typeof metrics !== "object") {
    return {};
  }

  return Object.fromEntries(
    Object.entries(metrics).filter(([, value]) => typeof value === "number"),
  );
}

function detectAutoresearchMode(sessionDoc: string | null): AutoresearchMode {
  if (sessionDoc === null) {
    return "inactive";
  }

  const normalized = sessionDoc.toLowerCase();
  if (
    normalized.includes("# autoresearch") ||
    normalized.includes("## objective") ||
    normalized.includes("## what's been tried") ||
    normalized.includes("## how to run")
  ) {
    return "active";
  }

  return sessionDoc.trim().length > 0 ? "active" : "inactive";
}

function summarizeIdeasBacklog(ideasBacklog: string | null): AutoresearchIdeasSnapshot {
  if (ideasBacklog === null) {
    return {
      hasBacklog: false,
      pendingCount: 0,
      preview: [],
    };
  }

  const ideas = ideasBacklog
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => /^([-*+]|\d+\.)\s+/.test(line))
    .map((line) => line.replace(/^([-*+]|\d+\.)\s+/, "").trim())
    .filter(Boolean);

  return {
    hasBacklog: ideas.length > 0,
    pendingCount: ideas.length,
    preview: ideas.slice(0, 3),
  };
}

function isBetter(
  current: number,
  best: number,
  direction: "lower" | "higher",
): boolean {
  return direction === "lower" ? current < best : current > best;
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
  if (name.endsWith("_kb") || name.includes("kb")) {
    return "kb";
  }
  if (name.endsWith("_mb") || name.includes("mb")) {
    return "mb";
  }
  return "";
}
