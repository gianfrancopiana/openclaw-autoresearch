import * as fs from "node:fs";
import type { OpenClawPluginApi } from "openclaw/plugin-sdk/core";
import {
  AUTORESEARCH_ROOT_FILES,
  getAutoresearchRootFilePath,
  type AutoresearchRootFileKey,
} from "../files.js";
import { reconstructStateFromJsonl } from "../state.js";
import { formatAutoresearchStatusText } from "../tools/autoresearch-status.js";

type CommandContext = {
  args?: string;
  channel?: string;
  senderId?: string;
};

const COMMAND_USAGE = [
  "Thin entrypoint for repo-root autoresearch state.",
  "",
  "Usage:",
  "/autoresearch",
  "/autoresearch status",
  "/autoresearch help",
].join("\n");

export function registerAutoresearchCommand(api: OpenClawPluginApi): void {
  const cwd = api.resolvePath(".");

  api.registerCommand({
    name: "autoresearch",
    description: "Detect repo-root autoresearch state and point back to autoresearch.md.",
    acceptsArgs: true,
    handler: (ctx: CommandContext) => {
      const action = (ctx.args ?? "").trim().toLowerCase();
      if (!action || action === "resume") {
        return { text: buildAutoresearchCommandText(cwd, "default") };
      }
      if (action === "status") {
        return { text: buildAutoresearchCommandText(cwd, "status") };
      }
      if (action === "help") {
        return { text: `${COMMAND_USAGE}\n\n${buildAutoresearchCommandText(cwd, "default")}` };
      }
      return {
        text:
          `Unrecognized /autoresearch argument: ${action}\n\n` +
          `${COMMAND_USAGE}\n\n` +
          buildAutoresearchCommandText(cwd, "default"),
      };
    },
  });
}

export function buildAutoresearchCommandText(
  cwd: string,
  mode: "default" | "status",
): string {
  const presentFiles = getPresentCanonicalFiles(cwd);
  const hasSession = presentFiles.length > 0;

  if (!hasSession) {
    return [
      "No repo-root autoresearch session detected.",
      "",
      `Expected canonical files: ${Object.values(AUTORESEARCH_ROOT_FILES).join(", ")}`,
      "Start with `/skill:autoresearch-create` to set up the session.",
      `Once created, read \`${AUTORESEARCH_ROOT_FILES.sessionDoc}\` and follow that workflow instead of treating this command as a separate UI.`,
    ].join("\n");
  }

  const state = reconstructStateFromJsonl(cwd);
  const lines = [
    `Autoresearch session detected at repo root: ${presentFiles.join(", ")}`,
    `Read \`${AUTORESEARCH_ROOT_FILES.sessionDoc}\` before resuming or changing the loop.`,
  ];

  if (mode === "status") {
    lines.push("", formatAutoresearchStatusText(state));
  } else if (state.mode === "active" || state.hasSessionDoc) {
    lines.push(
      "Resume from the existing files and continue the upstream loop with `init_experiment`, `run_experiment`, and `log_experiment` as needed.",
    );
  } else {
    lines.push(
      `The canonical files exist, but the session brief looks incomplete. Open \`${AUTORESEARCH_ROOT_FILES.sessionDoc}\` and finish setup through \`/skill:autoresearch-create\` if needed.`,
    );
  }

  return lines.join("\n");
}

function getPresentCanonicalFiles(cwd: string): string[] {
  const present: string[] = [];
  for (const key of Object.keys(AUTORESEARCH_ROOT_FILES) as AutoresearchRootFileKey[]) {
    if (fs.existsSync(getAutoresearchRootFilePath(cwd, key))) {
      present.push(AUTORESEARCH_ROOT_FILES[key]);
    }
  }
  return present;
}
