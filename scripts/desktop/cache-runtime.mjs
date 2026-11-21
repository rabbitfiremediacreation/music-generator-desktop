import { appendFile, cp, mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { createWriteStream } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { fileURLToPath } from "node:url";
import { architecture, engineRecipeHash, exists, hash, platform, root, run, target, verifyEngine } from "./common.mjs";
import { componentRecipes } from "./engine-recipes.mjs";
import { reusableComponents } from "./engine-components.mjs";
import { prepareEngine, engineFolder } from "./prepare-engine.mjs";
import { prepareWebView } from "./prepare-webview.mjs";
import { verifyTitle } from "./prepare-title.mjs";

const resources = path.join(root, "src-tauri/resources");
const tar = platform === "windows" ? "tar.exe" : "tar";

// A partial restore must have a compatible runner, backend and fixed WebView2 installation.
export async function runtimeCachePrefix(buildTarget = target) {
  const parts = ["desktop-runtime-v3", process.env.DESKTOP_RUNNER || "local", buildTarget.platform, buildTarget.arch, buildTarget.backend || "native"];
  if (buildTarget.platform === "windows") {
    for (const file of ["models/webview2.json", "scripts/desktop/prepare-webview.mjs"]) parts.push(await hash(path.join(root, file)));
  }
  return parts.join("-") + "-";
}

export async function runtimeCacheKey(buildTarget = target) {
  return await runtimeCachePrefix(buildTarget) + await engineRecipeHash(buildTarget);
}

// Tag-scoped Actions caches cannot see caches from earlier release tags.
export async function findRuntimeArtifact(repository, key, api) {
  const { artifacts } = await api(`/repos/${repository}/actions/artifacts?name=${encodeURIComponent(key)}&per_page=20`);
  for (const artifact of artifacts) {
    if (artifact.name !== key || artifact.expired || !artifact.workflow_run?.id) continue;
    const workflow = await api(`/repos/${repository}/actions/runs/${artifact.workflow_run.id}`);
    if (workflow.conclusion === "success" && workflow.path === ".github/workflows/desktop.yml" && workflow.head_repository?.full_name === repository) return artifact;
  }
  return undefined;
}

async function output(name, value) {
  if (process.env.GITHUB_OUTPUT) await appendFile(process.env.GITHUB_OUTPUT, `${name}=${value}\n`);
}

async function github(route) {
  const response = await fetch(`https://api.github.com${route}`, {
    headers: { Authorization: `Bearer ${process.env.GH_TOKEN}`, Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28" },
    signal: AbortSignal.timeout(600000),
  });
  if (!response.ok) throw Error(`Runtime cache API returned ${response.status}`);
  return response;
}

async function restore() {
  const work = await mkdtemp(path.join(tmpdir(), "music-runtime-cache-"));
  try {
    const artifact = await findRuntimeArtifact(process.env.GITHUB_REPOSITORY, process.env.RUNTIME_CACHE_KEY, async route => (await github(route)).json());
    if (!artifact) { console.log("No shared native runtime cache; the normal build will prepare it."); return; }
    if (process.env.RUNTIME_CACHE_HIT === "true") { await output("available", "true"); return; }
    const archive = path.join(work, "cache.zip");
    const response = await github(`/repos/${process.env.GITHUB_REPOSITORY}/actions/artifacts/${artifact.id}/zip`);
    await pipeline(Readable.fromWeb(response.body), createWriteStream(archive));
    if (artifact.digest && artifact.digest !== `sha256:${await hash(archive)}`) throw Error("Runtime cache archive checksum mismatch");
    const unpacked = path.join(work, "unpacked"); await mkdir(unpacked);
    await run(platform === "windows" ? tar : "unzip", platform === "windows" ? ["-xf", archive, "-C", unpacked] : ["-q", archive, "-d", unpacked]);
    await run(tar, ["-xzf", path.join(unpacked, "runtime.tar.gz"), "-C", unpacked]);
    await verifyEngine(path.join(unpacked, "engine"));
    await verifyTitle(path.join(unpacked, "engine/title"));
    if (platform === "windows" && !await exists(path.join(unpacked, "WebView2/msedgewebview2.exe"))) throw Error("Cached WebView2 runtime is incomplete");
    for (const folder of platform === "windows" ? ["engine", "WebView2"] : ["engine"]) {
      await rm(path.join(resources, folder), { recursive: true, force: true });
      await cp(path.join(unpacked, folder), path.join(resources, folder), { recursive: true, verbatimSymlinks: true });
    }
    await output("restored", "true"); await output("available", "true");
    console.log(`Reused verified ${platform}/${architecture}/${target.backend || "native"} runtime from run ${artifact.workflow_run.id}.`);
  } catch (error) {
    console.log(`::warning::Native runtime cache unavailable: ${error.message}. Falling back to a normal build.`);
  } finally { await rm(work, { recursive: true, force: true }); }
}

async function pack() {
  await verifyEngine(path.join(resources, "engine")); await verifyTitle();
  const directory = await mkdtemp(path.join(tmpdir(), "music-runtime-artifact-"));
  const archive = path.join(directory, "runtime.tar.gz");
  // The inner tar preserves executable permissions and symlinks across artifact ZIPs.
  await run(tar, ["-czf", archive, "-C", resources, "engine", ...(platform === "windows" ? ["WebView2"] : [])]);
  await output("archive", archive);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const command = process.argv[2];
  if (command === "key") {
    const key = await runtimeCacheKey(); console.log(key); await output("key", key); await output("prefix", await runtimeCachePrefix());
  }
  else if (command === "prepare") {
    await prepareEngine();
    if (platform === "windows") await prepareWebView();
  }
  else if (command === "check-ace") {
    const previous = await readFile(path.join(engineFolder, "VERSION.desktop.json"), "utf8").then(JSON.parse).catch(() => undefined);
    const { "ace-step": ace } = await componentRecipes();
    const reusable = await reusableComponents(engineFolder, { "ace-step": ace }, previous);
    await output("build", String(!reusable.has("ace-step")));
  }
  else if (command === "restore") await restore();
  else if (command === "pack") await pack();
  else throw Error(`Unknown runtime cache command: ${command}`);
}
