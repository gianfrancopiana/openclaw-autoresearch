import * as fs from "node:fs";
import { getAutoresearchRootFilePath } from "./files.js";

export type AutoresearchConfigHeader = {
  type: "config";
  name: string;
  metricName: string;
  metricUnit: string;
  bestDirection: "lower" | "higher";
};

export function createConfigHeader(config: {
  name: string;
  metricName: string;
  metricUnit: string;
  bestDirection: "lower" | "higher";
}): AutoresearchConfigHeader {
  return {
    type: "config",
    name: config.name,
    metricName: config.metricName,
    metricUnit: config.metricUnit,
    bestDirection: config.bestDirection,
  };
}

export function writeConfigHeader(
  cwd: string,
  header: AutoresearchConfigHeader,
  mode: "create" | "append",
): void {
  const jsonlPath = getAutoresearchRootFilePath(cwd, "resultsLog");
  const line = `${JSON.stringify(header)}\n`;
  if (mode === "append") {
    fs.appendFileSync(jsonlPath, line);
    return;
  }
  fs.writeFileSync(jsonlPath, line);
}

export type AutoresearchResultEntry = {
  readonly run: number;
  readonly commit: string;
  readonly metric: number;
  readonly metrics: Record<string, number>;
  readonly status: "keep" | "discard" | "crash";
  readonly baseline?: boolean;
  readonly description: string;
  readonly timestamp: number;
  readonly segment: number;
  readonly confidence: number | null;
};

export function appendResultEntry(cwd: string, entry: AutoresearchResultEntry): void {
  const jsonlPath = getAutoresearchRootFilePath(cwd, "resultsLog");
  fs.appendFileSync(jsonlPath, `${JSON.stringify(entry)}\n`);
}
