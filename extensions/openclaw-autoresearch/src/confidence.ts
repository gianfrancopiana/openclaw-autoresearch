export type ConfidenceRun = {
  readonly metric: number;
  readonly status: string;
};

export function computeConfidence(
  runs: readonly ConfidenceRun[],
  direction: "lower" | "higher",
): number | null {
  const usableRuns = runs.filter((run) => Number.isFinite(run.metric) && run.metric > 0);
  if (usableRuns.length < 3) {
    return null;
  }

  const baseline = runs.find((run) => Number.isFinite(run.metric));
  if (!baseline) {
    return null;
  }

  const values = usableRuns.map((run) => run.metric);
  const median = sortedMedian(values);
  const deviations = values.map((value) => Math.abs(value - median));
  const mad = sortedMedian(deviations);
  if (mad === 0) {
    return null;
  }

  let bestKept: number | null = null;
  for (const run of usableRuns) {
    if (run.status !== "keep") {
      continue;
    }

    if (bestKept === null || isBetter(run.metric, bestKept, direction)) {
      bestKept = run.metric;
    }
  }

  if (bestKept === null || bestKept === baseline.metric) {
    return null;
  }

  return Math.abs(bestKept - baseline.metric) / mad;
}

export function formatConfidenceLine(
  confidence: number | null,
  label = "Confidence",
): string {
  return confidence === null ? `${label}: n/a` : `${label}: ${describeConfidence(confidence)}`;
}

export function describeConfidence(confidence: number): string {
  const rendered = confidence.toFixed(1);
  if (confidence >= 2.0) {
    return `${rendered}x noise floor - improvement is likely real`;
  }
  if (confidence >= 1.0) {
    return `${rendered}x noise floor - improvement is above noise but marginal`;
  }
  return `${rendered}x noise floor - improvement is within noise. Consider re-running to confirm before keeping`;
}

function sortedMedian(values: readonly number[]): number {
  if (values.length === 0) {
    return 0;
  }

  const sorted = [...values].sort((left, right) => left - right);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[mid - 1] + sorted[mid]) / 2
    : sorted[mid];
}

function isBetter(
  current: number,
  best: number,
  direction: "lower" | "higher",
): boolean {
  return direction === "lower" ? current < best : current > best;
}
