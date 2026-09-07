import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  test: { include: ["src/**/*.test.ts"] },
  resolve: {
    alias: {
      "@district/shared": path.resolve(__dirname, "../../packages/shared/src/index.ts"),
    },
  },
});
