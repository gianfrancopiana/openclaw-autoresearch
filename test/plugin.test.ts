import { describe, expect, it, vi } from "vitest";
import plugin from "../extensions/openclaw-autoresearch/index.js";

describe("plugin registration", () => {
  it("registers the command and all tool surfaces", () => {
    const api = {
      resolvePath: vi.fn(() => "/tmp/repo"),
      registerTool: vi.fn(),
      registerCommand: vi.fn(),
    };

    plugin.register(api);

    expect(api.registerCommand).toHaveBeenCalledTimes(1);
    expect(api.registerTool).toHaveBeenCalledTimes(4);
    expect(api.registerTool.mock.calls.map(([tool]) => tool.name)).toEqual([
      "init_experiment",
      "run_experiment",
      "log_experiment",
      "autoresearch_status",
    ]);
  });
});
