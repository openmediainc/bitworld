import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "node:path";

export default defineConfig({
  plugins: [react()],
  base: process.env.DISTRICT_BASE || "/",
  resolve: {
    alias: {
      "@district/shared": path.resolve(__dirname, "../../packages/shared/src/index.ts"),
    },
  },
  build: {
    // The Phaser chunk alone is ~1.5 MB and cannot be split further, so warn
    // only above it. App code stays in its own much smaller chunk.
    chunkSizeWarningLimit: 1600,
    rollupOptions: {
      output: {
        manualChunks: {
          // Phaser is the bulk of the bundle and changes far less often than app code.
          phaser: ["phaser"],
        },
      },
    },
  },
  server: {
    host: "127.0.0.1",
    port: 5173,
    strictPort: true,
    proxy: {
      "/api": "http://127.0.0.1:4242",
      "/b": "http://127.0.0.1:4242",
      "/rules": "http://127.0.0.1:4242",
      "/health": "http://127.0.0.1:4242",
    },
  },
});
