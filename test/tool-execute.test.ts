import { execFileSync } from "node:child_process";
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

function initGitRepo(cwd: string): void {
  execFileSync("git", ["init", "-b", "main"], { cwd, stdio: "pipe" });
  execFileSync("git", ["config", "user.name", "Test User"], { cwd, stdio: "pipe" });
  execFileSync("git", ["config", "user.email", "test@example.com"], { cwd, stdio: "pipe" });
}

function createTempDir(): string {
  const cwd = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "autoresearch-tool-test-")));
  initGitRepo(cwd);
  return cwd;
}

function createPlainTempDir(): string {
  return fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "autoresearch-plain-tool-test-")));
}

function createMissingCommandRuntime(commandName: "bash" | "git") {
  return async (...args: Parameters<typeof runCommandWithTimeout>) => {
    if ((args[0]?.[0] ?? "") === commandName) {
      const error = new Error(`spawn ${commandName} ENOENT`) as NodeJS.ErrnoException;
      error.code = "ENOENT";
      throw error;
    }
    return await runCommandWithTimeout(...args);
  };
}

function createApi(cwd: string, commandRunner: typeof runCommandWithTimeout = runCommandWithTimeout) {
  return {
    resolvePath: vi.fn(() => cwd),
    runtime: {
      system: {
        runCommandWithTimeout: commandRunner,
      },
    },
  };
}

function createToolContext(cwd: string, sessionKey = cwd) {
  return {
    workspaceDir: cwd,
    sessionKey,
    sessionId: `${sessionKey}:session`,
  };
}

describe("autoresearch tools", () => {
  it("init_experiment binds repo cwd from the OpenClaw tool workspace instead of api.resolvePath", async () => {
    const cwd = createTempDir();
    const api = createApi(cwd);
    const tool = createInitExperimentTool(api as never, createToolContext(cwd));

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

    expect(api.resolvePath).not.toHaveBeenCalled();
    expect(result.details).toMatchObject({ status: "ok" });
    expect(fs.existsSync(path.join(cwd, AUTORESEARCH_ROOT_FILES.resultsLog))).toBe(true);
  });

  it("autoresearch_status reads the active workspace from the OpenClaw tool context", async () => {
    const cwd = createTempDir();
    const api = createApi(cwd);
    const toolContext = createToolContext(cwd);
    await createInitExperimentTool(api as never, toolContext).execute(
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

    const result = await createAutoresearchStatusTool(api as never, toolContext).execute(
      "call-2",
      {},
      new AbortController().signal,
      undefined,
    );

    expect(api.resolvePath).not.toHaveBeenCalled();
    expect(result.content[0]?.text).toContain("Session: Repo robustness");
    expect(result.content[0]?.text).toContain("Metric: escaped_mutations");
  });

  it("run_experiment reuses the OpenClaw tool workspace when no cwd override is supplied", async () => {
    const cwd = createTempDir();
    const api = createApi(cwd);
    const updates: unknown[] = [];

    const result = await createRunExperimentTool(api as never, createToolContext(cwd)).execute(
      "call-3",
      { command: "node -e \"console.log('ok')\"", timeout_seconds: 10 },
      new AbortController().signal,
      async (update) => {
        updates.push(update);
      },
    );

    expect(api.resolvePath).not.toHaveBeenCalled();
    expect(updates.length).toBe(1);
    expect(result.details).toMatchObject({ passed: true, timedOut: false });
  });

  it("log_experiment reuses the OpenClaw tool workspace when no cwd override is supplied", async () => {
    const cwd = createTempDir();
    const api = createApi(cwd);
    const toolContext = createToolContext(cwd);
    await createInitExperimentTool(api as never, toolContext).execute(
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

    const result = await createLogExperimentTool(api as never, toolContext).execute(
      "call-4",
      {
        commit: "abc1234",
        metric: 5,
        status: "discard",
        description: "baseline",
        idea: "keep a discard note so follow-up experiments are not lost",
      },
      new AbortController().signal,
      undefined,
    );

    expect(api.resolvePath).not.toHaveBeenCalled();
    expect(result.details).toMatchObject({ status: "ok" });
    expect(result.content[0]?.text).toContain("Logged #1: discard - baseline");
  });

  it("supports explicit cwd overrides for nested repo tool execution", async () => {
    const workspaceCwd = createTempDir();
    const repoCwd = createTempDir();
    const api = createApi(workspaceCwd);
    const toolContext = createToolContext(workspaceCwd, "session:nested");

    const initResult = await createInitExperimentTool(api as never, toolContext).execute(
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

    const runResult = await createRunExperimentTool(api as never, toolContext).execute(
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

    const statusResult = await createAutoresearchStatusTool(api as never, toolContext).execute(
      "call-3",
      { cwd: repoCwd },
      new AbortController().signal,
      undefined,
    );

    expect(statusResult.content[0]?.text).toContain("Session: Nested repo robustness");

    const logResult = await createLogExperimentTool(api as never, toolContext).execute(
      "call-4",
      {
        cwd: repoCwd,
        commit: "abc1234",
        metric: 5,
        status: "discard",
        description: "baseline",
        idea: "keep a discard note so follow-up experiments are not lost",
      },
      new AbortController().signal,
      undefined,
    );

    expect(logResult.details).toMatchObject({ status: "ok" });
    expect(logResult.content[0]?.text).toContain("Logged #1: discard - baseline");
  });

  it("normalizes cwd overrides to the enclosing git repo root", async () => {
    const workspaceCwd = createTempDir();
    const repoRoot = createTempDir();
    const repoSubdir = path.join(repoRoot, "nested", "project");
    fs.mkdirSync(repoSubdir, { recursive: true });

    const api = createApi(workspaceCwd);
    const toolContext = createToolContext(workspaceCwd, "session:subdir");

    const initResult = await createInitExperimentTool(api as never, toolContext).execute(
      "call-1",
      {
        cwd: repoSubdir,
        name: "Subdir repo root",
        metric_name: "escaped_mutations",
        metric_unit: "",
        direction: "lower",
      },
      new AbortController().signal,
      undefined,
    );

    expect(initResult.details).toMatchObject({ status: "ok" });
    expect(fs.existsSync(path.join(repoRoot, AUTORESEARCH_ROOT_FILES.resultsLog))).toBe(true);
    expect(fs.existsSync(path.join(repoSubdir, AUTORESEARCH_ROOT_FILES.resultsLog))).toBe(false);

    const runResult = await createRunExperimentTool(api as never, toolContext).execute(
      "call-2",
      {
        cwd: repoSubdir,
        command: "node -e \"console.log(process.cwd())\"",
        timeout_seconds: 10,
      },
      new AbortController().signal,
      undefined,
    );

    expect(runResult.details).toMatchObject({ passed: true, timedOut: false });
    expect((runResult.details as { stdout: string }).stdout.trim()).toBe(repoRoot);
  });

  it("returns a clear preflight error when the target directory is not a git repo", async () => {
    const cwd = createPlainTempDir();
    const api = createApi(cwd);

    const result = await createInitExperimentTool(api as never, createToolContext(cwd)).execute(
      "call-1",
      {
        name: "Not a repo",
        metric_name: "escaped_mutations",
        metric_unit: "",
        direction: "lower",
      },
      new AbortController().signal,
      undefined,
    );

    expect(result.details).toMatchObject({
      status: "error",
      phase: "preflight",
      requirement: "git-repo",
    });
    expect(result.content[0]?.text).toContain("only works inside a git repo");
  });

  it("returns a clear preflight error when git is unavailable", async () => {
    const cwd = createTempDir();
    const api = createApi(cwd, createMissingCommandRuntime("git"));

    const result = await createInitExperimentTool(api as never, createToolContext(cwd)).execute(
      "call-1",
      {
        name: "Missing git",
        metric_name: "escaped_mutations",
        metric_unit: "",
        direction: "lower",
      },
      new AbortController().signal,
      undefined,
    );

    expect(result.details).toMatchObject({
      status: "error",
      phase: "preflight",
      requirement: "git",
    });
    expect(result.content[0]?.text).toContain("needs git");
  });

  it("returns a clear preflight error when bash is unavailable", async () => {
    const cwd = createTempDir();
    const api = createApi(cwd, createMissingCommandRuntime("bash"));

    const result = await createRunExperimentTool(api as never, createToolContext(cwd)).execute(
      "call-1",
      {
        command: "node -e \"console.log('ok')\"",
        timeout_seconds: 10,
      },
      new AbortController().signal,
      undefined,
    );

    expect(result.details).toMatchObject({
      status: "error",
      phase: "preflight",
      requirement: "bash",
    });
    expect(result.content[0]?.text).toContain("needs bash");
  });
});
