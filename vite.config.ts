import { defineConfig } from "vite";

export default defineConfig({
  root: "frontend",
  publicDir: "../static",
  clearScreen: false,
  server: { host: "127.0.0.1", port: 1420, strictPort: true },
  build: { rollupOptions: { input: { main: "frontend/index.html", splash: "frontend/splash.html" } }, outDir: "../dist", emptyOutDir: true, target: "es2022" },
});
