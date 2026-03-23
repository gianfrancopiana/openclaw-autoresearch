import { describe, expect, it } from "vitest";
import {
  formatAutoresearchStatusText,
  type AutoresearchStatusDiagnostics,
} from "../extensions/openclaw-autoresearch/src/tools/autoresearch-status.js";
import { reconstructStateFromJsonl } from "../extensions/openclaw-autoresearch/src/state.js";
import { getAutoresearchRuntimeState } from "../extensions/openclaw-autoresearch/src/runtime-state.js";
import path from "node:path";

const activeSessionFixture = path.resolve("test/fixtures/active-session");

describe("formatAutoresearchStatusText", () => {
  it("renders a concise status summary from reconstructed state", () => {
    const diagnostics: AutoresearchStatusDiagnostics = {
      warnings: ["2 commits since the last logged experiment (7654321)."],
      checkpoint: null,
      gitHead: "89abcde",
      gitBranch: "autoresearch/parser-cache",
      lock: {
        state: "missing",
        pid: null,
        timestamp: null,
        ownedByCurrentProcess: false,
      },
    };
    const text = formatAutoresearchStatusText(
      reconstructStateFromJsonl(activeSessionFixture),
      getAutoresearchRuntimeState(activeSessionFixture),
      diagnostics,
    );

    expect(text).toContain("Session: Parser optimization");
    expect(text).toContain("Runtime mode: auto");
    expect(text).toContain("Experiment window: idle");
    expect(text).toContain("Pending run: no");
    expect(text).toContain("Queued steers: 0");
    expect(text).toContain("Checkpoint: missing");
    expect(text).toContain("Metric: total_ms (ms, lower is better)");
    expect(text).toContain("Runs: 2 current / 4 total");
    expect(text).toContain("Best kept: 118ms");
    expect(text).toContain("Confidence: n/a");
    expect(text).toContain("Last run: #2 keep 118ms 7654321 keep winner");
    expect(text).toContain("Git HEAD: 89abcde");
    expect(text).toContain("Current branch: autoresearch/parser-cache");
    expect(text).toContain("Session lock: missing");
    expect(text).toContain("Warnings:");
    expect(text).toContain("2 commits since the last logged experiment");
    expect(text).toContain(
      "Ideas preview: Retry the parser change with a safer cache key | Separate compile and runtime metrics | Investigate benchmark startup overhead",
    );
  });
});
