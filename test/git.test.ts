import { describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  commitKeptExperiment,
  revertTrackedChanges,
} from "../extensions/openclaw-autoresearch/src/git.js";

function createTempDir(prefix: string): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function runGit(cwd: string, args: readonly string[]): string {
  const result = spawnSync("git", [...args], {
    cwd,
    encoding: "utf8",
  });

  if (result.status !== 0) {
    throw new Error(result.stderr || result.stdout || `git ${args.join(" ")} failed`);
  }

  return result.stdout ?? "";
}

function createTempGitRepo(prefix: string): string {
  const cwd = createTempDir(prefix);

  runGit(cwd, ["init"]);
  runGit(cwd, ["config", "user.name", "Autoresearch Tests"]);
  runGit(cwd, ["config", "user.email", "autoresearch-tests@example.com"]);
  fs.writeFileSync(path.join(cwd, "tracked.txt"), "baseline\n");
  runGit(cwd, ["add", "tracked.txt"]);
  runGit(cwd, ["commit", "-m", "initial"]);

  return cwd;
}

describe("git helpers", () => {
  it("commits kept experiment changes in a temp git repo", () => {
    const cwd = createTempGitRepo("autoresearch-git-keep-");
    fs.writeFileSync(path.join(cwd, "tracked.txt"), "improved\n");

    const result = commitKeptExperiment({
      cwd,
      description: "Reduce parser runtime",
      metricName: "total_ms",
      metric: 118,
      metrics: { compile_ms: 44 },
      commit: "pending",
      status: "keep",
    });

    expect(result.attempted).toBe(true);
    expect(result.committed).toBe(true);
    expect(result.commit).toMatch(/^[0-9a-f]{7}$/);
    expect(result.summary).toContain("Git: committed -");
    expect(runGit(cwd, ["log", "-1", "--pretty=%B"])).toContain("Reduce parser runtime");
    expect(runGit(cwd, ["log", "-1", "--pretty=%B"])).toContain('"total_ms":118');
  });

  it("treats a clean tree as a no-op commit path", () => {
    const cwd = createTempGitRepo("autoresearch-git-clean-");

    const result = commitKeptExperiment({
      cwd,
      description: "No changes",
      metricName: "total_ms",
      metric: 120,
      metrics: {},
      commit: "abc1234",
      status: "keep",
    });

    expect(result).toMatchObject({
      attempted: true,
      committed: false,
      commit: "abc1234",
      summary: "Git: nothing to commit (working tree clean)",
    });
    expect(result.command.code).toBe(0);
  });

  it("reverts tracked working-tree changes in a temp git repo", () => {
    const cwd = createTempGitRepo("autoresearch-git-revert-");
    const trackedPath = path.join(cwd, "tracked.txt");

    fs.writeFileSync(trackedPath, "modified\n");

    const result = revertTrackedChanges(cwd);

    expect(result).toMatchObject({
      attempted: true,
      reverted: true,
      summary: "Git: reverted tracked changes with git checkout -- .",
    });
    expect(fs.readFileSync(trackedPath, "utf8")).toBe("baseline\n");
  });
});
