import * as fs from "node:fs";
import { getAutoresearchRootFilePath } from "./files.js";

export function appendIdeaBacklogEntry(cwd: string, idea: string): void {
  const normalized = idea.trim();
  if (!normalized) {
    return;
  }

  const ideasPath = getAutoresearchRootFilePath(cwd, "ideasBacklog");
  const prefix =
    fs.existsSync(ideasPath) && fs.readFileSync(ideasPath, "utf8").trim().length > 0 ? "\n" : "";
  fs.appendFileSync(ideasPath, `${prefix}- ${normalized}\n`);
}
