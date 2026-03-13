import { describe, expect, it } from "vitest";
import path from "node:path";
import { reconstructStateFromJsonl } from "../extensions/openclaw-autoresearch/src/state.js";

const activeSessionFixture = path.resolve("test/fixtures/active-session");

describe("reconstructStateFromJsonl", () => {
  it("rebuilds the active session snapshot from canonical fixtures", () => {
    const state = reconstructStateFromJsonl(activeSessionFixture);

    expect(state.name).toBe("Parser optimization");
    expect(state.mode).toBe("active");
    expect(state.hasSessionDoc).toBe(true);
    expect(state.currentSegment).toBe(1);
    expect(state.currentRunCount).toBe(2);
    expect(state.totalRunCount).toBe(4);
    expect(state.currentBaselineMetric).toBe(130);
    expect(state.currentBestMetric).toBe(118);
    expect(state.lastRun).toMatchObject({
      run: 2,
      commit: "7654321",
      metric: 118,
      status: "keep",
      description: "keep winner",
      segment: 1,
    });
    expect(state.secondaryMetrics).toEqual([
      { name: "compile_ms", unit: "ms" },
      { name: "bundle_kb", unit: "kb" },
    ]);
    expect(state.ideas).toEqual({
      hasBacklog: true,
      pendingCount: 3,
      preview: [
        "Retry the parser change with a safer cache key",
        "Separate compile and runtime metrics",
        "Investigate benchmark startup overhead",
      ],
    });
  });
});
