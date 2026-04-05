import { type AutoresearchScopeRef, resolveAutoresearchScope } from "./scope.js";

export type AutoresearchRuntimeMode = "auto" | "on" | "off";

export type PendingAutoresearchCommand =
  | {
      readonly kind: "resume" | "setup";
      readonly args: string | null;
    }
  | null;

export type PendingExperimentRun = {
  readonly command: string;
  readonly commit: string | null;
  readonly primaryMetric: number | null;
  readonly metrics: Record<string, number>;
  readonly durationSeconds: number;
  readonly exitCode: number | null;
  readonly passed: boolean;
  readonly timedOut: boolean;
  readonly tailOutput: string;
  readonly capturedAt: number;
};

export type AutoresearchRuntimeSnapshot = {
  readonly mode: AutoresearchRuntimeMode;
  readonly runInFlight: boolean;
  readonly queuedSteers: readonly string[];
  readonly needsContinuationReminder: boolean;
  readonly pendingCommand: PendingAutoresearchCommand;
  readonly pendingRun: PendingExperimentRun | null;
};

type MutableAutoresearchRuntimeState = {
  mode: AutoresearchRuntimeMode;
  runInFlight: boolean;
  queuedSteers: string[];
  needsContinuationReminder: boolean;
  pendingCommand: PendingAutoresearchCommand;
  pendingRun: PendingExperimentRun | null;
};

type ResolvedRuntimeScope = ReturnType<typeof resolveAutoresearchRuntimeStateScope>;

const MAX_QUEUED_STEERS = 20;
const SESSION_SCOPE_PREFIX = "session:";
const REPO_SCOPE_PREFIX = "repo:";
const runtimeStates = new Map<string, MutableAutoresearchRuntimeState>();
const activeScopeKeyBySessionToken = new Map<string, string>();

function createDefaultRuntimeState(): MutableAutoresearchRuntimeState {
  return {
    mode: "auto",
    runInFlight: false,
    queuedSteers: [],
    needsContinuationReminder: false,
    pendingCommand: null,
    pendingRun: null,
  };
}

function buildRuntimeScopeKey(sessionToken: string | null, repoDir: string | null): string {
  if (sessionToken && repoDir) {
    return `${SESSION_SCOPE_PREFIX}${sessionToken}|${REPO_SCOPE_PREFIX}${repoDir}`;
  }
  if (sessionToken) {
    return `${SESSION_SCOPE_PREFIX}${sessionToken}`;
  }
  if (repoDir) {
    return `${REPO_SCOPE_PREFIX}${repoDir}`;
  }
  throw new Error("Autoresearch runtime state requires a session or repo scope.");
}

function snapshotRuntimeState(
  state: MutableAutoresearchRuntimeState,
): AutoresearchRuntimeSnapshot {
  return {
    mode: state.mode,
    runInFlight: state.runInFlight,
    queuedSteers: [...state.queuedSteers],
    needsContinuationReminder: state.needsContinuationReminder,
    pendingCommand: state.pendingCommand,
    pendingRun: state.pendingRun,
  };
}

function mergeRuntimeStates(
  target: MutableAutoresearchRuntimeState,
  source: MutableAutoresearchRuntimeState,
): void {
  if (target.mode === "auto" && source.mode !== "auto") {
    target.mode = source.mode;
  }
  target.runInFlight = target.runInFlight || source.runInFlight;
  target.queuedSteers = [...source.queuedSteers, ...target.queuedSteers].slice(-MAX_QUEUED_STEERS);
  target.needsContinuationReminder =
    target.needsContinuationReminder || source.needsContinuationReminder;
  target.pendingCommand ??= source.pendingCommand;
  target.pendingRun ??= source.pendingRun;
}

function migrateRuntimeState(fromKey: string, toKey: string): void {
  if (fromKey === toKey) {
    return;
  }

  const source = runtimeStates.get(fromKey);
  if (!source) {
    return;
  }

  const target = runtimeStates.get(toKey);
  if (!target) {
    runtimeStates.set(toKey, source);
    runtimeStates.delete(fromKey);
    return;
  }

  mergeRuntimeStates(target, source);
  runtimeStates.delete(fromKey);
}

function resolveAutoresearchRuntimeStateScope(
  ref: AutoresearchScopeRef,
  options?: {
    readonly preferActiveSessionScope?: boolean;
  },
) {
  const scope = resolveAutoresearchScope(ref);
  let key = buildRuntimeScopeKey(scope.sessionToken, scope.repoDir);

  if (!scope.repoDir && scope.sessionToken && options?.preferActiveSessionScope !== false) {
    const activeKey = activeScopeKeyBySessionToken.get(scope.sessionToken);
    if (activeKey) {
      key = activeKey;
    }
  }

  if (scope.sessionToken && scope.repoDir) {
    migrateRuntimeState(buildRuntimeScopeKey(scope.sessionToken, null), key);
  }

  return {
    ...scope,
    key,
  };
}

function getMutableRuntimeState(
  ref: AutoresearchScopeRef,
  options?: {
    readonly preferActiveSessionScope?: boolean;
  },
): {
  readonly scope: ResolvedRuntimeScope;
  readonly state: MutableAutoresearchRuntimeState;
} {
  const scope = resolveAutoresearchRuntimeStateScope(ref, options);
  let state = runtimeStates.get(scope.key);
  if (!state) {
    state = createDefaultRuntimeState();
    runtimeStates.set(scope.key, state);
  }
  return { scope, state };
}

function syncActiveRuntimeScope(scope: ResolvedRuntimeScope): void {
  if (!scope.sessionToken) {
    return;
  }

  const state = runtimeStates.get(scope.key);
  const shouldTrack = Boolean(state && scope.repoDir && (state.runInFlight || state.pendingRun));
  if (shouldTrack) {
    activeScopeKeyBySessionToken.set(scope.sessionToken, scope.key);
    return;
  }

  if (activeScopeKeyBySessionToken.get(scope.sessionToken) === scope.key) {
    activeScopeKeyBySessionToken.delete(scope.sessionToken);
  }
}

export function getAutoresearchRuntimeState(
  ref: AutoresearchScopeRef,
): AutoresearchRuntimeSnapshot {
  return snapshotRuntimeState(getMutableRuntimeState(ref).state);
}

export function setAutoresearchRuntimeMode(
  ref: AutoresearchScopeRef,
  mode: AutoresearchRuntimeMode,
): AutoresearchRuntimeSnapshot {
  const { scope, state } = getMutableRuntimeState(ref);
  state.mode = mode;
  syncActiveRuntimeScope(scope);
  return snapshotRuntimeState(state);
}

export function setAutoresearchRunInFlight(
  ref: AutoresearchScopeRef,
  runInFlight: boolean,
): AutoresearchRuntimeSnapshot {
  const { scope, state } = getMutableRuntimeState(ref);
  state.runInFlight = runInFlight;
  syncActiveRuntimeScope(scope);
  return snapshotRuntimeState(state);
}

export function queueAutoresearchSteer(
  ref: AutoresearchScopeRef,
  steer: string,
): AutoresearchRuntimeSnapshot {
  const normalized = steer.trim();
  if (!normalized) {
    return getAutoresearchRuntimeState(ref);
  }

  const { scope, state } = getMutableRuntimeState(ref);
  state.queuedSteers.push(normalized);
  if (state.queuedSteers.length > MAX_QUEUED_STEERS) {
    state.queuedSteers = state.queuedSteers.slice(-MAX_QUEUED_STEERS);
  }
  syncActiveRuntimeScope(scope);
  return snapshotRuntimeState(state);
}

export function consumeAutoresearchSteers(ref: AutoresearchScopeRef): readonly string[] {
  const { scope, state } = getMutableRuntimeState(ref);
  const queued = [...state.queuedSteers];
  state.queuedSteers = [];
  syncActiveRuntimeScope(scope);
  return queued;
}

export function clearAutoresearchSteers(
  ref: AutoresearchScopeRef,
): AutoresearchRuntimeSnapshot {
  const { scope, state } = getMutableRuntimeState(ref);
  state.queuedSteers = [];
  syncActiveRuntimeScope(scope);
  return snapshotRuntimeState(state);
}

export function setAutoresearchPendingCommand(
  ref: AutoresearchScopeRef,
  pendingCommand: PendingAutoresearchCommand,
): AutoresearchRuntimeSnapshot {
  const { scope, state } = getMutableRuntimeState(ref);
  state.pendingCommand = pendingCommand;
  syncActiveRuntimeScope(scope);
  return snapshotRuntimeState(state);
}

export function consumeAutoresearchPendingCommand(
  ref: AutoresearchScopeRef,
): PendingAutoresearchCommand {
  const { scope, state } = getMutableRuntimeState(ref);
  const pending = state.pendingCommand;
  state.pendingCommand = null;
  syncActiveRuntimeScope(scope);
  return pending;
}

export function setAutoresearchContinuationReminder(
  ref: AutoresearchScopeRef,
  needsReminder: boolean,
): AutoresearchRuntimeSnapshot {
  const { scope, state } = getMutableRuntimeState(ref);
  state.needsContinuationReminder = needsReminder;
  syncActiveRuntimeScope(scope);
  return snapshotRuntimeState(state);
}

export function consumeAutoresearchContinuationReminder(ref: AutoresearchScopeRef): boolean {
  const { scope, state } = getMutableRuntimeState(ref);
  const needsReminder = state.needsContinuationReminder;
  state.needsContinuationReminder = false;
  syncActiveRuntimeScope(scope);
  return needsReminder;
}

export function setAutoresearchPendingRun(
  ref: AutoresearchScopeRef,
  pendingRun: PendingExperimentRun | null,
): AutoresearchRuntimeSnapshot {
  const { scope, state } = getMutableRuntimeState(ref);
  state.pendingRun = pendingRun;
  syncActiveRuntimeScope(scope);
  return snapshotRuntimeState(state);
}

export function getAutoresearchPendingRun(
  ref: AutoresearchScopeRef,
): PendingExperimentRun | null {
  return getMutableRuntimeState(ref).state.pendingRun;
}

export function consumeAutoresearchPendingRun(
  ref: AutoresearchScopeRef,
): PendingExperimentRun | null {
  const { scope, state } = getMutableRuntimeState(ref);
  const pendingRun = state.pendingRun;
  state.pendingRun = null;
  syncActiveRuntimeScope(scope);
  return pendingRun;
}

export function clearAutoresearchRuntimeState(ref: AutoresearchScopeRef): void {
  const scope = resolveAutoresearchScope(ref);
  if (scope.sessionToken) {
    const prefix = `${SESSION_SCOPE_PREFIX}${scope.sessionToken}`;
    for (const key of [...runtimeStates.keys()]) {
      if (key === prefix || key.startsWith(`${prefix}|${REPO_SCOPE_PREFIX}`)) {
        runtimeStates.delete(key);
      }
    }
    activeScopeKeyBySessionToken.delete(scope.sessionToken);
    return;
  }

  if (scope.repoDir) {
    runtimeStates.delete(buildRuntimeScopeKey(null, scope.repoDir));
  }
}
