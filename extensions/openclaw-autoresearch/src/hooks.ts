import type { OpenClawPluginApi } from "openclaw/plugin-sdk";
import { AUTORESEARCH_ROOT_FILES } from "./files.js";
import { reconstructStateFromJsonl } from "./state.js";
import {
  clearAutoresearchRuntimeState,
  consumeAutoresearchContinuationReminder,
  consumeAutoresearchPendingCommand,
  getAutoresearchRuntimeState,
  queueAutoresearchSteer,
  setAutoresearchContinuationReminder,
} from "./runtime-state.js";

type BeforeAgentStartEvent = {
  systemPrompt?: string;
};

type HookContext = {
  cwd?: string;
};

type HookCapablePluginApi = OpenClawPluginApi & {
  on?: (hookName: string, handler: (event: unknown, ctx: HookContext) => unknown) => void;
  registerHook?: (
    hookName: string,
    handler: (event: BeforeAgentStartEvent, ctx: HookContext) => BeforeAgentStartEvent | void,
  ) => void;
};

export function registerAutoresearchHooks(api: OpenClawPluginApi): void {
  const hookApi = api as HookCapablePluginApi;
  if (typeof hookApi.on === "function") {
    hookApi.on("before_prompt_build", (_event, ctx) => {
      const cwd = resolveHookCwd(api, ctx);
      if (cwd === null) {
        return;
      }

      const addition = buildBeforePromptBuildContext(cwd);
      if (addition === null) {
        return;
      }

      return {
        appendSystemContext: addition,
      };
    });

    hookApi.on("message_received", (event, ctx) => {
      const cwd = resolveHookCwd(api, ctx);
      if (cwd === null) {
        return;
      }

      const state = getAutoresearchRuntimeState(cwd);
      if (!state.runInFlight) {
        return;
      }

      const messageText = extractMessageText(event);
      if (messageText === null || isCommandLikeMessage(messageText)) {
        return;
      }

      queueAutoresearchSteer(cwd, messageText);
    });

    hookApi.on("agent_end", (_event, ctx) => {
      const cwd = resolveHookCwd(api, ctx);
      if (cwd === null) {
        return;
      }

      const state = reconstructStateFromJsonl(cwd);
      if (state.mode === "active" && state.ideas.hasBacklog) {
        setAutoresearchContinuationReminder(cwd, true);
      }
    });

    hookApi.on("session_end", (_event, ctx) => {
      const cwd = resolveHookCwd(api, ctx);
      if (cwd === null) {
        return;
      }

      clearAutoresearchRuntimeState(cwd);
    });
    return;
  }

  if (typeof hookApi.registerHook !== "function") {
    return;
  }

  hookApi.registerHook("before_agent_start", (event, ctx) => {
    const cwd = resolveHookCwd(api, ctx);
    if (cwd === null) {
      return;
    }

    const addition = buildBeforePromptBuildContext(cwd);
    if (addition === null) {
      return;
    }

    return {
      ...event,
      systemPrompt: `${event.systemPrompt ?? ""}${addition}`,
    };
  });
}

export function buildBeforePromptBuildContext(cwd: string): string | null {
  const state = reconstructStateFromJsonl(cwd);
  const runtimeState = getAutoresearchRuntimeState(cwd);
  const modeEnabled =
    runtimeState.mode === "on" ||
    (runtimeState.mode !== "off" && (state.mode === "active" || state.hasSessionDoc));

  if (!modeEnabled) {
    return null;
  }

  const canonicalFiles = [
    AUTORESEARCH_ROOT_FILES.sessionDoc,
    AUTORESEARCH_ROOT_FILES.runnerScript,
    AUTORESEARCH_ROOT_FILES.resultsLog,
  ];
  const pendingCommand = consumeAutoresearchPendingCommand(cwd);
  const needsContinuationReminder = consumeAutoresearchContinuationReminder(cwd);

  const lines = ["", "", "## Autoresearch Mode (ACTIVE)"];

  if (pendingCommand?.kind === "setup" || !state.hasSessionDoc) {
    lines.push(
      `No ${AUTORESEARCH_ROOT_FILES.sessionDoc} was detected. Gather context and set up the experiment now with the canonical repo-root files.`,
      `Create ${AUTORESEARCH_ROOT_FILES.sessionDoc} and ${AUTORESEARCH_ROOT_FILES.runnerScript}, then initialize the loop with init_experiment, run_experiment, and log_experiment.`,
    );
    if (pendingCommand?.args) {
      lines.push(`Additional setup instruction from /autoresearch: ${pendingCommand.args}`);
    }
  } else {
    lines.push(
      `Autoresearch files live at repo root: ${canonicalFiles.join(", ")}.`,
      `Read ${AUTORESEARCH_ROOT_FILES.sessionDoc} before resuming or changing the experiment loop, and re-read it after compaction.`,
      "Resume the autonomous upstream loop: edit, run_experiment, log_experiment, keep/discard/crash, repeat.",
      "Use init_experiment, run_experiment, and log_experiment for experiment state changes. Never stop unless the user explicitly interrupts the loop.",
    );
    if (pendingCommand?.args) {
      lines.push(`Additional resume instruction from /autoresearch: ${pendingCommand.args}`);
    }
  }

  lines.push(
    `For discard or crash results, log_experiment records the outcome but does not revert your tree for you. Run \`git checkout -- .\` yourself after logging when you want to discard tracked changes.`,
  );

  if (state.ideas.hasBacklog) {
    lines.push(
      `${AUTORESEARCH_ROOT_FILES.ideasBacklog} exists with ${state.ideas.pendingCount} pending idea${state.ideas.pendingCount === 1 ? "" : "s"}; use it as continuation fuel for promising paths you have not exhausted.`,
    );
  }

  if (needsContinuationReminder && state.ideas.hasBacklog) {
    lines.push(
      `The previous autoresearch run ended with pending ideas. Read ${AUTORESEARCH_ROOT_FILES.ideasBacklog}, prune stale items, and spin those ideas into the next experiments before declaring the work done.`,
    );
  }

  if (runtimeState.queuedSteers.length > 0) {
    lines.push(
      `${runtimeState.queuedSteers.length} user steer${runtimeState.queuedSteers.length === 1 ? "" : "s"} arrived during the current experiment window. If the next followup turn repeats a steer already surfaced in log_experiment output, treat it as the same request rather than a new branch of work.`,
    );
  }

  return lines.join("\n");
}

function resolveHookCwd(api: OpenClawPluginApi, ctx: HookContext | undefined): string | null {
  if (ctx && typeof ctx.cwd === "string" && ctx.cwd.trim().length > 0) {
    return ctx.cwd;
  }

  try {
    const resolved = api.resolvePath(".");
    return resolved.trim().length > 0 ? resolved : null;
  } catch {
    return null;
  }
}

function extractMessageText(event: unknown): string | null {
  if (!event || typeof event !== "object") {
    return null;
  }

  const record = event as Record<string, unknown>;
  const direct = firstString(record.text, record.content, record.body, record.prompt);
  if (direct) {
    return direct;
  }

  const message = record.message;
  if (message && typeof message === "object") {
    const nested = message as Record<string, unknown>;
    const messageText = firstString(nested.text, nested.content, nested.body);
    if (messageText) {
      return messageText;
    }
  }

  const context = record.context;
  if (context && typeof context === "object") {
    const nested = context as Record<string, unknown>;
    const contextText = firstString(nested.content, nested.commandBody, nested.text);
    if (contextText) {
      return contextText;
    }
  }

  return null;
}

function firstString(...values: unknown[]): string | null {
  for (const value of values) {
    if (typeof value === "string" && value.trim().length > 0) {
      return value.trim();
    }
  }
  return null;
}

function isCommandLikeMessage(text: string): boolean {
  return /^[\/!]/.test(text.trim());
}
