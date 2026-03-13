import { describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { AUTORESEARCH_ROOT_FILES } from "../extensions/openclaw-autoresearch/src/files.js";
import {
  buildBeforePromptBuildContext,
  registerAutoresearchHooks,
} from "../extensions/openclaw-autoresearch/src/hooks.js";
import {
  getAutoresearchRuntimeState,
  queueAutoresearchSteer,
  setAutoresearchContinuationReminder,
  setAutoresearchPendingCommand,
  setAutoresearchRunInFlight,
  setAutoresearchRuntimeMode,
} from "../extensions/openclaw-autoresearch/src/runtime-state.js";

function createTempDir(prefix: string): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function seedActiveSession(cwd: string): void {
  fs.writeFileSync(
    path.join(cwd, AUTORESEARCH_ROOT_FILES.sessionDoc),
    "# Autoresearch\n\n## Objective\n\nReduce runtime.\n\n## What's Been Tried\n\n- baseline\n",
  );
  fs.writeFileSync(
    path.join(cwd, AUTORESEARCH_ROOT_FILES.ideasBacklog),
    "- retry the parser cache\n- measure compile_ms separately\n",
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
}

describe("autoresearch hooks", () => {
  it("builds a stronger before_prompt_build context for active sessions", () => {
    const cwd = createTempDir("autoresearch-hooks-context-");
    seedActiveSession(cwd);
    setAutoresearchRuntimeMode(cwd, "on");
    setAutoresearchPendingCommand(cwd, {
      kind: "resume",
      args: "focus parser cache",
    });
    queueAutoresearchSteer(cwd, "try branchless parsing");
    setAutoresearchContinuationReminder(cwd, true);

    const context = buildBeforePromptBuildContext(cwd);

    expect(context).toContain("## Autoresearch Mode (ACTIVE)");
    expect(context).toContain("Never stop unless the user explicitly interrupts the loop.");
    expect(context).toContain("Additional resume instruction from /autoresearch: focus parser cache");
    expect(context).toContain("The previous autoresearch run ended with pending ideas.");
    expect(context).toContain("1 user steer arrived during the current experiment window");

    const secondContext = buildBeforePromptBuildContext(cwd);
    expect(secondContext).not.toContain("The previous autoresearch run ended with pending ideas.");
  });

  it("registers OpenClaw-compatible hooks and queues steer messages only while experiments are in flight", () => {
    const cwd = createTempDir("autoresearch-hooks-runtime-");
    const handlers = new Map<string, (event: unknown, ctx: { cwd?: string }) => unknown>();
    const api = {
      resolvePath: vi.fn(() => cwd),
      on: vi.fn((hookName: string, handler: (event: unknown, ctx: { cwd?: string }) => unknown) => {
        handlers.set(hookName, handler);
      }),
    };

    registerAutoresearchHooks(api as never);

    expect(handlers.has("message_received")).toBe(true);

    setAutoresearchRunInFlight(cwd, false);
    handlers.get("message_received")?.({ text: "ignore this" }, { cwd });
    expect(getAutoresearchRuntimeState(cwd).queuedSteers).toEqual([]);

    setAutoresearchRunInFlight(cwd, true);
    handlers.get("message_received")?.({ text: "/help" }, { cwd });
    handlers.get("message_received")?.({ text: "try branchless parsing" }, { cwd });

    expect(getAutoresearchRuntimeState(cwd).queuedSteers).toEqual([
      "try branchless parsing",
    ]);
  });
});
