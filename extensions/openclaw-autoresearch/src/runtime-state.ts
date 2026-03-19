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

const MAX_QUEUED_STEERS = 20;
const runtimeStates = new Map<string, MutableAutoresearchRuntimeState>();

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

function getMutableRuntimeState(cwd: string): MutableAutoresearchRuntimeState {
  let state = runtimeStates.get(cwd);
  if (!state) {
    state = createDefaultRuntimeState();
    runtimeStates.set(cwd, state);
  }
  return state;
}

export function getAutoresearchRuntimeState(cwd: string): AutoresearchRuntimeSnapshot {
  const state = getMutableRuntimeState(cwd);
  return {
    mode: state.mode,
    runInFlight: state.runInFlight,
    queuedSteers: [...state.queuedSteers],
    needsContinuationReminder: state.needsContinuationReminder,
    pendingCommand: state.pendingCommand,
    pendingRun: state.pendingRun,
  };
}

export function setAutoresearchRuntimeMode(
  cwd: string,
  mode: AutoresearchRuntimeMode,
): AutoresearchRuntimeSnapshot {
  const state = getMutableRuntimeState(cwd);
  state.mode = mode;
  return getAutoresearchRuntimeState(cwd);
}

export function setAutoresearchRunInFlight(
  cwd: string,
  runInFlight: boolean,
): AutoresearchRuntimeSnapshot {
  const state = getMutableRuntimeState(cwd);
  state.runInFlight = runInFlight;
  return getAutoresearchRuntimeState(cwd);
}

export function queueAutoresearchSteer(
  cwd: string,
  steer: string,
): AutoresearchRuntimeSnapshot {
  const normalized = steer.trim();
  if (!normalized) {
    return getAutoresearchRuntimeState(cwd);
  }

  const state = getMutableRuntimeState(cwd);
  state.queuedSteers.push(normalized);
  if (state.queuedSteers.length > MAX_QUEUED_STEERS) {
    state.queuedSteers = state.queuedSteers.slice(-MAX_QUEUED_STEERS);
  }
  return getAutoresearchRuntimeState(cwd);
}

export function consumeAutoresearchSteers(cwd: string): readonly string[] {
  const state = getMutableRuntimeState(cwd);
  const queued = [...state.queuedSteers];
  state.queuedSteers = [];
  return queued;
}

export function clearAutoresearchSteers(cwd: string): AutoresearchRuntimeSnapshot {
  const state = getMutableRuntimeState(cwd);
  state.queuedSteers = [];
  return getAutoresearchRuntimeState(cwd);
}

export function setAutoresearchPendingCommand(
  cwd: string,
  pendingCommand: PendingAutoresearchCommand,
): AutoresearchRuntimeSnapshot {
  const state = getMutableRuntimeState(cwd);
  state.pendingCommand = pendingCommand;
  return getAutoresearchRuntimeState(cwd);
}

export function consumeAutoresearchPendingCommand(
  cwd: string,
): PendingAutoresearchCommand {
  const state = getMutableRuntimeState(cwd);
  const pending = state.pendingCommand;
  state.pendingCommand = null;
  return pending;
}

export function setAutoresearchContinuationReminder(
  cwd: string,
  needsReminder: boolean,
): AutoresearchRuntimeSnapshot {
  const state = getMutableRuntimeState(cwd);
  state.needsContinuationReminder = needsReminder;
  return getAutoresearchRuntimeState(cwd);
}

export function consumeAutoresearchContinuationReminder(cwd: string): boolean {
  const state = getMutableRuntimeState(cwd);
  const needsReminder = state.needsContinuationReminder;
  state.needsContinuationReminder = false;
  return needsReminder;
}

export function setAutoresearchPendingRun(
  cwd: string,
  pendingRun: PendingExperimentRun | null,
): AutoresearchRuntimeSnapshot {
  const state = getMutableRuntimeState(cwd);
  state.pendingRun = pendingRun;
  return getAutoresearchRuntimeState(cwd);
}

export function getAutoresearchPendingRun(cwd: string): PendingExperimentRun | null {
  return getMutableRuntimeState(cwd).pendingRun;
}

export function consumeAutoresearchPendingRun(cwd: string): PendingExperimentRun | null {
  const state = getMutableRuntimeState(cwd);
  const pendingRun = state.pendingRun;
  state.pendingRun = null;
  return pendingRun;
}

export function clearAutoresearchRuntimeState(cwd: string): void {
  runtimeStates.delete(cwd);
}
