import { describe, expect, it, vi } from "vitest";
import { runCommandWithTimeout } from "./helpers/fake-runtime.js";

vi.mock("openclaw/plugin-sdk/core", () => ({
  definePluginEntry: <TEntry extends { id: string; name: string; description: string }>(entry: TEntry) =>
    entry,
}));

describe("plugin registration", () => {
  it("registers the command, OpenClaw hooks, and all tool surfaces", async () => {
    const plugin = (await import("../index.js")).default;
    const api = {
      resolvePath: vi.fn(() => "/tmp/repo"),
      runtime: {
        system: {
          runCommandWithTimeout,
        },
      },
      registerTool: vi.fn(),
      registerCommand: vi.fn(),
      on: vi.fn(),
    };

    plugin.register(api as never);

    expect(api.registerCommand).toHaveBeenCalledTimes(1);
    expect(api.on).toHaveBeenCalledTimes(5);
    expect(api.on.mock.calls.map(([hookName]) => hookName)).toEqual([
      "before_prompt_build",
      "message_received",
      "before_tool_call",
      "agent_end",
      "session_end",
    ]);
    expect(api.registerTool).toHaveBeenCalledTimes(4);
    expect(api.registerTool.mock.calls.map(([, options]) => options)).toEqual([
      { name: "init_experiment", optional: false },
      { name: "run_experiment", optional: false },
      { name: "log_experiment", optional: false },
      { name: "autoresearch_status", optional: false },
    ]);
    expect(
      api.registerTool.mock.calls.map(([tool]) =>
        typeof tool === "function"
          ? tool({
              workspaceDir: "/tmp/repo",
              sessionKey: "session:test",
              sessionId: "session:test:1",
            }).name
          : tool.name,
      ),
    ).toEqual(["init_experiment", "run_experiment", "log_experiment", "autoresearch_status"]);
  });
});
