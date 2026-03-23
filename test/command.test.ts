import { describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { AUTORESEARCH_ROOT_FILES } from "../extensions/openclaw-autoresearch/src/files.js";
import {
  buildAutoresearchCommandText,
  registerAutoresearchCommand,
} from "../extensions/openclaw-autoresearch/src/commands/autoresearch.js";
import { getAutoresearchRuntimeState } from "../extensions/openclaw-autoresearch/src/runtime-state.js";

function createTempDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "autoresearch-command-test-"));
}

describe("buildAutoresearchCommandText", () => {
  it("guides setup when no canonical files exist", () => {
    const cwd = createTempDir();

    expect(buildAutoresearchCommandText(cwd, "default")).toContain(
      "Recommended OpenClaw entrypoint: `/autoresearch` or `/autoresearch setup <goal>`.",
    );
    expect(buildAutoresearchCommandText(cwd, "default")).toContain(
      "Direct skill fallback: `/skill autoresearch-create`.",
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
    expect(text).toContain("Runtime mode: auto");
    expect(text).toContain("Baseline: 101ms");
    expect(text).toContain("Confidence: n/a");
  });

  it("registers a mode-aware /autoresearch command that primes resume instructions", () => {
    const cwd = createTempDir();
    fs.writeFileSync(
      path.join(cwd, AUTORESEARCH_ROOT_FILES.sessionDoc),
      "# Autoresearch\n\n## Objective\n\nReduce runtime.\n",
    );

    const api = {
      resolvePath: vi.fn(() => cwd),
      registerCommand: vi.fn(),
    };

    registerAutoresearchCommand(api as never);

    const command = api.registerCommand.mock.calls[0]?.[0];
    expect(command?.name).toBe("autoresearch");

    const result = command.handler({ args: "resume focus parser cache", cwd });
    expect(result.text).toContain("Autoresearch mode ON.");
    expect(result.text).toContain("Captured resume instruction: focus parser cache");
    expect(getAutoresearchRuntimeState(cwd)).toMatchObject({
      mode: "on",
      pendingCommand: {
        kind: "resume",
        args: "focus parser cache",
      },
    });
  });

  it("uses the explicit command flow for setup before falling back to the raw skill call", () => {
    const cwd = createTempDir();
    const api = {
      resolvePath: vi.fn(() => cwd),
      registerCommand: vi.fn(),
    };

    registerAutoresearchCommand(api as never);

    const command = api.registerCommand.mock.calls[0]?.[0];
    const result = command.handler({ args: "", cwd });

    expect(result.text).toContain("Autoresearch mode ON.");
    expect(result.text).toContain(
      "Next step: send a normal message so the next agent turn can gather setup details.",
    );
    expect(result.text).toContain("Direct skill fallback: `/skill autoresearch-create`.");
    expect(getAutoresearchRuntimeState(cwd)).toMatchObject({
      mode: "on",
      pendingCommand: {
        kind: "setup",
        args: null,
      },
    });
  });
});
