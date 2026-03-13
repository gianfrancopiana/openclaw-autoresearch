export const AUTORESEARCH_ROOT_FILES = {
  sessionDoc: "autoresearch.md",
  runnerScript: "autoresearch.sh",
  resultsLog: "autoresearch.jsonl",
  ideasBacklog: "autoresearch.ideas.md",
} as const;

export type AutoresearchRootFileKey = keyof typeof AUTORESEARCH_ROOT_FILES;

export function getAutoresearchRootFilePath(
  cwd: string,
  file: AutoresearchRootFileKey,
): string {
  return `${cwd}/${AUTORESEARCH_ROOT_FILES[file]}`;
}

/**
 * PR 2 skeleton only.
 * This module will own canonical root-level file IO helpers in later PRs.
 */
export function describeCanonicalFiles(): typeof AUTORESEARCH_ROOT_FILES {
  return AUTORESEARCH_ROOT_FILES;
}
