import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { cp, lstat, mkdir, readFile, readdir, readlink, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import catalog from "../../models/catalog.json" with { type: "json" };
import { aceMacPlugin, architecture, exists, hash, platform, root, run, target } from "./common.mjs";
import { engineManifestName, engineAssetName } from "./release-assets.mjs";

const optional = [
  ["audio-cpp", "providers/audio.cpp/audiocpp_cli", /^providers\/audio\.cpp$/],
  ["yue2", "yue2/yue-synth", /^(yue2|LICENSE-yue2.*)$/],
  ["magenta", "magenta/mrt2-record", /^magenta$/],
  ["audiocraft", "audiocraft/audiocraft-synth", /^audiocraft$/],
  ["diffrhythm2", "diffrhythm2/diffrhythm2-synth", /^diffrhythm2$/],
];
const pytorchFiles = /^(mimetic-synth|pytorch|text2midi)$/;

export const releaseTarget = `${platform}-${architecture}${target.backend === "cuda" ? "-cuda" : ""}`;
export const utilityResources = path.join(root, "src-tauri/resources/desktop-utilities");
const crt = /^(vcruntime140(?:_1)?|msvcp140(?:_[12])?|concrt140)\.dll$/i;
const utility = /^(mp3-codec(?:\.exe)?|title)$/;
const metadata = /^(\.gitkeep|VERSION\.desktop\.json)$/;

async function copyEntries(source, destination, entries) {
  for (const entry of entries) {
    const to = path.join(destination, entry);
    await mkdir(path.dirname(to), { recursive: true });
    await cp(path.join(source, entry), to, { recursive: true, verbatimSymlinks: true });
  }
}

async function expandedBytes(folder) {
  let bytes = 0;
  for (const entry of await readdir(folder)) {
    const file = path.join(folder, entry), info = await lstat(file);
    bytes += info.isDirectory() ? await expandedBytes(file)
      : info.isSymbolicLink() ? Buffer.byteLength(await readlink(file))
        : info.size;
  }
  return bytes;
}

export async function packageEngines({ source, provenance, version, output, work, utilities = utilityResources }) {
  const ace = platform === "macos" ? aceMacPlugin : platform === "windows" ? "ace-server.exe" : "ace-server";
  const entries = (await readdir(source)).flatMap(entry => entry === "providers" ? ["providers/audio.cpp"] : [entry]);
  await rm(utilities, { recursive: true, force: true });
  await copyEntries(source, utilities, entries.filter(entry => utility.test(entry) || crt.test(entry)));
  // Publish the codec notices with the shared MP3 executable.
  await copyEntries(source, utilities, entries.filter(entry => /^LICENSE(?!-yue2)/i.test(entry)));

  const aceFiles = entries.filter(entry =>
    !utility.test(entry) && !metadata.test(entry) &&
    !pytorchFiles.test(entry) && entry !== "mimetic-python" &&
    !optional.some(([, , match]) => match.test(entry)) &&
    !(platform === "macos" && entry === "ace-server")
  );
  const specs = [["ace-step", ace, aceFiles, `${provenance.revision}:${provenance.recipe_sha256}`]];
  if (await exists(path.join(source, "pytorch/PYTORCH_RUNTIME.json"))) {
    const { details, recipe } = JSON.parse(await readFile(path.join(source, "pytorch/PYTORCH_RUNTIME.json"), "utf8"));
    const revision = `${details.torch}:${createHash("sha256").update(JSON.stringify(recipe)).digest("hex")}`;
    specs.push(["pytorch", "mimetic-synth", entries.filter(entry => pytorchFiles.test(entry)), revision, ["text2midi/text2midi-runner", "pytorch/stem-runner"]]);
  }
  for (const [id, executable, match] of optional) {
    if (!await exists(path.join(source, executable))) continue;
    const profile = catalog.profiles.find(({ runtime }) =>
      (runtime.packaged_executable || runtime.executable) === `engine/${executable}`);
    assert(profile, `Missing catalog entry for ${executable}`);
    const revision = platform === "macos"
      ? `${profile.runtime.revision}:macos-plugin-v1`
      : profile.runtime.revision;
    specs.push([id, executable, entries.filter(entry => match.test(entry)), revision]);
  }

  const packages = [];
  for (const [id, executable, inventory, revision, additionalExecutables = []] of specs) {
    const staged = path.join(work, id);
    const engine = path.join(staged, "engine");
    await copyEntries(source, engine, inventory);
    for (const entry of [executable, ...additionalExecutables]) {
      assert(await exists(path.join(engine, entry)), `Missing ${id} executable ${entry}`);
    }
    const file = engineAssetName(version, releaseTarget, id);
    const archive = path.join(output, file);
    await rm(archive, { force: true });
    if (platform === "windows") await run("tar.exe", ["-a", "-cf", archive, "-C", staged, "engine"]);
    else await run("zip", ["-q", "-y", "-r", archive, "engine"], { cwd: staged });
    const { size } = await stat(archive);
    const additional_executables = additionalExecutables.map(entry => `engine/${entry}`);
    packages.push({ id, executable: `engine/${executable}`, ...(additional_executables.length && { additional_executables }),
      revision, file, sha256: await hash(archive), bytes: size, unpacked_bytes: await expandedBytes(staged) });
    await rm(staged, { recursive: true, force: true });
  }
  const manifest = path.join(output, engineManifestName(releaseTarget));
  const tag = process.env.MUSIC_GENERATOR_UPDATE_BUILD || `v${version}`;
  await writeFile(manifest, JSON.stringify({ format: 1, tag, packages }, null, 2) + "\n");
  return { manifest, artifacts: [...packages.map(({ file }) => path.join(output, file)), manifest] };
}
