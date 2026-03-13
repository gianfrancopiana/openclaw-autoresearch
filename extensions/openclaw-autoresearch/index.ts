import type { OpenClawPluginApi } from "openclaw/plugin-sdk/core";
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

const plugin = {
  id: AUTORESEARCH_PLUGIN_ID,
  name: AUTORESEARCH_PLUGIN_NAME,
  description: AUTORESEARCH_PLUGIN_DESCRIPTION,
  configSchema: autoresearchPluginConfigSchema,
  register(api: OpenClawPluginApi) {
    registerAutoresearchHooks(api);
    api.registerTool(createInitExperimentTool(api));
    api.registerTool(createRunExperimentTool(api));
    api.registerTool(createLogExperimentTool(api));
    api.registerTool(createAutoresearchStatusTool(api));
  },
};

export default plugin;
