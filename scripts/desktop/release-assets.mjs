import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { lstat, readFile, readdir } from "node:fs/promises";
import path from "node:path";

const suffixes = {
  "macos-arm64": ["macos-arm64.dmg", "macos-arm64.zip"],
  "macos-x64": ["macos-x64.dmg", "macos-x64.zip"],
  "windows-x64": ["windows-x64.zip", "windows-x64.msi"],
  "linux-x64": ["linux-x64.AppImage"],
  "linux-x64-cuda": ["linux-x64-cuda.AppImage"],
};

export const releaseTargets = Object.freeze(Object.keys(suffixes));
export const appcastName = target => `appcast-${target}.xml`;
export const engineManifestName = target => `engine-packages-${target}.json`;
export const engineAssetName = (version, target, id) => `Music-Generator-Engine-${id}-${version}-${target}.zip`;

// Release tags must identify the exact version shared by all application manifests.
export function validateReleaseVersion(tag, versions) {
  assert(versions.length === 3 && versions.every(version => typeof version === "string" && version.length > 0), "Missing application version");
  assert(versions.every(version => tag === `v${version}`), "Release tag and application versions differ");
}

export async function applicationVersions(root) {
  const pkg = JSON.parse(await readFile(path.join(root, "package.json"), "utf8"));
  const tauri = JSON.parse(await readFile(path.join(root, "src-tauri/tauri.conf.json"), "utf8"));
  const cargo = await readFile(path.join(root, "src-tauri/Cargo.toml"), "utf8");
  const packageSection = cargo.match(/^\[package\]\s*\n([\s\S]*?)(?=^\[|$(?![\s\S]))/m)?.[1];
  return [pkg.version, packageSection?.match(/^version\s*=\s*"([^"]+)"\s*$/m)?.[1], tauri.version];
}

export function expectedAssets(tag, target) {
  assert(/^v\d+\.\d+\.\d+(?:-[\da-zA-Z.-]+)?(?:\+[\da-zA-Z.-]+)?$/.test(tag), "Invalid release tag");
  assert(Object.hasOwn(suffixes, target), `Unknown release platform: ${target}`);
  return suffixes[target].flatMap(suffix => {
    const name = `Music-Generator-${tag.slice(1)}-${suffix}`;
    return [name, `${name}.sha256`];
  });
}

export async function sha256(file) {
  const digest = createHash("sha256");
  for await (const chunk of createReadStream(file)) digest.update(chunk);
  return digest.digest("hex");
}

// Validate the entire platform set before allowing any release mutation.
export async function validateAssets(tag, target, directory, { requireAppcast = false, releaseTag = tag } = {}) {
  const desktop = expectedAssets(tag, target);
  const actual = await readdir(directory);
  const manifest = engineManifestName(target);
  assert(actual.includes(manifest), "Release files are missing or unexpected: missing engine manifest");
  const file = path.join(directory, manifest);
  assert((await lstat(file)).isFile(), "Engine manifest must be a regular file");
  const engines = JSON.parse(await readFile(file, "utf8"));
  assert(engines.format === 1 && engines.tag === releaseTag && Array.isArray(engines.packages), "Invalid engine release manifest");
  const packages = new Map();
  for (const entry of engines.packages) {
    assert(typeof entry.id === "string" && /^[a-z][a-z0-9-]*$/.test(entry.id), "Invalid engine ID");
    assert(entry.file === engineAssetName(tag.slice(1), target, entry.id) && !packages.has(entry.file), "Invalid engine asset name");
    assert(/^[a-f0-9]{64}$/.test(entry.sha256) && Number.isSafeInteger(entry.bytes) && entry.bytes > 0 && Number.isSafeInteger(entry.unpacked_bytes) && entry.unpacked_bytes > 0, "Invalid engine asset metadata");
    assert(entry.bytes < 2 * 1024 ** 3, `GitHub release asset exceeds 2 GiB: ${entry.file}`);
    packages.set(entry.file, entry);
  }
  assert(packages.has(engineAssetName(tag.slice(1), target, "ace-step")), "ACE-Step release asset is missing");
  const names = [...[...packages.keys(), manifest].flatMap(name => [name, `${name}.sha256`]), ...desktop];
  if (target.startsWith("macos-")) {
    const appcast = appcastName(target);
    if (requireAppcast || actual.includes(appcast)) names.push(appcast, `${appcast}.sha256`);
  }
  assert.deepEqual(actual.sort(), [...names].sort(), "Release files are missing or unexpected");
  const assets = [];
  for (const name of names) {
    const file = path.join(directory, name);
    const info = await lstat(file);
    assert(info.isFile(), `Release asset must be a regular file: ${name}`);
    const digest = await sha256(file);
    const engine = packages.get(name);
    if (engine) assert(engine.sha256 === digest && engine.bytes === info.size, `Engine archive does not match manifest: ${name}`);
    assets.push({ name, file, digest: `sha256:${digest}` });
  }
  for (const asset of assets.filter(asset => !asset.name.endsWith(".sha256"))) {
    const checksum = await readFile(`${asset.file}.sha256`, "utf8");
    assert.equal(checksum.trimEnd(), `${asset.digest.slice(7)}  ${asset.name}`, `Invalid checksum: ${asset.name}`);
  }
  return assets;
}
