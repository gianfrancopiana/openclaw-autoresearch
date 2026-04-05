import path from "node:path";
import type { OpenClawPluginApi } from "openclaw/plugin-sdk/core";
import { resolveAutoresearchScope } from "../scope.js";
import type { ResolvedToolExecutionScope } from "./tool-cwd.js";

const PREFLIGHT_TIMEOUT_MS = 10_000;
const DETAIL_LIMIT = 200;

type RunCommandWithTimeout = OpenClawPluginApi["runtime"]["system"]["runCommandWithTimeout"];
type PreflightRequirement = "bash" | "git" | "git-repo";
type CommandCheckResult = Awaited<ReturnType<RunCommandWithTimeout>>;

export type AutoresearchToolFailure = {
  content: [
    {
      type: "text";
      text: string;
    },
  ];
  details: {
    status: "error";
    phase: "preflight";
    requirement: PreflightRequirement;
    cwd: string;
  };
};

export type PreparedAutoresearchToolExecution =
  | {
      ok: true;
      scope: ResolvedToolExecutionScope;
    }
  | {
      ok: false;
      failure: AutoresearchToolFailure;
    };

type CommandCheck =
  | {
      ok: true;
      result: CommandCheckResult;
    }
  | {
      ok: false;
      error: unknown;
    };

export async function prepareAutoresearchToolExecution(options: {
  runCommandWithTimeout: RunCommandWithTimeout;
  scope: ResolvedToolExecutionScope;
  requireBash?: boolean;
}): Promise<PreparedAutoresearchToolExecution> {
  const gitCheck = await runCheck(options.runCommandWithTimeout, options.scope.repoDir, [
    "git",
    "--version",
  ]);
  if (!gitCheck.ok) {
    return {
      ok: false,
      failure: buildPreflightFailure({
        requirement: "git",
        cwd: options.scope.repoDir,
        text: formatMissingCommandMessage({
          command: "git",
          fallback: "Autoresearch needs git. Install git and try again.",
          error: gitCheck.error,
        }),
      }),
    };
  }
  if (gitCheck.result.code !== 0) {
    return {
      ok: false,
      failure: buildPreflightFailure({
        requirement: "git",
        cwd: options.scope.repoDir,
        text: appendCheckDetails(
          "Autoresearch could not run git. Make sure git works on this machine and try again.",
          gitCheck.result,
        ),
      }),
    };
  }

  const repoCheck = await runCheck(options.runCommandWithTimeout, options.scope.repoDir, [
    "git",
    "rev-parse",
    "--show-toplevel",
  ]);
  if (!repoCheck.ok) {
    return {
      ok: false,
      failure: buildPreflightFailure({
        requirement: "git-repo",
        cwd: options.scope.repoDir,
        text: formatMissingCommandMessage({
          command: "git",
          fallback:
            "Autoresearch only works inside a git repo. Run it in the repo you want to optimize, or pass cwd to that repo.",
          error: repoCheck.error,
        }),
      }),
    };
  }
  if (repoCheck.result.code !== 0 || repoCheck.result.stdout.trim().length === 0) {
    return {
      ok: false,
      failure: buildPreflightFailure({
        requirement: "git-repo",
        cwd: options.scope.repoDir,
        text: appendCheckDetails(
          "Autoresearch only works inside a git repo. Run it in the repo you want to optimize, or pass cwd to that repo.",
          repoCheck.result,
        ),
      }),
    };
  }

  const canonicalRepoDir = path.resolve(repoCheck.result.stdout.trim());
  const scope = canonicalizeScope(options.scope, canonicalRepoDir);

  if (options.requireBash) {
    const bashCheck = await runCheck(options.runCommandWithTimeout, scope.repoDir, [
      "bash",
      "-lc",
      "exit 0",
    ]);
    if (!bashCheck.ok) {
      return {
        ok: false,
        failure: buildPreflightFailure({
          requirement: "bash",
          cwd: scope.repoDir,
          text: formatMissingCommandMessage({
            command: "bash",
            fallback: "Autoresearch needs bash to run experiment commands. Install bash and try again.",
            error: bashCheck.error,
          }),
        }),
      };
    }
    if (bashCheck.result.code !== 0) {
      return {
        ok: false,
        failure: buildPreflightFailure({
          requirement: "bash",
          cwd: scope.repoDir,
          text: appendCheckDetails(
            "Autoresearch needs bash to run experiment commands. Install bash and try again.",
            bashCheck.result,
          ),
        }),
      };
    }
  }

  return {
    ok: true,
    scope,
  };
}

async function runCheck(
  runCommandWithTimeout: RunCommandWithTimeout,
  cwd: string,
  argv: string[],
): Promise<CommandCheck> {
  try {
    return {
      ok: true,
      result: await runCommandWithTimeout(argv, {
        cwd,
        timeoutMs: PREFLIGHT_TIMEOUT_MS,
      }),
    };
  } catch (error) {
    return {
      ok: false,
      error,
    };
  }
}

function canonicalizeScope(
  scope: ResolvedToolExecutionScope,
  repoDir: string,
): ResolvedToolExecutionScope {
  if (scope.repoDir === repoDir) {
    return scope;
  }

  const resolved = resolveAutoresearchScope({
    sessionKey: scope.sessionKey,
    sessionId: scope.sessionId,
    workspaceDir: scope.workspaceDir,
    repoDir,
    runId: scope.runId,
  });

  return {
    ...resolved,
    repoDir,
  };
}

function buildPreflightFailure(params: {
  requirement: PreflightRequirement;
  cwd: string;
  text: string;
}): AutoresearchToolFailure {
  return {
    content: [
      {
        type: "text",
        text: params.text,
      },
    ],
    details: {
      status: "error",
      phase: "preflight",
      requirement: params.requirement,
      cwd: params.cwd,
    },
  };
}

function formatMissingCommandMessage(params: {
  command: "bash" | "git";
  fallback: string;
  error: unknown;
}): string {
  const err = params.error as NodeJS.ErrnoException | undefined;
  const raw = err?.message ?? String(params.error ?? "");
  if (err?.code === "ENOENT" || raw.includes(`spawn ${params.command} ENOENT`)) {
    return params.fallback;
  }
  return appendInlineDetail(params.fallback, raw);
}

function appendCheckDetails(message: string, result: CommandCheckResult): string {
  const output = `${result.stderr ?? ""}${result.stdout ?? ""}`.trim();
  if (!output) {
    return message;
  }
  return appendInlineDetail(message, output);
}

function appendInlineDetail(message: string, detail: string): string {
  const normalized = detail.trim();
  if (!normalized) {
    return message;
  }
  const clipped = normalized.length > DETAIL_LIMIT ? `${normalized.slice(0, DETAIL_LIMIT)}...` : normalized;
  return `${message}\nDetails: ${clipped}`;
}
