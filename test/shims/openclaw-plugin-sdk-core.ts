export type CommandRegistration = {
  name: string;
  description: string;
  acceptsArgs?: boolean;
  handler: (ctx: { args?: string; cwd?: string }) => { text: string };
};

export type ToolRegistration = {
  name: string;
};

export type OpenClawPluginApi = {
  resolvePath(path: string): string;
  registerTool(tool: ToolRegistration): void;
  registerCommand(command: CommandRegistration): void;
  on?(hookName: string, handler: (event: unknown, ctx: { cwd?: string }) => unknown): void;
  registerHook?(
    hookName: string,
    handler: (event: { systemPrompt?: string }, ctx: { cwd?: string }) => { systemPrompt?: string } | void,
  ): void;
};

export function emptyPluginConfigSchema(): Record<string, never> {
  return {};
}
