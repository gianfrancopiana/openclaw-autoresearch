import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

type PackageManifest = {
  openclawRuntime?: unknown;
  main?: unknown;
  types?: unknown;
  exports?: unknown;
  files?: unknown;
  scripts?: Record<string, unknown>;
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

function readPackageManifest(): PackageManifest {
  return JSON.parse(readFileSync(resolve(process.cwd(), "package.json"), "utf8")) as PackageManifest;
}

describe("package manifest contract", () => {
  it("uses supported OpenClaw metadata instead of the removed openclawRuntime hint", () => {
    const manifest = readPackageManifest();

    expect(manifest.openclawRuntime).toBeUndefined();
    expect(manifest.openclaw?.extensions).toEqual(["./index.ts"]);
    expect(manifest.openclaw?.runtimeExtensions).toEqual(["./dist/index.js"]);
    expect(manifest.openclaw?.install?.minHostVersion).toBe(">=2026.4.24");
    expect(manifest.openclaw?.compat?.pluginApi).toBe(">=2026.4.24");
    expect(manifest.openclaw?.build?.openclawVersion).toBe("2026.4.24");
  });

  it("publishes compiled runtime entrypoints and type declarations", () => {
    const manifest = readPackageManifest();

    expect(manifest.main).toBe("./dist/index.js");
    expect(manifest.types).toBe("./dist/index.d.ts");
    expect(manifest.exports).toEqual({
      ".": {
        types: "./dist/index.d.ts",
        import: "./dist/index.js",
        default: "./dist/index.js",
      },
    });
    expect(manifest.files).toEqual(
      expect.arrayContaining([
        "dist/",
        "openclaw.plugin.json",
        "skills/",
        "docs/",
        "README.md",
        "RELEASING.md",
        "LICENSE",
      ]),
    );
  });

  it("builds compiled output before release verification and publishing", () => {
    const manifest = readPackageManifest();

    expect(manifest.scripts?.build).toBe("node ./scripts/clean-dist.mjs && tsc -p tsconfig.build.json");
    expect(manifest.scripts?.prepack).toBe("npm run build");
    expect(manifest.scripts?.["release:verify"]).toBe(
      "npm run validate && npm run build && npm pack --dry-run",
    );
    expect(manifest.scripts?.prepublishOnly).toBe("npm run release:verify");
    expect(existsSync(resolve(process.cwd(), "scripts/clean-dist.mjs"))).toBe(true);
    expect(existsSync(resolve(process.cwd(), "tsconfig.build.json"))).toBe(true);
    expect(existsSync(resolve(process.cwd(), "types/openclaw-plugin-sdk-core.d.ts"))).toBe(true);
  });

  it("provides a registry tarball smoke command", () => {
    const manifest = readPackageManifest();

    expect(manifest.scripts?.["smoke:registry-openclaw-host"]).toBe(
      "node ./scripts/smoke-openclaw-registry.mjs",
    );
    expect(existsSync(resolve(process.cwd(), "scripts/smoke-openclaw-registry.mjs"))).toBe(true);
  });

  it("aligns the npm peer dependency with the supported OpenClaw host range", () => {
    const manifest = readPackageManifest();

    expect(manifest.peerDependencies?.openclaw).toBe(">=2026.4.24");
    expect(manifest.peerDependenciesMeta?.openclaw?.optional).toBe(true);
  });
});
