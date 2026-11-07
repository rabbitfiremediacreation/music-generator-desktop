import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { fileURLToPath } from "node:url";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  root: "frontend",
  publicDir: "../static",
  clearScreen: false,
  server: { host: "127.0.0.1", port: 1420, strictPort: true },
  build: {
    rollupOptions: { input: {
      main: fileURLToPath(new URL("./frontend/index.html", import.meta.url)),
      splash: fileURLToPath(new URL("./frontend/splash.html", import.meta.url)),
    } },
    outDir: "../dist", emptyOutDir: true, target: "es2022",
  },
});
