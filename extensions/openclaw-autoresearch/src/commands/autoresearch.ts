import * as fs from "node:fs";
import type { OpenClawPluginApi } from "openclaw/plugin-sdk/core";
import {
  AUTORESEARCH_ROOT_FILES,
  getAutoresearchRootFilePath,
  type AutoresearchRootFileKey,
} from "../files.js";
import { reconstructStateFromJsonl } from "../state.js";
import { formatAutoresearchStatusText } from "../tools/autoresearch-status.js";
import {
  clearAutoresearchRuntimeState,
  getAutoresearchRuntimeState,
  setAutoresearchPendingCommand,
  setAutoresearchRuntimeMode,
} from "../runtime-state.js";
import {
  acquireAutoresearchSessionLock,
  getAutoresearchSessionLockStatus,
  removeAutoresearchSessionLock,
} from "../session-lock.js";
import { type AutoresearchScopeRef, resolveAutoresearchScope } from "../scope.js";

type CommandContext = {
  args?: string;
  channel?: string;
  senderId?: string;
  sessionKey?: string;
  sessionId?: string;
  workspaceDir?: string;
  runId?: string;
  cwd?: string;
};

const COMMAND_USAGE = [
  "Enable or inspect repo-root autoresearch mode.",
  "",
  "Usage:",
  "/autoresearch",
  "/autoresearch on",
  "/autoresearch off",
  "/autoresearch setup",
  "/autoresearch status",
  "/autoresearch help",
].join("\n");

export function registerAutoresearchCommand(api: OpenClawPluginApi): void {
  api.registerCommand({
    name: "autoresearch",
    description: "Enable, disable, or inspect repo-root autoresearch mode.",
    acceptsArgs: true,
    handler: (ctx: CommandContext) => {
      const scope = resolveCommandScope(ctx);
      const rawArgs = (ctx.args ?? "").trim();
      const [verb, ...rest] = rawArgs.split(/\s+/).filter(Boolean);
      const action = (verb ?? "").toLowerCase();
      const remainder = rest.join(" ").trim() || null;

      if (!rawArgs || action === "resume" || action === "on") {
        return {
          text: enableAutoresearchMode(
            scope,
            rawArgs && action !== "resume" && action !== "on" ? rawArgs : remainder,
          ),
        };
      }
      if (action === "setup") {
        return { text: primeAutoresearchSetup(scope, remainder) };
      }
      if (action === "off") {
        clearAutoresearchRuntimeState(scope);
        setAutoresearchRuntimeMode(scope, "off");
        removeAutoresearchSessionLock(scope);
        return {
          text: [
            "Autoresearch mode OFF.",
            `Canonical files remain at repo root: ${Object.values(AUTORESEARCH_ROOT_FILES).join(", ")}`,
          ].join("\n"),
        };
      }
      if (action === "status") {
        return { text: buildAutoresearchCommandText(scope, "status") };
      }
      if (action === "help") {
        return { text: `${COMMAND_USAGE}\n\n${buildAutoresearchCommandText(scope, "default")}` };
      }

      return {
        text: enableAutoresearchMode(scope, rawArgs),
      };
    },
  });
}

export function buildAutoresearchCommandText(
  scopeRef: AutoresearchScopeRef,
  mode: "default" | "status",
): string {
  const scope = resolveAutoresearchScope(scopeRef);
  const runtimeState = getAutoresearchRuntimeState(scopeRef);
  if (!scope.repoDir) {
    return buildWorkspacePendingCommandText(runtimeState);
  }

  const presentFiles = getPresentCanonicalFiles(scope.repoDir);
  const presentSessionFiles = presentFiles.filter(
    (file) => file !== AUTORESEARCH_ROOT_FILES.sessionLock,
  );
  const hasSession = presentSessionFiles.length > 0;
  const lockStatus = getAutoresearchSessionLockStatus(scope);

  if (!hasSession) {
    return [
      "No repo-root autoresearch session detected.",
      "",
      `Expected canonical files: ${Object.values(AUTORESEARCH_ROOT_FILES).join(", ")}`,
      "Recommended OpenClaw entrypoint: `/autoresearch` or `/autoresearch setup <goal>`.",
      "Direct skill fallback: `/skill autoresearch-create`.",
      `Session lock: ${formatLockStatus(lockStatus)}`,
    ].join("\n");
  }

  const state = reconstructStateFromJsonl(scope.repoDir);
  const lines = [
    `Autoresearch session detected at repo root: ${presentFiles.join(", ")}`,
    `Read \`${AUTORESEARCH_ROOT_FILES.sessionDoc}\` before resuming or changing the loop.`,
  ];

  if (mode === "status") {
    lines.push(
      "",
      formatAutoresearchStatusText(state, runtimeState),
      `Session lock: ${formatLockStatus(lockStatus)}`,
    );
  } else if (state.mode === "active" || state.hasSessionDoc) {
    lines.push(
      "Use `/autoresearch` or `/autoresearch on` to enable mode for the next agent turn, then continue the upstream loop with `init_experiment`, `run_experiment`, and `log_experiment` as needed.",
    );
  } else {
    lines.push(
      `The canonical files exist, but the session brief looks incomplete. Open \`${AUTORESEARCH_ROOT_FILES.sessionDoc}\` and finish setup, or restart via \`/skill autoresearch-create\` if needed.`,
    );
  }

  return lines.join("\n");
}

function buildWorkspacePendingCommandText(
  runtimeState: ReturnType<typeof getAutoresearchRuntimeState>,
): string {
  return [
    "OpenClaw has not exposed a workspace root for this session yet.",
    "Send a normal message from the target workspace, or invoke an autoresearch tool there, so the plugin can bind `workspaceDir` and inspect the repo-root files.",
    `Runtime mode: ${runtimeState.mode}`,
    `Pending run: ${runtimeState.pendingRun ? "yes" : "no"}`,
  ].join("\n");
}

function enableAutoresearchMode(scopeRef: AutoresearchScopeRef, args: string | null): string {
  const scope = resolveAutoresearchScope(scopeRef);
  if (scope.repoDir) {
    const lockStatus = acquireAutoresearchSessionLock(scope);
    if (lockStatus.state === "active" && !lockStatus.ownedByCurrentSession) {
      return [
        "Autoresearch mode NOT enabled.",
        `Another live autoresearch loop holds autoresearch.lock (PID ${lockStatus.pid}, started ${new Date(lockStatus.timestamp ?? 0).toISOString()}).`,
        "Resume that loop instead of creating a parallel session.",
      ].join("\n");
    }
  }

  setAutoresearchRuntimeMode(scopeRef, "on");
  const presentFiles = scope.repoDir ? getPresentCanonicalFiles(scope.repoDir) : [];
  const hasSession = presentFiles.some((file) => file !== AUTORESEARCH_ROOT_FILES.sessionLock);
  setAutoresearchPendingCommand(scopeRef, {
    kind: hasSession ? "resume" : "setup",
    args,
  });

  if (!scope.repoDir) {
    return [
      "Autoresearch mode ON.",
      "Workspace root is not bound yet, so the next agent or tool turn for this session will resolve it from OpenClaw `workspaceDir` before continuing.",
      args ? `Captured instruction: ${args}` : "Send a normal message to continue once the workspace is available.",
    ].join("\n");
  }

  if (!hasSession) {
    return [
      "Autoresearch mode ON.",
      "No repo-root session was detected, so the next agent turn will be primed for setup.",
      "Next step: send a normal message so the next agent turn can gather setup details.",
      "Direct skill fallback: `/skill autoresearch-create`.",
      args ? `Captured setup instruction: ${args}` : "Run `/autoresearch setup <goal>` to attach a setup hint.",
    ].join("\n");
  }

  return [
    "Autoresearch mode ON.",
    `Next agent turn will be primed from \`${AUTORESEARCH_ROOT_FILES.sessionDoc}\` and the canonical repo-root files.`,
    args ? `Captured resume instruction: ${args}` : "Send a normal message to continue the loop, or use `/autoresearch status` for a snapshot first.",
  ].join("\n");
}

function primeAutoresearchSetup(scopeRef: AutoresearchScopeRef, args: string | null): string {
  const scope = resolveAutoresearchScope(scopeRef);
  if (scope.repoDir) {
    const lockStatus = acquireAutoresearchSessionLock(scope);
    if (lockStatus.state === "active" && !lockStatus.ownedByCurrentSession) {
      return [
        "Autoresearch setup NOT primed.",
        `Another live autoresearch loop holds autoresearch.lock (PID ${lockStatus.pid}, started ${new Date(lockStatus.timestamp ?? 0).toISOString()}).`,
        "Resume that loop instead of starting a parallel setup flow.",
      ].join("\n");
    }
  }

  setAutoresearchRuntimeMode(scopeRef, "on");
  setAutoresearchPendingCommand(scopeRef, {
    kind: "setup",
    args,
  });

  return [
    "Autoresearch setup primed.",
    scope.repoDir
      ? "The next agent turn will be told to create the canonical repo-root files and start the loop."
      : "The next agent turn will wait for OpenClaw to provide a workspace root, then create the canonical repo-root files and start the loop.",
    "Continue with a normal message on the next turn, or invoke the skill directly with `/skill autoresearch-create`.",
    args ? `Captured setup instruction: ${args}` : "Add an argument to `/autoresearch setup` if you want a specific goal or constraint carried forward.",
  ].join("\n");
}

function resolveCommandScope(ctx: CommandContext): AutoresearchScopeRef {
  return {
    sessionKey: ctx.sessionKey,
    sessionId: ctx.sessionId,
    workspaceDir: ctx.workspaceDir,
    runId: ctx.runId,
    legacyCwd: ctx.cwd,
  };
}

function getPresentCanonicalFiles(cwd: string): string[] {
  const present: string[] = [];
  for (const key of Object.keys(AUTORESEARCH_ROOT_FILES) as AutoresearchRootFileKey[]) {
    if (fs.existsSync(getAutoresearchRootFilePath(cwd, key))) {
      present.push(AUTORESEARCH_ROOT_FILES[key]);
    }
  }
  return present;
}

function formatLockStatus(lockStatus: ReturnType<typeof getAutoresearchSessionLockStatus>): string {
  if (lockStatus.state === "missing") {
    return "missing";
  }

  const timestamp = lockStatus.timestamp
    ? new Date(lockStatus.timestamp).toISOString()
    : "unknown time";
  return `${lockStatus.state} (pid ${lockStatus.pid}, started ${timestamp})`;
}
