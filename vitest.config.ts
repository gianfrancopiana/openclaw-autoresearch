import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

const rootDir = fileURLToPath(new URL(".", import.meta.url));
const shimPath = fileURLToPath(
  new URL("./test/shims/openclaw-plugin-sdk-core.ts", import.meta.url),
);

export default defineConfig({
  resolve: {
    alias: {
      "openclaw/plugin-sdk": shimPath,
    },
  },
  test: {
    environment: "node",
    include: ["test/**/*.test.ts"],
    root: rootDir,
  },
});
