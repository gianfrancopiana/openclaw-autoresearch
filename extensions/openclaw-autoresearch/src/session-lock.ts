import * as fs from "node:fs";
import { getAutoresearchRootFilePath } from "./files.js";
import { type AutoresearchScopeRef, resolveAutoresearchScope } from "./scope.js";

export type AutoresearchSessionLock = {
  readonly pid: number;
  readonly timestamp: number;
  readonly sessionKey: string | null;
  readonly sessionId: string | null;
};

export type AutoresearchSessionLockStatus = {
  readonly state: "missing" | "active" | "stale";
  readonly pid: number | null;
  readonly timestamp: number | null;
  readonly sessionKey: string | null;
  readonly sessionId: string | null;
  readonly ownedByCurrentProcess: boolean;
  readonly ownedByCurrentSession: boolean;
};

function isSameSession(
  lock: AutoresearchSessionLock,
  scope: ReturnType<typeof resolveAutoresearchScope>,
): boolean {
  if (scope.sessionId) {
    return lock.sessionId === scope.sessionId;
  }
  if (scope.sessionKey) {
    return lock.sessionKey === scope.sessionKey;
  }
  return false;
}

function missingLockStatus(): AutoresearchSessionLockStatus {
  return {
    state: "missing",
    pid: null,
    timestamp: null,
    sessionKey: null,
    sessionId: null,
    ownedByCurrentProcess: false,
    ownedByCurrentSession: false,
  };
}

export function readAutoresearchSessionLock(ref: AutoresearchScopeRef): AutoresearchSessionLock | null {
  const scope = resolveAutoresearchScope(ref);
  if (!scope.repoDir) {
    return null;
  }

  const lockPath = getAutoresearchRootFilePath(scope.repoDir, "sessionLock");
  if (!fs.existsSync(lockPath)) {
    return null;
  }

  try {
    const parsed = JSON.parse(fs.readFileSync(lockPath, "utf8")) as Partial<AutoresearchSessionLock>;
    if (typeof parsed.pid !== "number" || typeof parsed.timestamp !== "number") {
      return null;
    }
    return {
      pid: parsed.pid,
      timestamp: parsed.timestamp,
      sessionKey: typeof parsed.sessionKey === "string" ? parsed.sessionKey : null,
      sessionId: typeof parsed.sessionId === "string" ? parsed.sessionId : null,
    };
  } catch {
    return null;
  }
}

export function getAutoresearchSessionLockStatus(
  ref: AutoresearchScopeRef,
): AutoresearchSessionLockStatus {
  const scope = resolveAutoresearchScope(ref);
  const lock = readAutoresearchSessionLock(ref);
  if (!lock) {
    return missingLockStatus();
  }

  const active = isProcessAlive(lock.pid);
  return {
    state: active ? "active" : "stale",
    pid: lock.pid,
    timestamp: lock.timestamp,
    sessionKey: lock.sessionKey,
    sessionId: lock.sessionId,
    ownedByCurrentProcess: lock.pid === process.pid,
    ownedByCurrentSession: isSameSession(lock, scope),
  };
}

export function acquireAutoresearchSessionLock(
  ref: AutoresearchScopeRef,
): AutoresearchSessionLockStatus {
  const scope = resolveAutoresearchScope(ref);
  if (!scope.repoDir) {
    throw new Error(
      "Could not resolve the active workspace for autoresearch lock scoping. OpenClaw provides workspaceDir on tool and agent contexts.",
    );
  }

  const status = getAutoresearchSessionLockStatus(ref);
  if (status.state === "active" && !status.ownedByCurrentSession) {
    return status;
  }

  const nextLock: AutoresearchSessionLock = {
    pid: process.pid,
    timestamp: Date.now(),
    sessionKey: scope.sessionKey,
    sessionId: scope.sessionId,
  };
  const lockPath = getAutoresearchRootFilePath(scope.repoDir, "sessionLock");
  fs.writeFileSync(lockPath, `${JSON.stringify(nextLock, null, 2)}\n`);

  return {
    state: "active",
    pid: nextLock.pid,
    timestamp: nextLock.timestamp,
    sessionKey: nextLock.sessionKey,
    sessionId: nextLock.sessionId,
    ownedByCurrentProcess: true,
    ownedByCurrentSession: true,
  };
}

export function removeAutoresearchSessionLock(ref: AutoresearchScopeRef): void {
  const scope = resolveAutoresearchScope(ref);
  if (!scope.repoDir) {
    return;
  }

  const status = getAutoresearchSessionLockStatus(ref);
  if (status.state === "active" && !status.ownedByCurrentSession) {
    if (scope.sessionToken || !status.ownedByCurrentProcess) {
      return;
    }
  }

  const lockPath = getAutoresearchRootFilePath(scope.repoDir, "sessionLock");
  if (fs.existsSync(lockPath)) {
    fs.unlinkSync(lockPath);
  }
}

function isProcessAlive(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) {
    return false;
  }

  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    const code = error && typeof error === "object" ? (error as NodeJS.ErrnoException).code : null;
    return code === "EPERM";
  }
}
