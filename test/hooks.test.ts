import { describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { registerAutoresearchHooks } from "../extensions/openclaw-autoresearch/src/hooks.js";

function createTempDir(prefix: string): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

describe("registerAutoresearchHooks", () => {
  it("returns without registering when the host does not expose hooks", () => {
    const api = {};

    expect(() => registerAutoresearchHooks(api as never)).not.toThrow();
  });

  it("registers a before_agent_start hook that appends autoresearch context", () => {
    const cwd = createTempDir("autoresearch-hooks-");
    fs.writeFileSync(
      path.join(cwd, "autoresearch.md"),
      "# Autoresearch\n\nContinue reducing runtime.\n",
    );
    fs.writeFileSync(
      path.join(cwd, "autoresearch.jsonl"),
      `${JSON.stringify({
        type: "config",
        name: "Runtime optimization",
        metricName: "total_ms",
        metricUnit: "ms",
        bestDirection: "lower",
      })}\n`,
    );

    const registerHook = vi.fn();
    registerAutoresearchHooks({ registerHook } as never);

    expect(registerHook).toHaveBeenCalledTimes(1);
    expect(registerHook).toHaveBeenCalledWith(
      "before_agent_start",
      expect.any(Function),
    );

    const handler = registerHook.mock.calls[0]?.[1] as (
      event: { systemPrompt?: string },
      ctx: { cwd: string },
    ) => { systemPrompt?: string } | void;
    const result = handler({ systemPrompt: "Base prompt." }, { cwd });

    expect(result).toEqual({
      systemPrompt:
        "Base prompt.\n\n## Autoresearch\nAutoresearch files live at repo root: autoresearch.md, autoresearch.sh, autoresearch.jsonl.\nRead autoresearch.md before resuming or changing the experiment loop.\nUse init_experiment, run_experiment, and log_experiment for experiment state changes.",
    });
  });
});
