import { defineConfig } from "astro/config";

export default defineConfig({
  site: "https://milagre.cloud",
  output: "static",
  trailingSlash: "ignore",
  build: { format: "directory" },
});
