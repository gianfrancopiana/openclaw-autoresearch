import * as fs from "node:fs";

export const AUTORESEARCH_ROOT_FILES = {
  sessionDoc: "autoresearch.md",
  runnerScript: "autoresearch.sh",
  resultsLog: "autoresearch.jsonl",
  ideasBacklog: "autoresearch.ideas.md",
  checkpoint: "autoresearch.checkpoint.json",
  sessionLock: "autoresearch.lock",
} as const;

export type AutoresearchRootFileKey = keyof typeof AUTORESEARCH_ROOT_FILES;

export function getAutoresearchRootFilePath(
  cwd: string,
  file: AutoresearchRootFileKey,
): string {
  return `${cwd}/${AUTORESEARCH_ROOT_FILES[file]}`;
}

export function readAutoresearchRootFile(
  cwd: string,
  file: AutoresearchRootFileKey,
): string | null {
  const filePath = getAutoresearchRootFilePath(cwd, file);
  if (!fs.existsSync(filePath)) {
    return null;
  }

  return fs.readFileSync(filePath, "utf8");
}

export function describeCanonicalFiles(): typeof AUTORESEARCH_ROOT_FILES {
  return AUTORESEARCH_ROOT_FILES;
}
