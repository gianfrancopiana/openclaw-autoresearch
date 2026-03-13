export type CommandRegistration = {
  name: string;
  description: string;
  acceptsArgs?: boolean;
  handler: (ctx: { args?: string }) => { text: string };
};

export type ToolRegistration = {
  name: string;
};

export type OpenClawPluginApi = {
  resolvePath(path: string): string;
  registerTool(tool: ToolRegistration): void;
  registerCommand(command: CommandRegistration): void;
};

export function emptyPluginConfigSchema(): Record<string, never> {
  return {};
}
