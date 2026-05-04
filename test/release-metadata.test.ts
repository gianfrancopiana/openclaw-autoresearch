import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

type PackageManifest = {
  version?: unknown;
  description?: unknown;
  keywords?: unknown;
  peerDependencies?: Record<string, unknown>;
  peerDependenciesMeta?: Record<string, { optional?: unknown }>;
  openclaw?: {
    extensions?: unknown;
    runtimeExtensions?: unknown;
    install?: {
      minHostVersion?: unknown;
    };
    compat?: {
      pluginApi?: unknown;
    };
    build?: {
      openclawVersion?: unknown;
    };
  };
};

type PluginManifest = {
  version?: unknown;
  description?: unknown;
  skills?: unknown;
  contracts?: {
    tools?: unknown;
  };
};

function readJsonFile<T>(fileName: string): T {
  return JSON.parse(readFileSync(resolve(process.cwd(), fileName), "utf8")) as T;
}

describe("release metadata contract", () => {
  it("keeps package and plugin manifest metadata aligned", () => {
    const pkg = readJsonFile<PackageManifest>("package.json");
    const manifest = readJsonFile<PluginManifest>("openclaw.plugin.json");
    const buildVersion = pkg.openclaw?.build?.openclawVersion;

    expect(typeof pkg.version).toBe("string");
    expect(manifest.version).toBe(pkg.version);
    expect(manifest.description).toBe(pkg.description);
    expect(buildVersion).toBe("2026.4.24");
    expect(pkg.openclaw?.extensions).toEqual(["./index.ts"]);
    expect(pkg.openclaw?.runtimeExtensions).toEqual(["./dist/index.js"]);
    expect(pkg.openclaw?.install?.minHostVersion).toBe(`>=${buildVersion}`);
    expect(pkg.openclaw?.compat?.pluginApi).toBe(`>=${buildVersion}`);
    expect(pkg.peerDependencies?.openclaw).toBe(`>=${buildVersion}`);
    expect(pkg.peerDependenciesMeta?.openclaw?.optional).toBe(true);
  });

  it("publishes discovery metadata for the OpenClaw ecosystem", () => {
    const pkg = readJsonFile<PackageManifest>("package.json");
    const manifest = readJsonFile<PluginManifest>("openclaw.plugin.json");

    expect(pkg.keywords).toEqual(
      expect.arrayContaining([
        "openclaw",
        "openclaw-plugin",
        "autoresearch",
        "benchmarking",
        "optimization",
        "experimentation",
      ]),
    );
    expect(manifest.skills).toEqual(["./skills"]);
    expect(manifest.contracts?.tools).toEqual([
      "init_experiment",
      "run_experiment",
      "log_experiment",
      "autoresearch_status",
    ]);
  });
});
