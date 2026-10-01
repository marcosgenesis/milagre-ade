import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  root: "app",
  // Packaged builds load dist/index.html over file://, so asset URLs must be relative.
  base: "./",
  plugins: [react()],
  resolve: {
    alias: {
      "@": resolve(projectRoot, "app/src"),
    },
  },
  build: {
    outDir: "../dist",
    emptyOutDir: true,
  },
});
