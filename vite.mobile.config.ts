import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";

async function assetFiles(folder: string): Promise<string[]> {
  const files: string[] = [];
  for (const entry of await readdir(folder, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      for (const file of await assetFiles(path.join(folder, entry.name))) files.push(`${entry.name}/${file}`);
    } else if (entry.isFile()) files.push(entry.name);
  }
  return files.sort();
}

/** Include Vite's hashed entry chunks in the first installed offline shell. */
function precacheMobileShell() {
  let output: string;
  return {
    name: "precache-mobile-shell",
    configResolved(config: { root: string; build: { outDir: string } }) {
      output = path.resolve(config.root, config.build.outDir);
    },
    async closeBundle() {
      const worker = path.join(output, "sw.js");
      const source = await readFile(worker, "utf8");
      if (!source.includes("__MOBILE_PRECACHE__")) throw new Error("Mobile worker is missing its precache placeholder");
      const paths = ["/mobile/", ...(await assetFiles(output)).filter(file => file !== "sw.js").map(file => `/mobile/${file}`)];
      await writeFile(worker, source.replace("__MOBILE_PRECACHE__", JSON.stringify(paths)));
    },
  };
}

/** A separate asset tree keeps the desktop UI and its resources off the phone server. */
export default defineConfig({
  plugins: [react(), precacheMobileShell()],
  root: "frontend/mobile",
  publicDir: "public",
  base: "/mobile/",
  clearScreen: false,
  build: { outDir: "../../dist-mobile", emptyOutDir: true, target: "es2022" },
});
