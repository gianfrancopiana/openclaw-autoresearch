export type AutoresearchStateSnapshot = {
  readonly currentSegment: number;
  readonly currentRunCount: number;
  readonly currentBestMetric: number | null;
};

/**
 * PR 2 skeleton only.
 *
 * This module will own state reconstruction from root-level autoresearch files in PR 7.
 * Canonical files remain:
 * - autoresearch.md
 * - autoresearch.sh
 * - autoresearch.jsonl
 * - autoresearch.ideas.md
 */
export function describeStateSkeleton(): string {
  return "state reconstruction not implemented yet";
}
