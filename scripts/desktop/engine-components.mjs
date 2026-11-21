import path from "node:path";
import { readdir, rm } from "node:fs/promises";
import { files, hash, manifest, target } from "./native-build.mjs";

function componentOf(relative) {
  const [entry] = relative.split("/");
  if (entry === ".gitkeep" || entry === "VERSION.desktop.json") return undefined;
  if (entry === "title" || entry === "magenta") return entry;
  if (entry === "yue2" || entry.startsWith("LICENSE-yue2")) return "yue2";
  if (entry === "providers") return "audio-cpp";
  if (["pytorch", "mimetic-synth", "text2midi"].includes(entry)) return "pytorch";
  return "ace-step";
}

// Keep a component only when its recipe, full inventory and file checksums still match.
export async function reusableComponents(folder, recipes, previous, build = target) {
  if (!previous?.files || previous.platform !== build.platform || previous.arch !== build.arch) return new Set();
  const expected = new Set(Object.keys(previous.files));
  const recorded = new Set([...expected].map(componentOf));
  const reusable = new Set(Object.keys(recipes).filter(id => recorded.has(id) && previous.components?.[id] === recipes[id]));
  if (previous.backend !== build.backend || previous.max_inference_steps !== manifest.engines[build.platform].max_inference_steps) {
    reusable.delete("ace-step");
  }
  if (!reusable.size) return reusable;
  // A broken symlink in a restored archive can make even the inventory unreadable.
  const inventory = await files(folder).catch(error => {
    if (error.code === "ENOENT" || error.code === "ENOTDIR") return undefined;
    throw error;
  });
  if (!inventory) return new Set();
  for (const file of inventory) {
    const relative = path.relative(folder, file).split(path.sep).join("/");
    const id = componentOf(relative);
    if (reusable.has(id) && (!expected.has(relative) || await hash(file) !== previous.files[relative])) reusable.delete(id);
    expected.delete(relative);
  }
  for (const missing of expected) reusable.delete(componentOf(missing));
  return reusable;
}

export async function removeChangedComponents(folder, reusable) {
  for (const entry of await readdir(folder)) {
    const id = componentOf(entry);
    if (id && !reusable.has(id)) await rm(path.join(folder, entry), { recursive: true, force: true });
  }
}
