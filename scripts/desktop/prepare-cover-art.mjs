import { mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pin from "../../models/cover-art.json" with { type: "json" };
import { architecture, download, platform, root, run } from "./native-build.mjs";

/** Stage the pinned CLI, its adjacent dylib and their notices for the macOS app. */
export async function prepareMacCoverArt(destination = path.join(root, "src-tauri/resources/cover-art")) {
  if (platform !== "macos") return;
  const engine = pin.engines.macos;
  const archive = path.join(root, ".cache/desktop/cover-art", engine.file);
  await download(`https://github.com/leejet/stable-diffusion.cpp/releases/download/${pin.engine_version}/${engine.file}`, archive, engine.sha256);
  await mkdir(destination, { recursive: true });
  const binaries = ["libstable-diffusion.dylib", "sd-cli"];
  await run("unzip", ["-oq", archive, ...binaries, "*.txt", "-d", destination]);
  for (const name of binaries) {
    const file = path.join(destination, name);
    await run("lipo", [file, "-thin", architecture === "arm64" ? "arm64" : "x86_64", "-output", file]);
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await prepareMacCoverArt();
