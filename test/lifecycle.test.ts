import { afterEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createInitExperimentTool } from "../extensions/openclaw-autoresearch/src/tools/init-experiment.js";
import { createRunExperimentTool } from "../extensions/openclaw-autoresearch/src/tools/run-experiment.js";
import { createLogExperimentTool } from "../extensions/openclaw-autoresearch/src/tools/log-experiment.js";
import { getAutoresearchRootFilePath } from "../extensions/openclaw-autoresearch/src/files.js";
import * as gitModule from "../extensions/openclaw-autoresearch/src/git.js";
import {
  getAutoresearchRuntimeState,
  queueAutoresearchSteer,
} from "../extensions/openclaw-autoresearch/src/runtime-state.js";
import { runCommandWithTimeout } from "./helpers/fake-runtime.js";

function createTempDir(prefix: string): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function createAbortSignal(): AbortSignal {
  return new AbortController().signal;
}

function createApi(cwd: string) {
  return {
    resolvePath: vi.fn(() => cwd),
    runtime: {
      system: {
        runCommandWithTimeout,
      },
    },
  };
}

function readJsonl(cwd: string): Array<Record<string, unknown>> {
  const jsonlPath = getAutoresearchRootFilePath(cwd, "resultsLog");
  return fs
    .readFileSync(jsonlPath, "utf8")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => JSON.parse(line) as Record<string, unknown>);
}

async function initExperiment(
  cwd: string,
  params: {
    name: string;
    metric_name: string;
    metric_unit?: string;
    direction?: "lower" | "higher";
  },
) {
  return await createInitExperimentTool(createApi(cwd) as never).execute(
    "tool-call",
    params,
    createAbortSignal(),
    undefined,
  );
}

async function runExperiment(
  cwd: string,
  params: {
    command: string;
    timeout_seconds?: number;
  },
  onUpdate?: (update: unknown) => void | Promise<void>,
) {
  return await createRunExperimentTool(createApi(cwd) as never).execute(
    "tool-call",
    params,
    createAbortSignal(),
    onUpdate,
  );
}

async function logExperiment(
  cwd: string,
  params: {
    commit?: string;
    metric?: number;
    status: "keep" | "discard" | "crash";
    description: string;
    metrics?: Record<string, number>;
    force?: boolean;
  },
) {
  return await createLogExperimentTool(createApi(cwd) as never).execute(
    "tool-call",
    params,
    createAbortSignal(),
    undefined,
  );
}

async function seedExperiment(cwd: string) {
  await initExperiment(cwd, {
    name: "Parser optimization",
    metric_name: "total_ms",
    metric_unit: "ms",
    direction: "lower",
  });
}

describe("experiment lifecycle tools", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("writes the first config header to the root autoresearch.jsonl file", async () => {
    const cwd = createTempDir("autoresearch-init-");

    const result = await initExperiment(cwd, {
      name: "Parser optimization",
      metric_name: "total_ms",
      metric_unit: "ms",
      direction: "lower",
    });

    expect(result.details).toMatchObject({
      status: "ok",
      state: {
        name: "Parser optimization",
        metricName: "total_ms",
        metricUnit: "ms",
        bestDirection: "lower",
        currentSegment: 0,
      },
    });
    expect(readJsonl(cwd)).toEqual([
      {
        type: "config",
        name: "Parser optimization",
        metricName: "total_ms",
        metricUnit: "ms",
        bestDirection: "lower",
      },
    ]);
  });

  it("appends a new config header on re-init instead of overwriting prior history", async () => {
    const cwd = createTempDir("autoresearch-reinit-");

    await initExperiment(cwd, {
      name: "Parser optimization",
      metric_name: "total_ms",
      metric_unit: "ms",
      direction: "lower",
    });
    fs.appendFileSync(
      getAutoresearchRootFilePath(cwd, "resultsLog"),
      `${JSON.stringify({
        run: 1,
        commit: "abc1234",
        metric: 120,
        metrics: {},
        status: "keep",
        description: "baseline",
        timestamp: 1700000000000,
        segment: 0,
      })}\n`,
    );

    const result = await initExperiment(cwd, {
      name: "Parser optimization v2",
      metric_name: "total_ms",
      metric_unit: "ms",
      direction: "lower",
    });

    expect(result.content[0]?.type).toBe("text");
    expect((result.content[0] as { text: string }).text).toContain("re-initialized");
    expect(readJsonl(cwd)).toEqual([
      {
        type: "config",
        name: "Parser optimization",
        metricName: "total_ms",
        metricUnit: "ms",
        bestDirection: "lower",
      },
      {
        run: 1,
        commit: "abc1234",
        metric: 120,
        metrics: {},
        status: "keep",
        description: "baseline",
        timestamp: 1700000000000,
        segment: 0,
      },
      {
        type: "config",
        name: "Parser optimization v2",
        metricName: "total_ms",
        metricUnit: "ms",
        bestDirection: "lower",
      },
    ]);
    expect(result.details).toMatchObject({
      status: "ok",
      state: {
        currentSegment: 1,
        currentRunCount: 0,
      },
    });
  });

  it("reports a successful run and emits a running update", async () => {
    const cwd = createTempDir("autoresearch-run-success-");
    const updates: unknown[] = [];

    const result = await runExperiment(
      cwd,
      {
        command: "printf 'hello\\nworld\\n'",
      },
      (update) => {
        updates.push(update);
      },
    );

    expect(updates).toEqual([
      {
        content: [{ type: "text", text: "Running: printf 'hello\\nworld\\n'" }],
        details: { phase: "running" },
      },
    ]);
    expect(result.details).toMatchObject({
      command: "printf 'hello\\nworld\\n'",
      exitCode: 0,
      passed: true,
      crashed: false,
      timedOut: false,
      primaryMetric: null,
      stdout: "hello\nworld\n",
      stderr: "",
      tailOutput: "hello\nworld",
    });
    expect((result.content[0] as { text: string }).text).toContain("PASSED");
    expect((result.content[0] as { text: string }).text).toContain(
      "Last 80 lines of output:\nhello\nworld",
    );
  });

  it("reports failed runs with exit code and stderr in the captured tail", async () => {
    const cwd = createTempDir("autoresearch-run-failure-");

    const result = await runExperiment(cwd, {
      command: "echo 'bad stderr' >&2; exit 7",
    });

    expect(result.details).toMatchObject({
      exitCode: 7,
      passed: false,
      crashed: true,
      timedOut: false,
      stdout: "",
      stderr: "bad stderr\n",
      tailOutput: "bad stderr",
    });
    expect((result.content[0] as { text: string }).text).toContain(
      "FAILED (exit code 7)",
    );
  });

  it("marks timed out runs and keeps the output-tail shape to the last 80 lines", async () => {
    const timeoutCwd = createTempDir("autoresearch-run-timeout-");

    const timeoutResult = await runExperiment(timeoutCwd, {
      command: "echo start; sleep 0.2; echo done",
      timeout_seconds: 0.05,
    });

    expect(timeoutResult.details).toMatchObject({
      exitCode: null,
      passed: false,
      crashed: true,
      timedOut: true,
    });
    expect((timeoutResult.content[0] as { text: string }).text).toContain("TIMEOUT");
    const timeoutDetails = timeoutResult.details as {
      stdout: string;
      timedOut: boolean;
      exitCode: number | null;
      passed: boolean;
      crashed: boolean;
    };
    expect(timeoutDetails.stdout).toContain("start\n");
    expect(timeoutDetails.stdout).not.toContain("done\n");

    const tailCwd = createTempDir("autoresearch-run-tail-");
    const tailResult = await runExperiment(tailCwd, {
      command:
        "i=1; while [ $i -le 100 ]; do echo line-$i; i=$((i+1)); done",
    });

    const tailLines = (tailResult.details as { tailOutput: string }).tailOutput.split("\n");
    expect(tailLines).toHaveLength(80);
    expect(tailLines[0]).toBe("line-21");
    expect(tailLines[79]).toBe("line-100");
    expect((tailResult.details as { tailOutput: string }).tailOutput).not.toContain("line-20");
  });

  it("appends a result row to autoresearch.jsonl and preserves secondary metrics in state", async () => {
    const cwd = createTempDir("autoresearch-log-append-");
    await seedExperiment(cwd);

    const result = await logExperiment(cwd, {
      commit: "abc1234",
      metric: 120,
      status: "discard",
      description: "baseline",
      metrics: {
        compile_ms: 15,
      },
    });

    const rows = readJsonl(cwd);
    expect(rows).toHaveLength(2);
    expect(rows[1]).toMatchObject({
      run: 1,
      commit: "abc1234",
      metric: 120,
      metrics: {
        compile_ms: 15,
      },
      status: "discard",
      description: "baseline",
      segment: 0,
    });
    expect(result.details).toMatchObject({
      status: "ok",
      experiment: {
        run: 1,
        commit: "abc1234",
      },
      state: {
        currentRunCount: 1,
        totalRunCount: 1,
        secondaryMetrics: [{ name: "compile_ms", unit: "ms" }],
      },
      git: {
        action: "skip",
        attempted: false,
      },
    });
    expect((result.content[0] as { text: string }).text).toContain(
      "Git: skipped commit (discard) - revert tracked changes yourself with git checkout -- .",
    );
  });

  it("validates missing and newly added secondary metrics unless forced", async () => {
    const cwd = createTempDir("autoresearch-log-metrics-");
    await seedExperiment(cwd);
    const baselineResult = await logExperiment(cwd, {
      commit: "abc1234",
      metric: 120,
      status: "discard",
      description: "baseline",
      metrics: {
        compile_ms: 15,
      },
    });
    expect(baselineResult.details).toMatchObject({ status: "ok" });

    const missingMetric = await logExperiment(cwd, {
      commit: "def5678",
      metric: 110,
      status: "discard",
      description: "missing secondary metric",
      metrics: {},
    });

    expect(missingMetric.details).toMatchObject({
      status: "error",
      phase: "validate",
    });
    expect((missingMetric.content[0] as { text: string }).text).toContain(
      "Missing secondary metrics: compile_ms",
    );

    const newMetricWithoutForce = await logExperiment(cwd, {
      commit: "def5678",
      metric: 110,
      status: "discard",
      description: "add bundle size",
      metrics: {
        compile_ms: 12,
        bundle_kb: 7,
      },
    });

    expect(newMetricWithoutForce.details).toMatchObject({
      status: "error",
      phase: "validate",
    });
    expect((newMetricWithoutForce.content[0] as { text: string }).text).toContain(
      "New secondary metric not previously tracked: bundle_kb",
    );

    const forcedNewMetric = await logExperiment(cwd, {
      commit: "def5678",
      metric: 110,
      status: "discard",
      description: "add bundle size",
      metrics: {
        compile_ms: 12,
        bundle_kb: 7,
      },
      force: true,
    });

    expect(forcedNewMetric.details).toMatchObject({
      status: "ok",
      state: {
        secondaryMetrics: [
          { name: "compile_ms", unit: "ms" },
          { name: "bundle_kb", unit: "kb" },
        ],
      },
    });
  });

  it("routes keep to commit and leaves discard/crash as manual reverts while preserving logged statuses", async () => {
    const cwd = createTempDir("autoresearch-log-status-");
    await seedExperiment(cwd);
    const commitSpy = vi.spyOn(gitModule, "commitKeptExperiment").mockResolvedValue({
      attempted: true,
      committed: true,
      commit: "def5678",
      summary: "Git: committed - [main def5678] keep improved parser",
      command: {
        code: 0,
        stdout: "[main def5678] keep improved parser\n",
        stderr: "",
        combinedOutput: "[main def5678] keep improved parser",
      },
    });
    const keepResult = await logExperiment(cwd, {
      commit: "abc1234",
      metric: 95,
      status: "keep",
      description: "keep improved parser",
    });

    expect(keepResult.details).toMatchObject({
      status: "ok",
      git: {
        action: "commit",
        attempted: true,
        committed: true,
        commit: "def5678",
      },
      experiment: {
        commit: "def5678",
        status: "keep",
      },
    });
    expect(commitSpy).toHaveBeenCalledTimes(1);

    const discardResult = await logExperiment(cwd, {
      commit: "def5678",
      metric: 130,
      status: "discard",
      description: "discard regression",
    });

    expect(discardResult.details).toMatchObject({
      status: "ok",
      git: {
        action: "skip",
        attempted: false,
      },
      experiment: {
        status: "discard",
      },
    });
    expect((discardResult.content[0] as { text: string }).text).toContain(
      "revert tracked changes yourself with git checkout -- .",
    );

    const crashResult = await logExperiment(cwd, {
      commit: "def5678",
      metric: 0,
      status: "crash",
      description: "crashed benchmark",
    });

    expect(crashResult.details).toMatchObject({
      status: "ok",
      git: {
        action: "skip",
        attempted: false,
      },
      experiment: {
        status: "crash",
        metric: 0,
      },
    });
    expect((crashResult.content[0] as { text: string }).text).toContain(
      "revert tracked changes yourself with git checkout -- .",
    );

    const statuses = readJsonl(cwd)
      .filter((entry) => entry.type !== "config")
      .map((entry) => entry.status);
    expect(statuses).toEqual(["keep", "discard", "crash"]);
  });

  it("keeps the experiment window open across run_experiment and surfaces queued steers in log_experiment", async () => {
    const cwd = createTempDir("autoresearch-queued-steers-");
    await seedExperiment(cwd);

    await runExperiment(cwd, {
      command: "printf 'baseline\\n'",
    });

    expect(getAutoresearchRuntimeState(cwd)).toMatchObject({
      runInFlight: true,
    });

    queueAutoresearchSteer(cwd, "try a parser cache");
    queueAutoresearchSteer(cwd, "watch compile_ms too");

    const result = await logExperiment(cwd, {
      commit: "abc1234",
      metric: 120,
      status: "discard",
      description: "baseline",
    });

    expect((result.content[0] as { text: string }).text).toContain(
      "Queued user steers captured during this experiment:",
    );
    expect((result.content[0] as { text: string }).text).toContain("- try a parser cache");
    expect((result.content[0] as { text: string }).text).toContain("- watch compile_ms too");
    expect(getAutoresearchRuntimeState(cwd)).toMatchObject({
      runInFlight: false,
      queuedSteers: [],
      pendingRun: null,
    });
  });

  it("blocks a second run_experiment until the previous result is logged", async () => {
    const cwd = createTempDir("autoresearch-pending-run-");
    await seedExperiment(cwd);

    const first = await runExperiment(cwd, {
      command: "printf 'METRIC total_ms=120\\n'",
    });

    expect(first.details).toMatchObject({
      primaryMetric: 120,
      pendingRun: {
        command: "printf 'METRIC total_ms=120\\n'",
      },
    });

    const second = await runExperiment(cwd, {
      command: "printf 'METRIC total_ms=110\\n'",
    });

    expect(second.details).toMatchObject({
      status: "error",
      phase: "pending_log",
    });
    expect((second.content[0] as { text: string }).text).toContain(
      "previous run_experiment result has not been logged yet",
    );
  });

  it("lets log_experiment default commit and metric from the pending run", async () => {
    const cwd = createTempDir("autoresearch-log-defaults-");
    await seedExperiment(cwd);

    await runExperiment(cwd, {
      command: "printf 'METRIC total_ms=120\\nMETRIC compile_ms=15\\n'",
    });

    const result = await logExperiment(cwd, {
      status: "discard",
      description: "baseline",
    });

    expect(result.details).toMatchObject({
      status: "ok",
      experiment: {
        metric: 120,
        metrics: {
          compile_ms: 15,
        },
      },
    });
    expect((result.content[0] as { text: string }).text).toContain(
      "Used the pending run_experiment result as the source of truth",
    );
    expect(getAutoresearchRuntimeState(cwd)).toMatchObject({
      pendingRun: null,
      runInFlight: false,
    });
    expect(
      fs.readFileSync(path.join(cwd, "autoresearch.checkpoint.json"), "utf8"),
    ).toContain('"pendingRun": null');
    expect(fs.readFileSync(path.join(cwd, "autoresearch.md"), "utf8")).toContain(
      "## Plugin Checkpoint",
    );
  });
});
