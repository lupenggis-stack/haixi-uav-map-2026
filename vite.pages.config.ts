import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  root: "pages-static",
  base: "/haixi-uav-map-2026/",
  publicDir: "../public",
  plugins: [react()],
  css: {
    postcss: "../postcss.config.mjs",
  },
  build: {
    outDir: "../pages-dist",
    emptyOutDir: true,
  },
});
