import { describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { getAutoresearchRootFilePath } from "../extensions/openclaw-autoresearch/src/files.js";
import {
  appendResultEntry,
  createConfigHeader,
  writeConfigHeader,
} from "../extensions/openclaw-autoresearch/src/logging.js";

function createTempDir(prefix: string): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

describe("logging helpers", () => {
  it("creates a config header with the canonical shape", () => {
    expect(
      createConfigHeader({
        name: "Runtime optimization",
        metricName: "total_ms",
        metricUnit: "ms",
        bestDirection: "lower",
      }),
    ).toEqual({
      type: "config",
      name: "Runtime optimization",
      metricName: "total_ms",
      metricUnit: "ms",
      bestDirection: "lower",
    });
  });

  it("writes a new config header in create mode and appends in append mode", () => {
    const cwd = createTempDir("autoresearch-logging-");
    const jsonlPath = getAutoresearchRootFilePath(cwd, "resultsLog");

    writeConfigHeader(
      cwd,
      createConfigHeader({
        name: "Baseline",
        metricName: "total_ms",
        metricUnit: "ms",
        bestDirection: "lower",
      }),
      "create",
    );
    writeConfigHeader(
      cwd,
      createConfigHeader({
        name: "Follow-up",
        metricName: "total_ms",
        metricUnit: "ms",
        bestDirection: "lower",
      }),
      "append",
    );

    expect(fs.readFileSync(jsonlPath, "utf8")).toBe(
      `${JSON.stringify({
        type: "config",
        name: "Baseline",
        metricName: "total_ms",
        metricUnit: "ms",
        bestDirection: "lower",
      })}\n${JSON.stringify({
        type: "config",
        name: "Follow-up",
        metricName: "total_ms",
        metricUnit: "ms",
        bestDirection: "lower",
      })}\n`,
    );
  });

  it("appends result entries as newline-delimited json", () => {
    const cwd = createTempDir("autoresearch-logging-entry-");
    const jsonlPath = getAutoresearchRootFilePath(cwd, "resultsLog");

    writeConfigHeader(
      cwd,
      createConfigHeader({
        name: "Runtime optimization",
        metricName: "total_ms",
        metricUnit: "ms",
        bestDirection: "lower",
      }),
      "create",
    );
    appendResultEntry(cwd, {
      run: 2,
      commit: "abc1234",
      metric: 118,
      metrics: { compile_ms: 44, bundle_kb: 201 },
      status: "keep",
      description: "cache parser artifacts",
      timestamp: 1700000000000,
      segment: 1,
    });

    const lines = fs
      .readFileSync(jsonlPath, "utf8")
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line) as Record<string, unknown>);

    expect(lines).toEqual([
      {
        type: "config",
        name: "Runtime optimization",
        metricName: "total_ms",
        metricUnit: "ms",
        bestDirection: "lower",
      },
      {
        run: 2,
        commit: "abc1234",
        metric: 118,
        metrics: { compile_ms: 44, bundle_kb: 201 },
        status: "keep",
        description: "cache parser artifacts",
        timestamp: 1700000000000,
        segment: 1,
      },
    ]);
  });
});
