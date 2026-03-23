import * as fs from "node:fs";
import { getAutoresearchRootFilePath } from "./files.js";

export type AutoresearchSessionLock = {
  readonly pid: number;
  readonly timestamp: number;
};

export type AutoresearchSessionLockStatus = {
  readonly state: "missing" | "active" | "stale";
  readonly pid: number | null;
  readonly timestamp: number | null;
  readonly ownedByCurrentProcess: boolean;
};

export function readAutoresearchSessionLock(cwd: string): AutoresearchSessionLock | null {
  const lockPath = getAutoresearchRootFilePath(cwd, "sessionLock");
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
    };
  } catch {
    return null;
  }
}

export function getAutoresearchSessionLockStatus(cwd: string): AutoresearchSessionLockStatus {
  const lock = readAutoresearchSessionLock(cwd);
  if (!lock) {
    return {
      state: "missing",
      pid: null,
      timestamp: null,
      ownedByCurrentProcess: false,
    };
  }

  const active = isProcessAlive(lock.pid);
  return {
    state: active ? "active" : "stale",
    pid: lock.pid,
    timestamp: lock.timestamp,
    ownedByCurrentProcess: lock.pid === process.pid,
  };
}

export function acquireAutoresearchSessionLock(cwd: string): AutoresearchSessionLockStatus {
  const status = getAutoresearchSessionLockStatus(cwd);
  if (status.state === "active" && !status.ownedByCurrentProcess) {
    return status;
  }

  const nextLock: AutoresearchSessionLock = {
    pid: process.pid,
    timestamp: Date.now(),
  };
  const lockPath = getAutoresearchRootFilePath(cwd, "sessionLock");
  fs.writeFileSync(lockPath, `${JSON.stringify(nextLock, null, 2)}\n`);

  return {
    state: "active",
    pid: nextLock.pid,
    timestamp: nextLock.timestamp,
    ownedByCurrentProcess: true,
  };
}

export function removeAutoresearchSessionLock(cwd: string): void {
  const lockPath = getAutoresearchRootFilePath(cwd, "sessionLock");
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
