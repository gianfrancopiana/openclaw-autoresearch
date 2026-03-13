import type { OpenClawPluginApi } from "openclaw/plugin-sdk/core";

export function resolveToolCwd(api: OpenClawPluginApi): string {
  const cwd = api.resolvePath(".");
  if (typeof cwd !== "string" || cwd.trim().length === 0) {
    throw new Error("Could not resolve repo cwd for autoresearch tool execution.");
  }
  return cwd;
}
