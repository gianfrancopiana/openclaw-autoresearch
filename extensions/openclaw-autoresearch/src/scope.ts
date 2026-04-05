import path from "node:path";

export type AutoresearchScopeRef =
  | string
  | {
      readonly sessionKey?: unknown;
      readonly sessionId?: unknown;
      readonly workspaceDir?: unknown;
      readonly repoDir?: unknown;
      readonly runId?: unknown;
      readonly legacyCwd?: unknown;
    };

export type ResolvedAutoresearchScope = {
  readonly sessionKey: string | null;
  readonly sessionId: string | null;
  readonly sessionToken: string | null;
  readonly workspaceDir: string | null;
  readonly repoDir: string | null;
  readonly runId: string | null;
  readonly hasExplicitRepoDir: boolean;
};

const sessionIdBySessionKey = new Map<string, string>();
const workspaceBySessionKey = new Map<string, string>();
const sessionKeyByRunId = new Map<string, string>();
const sessionIdByRunId = new Map<string, string>();
const workspaceByRunId = new Map<string, string>();

function normalizeText(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const normalized = value.trim();
  return normalized.length > 0 ? normalized : null;
}

function normalizeDir(value: unknown): string | null {
  const normalized = normalizeText(value);
  return normalized ? path.resolve(normalized) : null;
}

function shouldRememberWorkspace(ref: Exclude<AutoresearchScopeRef, string>): boolean {
  return ref.workspaceDir !== undefined || ref.legacyCwd !== undefined;
}

export function resolveAutoresearchScope(
  ref: AutoresearchScopeRef | undefined,
): ResolvedAutoresearchScope {
  if (typeof ref === "string") {
    const repoDir = normalizeDir(ref);
    return {
      sessionKey: null,
      sessionId: null,
      sessionToken: null,
      workspaceDir: null,
      repoDir,
      runId: null,
      hasExplicitRepoDir: repoDir !== null,
    };
  }

  const scopeRef = ref ?? {};
  const runId = normalizeText(scopeRef.runId);

  let sessionKey = normalizeText(scopeRef.sessionKey);
  if (!sessionKey && runId) {
    sessionKey = sessionKeyByRunId.get(runId) ?? null;
  }

  let sessionId = normalizeText(scopeRef.sessionId);
  if (!sessionId && runId) {
    sessionId = sessionIdByRunId.get(runId) ?? null;
  }
  if (!sessionId && sessionKey) {
    sessionId = sessionIdBySessionKey.get(sessionKey) ?? null;
  }

  const explicitWorkspaceDir =
    normalizeDir(scopeRef.workspaceDir) ?? normalizeDir(scopeRef.legacyCwd);
  const workspaceDir =
    explicitWorkspaceDir ??
    (runId ? workspaceByRunId.get(runId) ?? null : null) ??
    (sessionKey ? workspaceBySessionKey.get(sessionKey) ?? null : null);
  const explicitRepoDir = normalizeDir(scopeRef.repoDir);
  const repoDir = explicitRepoDir ?? workspaceDir;

  if (sessionKey && sessionId) {
    sessionIdBySessionKey.set(sessionKey, sessionId);
  }
  if (runId && sessionKey) {
    sessionKeyByRunId.set(runId, sessionKey);
  }
  if (runId && sessionId) {
    sessionIdByRunId.set(runId, sessionId);
  }
  if (explicitWorkspaceDir && runId) {
    workspaceByRunId.set(runId, explicitWorkspaceDir);
  }
  if (sessionKey && explicitWorkspaceDir && shouldRememberWorkspace(scopeRef)) {
    workspaceBySessionKey.set(sessionKey, explicitWorkspaceDir);
  }

  return {
    sessionKey,
    sessionId,
    sessionToken: sessionId ?? sessionKey,
    workspaceDir,
    repoDir,
    runId,
    hasExplicitRepoDir: explicitRepoDir !== null,
  };
}

export function forgetAutoresearchScope(
  ref: Exclude<AutoresearchScopeRef, string>,
): ResolvedAutoresearchScope {
  const resolved = resolveAutoresearchScope(ref);

  if (resolved.runId) {
    const mappedSessionKey = sessionKeyByRunId.get(resolved.runId);
    if (!resolved.sessionKey || mappedSessionKey === resolved.sessionKey) {
      sessionKeyByRunId.delete(resolved.runId);
    }

    const mappedSessionId = sessionIdByRunId.get(resolved.runId);
    if (!resolved.sessionId || mappedSessionId === resolved.sessionId) {
      sessionIdByRunId.delete(resolved.runId);
    }

    const mappedWorkspace = workspaceByRunId.get(resolved.runId);
    if (!resolved.workspaceDir || mappedWorkspace === resolved.workspaceDir) {
      workspaceByRunId.delete(resolved.runId);
    }
  }

  if (resolved.sessionKey) {
    const mappedSessionId = sessionIdBySessionKey.get(resolved.sessionKey);
    const canForgetSessionKey =
      resolved.sessionId === null || mappedSessionId === resolved.sessionId;
    if (canForgetSessionKey) {
      sessionIdBySessionKey.delete(resolved.sessionKey);
      workspaceBySessionKey.delete(resolved.sessionKey);
    }
  }

  return resolved;
}
