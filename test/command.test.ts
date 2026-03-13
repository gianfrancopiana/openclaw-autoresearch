import { describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { AUTORESEARCH_ROOT_FILES } from "../extensions/openclaw-autoresearch/src/files.js";
import { buildAutoresearchCommandText } from "../extensions/openclaw-autoresearch/src/commands/autoresearch.js";

function createTempDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "autoresearch-command-test-"));
}

describe("buildAutoresearchCommandText", () => {
  it("guides setup when no canonical files exist", () => {
    const cwd = createTempDir();

    expect(buildAutoresearchCommandText(cwd, "default")).toContain(
      "Start with `/skill:autoresearch-create` to set up the session.",
    );
  });

  it("routes active sessions back to the canonical files", () => {
    const cwd = createTempDir();
    fs.writeFileSync(
      path.join(cwd, AUTORESEARCH_ROOT_FILES.sessionDoc),
      "# Autoresearch\n\n## Objective\n\nReduce runtime.\n",
    );
    fs.writeFileSync(
      path.join(cwd, AUTORESEARCH_ROOT_FILES.resultsLog),
      [
        JSON.stringify({
          type: "config",
          name: "Runtime optimization",
          metricName: "total_ms",
          metricUnit: "ms",
          bestDirection: "lower",
        }),
        JSON.stringify({
          run: 1,
          commit: "abc1234",
          metric: 101,
          metrics: {},
          status: "keep",
          description: "baseline",
          timestamp: 1700000000000,
          segment: 0,
        }),
      ].join("\n"),
    );

    const text = buildAutoresearchCommandText(cwd, "status");

    expect(text).toContain("Autoresearch session detected at repo root:");
    expect(text).toContain("Read `autoresearch.md` before resuming or changing the loop.");
    expect(text).toContain("Mode: active");
    expect(text).toContain("Baseline: 101ms");
  });
});
