export type CommandRegistration = {
  name: string;
  description: string;
  acceptsArgs?: boolean;
  handler: (ctx: {
    args?: string;
    sessionKey?: string;
    sessionId?: string;
    workspaceDir?: string;
    runId?: string;
    cwd?: string;
  }) => { text: string };
};

export type OpenClawPluginToolContext = {
  sessionKey?: string;
  sessionId?: string;
  workspaceDir?: string;
};

export type ToolRegistration = {
  name: string;
};

export type OpenClawPluginApi = {
  resolvePath(path: string): string;
  runtime: {
    system: {
      runCommandWithTimeout: (
        argv: string[],
        optionsOrTimeout:
          | number
          | {
              timeoutMs: number;
              cwd?: string;
              input?: string;
              env?: NodeJS.ProcessEnv;
              windowsVerbatimArguments?: boolean;
              noOutputTimeoutMs?: number;
            },
      ) => Promise<{
        pid?: number;
        stdout: string;
        stderr: string;
        code: number | null;
        signal: NodeJS.Signals | null;
        killed: boolean;
        termination: "exit" | "timeout" | "no-output-timeout" | "signal";
        noOutputTimedOut?: boolean;
      }>;
    };
  };
  registerTool(tool: ToolRegistration | ((ctx: OpenClawPluginToolContext) => ToolRegistration)): void;
  registerCommand(command: CommandRegistration): void;
  on?(
    hookName: string,
    handler: (
      event: unknown,
      ctx: {
        sessionKey?: string;
        sessionId?: string;
        workspaceDir?: string;
        runId?: string;
        cwd?: string;
      },
    ) => unknown,
  ): void;
  registerHook?(
    hookName: string,
    handler: (
      event: { systemPrompt?: string },
      ctx: {
        sessionKey?: string;
        sessionId?: string;
        workspaceDir?: string;
        runId?: string;
        cwd?: string;
      },
    ) => { systemPrompt?: string } | void,
  ): void;
};

export function emptyPluginConfigSchema(): Record<string, never> {
  return {};
}
