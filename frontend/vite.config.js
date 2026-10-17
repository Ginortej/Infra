import { defineConfig } from "vite";
export default defineConfig({
  build: { outDir: "dist", emptyOutDir: true, target: "es2021", chunkSizeWarningLimit: 1000 },
});
