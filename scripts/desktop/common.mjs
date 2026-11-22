import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import yue2 from "../../models/yue2-runtime.json" with { type: "json" };
import { componentRecipes } from "./engine-recipes.mjs";
import { aceMacPlugin, audioCppDirectory, audioCppRuntime, audioCppSupported, files, hash, manifest, root, shipsYue2, target } from "./native-build.mjs";

export * from "./native-build.mjs";

export async function recordHashes(folder, metadata) {
  const sums = {};
  for (const file of await files(folder)) if (path.basename(file) !== "VERSION.desktop.json") sums[path.relative(folder, file).split(path.sep).join("/")] = await hash(file);
  await writeFile(path.join(folder, "VERSION.desktop.json"), JSON.stringify({ ...metadata, files: sums }, null, 2) + "\n");
}

export async function engineRecipeHash(buildTarget = target, components) {
  const recipes = components ?? await componentRecipes(buildTarget);
  const digest = createHash("sha256").update(JSON.stringify(recipes));
  for (const file of ["prepare-engine.mjs", "common.mjs", "engine-components.mjs"]) {
    digest.update(await hash(path.join(root, "scripts/desktop", file)));
  }
  return digest.digest("hex");
}

export async function verifyEngine(folder, buildTarget = target) {
  const buildPlatform = buildTarget.platform;
  const provenance = JSON.parse(await readFile(path.join(folder, "VERSION.desktop.json"), "utf8"));
  if (provenance.platform !== buildPlatform || provenance.arch !== buildTarget.arch || provenance.revision !== manifest.engines[buildPlatform].revision) throw new Error("Engine belongs to a different platform or revision");
  if (provenance.max_inference_steps !== manifest.engines[buildPlatform].max_inference_steps) throw new Error("Engine iteration limit requires rebuilding");
  if (buildPlatform === "macos" && provenance.sandbox_patch_sha256 !== await hash(path.join(root,"scripts/desktop/engine-sandbox.mm"))) throw new Error("Engine sandbox bridge needs rebuilding");
  if (buildPlatform === "linux" && provenance.backend !== buildTarget.backend) throw new Error("Engine Linux backend changed");
  const components = await componentRecipes(buildTarget);
  if (provenance.recipe_sha256 !== await engineRecipeHash(buildTarget, components) ||
      Object.entries(components).some(([id, recipe]) => provenance.components?.[id] !== recipe)) {
    throw new Error("Engine build recipe changed");
  }
  const executable = buildPlatform === "windows" ? "ace-server.exe" : "ace-server";
  if (!provenance.files[executable]) throw new Error("Engine executable is missing from checksums");
  if (buildPlatform === "macos" && !provenance.files[aceMacPlugin]) {
    throw new Error("ACE-Step plug-in is missing from checksums");
  }
  if (components.magenta && !["mrt2-record", "mlx.metallib", "MAGENTA_RUNTIME.json"]
    .every(file => provenance.files[`magenta/${file}`])) {
    throw new Error("Magenta runtime is missing from checksums");
  }
  if (shipsYue2(buildTarget)) {
    const { yue2_revision, yue2_ggml_revision } = provenance;
    if (yue2_revision !== yue2.revision || yue2_ggml_revision !== yue2.ggml_revision || !provenance.files[yue2.executable]) {
      throw new Error("YuE2 runner is missing or has a different revision");
    }
    if (!provenance.files[yue2.planner]) throw new Error("YuE2 instrumental planner is missing");
    const yue2Folder = path.posix.dirname(yue2.executable);
    if (yue2Folder === "." || Object.keys(provenance.files).some(file =>
      path.posix.dirname(file) === yue2Folder && /^libggml-.*\.so$/.test(path.posix.basename(file))
    )) {
      throw new Error("YuE2 must be isolated from dynamic GGML backends");
    }
  }
  if (buildPlatform === "macos" && buildTarget.arch === "arm64" && (!provenance.files["mimetic-synth"] || !provenance.files["pytorch/PYTORCH_RUNTIME.json"])) throw new Error("The shared PyTorch runtime is missing from checksums");
  if (buildPlatform === "macos" && buildTarget.arch === "arm64" && !provenance.files["text2midi/text2midi-runner"]) {
    throw new Error("Text2midi plug-in is missing from checksums");
  }
  if (buildPlatform === "macos" && buildTarget.arch === "arm64" &&
    (!provenance.files["pytorch/stem-runner"] || !provenance.files["pytorch/stem_runner.py"])) {
    throw new Error("The Demucs plug-in is missing from checksums");
  }
  if (Object.keys(provenance.files).some(file => file.startsWith("heartmula/"))) throw new Error("Retired provider resources must be removed");
  const providerFiles = Object.keys(provenance.files).filter(file => file.startsWith(`${audioCppDirectory}/`)).sort();
  const expectedProviderFiles = audioCppSupported(buildTarget)
    ? [
      "LICENSE", "LICENSE.soxr", "audiocpp_cli", "libaudiocpp.0.dylib", "libsoxr.dylib",
      "soxr-0.1.3-Source.tar.xz", ...audioCppRuntime.model_specs.map(spec => spec.path),
    ].map(file => `${audioCppDirectory}/${file}`).sort()
    : [];
  if (JSON.stringify(providerFiles) !== JSON.stringify(expectedProviderFiles)) throw new Error("Unexpected audio.cpp runtime inventory");
  const actual = (await files(folder)).filter(file => path.basename(file) !== "VERSION.desktop.json").map(file => path.relative(folder, file).split(path.sep).join("/")).sort();
  if (JSON.stringify(actual) !== JSON.stringify(Object.keys(provenance.files).sort())) throw new Error("Engine resource inventory changed");
  for (const [file, checksum] of Object.entries(provenance.files)) {
    if (file.split("/").includes("..") || path.isAbsolute(file) || await hash(path.join(folder, file)) !== checksum) throw new Error(`Engine resource failed verification: ${file}`);
  }
  return provenance;
}
