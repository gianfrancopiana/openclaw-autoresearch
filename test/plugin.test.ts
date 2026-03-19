import { describe, expect, it, vi } from "vitest";
import plugin from "../index.js";
import { runCommandWithTimeout } from "./helpers/fake-runtime.js";

describe("plugin registration", () => {
  it("registers the command, OpenClaw hooks, and all tool surfaces", () => {
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

    plugin.register(api);

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
    expect(api.registerTool.mock.calls.map(([tool]) => tool.name)).toEqual([
      "init_experiment",
      "run_experiment",
      "log_experiment",
      "autoresearch_status",
    ]);
  });
});
