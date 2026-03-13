import { describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  AUTORESEARCH_ROOT_FILES,
  getAutoresearchRootFilePath,
  readAutoresearchRootFile,
} from "../extensions/openclaw-autoresearch/src/files.js";

function createTempDir(prefix: string): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

describe("files helpers", () => {
  it("builds canonical repo-root paths", () => {
    const cwd = "/tmp/example-repo";

    expect(getAutoresearchRootFilePath(cwd, "sessionDoc")).toBe(
      "/tmp/example-repo/autoresearch.md",
    );
    expect(getAutoresearchRootFilePath(cwd, "runnerScript")).toBe(
      "/tmp/example-repo/autoresearch.sh",
    );
    expect(getAutoresearchRootFilePath(cwd, "resultsLog")).toBe(
      "/tmp/example-repo/autoresearch.jsonl",
    );
    expect(getAutoresearchRootFilePath(cwd, "ideasBacklog")).toBe(
      "/tmp/example-repo/autoresearch.ideas.md",
    );
  });

  it("reads an existing canonical root file", () => {
    const cwd = createTempDir("autoresearch-files-");
    const content = "# Autoresearch\n\nBaseline notes.\n";

    fs.writeFileSync(path.join(cwd, AUTORESEARCH_ROOT_FILES.sessionDoc), content);

    expect(readAutoresearchRootFile(cwd, "sessionDoc")).toBe(content);
  });

  it("returns null when a canonical root file is missing", () => {
    const cwd = createTempDir("autoresearch-files-missing-");

    expect(readAutoresearchRootFile(cwd, "resultsLog")).toBeNull();
  });
});
