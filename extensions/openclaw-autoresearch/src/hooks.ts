import type { OpenClawPluginApi } from "openclaw/plugin-sdk/core";
import { AUTORESEARCH_ROOT_FILES } from "./files.js";
import { reconstructStateFromJsonl } from "./state.js";

type BeforeAgentStartEvent = {
  systemPrompt?: string;
};

type HookContext = {
  cwd: string;
};

type HookCapablePluginApi = OpenClawPluginApi & {
  registerHook?: (
    hookName: string,
    handler: (event: BeforeAgentStartEvent, ctx: HookContext) => BeforeAgentStartEvent | void,
  ) => void;
};

export function registerAutoresearchHooks(api: OpenClawPluginApi): void {
  const hookApi = api as HookCapablePluginApi;
  if (typeof hookApi.registerHook !== "function") {
    return;
  }

  hookApi.registerHook("before_agent_start", (event, ctx) => {
    const addition = buildBeforeAgentStartContext(ctx.cwd);
    if (addition === null) {
      return;
    }

    return {
      ...event,
      systemPrompt: `${event.systemPrompt ?? ""}${addition}`,
    };
  });
}

function buildBeforeAgentStartContext(cwd: string): string | null {
  const state = reconstructStateFromJsonl(cwd);
  if (state.mode !== "active" && !state.hasSessionDoc) {
    return null;
  }

  const canonicalFiles = [
    AUTORESEARCH_ROOT_FILES.sessionDoc,
    AUTORESEARCH_ROOT_FILES.runnerScript,
    AUTORESEARCH_ROOT_FILES.resultsLog,
  ];

  const lines = [
    "",
    "",
    "## Autoresearch",
    `Autoresearch files live at repo root: ${canonicalFiles.join(", ")}.`,
    `Read ${AUTORESEARCH_ROOT_FILES.sessionDoc} before resuming or changing the experiment loop.`,
    "Use init_experiment, run_experiment, and log_experiment for experiment state changes.",
  ];

  if (state.ideas.hasBacklog) {
    lines.push(
      `${AUTORESEARCH_ROOT_FILES.ideasBacklog} exists with ${state.ideas.pendingCount} pending idea${state.ideas.pendingCount === 1 ? "" : "s"}; consult it only when you need continuation context.`,
    );
  }

  return lines.join("\n");
}
