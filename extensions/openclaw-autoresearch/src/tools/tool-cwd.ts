import path from "node:path";
import type { OpenClawPluginApi } from "openclaw/plugin-sdk";

export function resolveToolCwd(api: OpenClawPluginApi, requestedCwd?: unknown): string {
  const normalizedRequestedCwd =
    typeof requestedCwd === "string" ? requestedCwd.trim() : "";

  const cwd = normalizedRequestedCwd
    ? path.isAbsolute(normalizedRequestedCwd)
      ? normalizedRequestedCwd
      : api.resolvePath(normalizedRequestedCwd)
    : api.resolvePath(".");

  if (typeof cwd !== "string" || cwd.trim().length === 0) {
    throw new Error("Could not resolve repo cwd for autoresearch tool execution.");
  }

  return cwd;
}
