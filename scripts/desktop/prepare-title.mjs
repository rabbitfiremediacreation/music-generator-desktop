import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { architecture, download, exists, files, hash, platform, root, run, target } from "./common.mjs";

const pin = JSON.parse(await readFile(path.join(root, "models/title-model.json"), "utf8"));
export const titleFolder = path.join(root, "src-tauri/resources/engine/title");
const exe = platform === "windows" ? "music-title.exe" : "music-title";
async function recipe() {
  const sources = [fileURLToPath(import.meta.url), "scripts/desktop/targets.mjs", "scripts/desktop/title-runtime/CMakeLists.txt", "scripts/desktop/title-runtime/title.cpp", "scripts/desktop/engine-sandbox.mm", "src-tauri/Engine.entitlements"];
  return (await Promise.all(sources.map(file => hash(path.isAbsolute(file) ? file : path.join(root, file))))).join(":");
}
export async function verifyTitle(folder = titleFolder, checkRecipe = true) {
  const proof = JSON.parse(await readFile(path.join(folder, "TITLE_RUNTIME.json"), "utf8"));
  if (proof.revision !== pin.engine.revision || proof.platform !== platform || proof.arch !== architecture || !proof.files[exe]) throw Error("Title runtime target/revision mismatch");
  if (checkRecipe && proof.recipe !== await recipe()) throw Error("Title build recipe changed");
  for (const [file, checksum] of Object.entries(proof.files)) {
    if (file.split("/").includes("..") || path.isAbsolute(file) || await hash(path.join(folder, file)) !== checksum) throw Error(`Title resource mismatch: ${file}`);
  }
  return proof;
}
export async function recordTitle(folder = titleFolder) {
  const sums = {};
  for (const file of await files(folder)) if (path.basename(file) !== "TITLE_RUNTIME.json") sums[path.relative(folder, file).split(path.sep).join("/")] = await hash(file);
  await writeFile(path.join(folder, "TITLE_RUNTIME.json"), JSON.stringify({ revision: pin.engine.revision, platform, arch: architecture, recipe: await recipe(), files: sums }, null, 2) + "\n");
}
export async function prepareTitle() {
  try { await verifyTitle(); return; } catch { /* Build pinned native CPU runtime. */ }
  const cache = path.join(root, ".cache/desktop/title", pin.engine.revision);
  const source = path.join(cache, "source"), build = path.join(cache, "build");
  await mkdir(cache, { recursive: true });
  const archive = path.join(cache, "source.tar.gz");
  await download(pin.engine.source_url, archive, pin.engine.sha256);
  if (!await exists(path.join(source, "CMakeLists.txt"))) {
    await mkdir(source, { recursive: true });
    await run(platform === "windows" ? "tar.exe" : "tar", ["-xf", archive, "-C", source, "--strip-components=1"]);
  }
  const options = ["-DCMAKE_BUILD_TYPE=Release", `-DLLAMA_SOURCE=${source}`, `-DSANDBOX_BRIDGE=${path.join(root, "scripts/desktop/engine-sandbox.mm")}`];
  if (platform === "macos") options.push(...target.titleCmake);
  await run("cmake", ["-S", path.join(root, "scripts/desktop/title-runtime"), "-B", build, ...options]);
  await run("cmake", ["--build", build, "--config", "Release", "--target", "music-title", "--parallel", "2"]);
  await rm(titleFolder, { recursive: true, force: true }); await mkdir(titleFolder, { recursive: true });
  await cp(path.join(build, "bin", exe), path.join(titleFolder, exe));
  await cp(path.join(source, "LICENSE"), path.join(titleFolder, "LICENSE-llama.cpp"));
  await cp(path.join(source, "licenses/LICENSE-jsonhpp"), path.join(titleFolder, "LICENSE-nlohmann-json.txt"));
  if (platform === "macos") await run("codesign", ["--force", "--sign", "-", "--entitlements", path.join(root, "src-tauri/Engine.entitlements"), path.join(titleFolder, exe)]);
  await recordTitle(); await verifyTitle();
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await prepareTitle();
