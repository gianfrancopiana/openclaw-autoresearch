import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const repoRoot = path.resolve(
  path.dirname(new URL(import.meta.url).pathname),
  "..",
);
const packageJsonPath = path.join(repoRoot, "package.json");
const extensionsDir = path.join(repoRoot, "extensions");
const expectedExtensionEntry = "./extensions/openclaw-autoresearch/index.ts";
const expectedExtensionDirs = ["openclaw-autoresearch"];

describe("repo wiring", () => {
  it("keeps the active OpenClaw extension entry aligned with the extensions tree", () => {
    const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, "utf8")) as {
      openclaw?: { extensions?: string[] };
    };
    const extensionDirs = fs
      .readdirSync(extensionsDir, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort();

    expect(packageJson.openclaw?.extensions).toEqual([expectedExtensionEntry]);
    expect(extensionDirs).toEqual(expectedExtensionDirs);
    expect(fs.existsSync(path.join(repoRoot, expectedExtensionEntry))).toBe(true);
  });
});
