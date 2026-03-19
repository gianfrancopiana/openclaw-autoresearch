import { describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createInitExperimentTool } from "../extensions/openclaw-autoresearch/src/tools/init-experiment.js";
import { createAutoresearchStatusTool } from "../extensions/openclaw-autoresearch/src/tools/autoresearch-status.js";
import { createRunExperimentTool } from "../extensions/openclaw-autoresearch/src/tools/run-experiment.js";
import { createLogExperimentTool } from "../extensions/openclaw-autoresearch/src/tools/log-experiment.js";
import { AUTORESEARCH_ROOT_FILES } from "../extensions/openclaw-autoresearch/src/files.js";
import { runCommandWithTimeout } from "./helpers/fake-runtime.js";

function createTempDir(): string {
  return fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "autoresearch-tool-test-")));
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

describe("autoresearch tools", () => {
  it("init_experiment resolves cwd from api.resolvePath instead of expecting a fifth execute arg", async () => {
    const cwd = createTempDir();
    const api = createApi(cwd);
    const tool = createInitExperimentTool(api as never);

    const result = await tool.execute(
      "call-1",
      {
        name: "Repo robustness",
        metric_name: "escaped_mutations",
        metric_unit: "",
        direction: "lower",
      },
      new AbortController().signal,
      undefined,
    );

    expect(api.resolvePath).toHaveBeenCalledWith(".");
    expect(result.details).toMatchObject({ status: "ok" });
    expect(fs.existsSync(path.join(cwd, AUTORESEARCH_ROOT_FILES.resultsLog))).toBe(true);
  });

  it("autoresearch_status resolves cwd from api.resolvePath", async () => {
    const cwd = createTempDir();
    const api = createApi(cwd);
    await createInitExperimentTool(api as never).execute(
      "call-1",
      {
        name: "Repo robustness",
        metric_name: "escaped_mutations",
        metric_unit: "",
        direction: "lower",
      },
      new AbortController().signal,
      undefined,
    );

    const result = await createAutoresearchStatusTool(api as never).execute(
      "call-2",
      {},
      new AbortController().signal,
      undefined,
    );

    expect(api.resolvePath).toHaveBeenCalledWith(".");
    expect(result.content[0]?.text).toContain("Session: Repo robustness");
    expect(result.content[0]?.text).toContain("Metric: escaped_mutations");
  });

  it("run_experiment resolves cwd from api.resolvePath", async () => {
    const cwd = createTempDir();
    const api = createApi(cwd);
    const updates: unknown[] = [];

    const result = await createRunExperimentTool(api as never).execute(
      "call-3",
      { command: "node -e \"console.log('ok')\"", timeout_seconds: 10 },
      new AbortController().signal,
      async (update) => {
        updates.push(update);
      },
    );

    expect(api.resolvePath).toHaveBeenCalledWith(".");
    expect(updates.length).toBe(1);
    expect(result.details).toMatchObject({ passed: true, timedOut: false });
  });

  it("log_experiment resolves cwd from api.resolvePath", async () => {
    const cwd = createTempDir();
    const api = createApi(cwd);
    await createInitExperimentTool(api as never).execute(
      "call-1",
      {
        name: "Repo robustness",
        metric_name: "escaped_mutations",
        metric_unit: "",
        direction: "lower",
      },
      new AbortController().signal,
      undefined,
    );

    const result = await createLogExperimentTool(api as never).execute(
      "call-4",
      {
        commit: "abc1234",
        metric: 5,
        status: "discard",
        description: "baseline",
      },
      new AbortController().signal,
      undefined,
    );

    expect(api.resolvePath).toHaveBeenCalledWith(".");
    expect(result.details).toMatchObject({ status: "ok" });
    expect(result.content[0]?.text).toContain("Logged #1: discard - baseline");
  });

  it("supports explicit cwd overrides for nested repo tool execution", async () => {
    const workspaceCwd = createTempDir();
    const repoCwd = createTempDir();
    const api = createApi(workspaceCwd);

    const initResult = await createInitExperimentTool(api as never).execute(
      "call-1",
      {
        cwd: repoCwd,
        name: "Nested repo robustness",
        metric_name: "escaped_mutations",
        metric_unit: "",
        direction: "lower",
      },
      new AbortController().signal,
      undefined,
    );

    expect(initResult.details).toMatchObject({ status: "ok" });
    expect(api.resolvePath).not.toHaveBeenCalled();
    expect(fs.existsSync(path.join(repoCwd, AUTORESEARCH_ROOT_FILES.resultsLog))).toBe(true);
    expect(fs.existsSync(path.join(workspaceCwd, AUTORESEARCH_ROOT_FILES.resultsLog))).toBe(false);

    const runResult = await createRunExperimentTool(api as never).execute(
      "call-2",
      {
        cwd: repoCwd,
        command: "node -e \"console.log(process.cwd())\"",
        timeout_seconds: 10,
      },
      new AbortController().signal,
      undefined,
    );

    expect(runResult.details).toMatchObject({ passed: true, timedOut: false });
    expect((runResult.details as { stdout: string }).stdout.trim()).toBe(repoCwd);

    const statusResult = await createAutoresearchStatusTool(api as never).execute(
      "call-3",
      { cwd: repoCwd },
      new AbortController().signal,
      undefined,
    );

    expect(statusResult.content[0]?.text).toContain("Session: Nested repo robustness");

    const logResult = await createLogExperimentTool(api as never).execute(
      "call-4",
      {
        cwd: repoCwd,
        commit: "abc1234",
        metric: 5,
        status: "discard",
        description: "baseline",
      },
      new AbortController().signal,
      undefined,
    );

    expect(logResult.details).toMatchObject({ status: "ok" });
    expect(logResult.content[0]?.text).toContain("Logged #1: discard - baseline");
  });
});
