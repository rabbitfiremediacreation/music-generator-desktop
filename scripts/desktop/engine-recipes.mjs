import { createHash } from "node:crypto";
import path from "node:path";
import titlePin from "../../models/title-model.json" with { type: "json" };
import { audioCppSupported, files, hash, manifest, root, shipsYue2, target } from "./native-build.mjs";

const scripts = (...names) => names.map(name => `scripts/desktop/${name}`);
const sandbox = "scripts/desktop/engine-sandbox.mm";
const plugin = scripts("macos-plugin.mjs", "macos-plugin-probe.cpp");

async function tree(directory) {
  return (await files(path.join(root, directory))).map(file => path.relative(root, file).split(path.sep).join("/"));
}

async function fingerprint(settings, inputs) {
  const digest = createHash("sha256").update(JSON.stringify(settings));
  for (const file of [...inputs, "scripts/desktop/native-build.mjs"].sort()) digest.update(JSON.stringify([file, await hash(path.join(root, file))]));
  return digest.digest("hex");
}

export async function titleRecipe({ platform, arch, minimumSystemVersion } = target) {
  const title = [...scripts("prepare-title.mjs"), ...await tree("scripts/desktop/title-runtime")];
  if (platform === "macos") title.push(sandbox);
  if (platform === "linux") title.push(...scripts("linux-runtime.mjs"));
  return fingerprint({ platform, arch, minimumSystemVersion, engine: titlePin.engine }, title);
}

// Hash the evaluated target flags so another backend's settings cannot invalidate this one.
export async function componentRecipes(build = target) {
  const { platform, arch, backend, cmake, minimumSystemVersion } = build;
  const host = { platform, arch, minimumSystemVersion };
  const source = manifest.engines[platform];
  const ace = scripts("prepare-ace.mjs", "engine-source.mjs", "engine-contract.mjs",
    "engine-generation-limits.h", "engine-registry-test.cpp", "registry-contract.mjs",
    "patches/acestep-title-registry.patch", `patches/${source.iterations_patch || "acestep-iterations.patch"}`);
  if (platform === "macos") ace.push(sandbox, ...scripts("ace-server-macos-main.cpp",
    "patches/acestep-macos-compat.patch", "patches/acestep-macos-plugin.patch"));
  if (platform === "windows") ace.push(...scripts("prepare-windows-engine.mjs", "windows-ggml-imports.cmake",
    "patches/acestep-windows-unicode.patch", "engine-windows-paths.h", "engine-windows-cli.cpp",
    "engine-windows-paths-test.cpp", "windows-unicode.mjs"));
  if (platform === "linux") ace.push(...scripts("linux-runtime.mjs"));
  if (backend === "vulkan") ace.push(...scripts("prepare-vulkan.sh"));
  if (backend === "cuda") ace.push("models/cuda-linux.json", ...scripts("prepare-cuda.mjs"));
  const recipes = {
    "ace-step": await fingerprint({ ...host, backend, cmake, source, registryTitle: titlePin.model.file }, ace),
    title: await titleRecipe(build),
  };
  if (shipsYue2(build)) recipes.yue2 = await fingerprint(host, ["models/yue2-runtime.json", sandbox,
    ...plugin, ...scripts("prepare-yue2.mjs", "macos-plugin-main.cpp")]);
  if (audioCppSupported(build)) recipes["audio-cpp"] = await fingerprint(host, ["models/audio-cpp-runtime.json",
    sandbox, ...plugin, ...scripts("prepare-audio-cpp.mjs", "prepare-audio-cpp-soxr.mjs", "audio-cpp-launcher.cpp", "audio-cpp-wav.h")]);
  if (platform === "macos" && arch === "arm64") recipes.pytorch = await fingerprint(host, [sandbox, ...plugin,
    ...scripts("prepare-pytorch.mjs", "prepare-stems.mjs", "prepare-text2midi.mjs", "embedded-python-plugin.cpp"),
    ...await tree("scripts/desktop/mimetic-runtime"), ...await tree("scripts/desktop/stems-runtime"),
    ...["text2midi.py", "decoder.py", "vocab_remi.json", "LICENSE.upstream", "LICENSE.vocab", "NOTICE"].map(name => `src-tauri/resources/text2midi/${name}`)]);
  return recipes;
}
