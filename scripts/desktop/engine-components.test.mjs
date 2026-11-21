import { test } from "node:test";
import assert from "node:assert/strict";
import { appendFile, cp, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { manifest, recordHashes, root } from "./common.mjs";
import { componentRecipes } from "./engine-recipes.mjs";
import { removeChangedComponents, reusableComponents } from "./engine-components.mjs";
import { desktopTarget } from "./targets.mjs";

const cuda = desktopTarget("linux", "x64", "cuda");

test("changing CUDA compilation flags invalidates only ACE-Step", async () => {
  const recipes = await componentRecipes(cuda);
  const changed = await componentRecipes({ ...cuda, cmake: [...cuda.cmake, "-DGGML_CUDA_F16=ON"] });
  assert.notEqual(changed["ace-step"], recipes["ace-step"]);
  assert.equal(changed.title, recipes.title);
  assert.deepEqual(Object.keys(recipes).sort(), ["ace-step", "title"]);
});

test("title and PyTorch source edits invalidate exactly their own components", async t => {
  const checkout = await mkdtemp(path.join(tmpdir(), "engine-recipes-"));
  t.after(() => rm(checkout, { recursive: true, force: true }));
  for (const input of ["models", "scripts/desktop", "src-tauri/resources/text2midi"]) {
    await cp(path.join(root, input), path.join(checkout, input), { recursive: true });
  }
  const { componentRecipes: recipes } = await import(pathToFileURL(path.join(checkout, "scripts/desktop/engine-recipes.mjs")));
  const mac = desktopTarget("macos", "arm64");
  const before = await recipes(mac);
  const cudaBefore = await recipes(cuda);
  await appendFile(path.join(checkout, "scripts/desktop/stems-runtime/runner.py"), "\n# changed\n");
  const stems = await recipes(mac);
  assert.notEqual(stems.pytorch, before.pytorch);
  assert.deepEqual(stems, { ...before, pytorch: stems.pytorch });
  assert.deepEqual(await recipes(cuda), cudaBefore);
  await appendFile(path.join(checkout, "scripts/desktop/title-runtime/title.cpp"), "\n// changed\n");
  const title = await recipes(cuda);
  assert.notEqual(title.title, cudaBefore.title);
  assert.equal(title["ace-step"], cudaBefore["ace-step"]);
});

test("a partial restore keeps the CUDA binary and removes the stale title helper", async t => {
  const folder = await mkdtemp(path.join(tmpdir(), "partial-cuda-"));
  t.after(() => rm(folder, { recursive: true, force: true }));
  const components = await componentRecipes(cuda);
  const metadata = { ...cuda, max_inference_steps: manifest.engines.linux.max_inference_steps, components };
  await mkdir(path.join(folder, "title"));
  await writeFile(path.join(folder, "ace-server"), "compiled ACE");
  await writeFile(path.join(folder, "title/music-title"), "compiled title helper");
  await recordHashes(folder, metadata);
  const previous = JSON.parse(await readFile(path.join(folder, "VERSION.desktop.json"), "utf8"));
  const keep = recipes => reusableComponents(folder, recipes, previous, cuda);
  assert.deepEqual(await keep(components), new Set(["ace-step", "title"]));
  const stale = await keep({ ...components, title: "changed" });
  assert.deepEqual(stale, new Set(["ace-step"]));
  await removeChangedComponents(folder, stale);
  await assert.rejects(readFile(path.join(folder, "title/music-title")), { code: "ENOENT" });
  assert.equal(await readFile(path.join(folder, "ace-server"), "utf8"), "compiled ACE");
  assert.deepEqual(await keep(components), stale);
  await writeFile(path.join(folder, "untracked.so"), "extra library");
  assert.deepEqual(await keep(components), new Set());
  await rm(path.join(folder, "untracked.so"));
  await writeFile(path.join(folder, "ace-server"), "damaged");
  assert.deepEqual(await keep(components), new Set());
});

test("a PyTorch recipe change preserves the other Apple Silicon engines", async t => {
  const build = desktopTarget("macos", "arm64");
  const folder = await mkdtemp(path.join(tmpdir(), "partial-engines-"));
  t.after(() => rm(folder, { recursive: true, force: true }));
  for (const name of ["ace-server", "mimetic-synth", "pytorch/library", "text2midi/runner",
    "LICENSE-yue2.cpp", "yue2/yue-plan", "providers/audio.cpp/audiocpp_cli", "title/music-title"]) {
    const file = path.join(folder, name);
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, "built");
  }
  const recipes = await componentRecipes(build);
  await recordHashes(folder, { ...build, max_inference_steps: manifest.engines.macos.max_inference_steps, components: recipes });
  const previous = JSON.parse(await readFile(path.join(folder, "VERSION.desktop.json"), "utf8"));
  const keep = await reusableComponents(folder, { ...recipes, pytorch: "updated" }, previous, build);
  assert.deepEqual(keep, new Set(["ace-step", "audio-cpp", "title", "yue2"]));
  await removeChangedComponents(folder, keep);
  for (const file of ["mimetic-synth", "pytorch/library", "text2midi/runner"]) {
    await assert.rejects(readFile(path.join(folder, file)), { code: "ENOENT" });
  }
  assert.deepEqual(await reusableComponents(folder, recipes, { ...previous, components: undefined }, build), new Set());
});
