import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: { port: 5174, strictPort: true, cors: true },
  build: { outDir: "dist", emptyOutDir: true, sourcemap: false, target: "es2022" },
  // Relative asset paths are MANDATORY for Nexus apps. The published
  // bundle is served at <apps-service>/apps/bundles/<app>/<version>/...
  // and the iframe loads index.html from there. Vite's default base="/"
  // would emit <script src="/assets/..."> which the browser resolves
  // against the iframe origin (app.maic.ai), not the bundle path —
  // returning 404 from the SPA's fallback. base: "./" emits relative
  // paths that resolve correctly under the bundle URL.
  base: "./",
});
