import { describe, expect, it } from "vitest";
import { formatAutoresearchStatusText } from "../extensions/openclaw-autoresearch/src/tools/autoresearch-status.js";
import { reconstructStateFromJsonl } from "../extensions/openclaw-autoresearch/src/state.js";
import path from "node:path";

const activeSessionFixture = path.resolve("test/fixtures/active-session");

describe("formatAutoresearchStatusText", () => {
  it("renders a concise status summary from reconstructed state", () => {
    const text = formatAutoresearchStatusText(
      reconstructStateFromJsonl(activeSessionFixture),
    );

    expect(text).toContain("Session: Parser optimization");
    expect(text).toContain("Metric: total_ms (ms, lower is better)");
    expect(text).toContain("Runs: 2 current / 4 total");
    expect(text).toContain("Best kept: 118ms");
    expect(text).toContain("Last run: #2 keep 118ms 7654321 keep winner");
    expect(text).toContain(
      "Ideas preview: Retry the parser change with a safer cache key | Separate compile and runtime metrics | Investigate benchmark startup overhead",
    );
  });
});
