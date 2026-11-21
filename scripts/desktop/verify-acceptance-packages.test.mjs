import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { engineAssetName, engineManifestName, sha256 } from "./release-assets.mjs";

const script = fileURLToPath(new URL("./verify-acceptance-packages.mjs", import.meta.url));
const packageSuffixes = {
  "macos-arm64": ["macos-arm64.dmg", "macos-arm64.zip"],
  "macos-x64": ["macos-x64.dmg", "macos-x64.zip"],
  "windows-x64": ["windows-x64.zip", "windows-x64.msi"],
  "linux-x64": ["linux-x64.AppImage"],
  "linux-x64-cuda": ["linux-x64-cuda.AppImage"],
};

async function packagesFixture(t, version = "0.3.0") {
  const root = await mkdtemp(path.join(tmpdir(), "music-acceptance-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const packages = [];
  for (const [target, suffixes] of Object.entries(packageSuffixes)) {
    const directory = path.join(root, `Music-Generator-${target}`);
    await mkdir(directory);
    const engine = engineAssetName(version, target, "ace-step");
    const archive = path.join(directory, engine);
    const contents = "Engine archive fixture";
    await writeFile(archive, contents);
    const digest = await sha256(archive);
    await writeFile(`${archive}.sha256`, `${digest}  ${engine}\n`);
    packages.push({ target, name: engine, sha256: digest });
    const manifest = engineManifestName(target);
    const record = path.join(directory, manifest);
    await writeFile(record, JSON.stringify({ format: 1, tag: `v${version}`, packages: [{ id: "ace-step", file: engine, sha256: digest, bytes: contents.length, unpacked_bytes: 25 }] }));
    const recordDigest = await sha256(record);
    await writeFile(`${record}.sha256`, `${recordDigest}  ${manifest}\n`);
    packages.push({ target, name: manifest, sha256: recordDigest });
    for (const suffix of suffixes) {
      const name = `Music-Generator-${version}-${suffix}`;
      const file = path.join(directory, name);
      await writeFile(file, `Package fixture: ${name}`);
      const digest = await sha256(file);
      await writeFile(`${file}.sha256`, `${digest}  ${name}\n`);
      packages.push({ target, name, sha256: digest });
    }
  }
  return { root, packages };
}

function verify(root) {
  return spawnSync(process.execPath, [script, "v0.3.0", root], { encoding: "utf8" });
}

test("inventories checksummed desktop and engine packages with separate Intel and CUDA artifacts", async t => {
  const { root, packages } = await packagesFixture(t);
  const result = verify(root);
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout), { packageVersion: "0.3.0", packages });
});

test("rejects an issue build with no CUDA package and produces no complete inventory", async t => {
  const { root } = await packagesFixture(t);
  await rm(path.join(root, "Music-Generator-linux-x64-cuda"), { recursive: true });
  const result = verify(root);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /Invalid linux-x64-cuda artifact/);
  assert.equal(result.stdout, "");
});

test("rejects an old version even when all its release checksums match", async t => {
  const { root } = await packagesFixture(t, "0.2.0");
  const result = verify(root);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /Invalid engine release manifest/);
  assert.equal(result.stdout, "");
});

test("rejects a changed package even when the expected sidecar is present", async t => {
  const { root } = await packagesFixture(t);
  const name = "Music-Generator-0.3.0-windows-x64.msi";
  await writeFile(path.join(root, "Music-Generator-windows-x64", name), "changed fixture");
  const result = verify(root);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /Invalid checksum: Music-Generator-0\.3\.0-windows-x64\.msi/);
  assert.equal(result.stdout, "");
});
