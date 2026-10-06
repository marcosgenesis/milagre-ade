import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import { SIMULATOR_RECEIVER_SCRIPT } from "@milagre/shared/simulator-receiver";

const projectRoot = dirname(fileURLToPath(import.meta.url));

// The packaged renderer shows agent output, so no script may run unless it ships with the app. Images also come from
// the media protocol and GitHub avatars. Dev keeps Vite's inline client and HMR socket, so this applies to builds only.
const CSP = [
  "default-src 'self'",
  // The simulator iframe embeds this exact bundled receiver, with data kept outside its executable script.
  `script-src 'self' 'sha256-${createHash("sha256").update(SIMULATOR_RECEIVER_SCRIPT).digest("base64")}'`,
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob: milagre-media: https:",
  "media-src 'self' blob: milagre-media:",
  "font-src 'self' data:",
  "connect-src 'self'",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
  "frame-src 'self'",
].join("; ");
const contentSecurityPolicy = {
  name: "milagre-csp",
  apply: "build" as const,
  transformIndexHtml: () => [{ tag: "meta", attrs: { "http-equiv": "Content-Security-Policy", content: CSP }, injectTo: "head-prepend" as const }],
};

export default defineConfig({
  root: resolve(projectRoot, "app"),
  // Packaged builds load dist/index.html over file://, so asset URLs must be relative.
  base: "./",
  plugins: [react(), contentSecurityPolicy],
  resolve: {
    alias: {
      "@": resolve(projectRoot, "app/src"),
    },
  },
  build: {
    outDir: resolve(projectRoot, "dist"),
    emptyOutDir: true,
    // Chunks load from disk in Electron, so size matters less than on the web. The largest are the app itself and Shiki's C++ grammar.
    chunkSizeWarningLimit: 1000,
  },
});
