import {
  definePluginEntry,
  type OpenClawPluginApi,
  type OpenClawPluginToolContext,
} from "openclaw/plugin-sdk/core";
import {
  AUTORESEARCH_PLUGIN_DESCRIPTION,
  AUTORESEARCH_PLUGIN_ID,
  AUTORESEARCH_PLUGIN_NAME,
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

function registerRequiredTool<TTool>(
  api: OpenClawPluginApi,
  name: string,
  createTool: (
    api: OpenClawPluginApi,
    toolContext?: Pick<OpenClawPluginToolContext, "sessionKey" | "sessionId" | "workspaceDir">,
  ) => TTool,
) {
  api.registerTool(
    createToolFactory(createTool, api) as Parameters<OpenClawPluginApi["registerTool"]>[0],
    {
      name,
      optional: false,
    },
  );
}

export default definePluginEntry({
  id: AUTORESEARCH_PLUGIN_ID,
  name: AUTORESEARCH_PLUGIN_NAME,
  description: AUTORESEARCH_PLUGIN_DESCRIPTION,
  register(api: OpenClawPluginApi) {
    registerAutoresearchHooks(api);
    registerAutoresearchCommand(api);
    registerRequiredTool(api, "init_experiment", createInitExperimentTool);
    registerRequiredTool(api, "run_experiment", createRunExperimentTool);
    registerRequiredTool(api, "log_experiment", createLogExperimentTool);
    registerRequiredTool(api, "autoresearch_status", createAutoresearchStatusTool);
  },
});
