import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  test: {
    environment: "jsdom",
    setupFiles: ["./vitest.setup.ts"],
    css: true,
    coverage: { reporter: ["text", "html"] },
  },
  resolve: {
    alias: { "@": path.resolve(__dirname, "./src") },
  },
});
