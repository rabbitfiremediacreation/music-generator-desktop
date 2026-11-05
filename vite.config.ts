import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  root: "frontend",
  publicDir: "../static",
  clearScreen: false,
  server: { host: "127.0.0.1", port: 1420, strictPort: true },
  build: { rollupOptions: { input: { main: "frontend/index.html", splash: "frontend/splash.html" } }, outDir: "../dist", emptyOutDir: true, target: "es2022" },
});
