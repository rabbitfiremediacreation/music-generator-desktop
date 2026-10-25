import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { lstat, readFile, readdir } from "node:fs/promises";
import path from "node:path";

const suffixes = {
  "macos-arm64": ["macos-arm64.dmg", "macos-arm64.zip"],
  "macos-x64": ["macos-x64.dmg", "macos-x64.zip"],
  "windows-x64": ["windows-x64.zip"],
  "linux-x64": ["linux-x64.AppImage"],
  "linux-x64-cuda": ["linux-x64-cuda.AppImage"],
};

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
export async function validateAssets(tag, target, directory) {
  const names = expectedAssets(tag, target);
  assert.deepEqual((await readdir(directory)).sort(), [...names].sort(), "Release files are missing or unexpected");
  const assets = [];
  for (const name of names) {
    const file = path.join(directory, name);
    assert((await lstat(file)).isFile(), `Release asset must be a regular file: ${name}`);
    assets.push({ name, file, digest: `sha256:${await sha256(file)}` });
  }
  for (const asset of assets.filter(asset => !asset.name.endsWith(".sha256"))) {
    const checksum = await readFile(`${asset.file}.sha256`, "utf8");
    assert.equal(checksum.trimEnd(), `${asset.digest.slice(7)}  ${asset.name}`, `Invalid checksum: ${asset.name}`);
  }
  return assets;
}
