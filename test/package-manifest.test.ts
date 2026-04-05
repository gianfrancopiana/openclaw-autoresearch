import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

type PackageManifest = {
  openclawRuntime?: unknown;
  openclaw?: {
    extensions?: unknown;
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

function readPackageManifest(): PackageManifest {
  return JSON.parse(readFileSync(resolve(process.cwd(), "package.json"), "utf8")) as PackageManifest;
}

describe("package manifest contract", () => {
  it("uses supported OpenClaw metadata instead of the removed openclawRuntime hint", () => {
    const manifest = readPackageManifest();

    expect(manifest.openclawRuntime).toBeUndefined();
    expect(manifest.openclaw?.extensions).toEqual(["./index.ts"]);
    expect(manifest.openclaw?.install?.minHostVersion).toBe(">=2026.3.13");
    expect(manifest.openclaw?.compat?.pluginApi).toBe(">=2026.3.13");
    expect(manifest.openclaw?.build?.openclawVersion).toBe("2026.3.13");
  });
});
