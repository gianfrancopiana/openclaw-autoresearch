import path from "node:path";
import type { OpenClawPluginToolContext } from "openclaw/plugin-sdk/core";
import { type ResolvedAutoresearchScope, resolveAutoresearchScope } from "../scope.js";

export type ResolvedToolExecutionScope = Omit<ResolvedAutoresearchScope, "repoDir"> & {
  readonly repoDir: string;
};

export function resolveToolExecutionScope(params: {
  toolContext?: Pick<OpenClawPluginToolContext, "sessionKey" | "sessionId" | "workspaceDir">;
  requestedCwd?: unknown;
}): ResolvedToolExecutionScope {
  const baseScope = resolveAutoresearchScope({
    sessionKey: params.toolContext?.sessionKey,
    sessionId: params.toolContext?.sessionId,
    workspaceDir: params.toolContext?.workspaceDir,
  });
  const normalizedRequestedCwd =
    typeof params.requestedCwd === "string" ? params.requestedCwd.trim() : "";

  let repoDir = baseScope.workspaceDir;
  if (normalizedRequestedCwd) {
    repoDir = path.isAbsolute(normalizedRequestedCwd)
      ? path.resolve(normalizedRequestedCwd)
      : baseScope.workspaceDir
        ? path.resolve(baseScope.workspaceDir, normalizedRequestedCwd)
        : null;
  }

  const scope = resolveAutoresearchScope({
    sessionKey: baseScope.sessionKey,
    sessionId: baseScope.sessionId,
    workspaceDir: baseScope.workspaceDir,
    repoDir,
  });
  if (!scope.repoDir) {
    throw new Error(
      normalizedRequestedCwd && !path.isAbsolute(normalizedRequestedCwd)
        ? "Relative cwd overrides require a workspaceDir in the OpenClaw tool context."
        : "Could not resolve the active workspace for autoresearch tool execution. OpenClaw provides workspaceDir in the tool context; use cwd only as an explicit override.",
    );
  }

  return {
    ...scope,
    repoDir: scope.repoDir,
  };
}
