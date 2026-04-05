import type { OpenClawPluginApi, OpenClawPluginToolContext } from "openclaw/plugin-sdk";
import {
  AUTORESEARCH_PLUGIN_DESCRIPTION,
  AUTORESEARCH_PLUGIN_ID,
  AUTORESEARCH_PLUGIN_NAME,
  autoresearchPluginConfigSchema,
} from "./src/config.js";
import { createInitExperimentTool } from "./src/tools/init-experiment.js";
import { createRunExperimentTool } from "./src/tools/run-experiment.js";
import { createLogExperimentTool } from "./src/tools/log-experiment.js";
import { createAutoresearchStatusTool } from "./src/tools/autoresearch-status.js";
import { registerAutoresearchHooks } from "./src/hooks.js";
import { registerAutoresearchCommand } from "./src/commands/autoresearch.js";

function createToolFactory<TTool>(
  createTool: (
    api: OpenClawPluginApi,
    toolContext?: Pick<OpenClawPluginToolContext, "sessionKey" | "sessionId" | "workspaceDir">,
  ) => TTool,
  api: OpenClawPluginApi,
) {
  return (toolContext: OpenClawPluginToolContext) => createTool(api, toolContext);
}

const plugin = {
  id: AUTORESEARCH_PLUGIN_ID,
  name: AUTORESEARCH_PLUGIN_NAME,
  description: AUTORESEARCH_PLUGIN_DESCRIPTION,
  configSchema: autoresearchPluginConfigSchema,
  register(api: OpenClawPluginApi) {
    registerAutoresearchHooks(api);
    registerAutoresearchCommand(api);
    api.registerTool(createToolFactory(createInitExperimentTool, api));
    api.registerTool(createToolFactory(createRunExperimentTool, api));
    api.registerTool(createToolFactory(createLogExperimentTool, api));
    api.registerTool(createToolFactory(createAutoresearchStatusTool, api));
  },
};

export default plugin;
