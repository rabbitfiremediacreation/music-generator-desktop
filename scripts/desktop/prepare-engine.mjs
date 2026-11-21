import { mkdir, mkdtemp, readFile, readdir, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { prepareTitle, verifyTitle } from "./prepare-title.mjs";
import { prepareAudioCpp } from "./prepare-audio-cpp.mjs";
import { prepareYue2 } from "./prepare-yue2.mjs";
import yue2 from "../../models/yue2-runtime.json" with { type: "json" };
import { preparePyTorch } from "./prepare-pytorch.mjs";
import { prepareMagenta, verifyMagenta } from "./prepare-magenta.mjs";
import { prepareAce } from "./prepare-ace.mjs";
import { componentRecipes } from "./engine-recipes.mjs";
import { reusableComponents, removeChangedComponents } from "./engine-components.mjs";
import { architecture, engineRecipeHash, hash, manifest, platform, recordHashes, root, target, verifyEngine } from "./common.mjs";

export const engineFolder = path.join(root, "src-tauri/resources/engine");

export async function prepareEngine() {
  const magenta = process.env.MUSIC_GENERATOR_MAGENTA === "1";
  if (magenta && (platform !== "macos" || architecture !== "arm64")) {
    throw new Error("Magenta RealTime 2 requires an Apple Silicon build host");
  }
  const validTitle = await verifyTitle().then(() => true, () => false);
  const validMagenta = magenta && await verifyMagenta().then(() => true, () => false);
  const existing = await verifyEngine(engineFolder).catch(() => undefined);
  if (existing && validTitle && magenta === Boolean(existing.files["magenta/mrt2-record"]) && (!magenta || validMagenta)) {
    console.log("Engine resources verified.");
    return existing;
  }

  const source = manifest.engines[platform];
  const recipes = await componentRecipes();
  const previous = existing ?? await readFile(path.join(engineFolder, "VERSION.desktop.json"), "utf8").then(JSON.parse).catch(() => undefined);
  const reusable = await reusableComponents(engineFolder, recipes, previous);
  if (!validTitle) reusable.delete("title");
  if (validMagenta) reusable.add("magenta");
  const cache = path.join(root, ".cache/desktop");
  await mkdir(cache, { recursive: true });
  await mkdir(engineFolder, { recursive: true });
  await removeChangedComponents(engineFolder, reusable);
  await writeFile(path.join(engineFolder, ".gitkeep"), "");
  const work = await mkdtemp(path.join(tmpdir(), "music-engine-"));
  try {
    let iterationLimit = previous?.max_inference_steps;
    if (!reusable.has("ace-step")) {
      // Relocate ACE in isolation so the tools cannot modify verified sibling engines.
      const stage = await mkdtemp(path.join(path.dirname(engineFolder), ".ace-"));
      try {
        iterationLimit = await prepareAce(stage, cache, work);
        for (const entry of await readdir(stage)) await rename(path.join(stage, entry), path.join(engineFolder, entry));
      } finally { await rm(stage, { recursive: true, force: true }); }
    }
    if (!reusable.has("title")) await prepareTitle();
    if (recipes.yue2 && !reusable.has("yue2")) await prepareYue2(engineFolder, work);
    if (recipes["audio-cpp"] && !reusable.has("audio-cpp")) await prepareAudioCpp(engineFolder, cache, work);
    if (recipes.pytorch && !reusable.has("pytorch")) await preparePyTorch(engineFolder);
    if (magenta && !validMagenta) {
      await prepareMagenta();
      await verifyMagenta();
    }
    await recordHashes(engineFolder, {
      platform, arch: architecture, backend: target.backend, revision: source.revision,
      source: source.url || source.repository, source_revision: source.source_revision || source.revision,
      archive_sha256: source.sha256 || null, max_inference_steps: iterationLimit,
      sandbox_patch_sha256: platform === "macos" ? await hash(path.join(root, "scripts/desktop/engine-sandbox.mm")) : null,
      recipe_sha256: await engineRecipeHash(target, recipes), components: recipes,
      ...(recipes.yue2 && { yue2_revision: yue2.revision, yue2_ggml_revision: yue2.ggml_revision }),
    });
    const prepared = await verifyEngine(engineFolder);
    console.log(`Prepared ${platform} engine ${source.revision}. Reused components: ${[...reusable].join(", ") || "none"}.`);
    return prepared;
  } finally { await rm(work, { recursive: true, force: true }); }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await prepareEngine();
